import { auditSnapshot, chinaToday, normalizeSnapshot, providerRows, requireTradingDate, safeError } from './core.mjs';
import { processQueueBackfill } from './queue.mjs';
import { DASHBOARD_HTML, DASHBOARD_CSS, DASHBOARD_JS, readPublicOverview } from './dashboard.mjs';

const PROVIDER = '369_day_kline';
const PROBE_TARGETS = [
  { name: 'sse_homepage', kind: 'PUBLIC_SITE_CONNECTIVITY_ONLY', url: 'https://www.sse.com.cn/' },
  { name: 'szse_homepage', kind: 'PUBLIC_SITE_CONNECTIVITY_ONLY', url: 'https://www.szse.cn/' },
  { name: 'cninfo_homepage', kind: 'PUBLIC_SITE_CONNECTIVITY_ONLY', url: 'https://www.cninfo.com.cn/' },
];
const QUOTE_COLUMNS = ['run_id', 'symbol', 'name', 'asset', 'trade_date', 'open', 'high', 'low', 'close', 'volume', 'amount', 'turnover'];

function reply(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff' },
  });
}

function authorized(request, secret) {
  const header = request.headers.get('authorization') || '';
  if (!secret || !header.startsWith('Bearer ')) return false;
  const provided = header.slice(7);
  if (provided.length !== secret.length) return false;
  // Secret length is held constant; no secrets are ever echoed back.
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

function requireBindings(env) {
  if (!env.DB || !env.RAW) throw new Error('D1_OR_R2_BINDING_MISSING');
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function insertQuotes(db, runId, rows) {
  // D1 limits bound parameters to 100 per query; 8 x 12 = 96.
  const insertSql = (count) => `INSERT INTO market_quotes (${QUOTE_COLUMNS.join(',')}) VALUES ` +
    Array.from({ length: count }, () => `(${QUOTE_COLUMNS.map(() => '?').join(',')})`).join(',');
  let pending = [];
  for (let pos = 0; pos < rows.length; pos += 8) {
    const slice = rows.slice(pos, pos + 8);
    const params = slice.flatMap(row => QUOTE_COLUMNS.map(col => col === 'run_id' ? runId : row[col] ?? null));
    pending.push(db.prepare(insertSql(slice.length)).bind(...params));
    if (pending.length === 20 || pos + 8 >= rows.length) {
      await db.batch(pending);
      pending = [];
    }
  }
}

async function download369(day, token) {
  if (!token) throw new Error('TOP369_API_KEY_NOT_CONFIGURED');
  const url = `https://api.369.top/api/a/stock/day_kline?date=${encodeURIComponent(day)}`;
  const response = await fetch(url, {
    headers: { 'X-API-Key': token, Accept: 'application/json', 'User-Agent': 'logic-b-cloudflare-collector/1.0' },
    signal: AbortSignal.timeout(45000),
  });
  if ([401, 403, 429].includes(response.status)) throw new Error(`HTTP_${response.status}_STOP`);
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
  const rawText = await response.text();
  if (rawText.length > 20_000_000) throw new Error('PROVIDER_RESPONSE_UNEXPECTEDLY_LARGE');
  let payload;
  try { payload = JSON.parse(rawText); } catch { throw new Error('PROVIDER_NOT_JSON'); }
  return { payload, rawText };
}

export async function collectDay(env, day, trigger = 'manual', options = {}) {
  requireBindings(env);
  requireTradingDate(day);
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO market_runs(id,trade_date,source,started_at,status) VALUES(?,?,?,?,?)')
    .bind(id, day, PROVIDER, startedAt, 'RUNNING').run();
  const prefix = `logic-b/369/${day}/${id}`;
  try {
    const { payload, rawText } = await download369(day, env.TOP369_API_KEY);
    const sourceRows = providerRows(payload);
    const normalized = normalizeSnapshot(sourceRows, day);
    const audit = auditSnapshot(sourceRows.length, normalized, { minA: env.MIN_A_COUNT, minCB: env.MIN_CB_COUNT });
    const rawHash = await sha256(rawText);
    const rawKey = `${prefix}/provider.json`;
    const normKey = `${prefix}/normalized.jsonl`;
    const manifestKey = `${prefix}/manifest.json`;
    const finishedAt = new Date().toISOString();
    const storeQuotes = options.storeQuotes !== false;
    const manifest = {
      schema_version: 1, run_id: id, source: PROVIDER, underlying_origin: '369.top',
      trade_date: day, observed_at: startedAt, retrieved_at: finishedAt,
      trigger, source_url: `https://api.369.top/api/a/stock/day_kline?date=${day}`,
      raw_sha256: rawHash, price_adjustment: 'UNVERIFIED', quote_units: 'UNVERIFIED',
      ...audit, source_license: 'CHECK_PROVIDER_TERMS_BEFORE_REDISTRIBUTION',
      first_public_at: null, historical_ST_verified: false,
      financial_valuation_verified: false,
      quote_storage: storeQuotes ? 'R2_AND_D1' : 'R2_ONLY',
    };
    // Keep full provider payload and invalid-row evidence privately in R2.
    await env.RAW.put(rawKey, rawText, { httpMetadata: { contentType: 'application/json' } });
    await env.RAW.put(normKey, normalized.valid.map(x => JSON.stringify(x)).join('\n') + '\n',
      { httpMetadata: { contentType: 'application/x-ndjson' } });
    await env.RAW.put(manifestKey, JSON.stringify(manifest),
      { httpMetadata: { contentType: 'application/json' } });
    // D1 has a hard per-database size limit. Preserve the whole historical
    // universe in R2; only recent data is indexed as individual D1 quotes.
    if (storeQuotes) await insertQuotes(env.DB, id, normalized.valid);
    const savedAudit = { ...audit, quote_storage: manifest.quote_storage };
    await env.DB.prepare(`UPDATE market_runs SET status=?,finished_at=?,total_rows=?,normalized_rows=?,
      raw_key=?,normalized_key=?,manifest_key=?,raw_sha256=?,audit_json=? WHERE id=?`)
      .bind(audit.status, finishedAt, sourceRows.length, normalized.valid.length,
        rawKey, normKey, manifestKey, rawHash, JSON.stringify(savedAudit), id).run();
    return { run_id: id, trade_date: day, trigger, ...savedAudit };
  } catch (error) {
    const message = safeError(error);
    const status = /HTTP_(401|403|429)_STOP|NOT_CONFIGURED/.test(message) ? 'BLOCKED' : 'FAILED';
    await env.DB.prepare('UPDATE market_runs SET status=?,finished_at=?,error=? WHERE id=?')
      .bind(status, new Date().toISOString(), message, id).run();
    return { run_id: id, trade_date: day, trigger, status, error: message };
  }
}

async function probeOne(env, target) {
  const checkedAt = new Date().toISOString();
  const began = Date.now();
  let status = 'NETWORK_ERROR';
  let code = null;
  let error = null;
  try {
    const headers = { Accept: 'text/html,application/json' };
    if (target.name === '369_master') headers['X-API-Key'] = env.TOP369_API_KEY;
    const res = await fetch(target.url, { headers, signal: AbortSignal.timeout(12000) });
    code = res.status;
    status = res.ok ? 'HTTP_REACHABLE_NOT_DATA_VERIFIED' :
      [401, 403, 429].includes(code) ? 'ACCESS_BLOCKED' : 'HTTP_ERROR';
    await res.body?.cancel();
  } catch (e) { error = safeError(e); }
  const row = {
    source: target.name, endpoint_type: target.kind, checked_at: checkedAt,
    status, http_status: code, latency_ms: Date.now() - began, error,
  };
  await env.DB.prepare(`INSERT INTO source_probes(id,source,endpoint_type,checked_at,status,http_status,latency_ms,error)
    VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), ...Object.values(row)).run();
  return row;
}

export async function probeSources(env) {
  requireBindings(env);
  const targets = [...PROBE_TARGETS];
  const results = [];
  if (env.TOP369_API_KEY) {
    targets.push({ name: '369_master', kind: 'AUTHENTICATED_API_HTTP_ONLY',
      url: 'https://api.369.top/api/a/stock/list?page=1&page_size=1' });
  } else {
    results.push({ source: '369_master', status: 'NOT_CONFIGURED',
      endpoint_type: 'AUTHENTICATED_API_HTTP_ONLY' });
  }
  for (const target of targets) results.push(await probeOne(env, target));
  return { tested_at: new Date().toISOString(), caveat: 'Connectivity probes are NOT proof of full-market ingestion.', results };
}

async function latestRun(env, day) {
  return env.DB.prepare('SELECT * FROM market_runs WHERE trade_date=? ORDER BY started_at DESC LIMIT 1')
    .bind(day).first();
}

async function serveRead(request, env, url) {
  if (!authorized(request, env.READ_TOKEN) && !authorized(request, env.ADMIN_TOKEN)) {
    return reply({ error: 'UNAUTHORIZED' }, 401);
  }
  const day = requireTradingDate(url.searchParams.get('date') || chinaToday());
  if (url.pathname === '/api/v1/market/status') {
    const run = await latestRun(env, day);
    if (!run) return reply({ error: 'SNAPSHOT_NOT_FOUND', trade_date: day }, 404);
    return reply({ run_id: run.id, date: run.trade_date, source: run.source,
      status: run.status, retrieved_at: run.finished_at,
      audit: run.audit_json ? JSON.parse(run.audit_json) : null, error: run.error });
  }
  if (url.pathname === '/api/v1/market/quotes') {
    const run = await latestRun(env, day);
    if (!run) return reply({ error: 'SNAPSHOT_NOT_FOUND', trade_date: day }, 404);
    if (!['PROVISIONAL', 'PARTIAL'].includes(run.status)) {
      return reply({ error: 'LATEST_RUN_NOT_USABLE', trade_date: day, run_id: run.id, status: run.status }, 409);
    }
    const runAudit = run.audit_json ? JSON.parse(run.audit_json) : {};
    if (runAudit.quote_storage === 'R2_ONLY') {
      return reply({ error: 'HISTORICAL_QUOTES_IN_PRIVATE_R2', trade_date: day,
        run_id: run.id, note: 'R2 history is archived, but this D1 pagination API indexes recent sessions only.' }, 409);
    }
    const asset = url.searchParams.get('asset') || 'ALL';
    if (!['ALL', 'A股', '可转债候选', 'ETF/基金候选', '其他证券'].includes(asset)) {
      return reply({ error: 'INVALID_ASSET' }, 400);
    }
    const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100));
    const after = url.searchParams.get('after') || '';
    if (after && !/^(sh|sz|bj)\d{6}$/.test(after)) return reply({ error: 'INVALID_CURSOR' }, 400);
    const query = asset === 'ALL'
      ? env.DB.prepare('SELECT * FROM market_quotes WHERE run_id=? AND symbol>? ORDER BY symbol LIMIT ?').bind(run.id, after, limit + 1)
      : env.DB.prepare('SELECT * FROM market_quotes WHERE run_id=? AND asset=? AND symbol>? ORDER BY symbol LIMIT ?').bind(run.id, asset, after, limit + 1);
    const { results } = await query.all();
    const hasMore = results.length > limit;
    const rows = results.slice(0, limit);
    return reply({ date: day, run_id: run.id, status: run.status, asset,
      rows, next_after: hasMore ? rows.at(-1)?.symbol : null,
      note: 'Unverified market coverage; do not infer fair value from quotes.' });
  }
  if (url.pathname === '/api/v1/sources/probes') {
    const { results } = await env.DB.prepare('SELECT source,endpoint_type,checked_at,status,http_status,latency_ms,error FROM source_probes ORDER BY checked_at DESC LIMIT 30').all();
    return reply({ results });
  }
  return reply({ error: 'NOT_FOUND' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return reply({ service: 'logic-b-cloudflare', status: 'online', trading: 'manual_only',
        data_source_status: 'CHECK_/api/v1/market/status' });
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      return new Response(DASHBOARD_HTML, { headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      } });
    }
    if (request.method === 'GET' && ['/assets/dashboard.css', '/assets/dashboard.js'].includes(url.pathname)) {
      const css = url.pathname.endsWith('.css');
      return new Response(css ? DASHBOARD_CSS : DASHBOARD_JS, { headers: {
        'content-type': css ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
        'cache-control': 'no-cache', 'x-content-type-options': 'nosniff',
      } });
    }
    if (request.method === 'GET' && url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }
    try {
      requireBindings(env);
      if (url.pathname === '/api/v1/public/overview' && request.method === 'GET') {
        return reply(await readPublicOverview(env));
      }
      if (url.pathname === '/api/v1/admin/probe' && request.method === 'POST') {
        if (!authorized(request, env.ADMIN_TOKEN)) return reply({ error: 'UNAUTHORIZED' }, 401);
        return reply(await probeSources(env));
      }
      if (url.pathname === '/api/v1/admin/collect' && request.method === 'POST') {
        if (!authorized(request, env.ADMIN_TOKEN)) return reply({ error: 'UNAUTHORIZED' }, 401);
        const day = requireTradingDate(url.searchParams.get('date') || chinaToday());
        const result = await collectDay(env, day);
        return reply(result, result.status === 'BLOCKED' || result.status === 'FAILED' ? 502 : 200);
      }
      if (request.method !== 'GET') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
      return await serveRead(request, env, url);
    } catch (error) {
      const message = safeError(error);
      const status = /INVALID_DATE|INVALID_ASSET/.test(message) ? 400 : 500;
      return reply({ error: message }, status);
    }
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (message.body?.kind !== 'backfill-next') {
        console.log(JSON.stringify({ event: 'logic_b_unknown_queue_message' }));
        continue;
      }
      const result = await processQueueBackfill(env, collectDay);
      console.log(JSON.stringify({ event: 'logic_b_queue_backfill', ...result }));
    }
  },
  async scheduled(event, env, ctx) {
    // Historical backfill has moved to Queue self-chaining. Discard old Cron
    // events during schedule propagation; never treat them as daily runs.
    if (event.cron !== '20 8 * * 1-5') {
      console.log(JSON.stringify({ event: 'logic_b_unknown_cron', cron: event.cron }));
      return;
    }
    // UTC 08:20 on weekdays = China 16:20, NOT a verified trading-day calendar.
    ctx.waitUntil((async () => {
      const result = await collectDay(env, chinaToday(), `cron:${event.cron}`);
      console.log('logic_b_market_run', JSON.stringify({ id: result.run_id, date: result.trade_date, status: result.status }));
      // Probe failures must not hide the original collection status.
      try {
        const probes = await probeSources(env);
        console.log('logic_b_source_probe', JSON.stringify(probes.results.map(x => ({ source: x.source, status: x.status }))));
      } catch (error) {
        console.log('logic_b_source_probe_failed', safeError(error));
      }
    })());
  },
};
