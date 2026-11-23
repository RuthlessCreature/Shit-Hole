import { runBackfill } from './backfill.mjs';
import { chinaToday } from './core.mjs';

// One authenticated full-market date request per stored day. Keep room for
// regular daily collection and other uses of a free-tier 500 calls/day key.
export const MAX_CHINA_DAY_CALLS = 450;
const RESUME_AFTER_MIDNIGHT_MS = 10 * 60 * 1000;
const NEXT_MESSAGE = { kind: 'backfill-next', schema_version: 1 };

export function chinaQuotaWindow(now = new Date()) {
  const day = chinaToday(now);
  const start = Date.parse(`${day}T00:00:00+08:00`);
  return {
    day,
    start: new Date(start).toISOString(),
    end: new Date(start + 86400000).toISOString(),
    resumeDelaySeconds: Math.min(86400, Math.max(60,
      Math.ceil((start + 86400000 + RESUME_AFTER_MIDNIGHT_MS - now.getTime()) / 1000))),
  };
}

async function sendNext(env, delaySeconds = 0) {
  const options = delaySeconds ? { delaySeconds } : undefined;
  await env.BACKFILL_QUEUE.send(NEXT_MESSAGE, options);
}

async function waitForQuota(env, now, reason) {
  const window = chinaQuotaWindow(now);
  await env.DB.prepare(`UPDATE backfill_control SET state='WAITING_QUOTA',updated_at=?
    WHERE id=1 AND enabled=1`).bind(now.toISOString()).run();
  await sendNext(env, window.resumeDelaySeconds);
  return { status: 'WAITING_QUOTA', reason, retry_after_seconds: window.resumeDelaySeconds };
}

/**
 * Called by the single-concurrency Queue consumer. Each message completes at
 * most one trading date, then enqueues the next immediately after persistence.
 * The D1 day claim protects against at-least-once Queue redelivery.
 */
export async function processQueueBackfill(env, collectDay, now = new Date()) {
  if (!env.DB || !env.RAW || !env.BACKFILL_QUEUE) throw new Error('QUEUE_BINDINGS_MISSING');
  const control = await env.DB.prepare('SELECT enabled,state FROM backfill_control WHERE id=1').first();
  if (!control || control.enabled !== 1) return { status: 'PAUSED' };

  const quota = chinaQuotaWindow(now);
  const usage = await env.DB.prepare(`SELECT COUNT(*) AS n FROM market_runs
    WHERE started_at>=? AND started_at<? AND source='369_day_kline'`)
    .bind(quota.start, quota.end).first();
  const callsToday = Number(usage?.n || 0);
  if (env.PRIMARY_MARKET_SOURCE !== 'baostock' && callsToday >= MAX_CHINA_DAY_CALLS) {
    return { ...(await waitForQuota(env, now, 'DAILY_REQUEST_BUDGET')), calls_today: callsToday };
  }

  if (control.state === 'WAITING_QUOTA') {
    await env.DB.prepare("UPDATE backfill_control SET state='RUNNING',updated_at=? WHERE id=1 AND enabled=1")
      .bind(now.toISOString()).run();
  }
  const result = await runBackfill(env, collectDay);

  if (result.status === 'BLOCKED' && result.error === 'HTTP_429_STOP') {
    // Obey provider rate limits: retain the failed run as evidence, return the
    // day to the pending queue and resume only after the next China midnight.
    await env.DB.prepare(`UPDATE backfill_days SET status='PENDING',updated_at=?
      WHERE trade_date=? AND status='BLOCKED'`)
      .bind(now.toISOString(), result.trade_date).run();
    await env.DB.prepare(`UPDATE backfill_control SET enabled=1,state='WAITING_QUOTA',updated_at=?
      WHERE id=1 AND state='BLOCKED'`)
      .bind(now.toISOString()).run();
    return { ...(await waitForQuota(env, now, 'HTTP_429_STOP')), trade_date: result.trade_date };
  }

  if (['PROVISIONAL', 'PARTIAL', 'FAILED'].includes(result.status)) {
    await sendNext(env);
    return { ...result, next_queued: true, calls_today: callsToday + 1 };
  }

  if (result.status === 'PAUSED_OR_LOCKED') {
    const status = await env.DB.prepare('SELECT enabled FROM backfill_control WHERE id=1').first();
    if (status?.enabled === 1) {
      await sendNext(env, 60);
      return { status: 'LOCKED_RETRY_QUEUED' };
    }
  }
  // FINISHED, FINISHED_WITH_GAPS, 401/403 BLOCKED, and fatal errors do not
  // enqueue another message. These remain visible on the public dashboard.
  return result;
}
