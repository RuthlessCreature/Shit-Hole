import { providerRows, requireTradingDate, safeError } from './core.mjs';

const CALENDAR_API = 'https://api.369.top/api/a/market/trade_calendar';
const COLD_WINDOW_DAYS = 45;
const MAX_TRANSIENT_DAY_ATTEMPTS = 3;

export function parseTradeCalendar(payload, start, end) {
  requireTradingDate(start);
  requireTradingDate(end);
  if (start > end) throw new Error('BACKFILL_DATE_RANGE_INVALID');
  const records = providerRows(payload);
  const days = [];
  const seen = new Set();
  for (const record of records) {
    const day = record?.date;
    requireTradingDate(day);
    if (day < start || day > end || seen.has(day)) {
      throw new Error('BACKFILL_CALENDAR_INVALID_OR_DUPLICATE_DATE');
    }
    seen.add(day);
    days.push(day);
  }
  if (!days.length) throw new Error('BACKFILL_CALENDAR_EMPTY');
  if (days.some((day, index) => index > 0 && day <= days[index - 1])) {
    throw new Error('BACKFILL_CALENDAR_NOT_SORTED');
  }
  return days;
}

export function storeHistoricalQuotesInD1(day, now = new Date()) {
  requireTradingDate(day);
  return Date.parse(`${day}T00:00:00Z`) >= now.getTime() - COLD_WINDOW_DAYS * 86400000;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), x => x.toString(16).padStart(2, '0')).join('');
}

async function seedCalendar(env, control) {
  if (!env.TOP369_API_KEY) throw new Error('TOP369_API_KEY_NOT_CONFIGURED');
  const start = control.start_date;
  const end = control.end_date;
  const url = `${CALENDAR_API}?start_date=${start}&end_date=${end}`;
  const res = await fetch(url, {
    headers: { 'X-API-Key': env.TOP369_API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(45000),
  });
  if ([401, 403, 429].includes(res.status)) throw new Error(`HTTP_${res.status}_STOP`);
  if (!res.ok) throw new Error(`CALENDAR_HTTP_${res.status}`);
  const raw = await res.text();
  if (raw.length > 500000) throw new Error('CALENDAR_RESPONSE_TOO_LARGE');
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error('CALENDAR_NOT_JSON'); }
  const days = parseTradeCalendar(payload, start, end);
  const key = `logic-b/369/calendar/${start}_${end}/provider.json`;
  await env.RAW.put(key, raw, { httpMetadata: { contentType: 'application/json' } });
  // SQLite variable limits: 40 dates per statement, 20 statements per D1 batch.
  let statements = [];
  for (let pos = 0; pos < days.length; pos += 40) {
    const subset = days.slice(pos, pos + 40);
    const sql = `INSERT OR IGNORE INTO backfill_days (trade_date) VALUES ${subset.map(() => '(?)').join(',')}`;
    statements.push(env.DB.prepare(sql).bind(...subset));
    if (statements.length === 20 || pos + 40 >= days.length) {
      await env.DB.batch(statements);
      statements = [];
    }
  }
  await env.DB.prepare(`UPDATE backfill_control SET calendar_rows=?,calendar_raw_key=?,
    calendar_sha256=?,calendar_loaded_at=?,updated_at=? WHERE id=1`)
    .bind(days.length, key, await sha256(raw), new Date().toISOString(), new Date().toISOString()).run();
  return days.length;
}

