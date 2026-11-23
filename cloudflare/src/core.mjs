// Pure data transformations shared by the Cloudflare runtime and offline tests.
export const FIELDS = ['open', 'high', 'low', 'close', 'volume', 'amount', 'turnover'];

export function requireTradingDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('INVALID_DATE: expected YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('INVALID_DATE: impossible calendar date');
  }
  return value;
}

export function chinaToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function providerRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') throw new Error('BAD_ENVELOPE');
  if (payload.success === false ||
      (payload.code !== undefined && payload.code !== null && ![0, 200].includes(payload.code) && payload.success !== true)) {
    throw new Error('PROVIDER_ERROR_ENVELOPE');
  }
  const data = payload.data ?? payload;
  if (Array.isArray(data)) return data;
  for (const field of ['rows', 'items', 'data', 'list']) {
    if (Array.isArray(data?.[field])) return data[field];
  }
  throw new Error('NO_ROWS_IN_ENVELOPE');
}

export function assetOf(symbol) {
  const market = symbol.slice(0, 2);
  const code = symbol.slice(2);
  if ((market === 'sh' && /^(60|68)/.test(code)) ||
      (market === 'sz' && /^(00|30)/.test(code)) ||
      (market === 'bj' && /^(92|83|87|43)/.test(code))) return 'A股';
  // The broad 13xxxx prefix includes Shenzhen bond repos (e.g. sz131810),
  // which must not be counted as convertible bonds in coverage reports.
  if ((market === 'sh' && /^(110|111|113|118)/.test(code)) ||
      (market === 'sz' && /^(123|125|126|127|128|129)/.test(code))) return '可转债候选';
  if (/^(51|15|56|58)/.test(code)) return 'ETF/基金候选';
  return '其他证券';
}

export function normalizeSnapshot(rows, day) {
  requireTradingDate(day);
  const valid = [];
  const errors = [];
  const seen = new Set();
  const assets = {};
  let zeroVolume = 0;
  for (const [index, record] of rows.entries()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push({ index, reason: 'NOT_OBJECT' });
      continue;
    }
    const symbol = String(record.code || record.symbol || '').trim().toLowerCase();
    if (!/^(sh|sz|bj)\d{6}$/.test(symbol)) {
      errors.push({ index, reason: 'BAD_SYMBOL', symbol: symbol.slice(0, 24) });
      continue;
    }
    if (String(record.date || record.trade_date || day).slice(0, 10) !== day) {
      errors.push({ index, reason: 'WRONG_DATE', symbol });
      continue;
    }
    if (seen.has(symbol)) {
      errors.push({ index, reason: 'DUPLICATE', symbol });
      continue;
    }
    const numbers = {};
    let invalid = false;
    for (const field of FIELDS) {
      const value = record[field];
      numbers[field] = value === null || value === undefined || value === '' || value === '-' ? null : Number(value);
      if (numbers[field] !== null && !Number.isFinite(numbers[field])) invalid = true;
    }
    if (invalid || (numbers.close !== null && numbers.close <= 0) ||
        (numbers.volume !== null && numbers.volume < 0) ||
        (numbers.high !== null && numbers.low !== null && numbers.high < numbers.low) ||
        (numbers.high !== null && numbers.open !== null && numbers.high < numbers.open) ||
        (numbers.high !== null && numbers.close !== null && numbers.high < numbers.close) ||
        (numbers.low !== null && numbers.open !== null && numbers.low > numbers.open) ||
        (numbers.low !== null && numbers.close !== null && numbers.low > numbers.close)) {
      errors.push({ index, reason: 'INVALID_OHLCV', symbol });
      continue;
    }
    seen.add(symbol);
    const asset = assetOf(symbol);
    assets[asset] = (assets[asset] || 0) + 1;
    if (numbers.volume === 0) zeroVolume++;
    valid.push({ symbol, name: String(record.name || '').slice(0, 120), asset, trade_date: day, ...numbers });
  }
  return { valid, errors, assets, zeroVolume };
}

// A provider result is not a verified *universe* until compared against an
// independent security master; minimum counts are only anomaly indicators.
export function auditSnapshot(rawCount, normalized, expected = {}) {
  const minA = Number(expected.minA ?? 5000);
  const minCB = Number(expected.minCB ?? 200);
  const a = normalized.assets['A股'] ?? 0;
  const cb = normalized.assets['可转债候选'] ?? 0;
  const warnings = [];
  if (a < minA) warnings.push('A_SHARE_COUNT_BELOW_BASELINE');
  if (cb < minCB) warnings.push('CONVERTIBLE_COUNT_BELOW_BASELINE');
  if (normalized.errors.length) warnings.push('INVALID_ROWS_PRESENT');
  const status = warnings.length ? 'PARTIAL' : 'PROVISIONAL';
  return {
    status, universe_verified: false, // Requires independent master reconciliation.
    provider_rows: rawCount, normalized_rows: normalized.valid.length,
    invalid_rows: normalized.errors.length, zero_volume: normalized.zeroVolume,
    assets: normalized.assets, baseline_a: minA, baseline_cb: minCB,
    warnings, errors_sample: normalized.errors.slice(0, 100),
    note: 'Zero research gates: all valid asset classes retained; anomalies are not valuations.',
  };
}

export function safeError(error) {
  // Never persist fetched URLs, auth headers, token values, or arbitrary bodies.
  return String(error?.message || error || 'UNKNOWN_ERROR').replace(/sk-[a-z0-9_-]{8,}/ig, '[REDACTED]').slice(0, 240);
}
