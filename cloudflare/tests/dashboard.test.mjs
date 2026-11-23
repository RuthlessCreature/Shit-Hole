import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import handler from '../src/index.mjs';
import { DASHBOARD_HTML, DASHBOARD_JS, readPublicOverview } from '../src/dashboard.mjs';

test('public landing page renders local CSS and JS with restrictive CSP', async () => {
  const page = await handler.fetch(new Request('https://example.org/'), {});
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await page.text(), /历史回填/);
  const script = await handler.fetch(new Request('https://example.org/assets/dashboard.js'), {});
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.doesNotThrow(() => new Function(DASHBOARD_JS));
  assert.ok(!DASHBOARD_HTML.includes('TOP369_API_KEY'));
});

test('public status reports only aggregates, with no secrets or raw R2 paths', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql', '0002_backfill.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  sqlite.prepare(`INSERT INTO source_probes(id,source,endpoint_type,checked_at,status,http_status)
    VALUES(?,?,?,?,?,?)`).run('probe1', '369_master', 'AUTHENTICATED_API_HTTP_ONLY',
    '2026-11-23T08:00:00Z', 'ACCESS_BLOCKED', 403);
  sqlite.prepare(`INSERT INTO backfill_days(trade_date,status,attempts,last_run_id,updated_at)
    VALUES(?,?,?,?,?)`).run('2020-01-02', 'STORED_UNVERIFIED', 1, 'run-123', '2026-11-23T08:00:00Z');
  const env = { DB: { prepare(sql) { return { bind(...params) { return {
    async first() { return sqlite.prepare(sql).get(...params) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...params) }; },
  }; }, async first() { return sqlite.prepare(sql).get() ?? null; },
    async all() { return { results: sqlite.prepare(sql).all() }; } }; } } };
  try {
    const overview = await readPublicOverview(env);
    assert.equal(overview.history.start_date, '2020-01-01');
    assert.equal(overview.history.stored_unverified, 1);
    assert.equal(overview.probes.length, 1);
    const serialized = JSON.stringify(overview);
    assert.ok(!serialized.includes('provider.json'));
    assert.ok(!serialized.includes('TOP369_API_KEY'));
    assert.ok(!serialized.includes('raw_key'));
  } finally { sqlite.close(); }
});
