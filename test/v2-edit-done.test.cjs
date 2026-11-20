'use strict';
// 実施済みの授業を直す（2026-11-20 本人「Stepwise を直す」）。あとから登録した実施済みの授業の時刻・担当・種類を間違えたときに、
// 請求・給与の前なら管理画面と MCP から直せる。メール・カレンダーは動かない。請求・給与に入った授業と、今日より先の日付は断る。
// 時計は 2026-10-02 12:00（日本時間）から始まる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

const WKEY = 'w'.repeat(40);
async function world() {
  const h = await createV2(); const auth = await h.owner();
  h.db2._sqlite.prepare("insert into settings (key, value, updatedAt) values ('live', '1', '')").run();
  h.env.V2_SERVICE_KEY = 'r'.repeat(40); h.env.V2_SERVICE_WRITE_KEY = WKEY;
  const fam = (await h.ok('admin/families/create', { auth, name: '【テスト】架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '【テスト】架空', givenName: '一郎', baseRate30: 1500, deliveryMode: 'in_person' })).student;
  const me = (await h.ok('staff/me', { auth })).me;
  const base = { auth, studentId: kid.id, date: '2026-10-01', minutes: 90, deliveryMode: 'in_person', staffId: me.id, send: 'done' };
  for (const [start, subject] of [['13:00', '英語'], ['14:30', '数学'], ['16:00', '理科・社会・国語']]) await h.ok('schedule/lessons/create', { ...base, start, subject });
  const rows = () => h.rows('select * from lessons order by start');
  const w = (route, body = {}) => h.call(route, { ...body, serviceWriteKey: WKEY });
  return { h, auth, kid, me, rows, w };
}
const edit = (auth, l, patch) => ({ auth, id: l.id, version: l.version, date: l.date, start: l.start, minutes: l.minutes, subject: l.subject, kind: l.kind, deliveryMode: l.deliveryMode, staffId: l.staffId, ...patch });

test('管理画面: 請求・給与の前の実施済みは、時刻・担当・種類を直せる。メールもカレンダーも動かない', async () => {
  const { h, auth, rows } = await world();
  const mails = h.mails().length, effects = h.rows('select count(*) n from effects')[0].n;
  // 早い順に 1 時間前へ（同じ生徒の重なりにならない）
  for (const [i, start] of [[0, '12:00'], [1, '13:30'], [2, '15:00']]) await h.ok('schedule/lessons/update', edit(auth, rows()[i], { start }));
  await h.ok('schedule/lessons/update', edit(auth, rows()[2], { kind: '演習' }));
  assert.deepEqual(rows().map(l => [l.start, l.subject, l.kind, l.status]), [['12:00', '英語', '通常', 'done'], ['13:30', '数学', '通常', 'done'], ['15:00', '理科・社会・国語', '演習', 'done']]);
  assert.equal(h.mails().length, mails, 'メールなし');
  assert.equal(h.rows('select count(*) n from effects')[0].n, effects, 'カレンダーなど外への作用なし');
  assert.ok(h.rows("select * from auditLog where action = 'lessonUpdateDone'").length >= 4, '前の値を監査に残す');
  // 種類の選択肢に、この期間の授業で使っている種類が出る
  assert.ok((await h.ok('schedule/staff/range', { auth, from: '2026-10-01', to: '2026-10-31' })).kinds.includes('演習'));
});

test('管理画面: 今日より先の日付・同じ生徒の重なり・請求や給与に入った授業は断る', async () => {
  const { h, auth, rows } = await world();
  assert.equal((await h.call('schedule/lessons/update', edit(auth, rows()[0], { date: '2026-10-03' }))).error.code, 'future');
  assert.equal((await h.call('schedule/lessons/update', edit(auth, rows()[0], { start: '14:00' }))).error.code, 'overlap');
  h.db2._sqlite.prepare("update lessons set invoiceId = 'iv_x' where id = ?").run(rows()[0].id);
  h.db2._sqlite.prepare("update lessons set payrollId = 'pr_x' where id = ?").run(rows()[1].id);
  assert.equal((await h.call('schedule/lessons/update', edit(auth, rows()[0], { start: '12:00' }))).error.code, 'badStatus');
  assert.equal((await h.call('schedule/lessons/update', edit(auth, rows()[1], { start: '13:30' }))).error.code, 'badStatus');
});

test('MCP: 実施済みの直しは dryRun → confirm で、メール 0・カレンダーなし', async () => {
  const { h, rows, w } = await world();
  const l = rows()[0];
  const dry = await w('mcp/lessons/reschedule', { lessonId: l.id, version: l.version, start: '12:00', dryRun: true });
  assert.equal(dry.ok, true, JSON.stringify(dry));
  assert.deepEqual([dry.effects.mails, dry.effects.calendar, dry.status], [0, 'none', 'done']);
  assert.equal((await w('mcp/lessons/reschedule', { requestId: 'req-done-0001', lessonId: l.id, version: l.version, start: '12:00' })).error.code, 'needConfirm');
  const r = await w('mcp/lessons/reschedule', { requestId: 'req-done-0002', lessonId: l.id, version: l.version, start: '12:00', confirm: dry.confirm });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([rows()[0].start, rows()[0].status, r.mails.length], ['12:00', 'done', 0]);
  assert.equal((await w('mcp/lessons/reschedule', { lessonId: l.id, version: rows()[0].version, date: '2026-10-05', dryRun: true })).error.code, 'future');
});
