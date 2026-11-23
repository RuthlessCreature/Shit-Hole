import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { chinaQuotaWindow, MAX_CHINA_DAY_CALLS, processQueueBackfill } from '../src/queue.mjs';

function envWithDays(days = ['2020-01-07', '2020-01-08']) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql', '0002_backfill.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  sqlite.exec("UPDATE backfill_control SET state='RUNNING',enabled=1,attempt_limit=0,calendar_rows=2,calendar_loaded_at='2026-11-23T00:00:00Z' WHERE id=1");
  for (const day of days) sqlite.prepare('INSERT INTO backfill_days(trade_date) VALUES(?)').run(day);
  const queued = [];
  const DB = {
    prepare(sql) {
      const wrap = params => ({
        async run() { return { meta: sqlite.prepare(sql).run(...params) }; },
        async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
      });
      return { ...wrap([]), bind(...params) { return wrap(params); } };
    },
    async batch(statements) { for (const s of statements) await s.run(); },
  };
  const env = {
    DB, RAW: { async put() {} },
    BACKFILL_QUEUE: { async send(body, options) { queued.push({ body, options }); } },
  };
  return { sqlite, env, queued };
}

test('China day quota window handles UTC midnight without confusing exchange dates', () => {
  const w = chinaQuotaWindow(new Date('2026-11-23T17:15:00Z'));
  assert.equal(w.day, '2026-11-24');
  assert.equal(w.start, '2026-11-23T16:00:00.000Z');
  assert.equal(w.end, '2026-11-24T16:00:00.000Z');
  assert.ok(w.resumeDelaySeconds > 0 && w.resumeDelaySeconds <= 86400);
});

test('queue immediately chains dates and stops cleanly after the full calendar is done', async () => {
  const { sqlite, env, queued } = envWithDays();
  const observed = [];
  const collectDay = async (_env, day, trigger, options) => {
    observed.push({ day, trigger, options });
    return { status: 'PARTIAL', run_id: 'run-'+day, quote_storage: 'R2_ONLY' };
  };
  try {
    const one = await processQueueBackfill(env, collectDay);
    assert.equal(one.status, 'PARTIAL');
    assert.equal(one.next_queued, true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].options, undefined); // immediate, not a five-minute delay
    const two = await processQueueBackfill(env, collectDay);
    assert.equal(two.status, 'PARTIAL');
    assert.equal(queued.length, 2);
    const complete = await processQueueBackfill(env, collectDay);
    assert.equal(complete.status, 'FINISHED');
    assert.equal(queued.length, 2);
    assert.deepEqual(observed.map(x => x.day), ['2020-01-07', '2020-01-08']);
    assert.equal(sqlite.prepare('SELECT enabled FROM backfill_control WHERE id=1').get().enabled, 0);
  } finally { sqlite.close(); }
});

test('queue defers until next China day after reaching source request budget', async () => {
  const { sqlite, env, queued } = envWithDays();
  const now = new Date('2026-11-23T08:00:00Z');
  const insert = sqlite.prepare('INSERT INTO market_runs(id,trade_date,source,started_at,status) VALUES(?,?,?,?,?)');
  for (let n = 0; n < MAX_CHINA_DAY_CALLS; n++) {
    insert.run('mock-'+n, '2026-11-23', '369_day_kline', now.toISOString(), 'PROVISIONAL');
  }
  try {
    const result = await processQueueBackfill(env, async () => { throw Error('provider must not be called'); }, now);
    assert.equal(result.status, 'WAITING_QUOTA');
    assert.equal(result.calls_today, MAX_CHINA_DAY_CALLS);
    assert.equal(queued.length, 1);
    assert.ok(queued[0].options.delaySeconds > 0);
    assert.equal(sqlite.prepare('SELECT state FROM backfill_control WHERE id=1').get().state, 'WAITING_QUOTA');
  } finally { sqlite.close(); }
});

test('BaoStock source is not blocked by unrelated 369 daily quota', async () => {
  const { sqlite, env, queued } = envWithDays(['2020-01-07']);
  env.PRIMARY_MARKET_SOURCE = 'baostock';
  const now = new Date('2026-11-23T08:00:00Z');
  const insert = sqlite.prepare('INSERT INTO market_runs(id,trade_date,source,started_at,status) VALUES(?,?,?,?,?)');
  for (let n = 0; n < MAX_CHINA_DAY_CALLS; n++) {
    insert.run('mock-'+n, '2026-11-23', '369_day_kline', now.toISOString(), 'PROVISIONAL');
  }
  try {
    const result = await processQueueBackfill(env, async () =>
      ({ status: 'PROVISIONAL', run_id: 'baostock-day' }), now);
    assert.equal(result.status, 'PROVISIONAL');
    assert.equal(result.next_queued, true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].options, undefined);
  } finally { sqlite.close(); }
});

test('HTTP 429 pauses source calls until next day but keeps the blocked trading date pending', async () => {
  const { sqlite, env, queued } = envWithDays(['2020-01-07']);
  try {
    const result = await processQueueBackfill(env,
      async () => ({ status: 'BLOCKED', error: 'HTTP_429_STOP', run_id: 'blocked-run' }),
      new Date('2026-11-23T08:00:00Z'));
    assert.equal(result.status, 'WAITING_QUOTA');
    assert.equal(result.trade_date, '2020-01-07');
    assert.equal(queued.length, 1);
    assert.ok(queued[0].options.delaySeconds > 0);
    assert.equal(sqlite.prepare('SELECT status FROM backfill_days WHERE trade_date=?').get('2020-01-07').status, 'PENDING');
    const c = sqlite.prepare('SELECT enabled,state FROM backfill_control WHERE id=1').get();
    assert.equal(c.enabled, 1);
    assert.equal(c.state, 'WAITING_QUOTA');
  } finally { sqlite.close(); }
});

test('401/403 source access loss stops the chain without a retry', async () => {
  const { sqlite, env, queued } = envWithDays(['2020-01-07']);
  try {
    const result = await processQueueBackfill(env,
      async () => ({ status: 'BLOCKED', error: 'HTTP_403_STOP', run_id: 'denied-run' }));
    assert.equal(result.status, 'BLOCKED');
    assert.equal(queued.length, 0);
    assert.equal(sqlite.prepare('SELECT enabled FROM backfill_control WHERE id=1').get().enabled, 0);
  } finally { sqlite.close(); }
});
