// BaoStock 0.9.4 wire protocol adapter. This file deliberately has no
// cloudflare:sockets import, so the framing and normalization are testable
// without network access. See https://www.baostock.com/mainContent?file=DailyUpdates.md
import { requireTradingDate } from './core.mjs';

const SEPARATOR = '\x01';
const VERSION = '00.9.40';
const END_OF_MESSAGE = new TextEncoder().encode('<![CDATA[]]>\n');
const MAX_WIRE_BYTES = 24_000_000;
const MAX_DAY_ROWS = 20_000;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodeBaostockMessage(type, body) {
  if (!/^[0-9A-Z]{2}$/.test(type)) throw new Error('BAOSTOCK_BAD_MESSAGE_TYPE');
  const byteLength = new TextEncoder().encode(body).length;
  const headerBody = `${VERSION}${SEPARATOR}${type}${SEPARATOR}${String(byteLength).padStart(10, '0')}${body}`;
  const checksum = crc32(new TextEncoder().encode(headerBody));
  return new TextEncoder().encode(`${headerBody}${SEPARATOR}${checksum}\n`);
}

function endsWithBytes(haystack, needle) {
  if (haystack.length < needle.length) return false;
  const offset = haystack.length - needle.length;
  return needle.every((v, i) => haystack[offset + i] === v);
}

async function readMessage(reader, deadlineMs = 90_000) {
  const chunks = [];
  let total = 0;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('BAOSTOCK_TIMEOUT')), deadlineMs);
  });
  let tail = new Uint8Array();
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done || !value?.length) throw new Error('BAOSTOCK_CONNECTION_CLOSED');
      chunks.push(value);
      total += value.length;
      if (total > MAX_WIRE_BYTES) throw new Error('BAOSTOCK_RESPONSE_TOO_LARGE');
      const check = new Uint8Array(tail.length + value.length);
      check.set(tail);
      check.set(value, tail.length);
      tail = check.slice(-END_OF_MESSAGE.length);
      if (endsWithBytes(tail, END_OF_MESSAGE)) {
        const accumulated = new Uint8Array(total);
        let position = 0;
        for (const chunk of chunks) { accumulated.set(chunk, position); position += chunk.length; }
        return accumulated;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function decodeBaostockMessage(wire) {
  if (!(wire instanceof Uint8Array) || wire.length < 21) throw new Error('BAOSTOCK_BAD_FRAME');
  const header = new TextDecoder().decode(wire.subarray(0, 21));
  const parts = header.split(SEPARATOR);
  if (parts.length !== 3 || !/^\d{10}$/.test(parts[2])) throw new Error('BAOSTOCK_BAD_HEADER');
  const type = parts[1];
  const bodyLength = Number(parts[2]);
  if (bodyLength <= 0 || bodyLength > MAX_WIRE_BYTES || wire.length < 21 + bodyLength) {
    throw new Error('BAOSTOCK_BAD_BODY_LENGTH');
  }
  const bodyBytes = wire.subarray(21, 21 + bodyLength);
  const compressed = ['96', '99', '9B', '9D'].includes(type);
  const body = compressed
    ? await new Response(new Blob([bodyBytes]).stream().pipeThrough(new DecompressionStream('deflate'))).text()
    : new TextDecoder().decode(bodyBytes);
  const fields = body.split(SEPARATOR);
  if (fields.length < 2) throw new Error('BAOSTOCK_BAD_BODY');
  if (fields[0] !== '0') {
    if (fields[0] === '10001011') throw new Error('BAOSTOCK_BLACKLIST_STOP');
    // Provider message can contain untrusted content; never persist it in logs.
    throw new Error(`BAOSTOCK_SOURCE_CODE_${String(fields[0]).replace(/[^0-9]/g, '').slice(0, 12)}`);
  }
  return { type, body, fields };
}

export function normalizeBaostockDayResponse(decoded, day) {
  requireTradingDate(day);
  if (decoded.type !== '99' || decoded.fields.length < 6 ||
      decoded.fields[2] !== 'query_daily_history_k_AStock') {
    throw new Error('BAOSTOCK_UNEXPECTED_DAY_RESPONSE');
  }
  let payload;
  try { payload = JSON.parse(decoded.fields[4]); }
  catch { throw new Error('BAOSTOCK_BAD_RECORD_JSON'); }
  if (!Array.isArray(payload?.record) || payload.record.length > MAX_DAY_ROWS) {
    throw new Error('BAOSTOCK_BAD_RECORD_COUNT');
  }
  const headings = decoded.fields[5].split(',');
  if (!['date', 'code', 'open', 'high', 'low', 'close', 'volume', 'amount'].every(f => headings.includes(f))) {
    throw new Error('BAOSTOCK_MISSING_REQUIRED_COLUMNS');
  }
  const rows = payload.record.map(values => {
    if (!Array.isArray(values) || values.length !== headings.length) return { code: null };
    const row = Object.fromEntries(headings.map((name, i) => [name, values[i]]));
    row.code = String(row.code).replace(/^(sh|sz|bj)\./i, '$1');
    row.turnover = row.turn;
    return row;
  });
  return { rows, fields: headings };
}

/**
 * A connection is made separately in each Queue event. The source implements
 * anonymous login, single-date A-share snapshot, then logout; no shared state.
 */
export async function fetchBaostockDay(day, connectSocket) {
  requireTradingDate(day);
  const socket = connectSocket({ hostname: 'public-api.baostock.com', port: 10030 }, { secureTransport: 'off' });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const request = async (type, body) => {
    await writer.write(encodeBaostockMessage(type, body));
    return decodeBaostockMessage(await readMessage(reader));
  };
  try {
    // A hung TCP connect must not exhaust a Queue invocation indefinitely.
    let connectTimer;
    const timeout = new Promise((_, reject) => {
      connectTimer = setTimeout(() => reject(new Error('BAOSTOCK_CONNECT_TIMEOUT')), 45_000);
    });
    try { await Promise.race([socket.opened, timeout]); }
    finally { clearTimeout(connectTimer); }
    const login = await request('00', ['login', 'anonymous', '123456', '0'].join(SEPARATOR));
    if (login.type !== '01' || login.fields[2] !== 'login') throw new Error('BAOSTOCK_LOGIN_BAD_REPLY');
    const daily = await request('98', ['query_daily_history_k_AStock', 'anonymous', day].join(SEPARATOR));
    const normalized = normalizeBaostockDayResponse(daily, day);
    if (!normalized.rows.length) throw new Error('BAOSTOCK_EMPTY_TRADING_DAY');
    // Store the decoded first-party provider response, including every field.
    return { rawText: daily.body, payload: normalized.rows, originalFields: normalized.fields };
  } finally {
    try { await socket.close(); } catch { /* no further requests after failure */ }
  }
}
