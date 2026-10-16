'use strict';
// カレンダーの予定 ID（Kura 調査 #195、2026-10-14）。
// - 仮の目印は Google の予定 ID の規則（base32hex: 英小文字 a-v と数字、5〜1024 文字）に合う
// - Apps Script が作成を断った（書き戻しが返ってこない）ときは「失敗」として残す（今までは「送れた」になっていた）
// - 作成を断られたままの今日以降の授業・面談を、新しい目印で作り直す（mcp/calendar/repair）
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

const WKEY = 'w'.repeat(48), RKEY = 'r'.repeat(48);
const GOOGLE_ID = /^[a-v0-9]{5,1024}$/;
const GAS = { GAS_URL: 'https://gas.example.invalid', SYNC_KEY: 'x'.repeat(30) };
// Apps Script（gas/Sync.gs effectsOp_）と同じ返し方の、架空の送り先。予定 ID の規則は Google と同じに確かめる
const fakeGas = () => async (url, init) => {
  const req = JSON.parse(init.body), writebacks = [], failed = [];
  for (const it of req.items) {
    if (it.kind !== 'calendarCreate') continue;
    if (!GOOGLE_ID.test(String((it.body && it.body.id) || ''))) { failed.push({ kind: it.kind, error: 'Invalid resource id value.' }); continue; }
    writebacks.push({ marker: it.marker, eventId: it.body.id + '@google.com', meetUrl: '' });
  }
  return { ok: true, json: async () => ({ ok: true, done: req.items.length - failed.length, writebacks, failed, results:req.items.map(it=>({id:it.deliveryId,status:it.kind==='calendarCreate'&&!GOOGLE_ID.test(String(it.body?.id||''))?'failed':'sent',error:it.kind==='calendarCreate'&&!GOOGLE_ID.test(String(it.body?.id||''))?'Invalid resource id value.':''})) }) };
};
async function world() {
  const h = await createV2(); const auth = await h.owner();
  h.env.V2_SERVICE_KEY = RKEY; h.env.V2_SERVICE_WRITE_KEY = WKEY; h.env.V2_SERVICE_WRITE_SCOPE = 'all';
  h.db2._sqlite.prepare("insert into settings (key, value, updatedAt) values ('live', '1', '')").run();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500, deliveryMode: 'in_person' })).student;
  const me = (await h.ok('staff/me', { auth })).me;
  const lesson = { auth, studentId: kid.id, start: '18:00', minutes: 90, subject: '数学', deliveryMode: 'in_person', staffId: me.id };
  const { deliverEffects, recordEffects } = await import('../cf/v2/effects.mjs');
  const pending = () => h.rows("select id, payload from effects where status = 'pending' and kind like 'calendar%' order by id").map(r => ({ id: r.id, item: JSON.parse(r.payload) }));
  return { h, auth, kid, lesson, deliverEffects, recordEffects, pending };
}

test('決定した授業の予定 ID は Google の規則に合い、作成されると本物の ID が書き戻される', async () => {
  const { h, auth, lesson, deliverEffects, pending } = await world();
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-09' });
  const l = h.rows('select * from lessons')[0];
  await h.ok('schedule/lessons/decide', { auth, id: l.id, version: l.version });
  const marker = h.rows('select calendarEventId from lessons')[0].calendarEventId;
  assert.match(marker, GOOGLE_ID);
  const r = await deliverEffects(GAS, h.env.DB2, pending(), fakeGas());
  assert.deepEqual([r.sent, r.failed], [1, 0]);
  assert.equal(h.rows('select calendarEventId from lessons')[0].calendarEventId, marker + '@google.com');
  assert.equal(h.rows("select status from effects where kind = 'calendarCreate'")[0].status, 'sent');
});

