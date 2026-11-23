import test from 'node:test';
import assert from 'node:assert/strict';
import { assetOf, auditSnapshot, chinaToday, normalizeSnapshot, providerRows, requireTradingDate, safeError } from '../src/core.mjs';
import handler, { collectDay } from '../src/index.mjs';

const record = (code, fields = {}) => ({ code, date: '2026-11-20',
  open: 2, high: 2.2, low: 1.8, close: 2, volume: 100, amount: 200, turnover: 1, ...fields });

test('Asia/Shanghai dates are independent of server timezone', () => {
  assert.equal(chinaToday(new Date('2026-11-20T16:30:00Z')), '2026-11-21');
  assert.equal(chinaToday(new Date('2026-11-20T07:30:00Z')), '2026-11-20');
});

test('invalid calendar dates are rejected, including rollover', () => {
  assert.equal(requireTradingDate('2026-11-20'), '2026-11-20');
  for (const bad of ['2026-02-30', '2026-11-20T16:00:00', '2026-13-01', 'x']) {
    assert.throws(() => requireTradingDate(bad), /INVALID_DATE/);
  }
});

test('provider envelope accepts documented shapes and rejects provider errors', () => {
  assert.equal(providerRows([{ code: 'sh600567' }]).length, 1);
  assert.equal(providerRows({ code: 0, data: { rows: [1] } }).length, 1);
  assert.equal(providerRows({ data: { list: [1, 2] } }).length, 2);
  assert.throws(() => providerRows({ code: 401, message: 'unauthorized' }), /PROVIDER_ERROR/);
  assert.throws(() => providerRows({ data: {} }), /NO_ROWS/);
});

test('stocks, bonds, ETFs, and other instruments are retained separately', () => {
  const rows = ['sh600567', 'sz002146', 'bj920001', 'sh110001', 'sz123456', 'sh510300', 'sh000001']
    .map(symbol => record(symbol));
  const normalized = normalizeSnapshot(rows, '2026-11-20');
  assert.equal(normalized.valid.length, 7);
  assert.deepEqual(normalized.assets, {
    'A股': 3, '可转债候选': 2, 'ETF/基金候选': 1, '其他证券': 1,
  });
  assert.equal(assetOf('sh110001'), '可转债候选');
});

test('missing prices and zero-volume valid securities are preserved', () => {
  const rows = [record('sh600567', { open: null, high: null, low: null, close: null, volume: 0 })];
  const normalized = normalizeSnapshot(rows, '2026-11-20');
  assert.equal(normalized.valid.length, 1);
  assert.equal(normalized.valid[0].close, null);
  assert.equal(normalized.zeroVolume, 1);
});

test('invalid rows are audited, not silently coerced to zero', () => {
  const normalized = normalizeSnapshot([
    record('sh600567', { close: 'NaN' }),
    record('sh600567'),
    record('sh600567'),
    record('sz002146', { date: '2026-11-21' }),
    record('badcode'),
    record('sh110001', { high: 1.9 }),
  ], '2026-11-20');
  assert.equal(normalized.valid.length, 1);
  assert.equal(normalized.errors.length, 5);
  assert.equal(normalized.errors[0].reason, 'INVALID_OHLCV');
  assert.equal(normalized.errors[1].reason, 'DUPLICATE');
});

test('no verified-universe or mispricing claim is made from one source alone', () => {
  const normalized = normalizeSnapshot([record('sh600567')], '2026-11-20');
  const audit = auditSnapshot(1, normalized);
  assert.equal(audit.status, 'PARTIAL');
  assert.equal(audit.universe_verified, false);
  assert.ok(audit.warnings.includes('A_SHARE_COUNT_BELOW_BASELINE'));
});

test('provider secrets are not returned in errors', () => {
  assert.equal(safeError(new Error('bad sk-abcdefghijklmnopqrstuvwxyz01234')), 'bad [REDACTED]');
});

function fakeEnv() {
  const state = { runs: [], writes: [], objects: new Map() };
  const DB = {
    prepare(sql) {
      const statement = { sql, params: [], bind(...values) { this.params = values; return this; },
        async run() { state.writes.push({ sql: this.sql, params: this.params }); return { success: true }; },
        async first() { return null; }, async all() { return { results: [] }; } };
      return statement;
    },
    async batch(statements) { for (const statement of statements) await statement.run(); },
  };
  const RAW = { async put(key, value) { state.objects.set(key, value); } };
  return { env: { DB, RAW, TOP369_API_KEY: 'dummy-test-key', ADMIN_TOKEN: 'admin-test', READ_TOKEN: 'reader-test' }, state };
}

test('collector saves raw, normalized and manifest objects, plus auditable run', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, data: [record('sh600567'), record('sh110001')] }), { status: 200 });
  try {
    const { env, state } = fakeEnv();
    const result = await collectDay(env, '2026-11-20');
    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.normalized_rows, 2);
    assert.equal(state.objects.size, 3);
    assert.ok([...state.objects.keys()].some(key => key.endsWith('/provider.json')));
    const manifest = JSON.parse([...state.objects.values()].find(v => String(v).includes('"schema_version":1')));
    assert.equal(manifest.universe_verified, false);
    assert.equal(manifest.financial_valuation_verified, false);
    assert.ok(state.writes.some(x => x.sql.startsWith('INSERT INTO market_quotes')));
  } finally { globalThis.fetch = oldFetch; }
});

test('429 stops without any bypass and persists a BLOCKED run', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('rate limited', { status: 429 });
  try {
    const { env, state } = fakeEnv();
    const result = await collectDay(env, '2026-11-20');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(state.objects.size, 0);
    assert.ok(state.writes.some(x => x.params.includes('BLOCKED')));
  } finally { globalThis.fetch = oldFetch; }
});

test('HTTP endpoints require credentials; public health does not leak data', async () => {
  const { env } = fakeEnv();
  const health = await handler.fetch(new Request('https://logic-b.example/health'), env);
  assert.equal(health.status, 200);
  const denied = await handler.fetch(new Request('https://logic-b.example/api/v1/market/quotes'), env);
  assert.equal(denied.status, 401);
  const noData = await handler.fetch(new Request('https://logic-b.example/api/v1/market/status?date=2026-11-20',
    { headers: { authorization: 'Bearer reader-test' } }), env);
  assert.equal(noData.status, 404);
});
