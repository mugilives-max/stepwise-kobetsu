'use strict';
// 作り直し（v2）: 授業のアラート（未公開・重複）。cf/v2/alerts.mjs と「今日」（cf/v2/home.mjs）
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

test('alerts: unpublished drafts near today and overlaps that cannot be taught together; fixing clears them', async () => {
  const h = await createV2(); const auth = await h.owner();
  const me = (await h.ok('staff/me', { auth })).me;
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = async (givenName, deliveryMode) => (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '【テスト】', givenName, baseRate30: 1500, deliveryMode })).student;
  const a = await kid('対面', 'in_person'), b = await kid('オンライン', 'online'), c = await kid('相方', 'in_person'), d = await kid('三人目', 'in_person');
  const make = async (s, date, start, mode, send) => { await h.ok('schedule/lessons/create', { auth, studentId: s.id, date, start, minutes: 90, subject: '英語', deliveryMode: mode, staffId: me.id, send, force: true });
    return h.rows('select * from lessons where studentId = ? and date = ? and start = ?', s.id, date, start)[0]; };
  // 今日は 2026-10-02（金）12:00
  const draft = await make(a, '2026-10-03', '14:30', 'in_person', 'hold');        // 明日の下書き → 未公開
  await make(a, '2026-10-20', '14:30', 'in_person', 'hold');                       // 遠い下書き → 出さない
  const inPerson = await make(c, '2026-10-04', '11:20', 'in_person', 'show');
  const online = await make(b, '2026-10-04', '10:00', 'online', 'show');          // 対面とオンラインが重なる → 重複
  await make(a, '2026-10-05', '13:00', 'in_person', 'show'); await make(c, '2026-10-05', '13:00', 'in_person', 'show'); // 対面の 1 対 2 → 正常

  let r = await h.ok('home/today', { auth });
  assert.deepEqual(r.alerts.map(x => [x.key, x.label, x.date, x.start, x.detail]), [
    ['unpublished', '未公開', '2026-10-03', '14:30', '英語'],
    ['overlap', '重複', '2026-10-04', '10:00', '対面・オンライン混在'],
  ]);
  assert.deepEqual(r.alerts[1].studentNames.sort(), ['【テスト】 オンライン', '【テスト】 相方'].sort());
  assert.equal(r.alerts[1].link, '#schedule/day=2026-10-04');

  // 3 人目を同じ時間に（保存では断られるので、後から重なった形を直接作る）→ 3名以上
  const third = await make(d, '2026-10-06', '13:00', 'in_person', 'show');
  h.db2._sqlite.prepare("update lessons set date = '2026-10-05' where id = ?").run(third.id);
  // 同じ生徒の二重（同じく直接）→ 同一生徒
  const dup = await make(b, '2026-10-07', '10:00', 'online', 'show');
  h.db2._sqlite.prepare("update lessons set date = '2026-10-04' where id = ?").run(dup.id);
  r = await h.ok('home/today', { auth });
  assert.deepEqual(r.alerts.filter(x => x.key === 'overlap').map(x => [x.date, x.detail]), [['2026-10-04', '同一生徒・3名以上・対面・オンライン混在'], ['2026-10-05', '3名以上']]);

  // 直す: 下書きを調整中として見せる、オンラインの授業を消す、3 人目を消す
  await h.ok('schedule/lessons/show', { auth, studentId: a.id, lessonIds: [draft.id] });
  for (const l of [online, dup, third]) { const row = h.rows('select * from lessons where id = ?', l.id)[0]; await h.ok('schedule/lessons/delete', { auth, id: row.id, version: row.version }); }
  r = await h.ok('home/today', { auth });
  assert.deepEqual(r.alerts, []);
  assert.ok(h.rows('select id from lessons where id = ?', inPerson.id).length);

  // 講師にはアラートを出さない（教室管理者だけ）。保護者・生徒へのメールは増えない
  const tAuth = await h.staffWith(auth, ['teacher'], 't@example.invalid');
  assert.deepEqual((await h.ok('home/today', { auth: tAuth })).alerts, []);
});

test('findOverlaps: same-mode pair is normal; ended lessons are ignored', async () => {
  const { findOverlaps } = await import('../cf/v2/alerts.mjs');
  const L = (id, studentId, start, deliveryMode = 'in_person', staffId = 'st1') => ({ id, studentId, staffId, date: '2026-10-04', start, minutes: 90, deliveryMode });
  assert.deepEqual(findOverlaps([L('1', 'a', '10:00'), L('2', 'b', '10:30')]), []);
  assert.deepEqual(findOverlaps([L('1', 'a', '10:00'), L('2', 'b', '11:30', 'online')]), [], '終わってから始まるのは重ならない');
  assert.deepEqual(findOverlaps([L('1', 'a', '10:00', 'in_person', 'st1'), L('2', 'b', '10:00', 'online', 'st2')]), [], '講師が違えば形式が違ってもよい');
  assert.deepEqual(findOverlaps([L('1', 'a', '10:00', 'in_person', 'st1'), L('2', 'a', '10:00', 'in_person', 'st2')]).map(g => g.reasons), [['同一生徒']]);
});
