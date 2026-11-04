'use strict';
// 送信の結果を項目ごとに読む（手順書 #45 の 2026-10-14 本人の決定）。
// - gas-effects/Code.gs の failed には items の番号が入る
// - 項目ごとの results が読めないとき、Worker はその番号で、失敗した項目だけを失敗にする
// - 番号の無い返事（旧スクリプト）は今までどおり
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createV2 } = require('./helpers/v2-harness.cjs');

const GAS = { GAS_URL: 'https://gas.example.invalid', SYNC_KEY: 'x'.repeat(30) };
const mail = to => ({ kind: 'mail', to, subject: 's', body: 'b', audience: 'family' });
async function world() {
  const h = await createV2();
  const { deliverEffects, recordEffects } = await import('../cf/v2/effects.mjs');
  const send = async (items, reply) => {
    const q = await recordEffects(h.env.DB2, items, Date.now());
    const r = await deliverEffects(GAS, h.env.DB2, q, async () => ({ ok: true, json: async () => reply }));
    const rows = h.rows('select status, deliveryState, error from effects order by id desc limit ?', items.length).reverse();
    return { r, rows };
  };
  return { send };
}

test('a numbered failure marks only that item when per-item results cannot be read', async () => {
  const { send } = await world();
  const { r, rows } = await send([mail('a@example.invalid'), mail('b@example.invalid'), mail('c@example.invalid')],
    { ok: true, done: 2, writebacks: [], failed: [{ index: 1, kind: 'mail', status: 'failed', error: 'メール送信上限です（未送信）' }] });
  assert.deepEqual([r.sent, r.failed, r.unknown], [2, 1, 0]);
  assert.deepEqual(rows.map(x => x.deliveryState), ['sent', 'failed', 'sent']);
  assert.match(rows[1].error, /送信上限/);
});

test('a numbered failure that may have gone out stays unknown, so it is never sent twice automatically', async () => {
  const { send } = await world();
  const { r, rows } = await send([mail('a@example.invalid'), mail('b@example.invalid')],
    { ok: true, done: 1, writebacks: [], failed: [{ index: 0, kind: 'mail', status: 'unknown', error: 'timeout' }] });
  assert.deepEqual([r.sent, r.failed, r.unknown], [1, 0, 1]);
  assert.deepEqual(rows.map(x => x.deliveryState), ['unknown', 'sent']);
});

test('numbers that do not add up leave the rest unknown instead of calling them sent', async () => {
  const { send } = await world();
  const { rows } = await send([mail('a@example.invalid'), mail('b@example.invalid')],
    { ok: true, done: 0, writebacks: [], failed: [{ index: 0, kind: 'mail', status: 'failed', error: 'x' }] });
  assert.deepEqual(rows.map(x => x.deliveryState), ['failed', 'unknown']);
});

test('per-item results win over the failed list; the old relay without numbers behaves as before', async () => {
  const { send } = await world();
  const old = await send([mail('a@example.invalid'), mail('b@example.invalid')], { ok: true, done: 1, writebacks: [], failed: [{ kind: 'mail', error: 'x' }] });
  assert.deepEqual(old.rows.map(x => x.deliveryState), ['unknown', 'unknown'], '番号が無ければ、どれか分からないので結果不明');
  const single = await send([mail('a@example.invalid')], { ok: true, done: 0, writebacks: [], failed: [{ kind: 'mail', error: 'x' }] });
  assert.deepEqual(single.rows.map(x => x.deliveryState), ['unknown']);
});

function relay({ failOn = '' } = {}) {
  const store = { WORKER_SYNC_KEY: 'k'.repeat(30) }, sent = [];
  const props = { getProperty: k => store[k] ?? null, setProperty: (k, v) => { store[k] = v; }, getProperties: () => ({ ...store }), deleteProperty: k => { delete store[k]; } };
  const context = {
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: o => { if (o.to === failOn) throw new Error('boom'); sent.push(o.to); } },
    Utilities: { sleep() {} },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.invalid' }) },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas-effects', 'Code.gs'), 'utf8'), context);
  const post = body => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ action: 'effects', key: store.WORKER_SYNC_KEY, ...body }) } }).text);
  return { post, sent };
}

test('gas-effects/Code.gs puts the item number and state in failed', () => {
  const { post, sent } = relay({ failOn: 'b@example.invalid' });
  const r = post({ items: [{ ...mail('a@example.invalid'), deliveryId: 'd1' }, { ...mail('b@example.invalid'), deliveryId: 'd2' }, { kind: 'nope', deliveryId: 'd3' }, { ...mail('c@example.invalid'), deliveryId: 'd4' }] });
  assert.deepEqual(sent, ['a@example.invalid', 'c@example.invalid']);
  assert.equal(r.done, 2);
  assert.deepEqual(r.failed.map(f => [f.index, f.kind, f.status]), [[1, 'mail', 'unknown'], [2, 'nope', 'unknown']]);
  assert.deepEqual(r.results.map(x => x.status), ['sent', 'unknown', 'unknown', 'sent']);
});

test('gas-effects/Code.gs refuses the old actions the new script does not take', () => {
  const { post } = relay();
  assert.deepEqual(post({ action: 'parentCrypto' }), { error: '知らない操作です' });
  const doc = post({ document: { op: 'read', fileId: 'x' } });
  assert.deepEqual([doc.ok, doc.done, doc.base64], [true, 0, undefined], 'document は扱わない（呼び出し元は読めずに失敗する）');
});
