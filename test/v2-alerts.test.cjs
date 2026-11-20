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
  const draft2 = await make(a, '2026-10-16', '14:30', 'in_person', 'hold');      // 14 日後の下書き → 同じ生徒の未公開にまとめる
  await make(a, '2026-10-17', '14:30', 'in_person', 'hold');                       // 15 日後 → 出さない
  const inPerson = await make(c, '2026-10-04', '11:20', 'in_person', 'show');
  const online = await make(b, '2026-10-04', '10:00', 'online', 'show');          // 対面とオンラインの 1 対 2 → 正常（2026-11-20 本人）
  await make(a, '2026-10-05', '13:00', 'in_person', 'show'); await make(c, '2026-10-05', '13:00', 'in_person', 'show'); // 対面の 1 対 2 → 正常

  let r = await h.ok('home/today', { auth });
  assert.deepEqual(r.alerts.map(x => [x.key, x.label, x.date, x.start, x.detail]), [
    ['unpublished', '未公開', '2026-10-03', '14:30', '2件（10/3〜10/16）'],
  ]);

  // 3 人目を同じ時間に（保存では断られるので、後から重なった形を直接作る）→ 3名以上
  const third = await make(d, '2026-10-06', '13:00', 'in_person', 'show');
  h.db2._sqlite.prepare("update lessons set date = '2026-10-05' where id = ?").run(third.id);
  // 同じ生徒の二重（同じく直接）→ 同一生徒。11:20 にはオンライン 2 つと対面 1 つで 3名以上
  const dup = await make(b, '2026-10-07', '10:00', 'online', 'show');
  h.db2._sqlite.prepare("update lessons set date = '2026-10-04' where id = ?").run(dup.id);
  r = await h.ok('home/today', { auth });
  assert.deepEqual(r.alerts.filter(x => x.key === 'overlap').map(x => [x.date, x.detail]), [['2026-10-04', '同一生徒・3名以上'], ['2026-10-05', '3名以上']]);
  const g = r.alerts.find(x => x.date === '2026-10-04');
  assert.deepEqual(g.studentNames.slice().sort(), ['【テスト】 オンライン', '【テスト】 相方'].sort());
  assert.equal(g.link, '#schedule/day=2026-10-04');

  // 直す: 下書きを調整中として見せる、オンラインの授業を消す、3 人目を消す
  await h.ok('schedule/lessons/show', { auth, studentId: a.id, lessonIds: [draft.id] });
  assert.deepEqual((await h.ok('home/today', { auth })).alerts.filter(x => x.key === 'unpublished').map(x => [x.date, x.detail]), [['2026-10-16', '英語']], '1 件だけ残れば科目');
  await h.ok('schedule/lessons/show', { auth, studentId: a.id, lessonIds: [draft2.id] });
  for (const l of [online, dup, third]) { const row = h.rows('select * from lessons where id = ?', l.id)[0]; await h.ok('schedule/lessons/delete', { auth, id: row.id, version: row.version }); }
  r = await h.ok('home/today', { auth });
  assert.deepEqual(r.alerts, []);
  assert.ok(h.rows('select id from lessons where id = ?', inPerson.id).length);

  // 講師にはアラートを出さない（教室管理者だけ）。保護者・生徒へのメールは増えない
  const tAuth = await h.staffWith(auth, ['teacher'], 't@example.invalid');
  assert.deepEqual((await h.ok('home/today', { auth: tAuth })).alerts, []);
});

test('findOverlaps: a pair is normal, also in-person with online; ended lessons are ignored', async () => {
  const { findOverlaps } = await import('../cf/v2/alerts.mjs');
  const L = (id, studentId, start, deliveryMode = 'in_person', staffId = 'st1') => ({ id, studentId, staffId, date: '2026-10-04', start, minutes: 90, deliveryMode });
  assert.deepEqual(findOverlaps([L('1', 'a', '10:00'), L('2', 'b', '10:30')]), []);
  assert.deepEqual(findOverlaps([L('1', 'a', '10:00'), L('2', 'b', '11:30', 'online')]), [], '終わってから始まるのは重ならない');
  assert.deepEqual(findOverlaps([L('1', 'a', '10:00', 'in_person', 'st1'), L('2', 'b', '10:00', 'online', 'st2')]), [], '講師が違えば形式が違ってもよい');
  assert.deepEqual(findOverlaps([L('1', 'a', '10:00', 'in_person'), L('2', 'b', '10:00', 'online')]), [], '同じ講師の対面とオンラインの 1 対 2 も正常（2026-11-20 本人）');
  assert.deepEqual(findOverlaps([L('1', 'a', '10:00', 'in_person'), L('2', 'b', '10:00', 'online'), L('3', 'c', '10:30', 'online')]).map(g => g.reasons), [['3名以上']], '混ざっていても 3 人同時は出す');
  assert.deepEqual(findOverlaps([L('1', 'a', '10:00', 'in_person', 'st1'), L('2', 'a', '10:00', 'in_person', 'st2')]).map(g => g.reasons), [['同一生徒']]);
});

test('mixed pair (2026-11-20): in-person + online with the same teacher saves without force and raises no alert; a third is refused', async () => {
  const h = await createV2(); const auth = await h.owner();
  const me = (await h.ok('staff/me', { auth })).me;
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = async (givenName, deliveryMode) => (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '【テスト】', givenName, baseRate30: 1500, deliveryMode })).student;
  const room = await kid('教室', 'in_person'), net = await kid('オンライン', 'online'), more = await kid('三人目', 'online');
  const lesson = (s, mode, extra = {}) => ({ auth, studentId: s.id, date: '2026-10-03', start: '10:00', minutes: 90, subject: '英語', deliveryMode: mode, staffId: me.id, send: 'show', ...extra });
  await h.ok('schedule/lessons/create', lesson(room, 'in_person'));
  await h.ok('schedule/lessons/create', lesson(net, 'online'));
  assert.deepEqual((await h.ok('home/today', { auth })).alerts, []);
  const r = await h.call('schedule/lessons/create', lesson(more, 'online', { start: '10:30', force: true }));
  assert.equal(r.ok, false); assert.equal(r.error.code, 'overlap');
  assert.match(r.error.message, /3つ重なります/);
});

test('month chips: each lesson keeps its own status colour in a shared start time', async () => {
  const path = require('node:path'), { pathToFileURL } = require('node:url');
  const { startChips } = await import(pathToFileURL(path.join(__dirname, '..', 'assets', 'v2', 'month-chips.js')).href);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const L = (name, start, status) => ({ name, start, status });
  // 2026-11-20 の例: 18:00 は岡野（調整中）と山本（下書き）
  assert.deepEqual(startChips([L('岡野', '18:00', 'proposed'), L('山本', '18:00', 'held'), L('岡野', '19:30', 'proposed'), L('山本', '19:30', 'proposed')], l => l.name, esc), [
    '<span class="nm t2 mix"><small class="tm">18:00</small><b><span class="r1">岡野</span>・<span class="r0">山本</span></b></span>',
    '<span class="nm t2 r1"><small class="tm">19:30</small><b>岡野・山本</b></span>',
  ]);
  assert.deepEqual(startChips([L('<x>', '09:00', 'decided'), L('y', '08:00', 'cancelled')], l => l.name, esc), ['<span class="nm t2 r2"><small class="tm">09:00</small><b>&lt;x&gt;</b></span>'], '休みなどは出さない・名前はエスケープ');
});
