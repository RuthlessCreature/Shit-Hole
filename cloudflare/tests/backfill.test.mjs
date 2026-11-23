import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseTradeCalendar, runBackfill, storeHistoricalQuotesInD1 } from '../src/backfill.mjs';
import { collectDay } from '../src/index.mjs';

test('calendar starts at the first actual session after New Year and stays sorted', () => {
  const days = parseTradeCalendar({ code: 0, data: { rows: [
    { date: '2020-01-02' }, { date: '2020-01-03' }, { date: '2020-01-06' },
  ] } }, '2020-01-01', '2020-01-10');
  assert.deepEqual(days, ['2020-01-02', '2020-01-03', '2020-01-06']);
});

test('calendar refuses duplicates, out-of-order days, invalid days and out-of-range days', () => {
  const wrap = days => ({ data: { rows: days.map(date => ({ date })) } });
  for (const days of [
    ['2020-01-02', '2020-01-02'],
    ['2020-01-03', '2020-01-02'],
    ['2020-01-34'],
    ['2019-12-31'],
    [],
  ]) {
    assert.throws(() => parseTradeCalendar(wrap(days), '2020-01-01', '2020-01-10'));
  }
});

test('deep history stays R2-only, recent sessions can also be indexed in D1', () => {
  const now = new Date('2026-11-23T08:00:00Z');
  assert.equal(storeHistoricalQuotesInD1('2020-01-02', now), false);
  assert.equal(storeHistoricalQuotesInD1('2026-11-20', now), true);
});

function fakeBackfillEnv() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql', '0002_backfill.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const objects = new Map();
  const DB = {
    prepare(sql) {
      const wrap = args => ({
          async run() { return { meta: sqlite.prepare(sql).run(...args) }; },
          async first() { return sqlite.prepare(sql).get(...args) ?? null; },
          async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        });
      return { ...wrap([]), bind(...args) { return wrap(args); } };
    },
    async batch(statements) { return Promise.all(statements.map(s => s.run())); },
  };
  const RAW = { async put(key, raw) { objects.set(key, raw); } };
  return { sqlite, objects, env: { DB, RAW, TOP369_API_KEY: 'dummy-test-key', MIN_A_COUNT: '5000', MIN_CB_COUNT: '200' } };
}

test('three-date pilot preserves history in R2, records audit in D1, then pauses', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const requested = new URL(url);
    if (requested.pathname.endsWith('/trade_calendar')) {
      return Response.json({ code: 0, data: { rows: [
        { date: '2020-01-02' }, { date: '2020-01-03' }, { date: '2020-01-06' },
      ] } });
    }
    const day = requested.searchParams.get('date');
    return Response.json({ code: 0, data: { rows: [{ code: 'sh600567', name: '测试', date: day,
      open: 1, high: 1.2, low: 0.9, close: 1.1, volume: 123, amount: 456, turnover: 1 }] } });
  };
  const { sqlite, objects, env } = fakeBackfillEnv();
  try {
    for (const day of ['2020-01-02', '2020-01-03', '2020-01-06']) {
      const result = await runBackfill(env, collectDay);
      assert.equal(result.trade_date, day);
      assert.equal(result.status, 'PARTIAL');
      assert.equal(result.quote_storage, 'R2_ONLY');
    }
    const control = sqlite.prepare('SELECT * FROM backfill_control WHERE id=1').get();
    assert.equal(control.enabled, 0);
    assert.equal(control.state, 'PILOT_COMPLETE');
    assert.equal(control.attempts, 3);
    assert.equal(control.calendar_rows, 3);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM market_runs').get().n, 3);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM market_quotes').get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM backfill_days WHERE status='STORED_UNVERIFIED'").get().n, 3);
    assert.equal(objects.size, 10); // 1 calendar + 3 raw/normalized/manifest bundles
    assert.equal((await runBackfill(env, collectDay)).status, 'PAUSED_OR_LOCKED');
  } finally { globalThis.fetch = original; sqlite.close(); }
});

test('HTTP 429 stops the historical pilot after one attempt without retry loops', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('trade_calendar')
    ? Response.json({ code: 0, data: { rows: [{ date: '2020-01-02' }] } })
    : new Response('too many requests', { status: 429 });
  const { sqlite, env } = fakeBackfillEnv();
  try {
    const result = await runBackfill(env, collectDay);
    assert.equal(result.status, 'BLOCKED');
    const control = sqlite.prepare('SELECT * FROM backfill_control WHERE id=1').get();
    assert.equal(control.enabled, 0);
    assert.equal(control.state, 'BLOCKED');
    assert.equal(control.attempts, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM market_runs WHERE status='BLOCKED'").get().n, 1);
  } finally { globalThis.fetch = original; sqlite.close(); }
});
