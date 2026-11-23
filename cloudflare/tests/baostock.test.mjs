import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodeBaostockMessage, encodeBaostockMessage, fetchBaostockDay,
  normalizeBaostockDayResponse } from '../src/baostock.mjs';
import { normalizeSnapshot } from '../src/core.mjs';
import { collectDay } from '../src/index.mjs';

const separator = '\x01';
const columns = 'date,code,open,high,low,close,preclose,volume,amount,adjustflag,turn,tradestatus,pctChg,peTTM,pbMRQ,psTTM,pcfNcfTTM,isST';
const dayRows = [
  ['2020-01-02', 'sh.600000', '12', '13', '11', '12.5', '12', '10000', '125000', '3', '0.2', '1', '4.1', '8', '1.2', '2', '6', '0'],
  ['2020-01-02', 'sz.000001', '5', '5.5', '4.8', '5', '5', '0', '0', '3', '', '0', '0', '', '', '', '', '1'],
];

function frame(type, fields, compressed = false) {
  const content = Buffer.from(fields.join(separator));
  const body = compressed ? deflateSync(content) : content;
  const header = Buffer.from(`00.9.40${separator}${type}${separator}${String(body.length).padStart(10, '0')}`);
  return new Uint8Array(Buffer.concat([header, body, Buffer.from('<![CDATA[]]>\n')]));
}

function fakeConnect({ fail = null, rows = dayRows } = {}) {
  const commands = [];
  const socketFactory = () => {
    let controller;
    const readable = new ReadableStream({ start(c) { controller = c; } });
    const writable = new WritableStream({ write(encoded) {
      const command = new TextDecoder().decode(encoded);
      const type = command.slice(8, 10);
      commands.push(type);
      let result;
      if (type === '00') result = frame('01', ['0', 'success', 'login', 'anonymous']);
      else if (type === '98') {
        const parts = fail ? [fail, 'blocked'] :
          ['0', 'success', 'query_daily_history_k_AStock', 'anonymous', JSON.stringify({ record: rows }), columns];
        result = frame('99', parts, true);
      } else throw new Error('UNEXPECTED_REQUEST');
      // Fragment compressed frames across multiple socket chunks.
      for (let p = 0; p < result.length; p += 11) controller.enqueue(result.subarray(p, p + 11));
    } });
    return { readable, writable, opened: Promise.resolve({}), async close() { controller.close(); } };
  };
  return { socketFactory, commands };
}

test('BaoStock 0.9.4 emits correct login and whole-market day requests', () => {
  const body = ['query_daily_history_k_AStock', 'anonymous', '2020-01-02'].join(separator);
  const command = new TextDecoder().decode(encodeBaostockMessage('98', body));
  assert.ok(command.startsWith(`00.9.40\x0198\x01${String(body.length).padStart(10, '0')}${body}`));
  assert.ok(command.endsWith('\n'));
});

test('decodes BaoStock compressed daily snapshot, including ST and paused rows', async () => {
  const { socketFactory, commands } = fakeConnect();
  const result = await fetchBaostockDay('2020-01-02', socketFactory);
  assert.deepEqual(commands, ['00', '98']);
  assert.equal(result.payload.length, 2);
  assert.deepEqual(result.payload.map(row => row.code), ['sh600000', 'sz000001']);
  assert.equal(result.payload[1].isST, '1');
  const normalized = normalizeSnapshot(result.payload, '2020-01-02');
  assert.equal(normalized.valid.length, 2);
  assert.equal(normalized.valid[1].isST, 1);
  assert.equal(normalized.valid[1].tradestatus, 0);
  assert.equal(normalized.valid[1].volume, 0);
  assert.equal(normalized.valid[1].turnover, null);
});

test('BaoStock access blocks fail closed with no implicit retry', async () => {
  const { socketFactory, commands } = fakeConnect({ fail: '10001011' });
  await assert.rejects(fetchBaostockDay('2020-01-02', socketFactory), /BAOSTOCK_BLACKLIST_STOP/);
  assert.deepEqual(commands, ['00', '98']);
});

test('the daily response refuses wrong provider methods and corrupt field counts', async () => {
  const decoded = await decodeBaostockMessage(frame('99',
    ['0', 'ok', 'wrong_method', 'anonymous', JSON.stringify({ record: dayRows }), columns], true));
  assert.throws(() => normalizeBaostockDayResponse(decoded, '2020-01-02'), /UNEXPECTED_DAY/);
  const broken = await decodeBaostockMessage(frame('99',
    ['0', 'ok', 'query_daily_history_k_AStock', 'anonymous', JSON.stringify({ record: [['2020-01-02']] }), columns], true));
  const normalized = normalizeBaostockDayResponse(broken, '2020-01-02');
  assert.equal(normalized.rows[0].code, null);
});

test('BaoStock collector uses independent source prefix and records audit provenance', async () => {
  const { socketFactory } = fakeConnect();
  const writes = [];
  const objects = new Map();
  const DB = { prepare(sql) {
    return { bind(...params) { this.params = params; return this; },
      async run() { writes.push({ sql, params: this.params }); return { success: true }; } };
  }, async batch(statements) { for (const stmt of statements) await stmt.run(); } };
  const env = { DB, RAW: { async put(key, value) { objects.set(key, value); } },
    PRIMARY_MARKET_SOURCE: 'baostock', MIN_A_COUNT: 1 };
  const result = await collectDay(env, '2020-01-02', 'test',
    { storeQuotes: false, baostockConnector: socketFactory });
  assert.equal(result.status, 'PROVISIONAL');
  assert.equal(result.normalized_rows, 2);
  assert.equal(objects.size, 3);
  assert.ok([...objects.keys()].every(key => key.startsWith('logic-b/baostock/2020-01-02/')));
  const manifest = JSON.parse([...objects.entries()].find(([k]) => k.endsWith('/manifest.json'))[1]);
  assert.equal(manifest.source, 'baostock_daily_AStock');
  assert.equal(manifest.quote_units, 'volume=shares;amount=CNY;turnover=percent');
  assert.equal(manifest.universe_verified, false);
  assert.equal(manifest.historical_ST_verified, false);
  assert.equal(writes.filter(x => x.sql.startsWith('INSERT INTO market_quotes')).length, 0);
});