test('作成を断られた（書き戻しが無い）予定は「失敗」になり、メールなどほかの頼みは「送れた」のまま', async () => {
  const { h, deliverEffects, recordEffects } = await world();
  const base = h.rows('select count(*) n from effects')[0].n;
  const items = [{ kind: 'calendarCreate', marker: 'swv2abc', body: { id: 'swv2abc', summary: 'x' }, audience: 'calendar' }, { kind: 'mail', to: 'a@example.invalid', subject: 's', body: 'b', audience: 'family' }];
  const q = await recordEffects(h.env.DB2, items, Date.now());
  const r = await deliverEffects(GAS, h.env.DB2, q, fakeGas());
  assert.deepEqual([r.sent, r.failed], [1, 1]);
  const rows = h.rows('select kind, status, error from effects order by id').slice(base);
  assert.deepEqual(rows.map(x => [x.kind, x.status]), [['calendarCreate', 'failed'], ['mail', 'sent']]);
  assert.match(rows[0].error, /Invalid resource id value\./);
  // 設定が off などで、失敗の知らせも書き戻しも無いとき
  const id = 'v2m' + 'a'.repeat(40);
  const q2 = await recordEffects(h.env.DB2, [{ kind: 'calendarCreate', marker: id, body: { id }, audience: 'calendar' }], Date.now());
  await deliverEffects(GAS, h.env.DB2, q2, async () => ({ ok: true, json: async () => ({ ok: true, done: 1, writebacks: [], failed: [] }) }));
  const last = h.rows('select status, error from effects order by id desc limit 1')[0];
  assert.equal(last.status, 'failed');
  assert.match(last.error, /予定 ID が返りませんでした/);
});

test('作り直し: 今日以降で予定が仮の目印のままの授業だけを、新しい目印で作り直す（dryRun は何も変えない・メールなし）', async () => {
  const { h, auth, kid, lesson, deliverEffects, pending } = await world();
  // 今日（2026-10-02）以降の決定 2 件を作り、作成を断られたときの形（目印が swv2…・控えは「送れた」）にしておく
  for (const date of ['2026-10-05', '2026-10-09']) {
    await h.ok('schedule/lessons/create', { ...lesson, date });
    const l = h.rows('select * from lessons where date = ?', date)[0];
    await h.ok('schedule/lessons/decide', { auth, id: l.id, version: l.version });
  }
  h.db2._sqlite.prepare("update effects set status = 'sent'").run();
  h.db2._sqlite.prepare("update lessons set calendarEventId = 'swv2' || substr(id, 4, 20)").run();
  // 過去の授業と、本物の予定がある授業は対象外
  h.db2._sqlite.prepare("insert into lessons (id, studentId, staffId, date, start, minutes, subject, kind, deliveryMode, status, calendarEventId, createdAt, updatedAt) values ('ls_past', ?, '', '2026-09-30', '18:00', 90, '数学', '通常', 'in_person', 'decided', 'swv2past', '', '')").run(kid.id);
  h.db2._sqlite.prepare("insert into lessons (id, studentId, staffId, date, start, minutes, subject, kind, deliveryMode, status, calendarEventId, createdAt, updatedAt) values ('ls_real', ?, '', '2026-10-12', '18:00', 90, '数学', '通常', 'in_person', 'decided', 'st0123@google.com', '', '')").run(kid.id);
  const before = JSON.stringify(h.rows('select * from lessons order by id'));
  const mailsBefore = h.mails().length;
  const dry = await h.ok('mcp/calendar/repair', { serviceWriteKey: WKEY, dryRun: true });
  assert.deepEqual(dry.targets.map(t => t.date), ['2026-10-05', '2026-10-09']);
  assert.equal(JSON.stringify(h.rows('select * from lessons order by id')), before, 'dryRun は何も変えない');
  assert.equal(pending().length, 0);
  assert.equal((await h.call('mcp/calendar/repair', { serviceWriteKey: 'x'.repeat(48) })).error.code, 'badKey');
  const run = await h.ok('mcp/calendar/repair', { serviceWriteKey: WKEY });
  assert.equal(run.queued, 2);
  assert.equal(h.mails().length, mailsBefore, 'メールは送らない');
  assert.ok(h.rows("select calendarEventId from lessons where id not in ('ls_past', 'ls_real')").every(x => GOOGLE_ID.test(x.calendarEventId)), '新しい目印は規則に合う');
  assert.equal(h.rows("select calendarEventId from lessons where id = 'ls_past'")[0].calendarEventId, 'swv2past', '過去は触らない');
  assert.equal(h.rows("select calendarEventId from lessons where id = 'ls_real'")[0].calendarEventId, 'st0123@google.com', '本物の予定は触らない');
  assert.equal((await h.ok('mcp/calendar/repair', { serviceWriteKey: WKEY, dryRun: true })).targets.length, 0, '送っている途中のものは二重に作らない');
  const r = await deliverEffects(GAS, h.env.DB2, pending(), fakeGas());
  assert.deepEqual([r.sent, r.failed], [2, 0]);
  assert.ok(h.rows("select calendarEventId from lessons where id not in ('ls_past', 'ls_real')").every(x => x.calendarEventId.endsWith('@google.com')));
  assert.equal((await h.ok('mcp/calendar/repair', { serviceWriteKey: WKEY, dryRun: true })).targets.length, 0, '作れたあとは対象にならない');
});