export async function runBackfill(env, collectDay) {
  if (!env.DB || !env.RAW) throw new Error('BACKFILL_BINDINGS_MISSING');
  const now = new Date();
  const claimed = await env.DB.prepare(`UPDATE backfill_control SET lock_until=?,updated_at=?
    WHERE id=1 AND enabled=1 AND (lock_until IS NULL OR lock_until<?)`)
    .bind(new Date(now.getTime() + 10 * 60 * 1000).toISOString(), now.toISOString(), now.toISOString()).run();
  if (claimed.meta?.changes !== 1) return { status: 'PAUSED_OR_LOCKED' };
  try {
    const control = await env.DB.prepare('SELECT * FROM backfill_control WHERE id=1').first();
    // attempt_limit=0 means the full calendar, with no artificial pilot cap.
    if (control.attempt_limit > 0 && control.attempts >= control.attempt_limit) {
      await env.DB.prepare("UPDATE backfill_control SET enabled=0,state='PILOT_COMPLETE' WHERE id=1").run();
      return { status: 'PILOT_COMPLETE', attempts: control.attempts };
    }
    let calendarRows = control.calendar_rows;
    if (!control.calendar_loaded_at) calendarRows = await seedCalendar(env, control);
    const target = await env.DB.prepare(`SELECT trade_date,attempts FROM backfill_days
      WHERE status='PENDING' ORDER BY trade_date LIMIT 1`).first();
    if (!target) {
      const failures = await env.DB.prepare("SELECT COUNT(*) AS n FROM backfill_days WHERE status IN ('FAILED','BLOCKED')").first();
      const state = Number(failures?.n || 0) > 0 ? 'FINISHED_WITH_GAPS' : 'FINISHED';
      await env.DB.prepare('UPDATE backfill_control SET enabled=0,state=?,updated_at=? WHERE id=1')
        .bind(state, new Date().toISOString()).run();
      return { status: state, calendar_rows: calendarRows, failed_days: Number(failures?.n || 0) };
    }
    const date = target.trade_date;
    const claimDay = await env.DB.prepare(`UPDATE backfill_days SET status='RUNNING',
      attempts=attempts+1,updated_at=? WHERE trade_date=? AND status='PENDING'`)
      .bind(new Date().toISOString(), date).run();
    if (claimDay.meta?.changes !== 1) return { status: 'DAY_ALREADY_CLAIMED' };
    const result = await collectDay(env, date, 'cron:history', {
      storeQuotes: storeHistoricalQuotesInD1(date),
    });
    const done = ['PROVISIONAL', 'PARTIAL'].includes(result.status);
    const retry = result.status === 'FAILED' && target.attempts + 1 < MAX_TRANSIENT_DAY_ATTEMPTS;
    await env.DB.prepare(`UPDATE backfill_days SET status=?,last_run_id=?,last_error=?,updated_at=?
      WHERE trade_date=?`).bind(done ? 'STORED_UNVERIFIED' : retry ? 'PENDING' : result.status,
      result.run_id ?? null, result.error ?? null, new Date().toISOString(), date).run();
    const attempts = control.attempts + 1;
    const blocked = result.status === 'BLOCKED';
    const pilotComplete = control.attempt_limit > 0 && attempts >= control.attempt_limit;
    await env.DB.prepare(`UPDATE backfill_control SET attempts=?,enabled=?,state=?,last_error=?,updated_at=? WHERE id=1`)
      .bind(attempts, blocked || pilotComplete ? 0 : 1,
        blocked ? 'BLOCKED' : pilotComplete ? 'PILOT_COMPLETE' : 'RUNNING',
        result.error ?? null, new Date().toISOString()).run();
    return { status: result.status, trade_date: date, run_id: result.run_id,
      quote_storage: result.quote_storage ?? null, retry_scheduled: retry,
      error: result.error ?? null, attempts, attempt_limit: control.attempt_limit };
  } catch (error) {
    const message = safeError(error);
    await env.DB.prepare(`UPDATE backfill_control SET enabled=0,state='BLOCKED_OR_FAILED',
      last_error=?,updated_at=? WHERE id=1`).bind(message, new Date().toISOString()).run();
    return { status: 'BLOCKED_OR_FAILED', error: message };
  } finally {
    await env.DB.prepare('UPDATE backfill_control SET lock_until=NULL WHERE id=1').run();
  }
}
