'use strict';
// 授業の予定の段階（2026-10-14 本人決定、2026-10-16 実装。Kura issues/stepwise-lesson-stages、規約 r9 第13〜15条。0026_lesson_stages.sql）
// 下書き → 調整中（見せるだけ・メールなし・締め切りなし）→ 確認待ち（締め切り 1 つ・メール 1 通）→ 確定（「この日程で大丈夫」・締め切り・先生の確定）
// 時計は 2026-10-02 12:00（日本時間）から始まる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

async function world() {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500, deliveryMode: 'online' })).student;
  const parent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam.id }), h.mails().at(-1))), password: 'family password 1' })).auth;
  const me = (await h.ok('staff/me', { auth })).me;
  const L = { auth, studentId: kid.id, start: '17:00', minutes: 60, subject: '数学', deliveryMode: 'online', staffId: me.id };
  const base = h.mails().length; // 招待のメールより後
  const familyMails = () => h.mails().slice(base).filter(m => m.audience === 'family');
  const row = id => h.rows('select * from lessons where id = ?', id)[0];
  const ids = () => h.rows('select id from lessons where studentId = ? order by date, start', kid.id).map(r => r.id);
  const { runV2Scheduled } = await import('../cf/v2/index.mjs');
  const night = d => runV2Scheduled(h.env, Date.parse(d + 'T00:10:00+09:00'));
  return { h, auth, fam, kid, parent, me, L, familyMails, row, ids, night };
}

test('締め切りは付けない（2026-10-27）。前に付けていた締め切りの式は残す', async () => {
  const { confirmByFor: now, confirmByFor20261014: confirmByFor } = await import('../cf/v2/schedule.mjs');
  assert.deepEqual(now(['2026-10-05', '2026-10-20'], '2026-10-02', ''), ['', '']);
  // 10/2 に 10/5・10/6・10/20 → 10/5・10/6 は 2 日前が 3 日後（10/5）より前なので置かない。10/20 は 10/5
  assert.deepEqual(confirmByFor(['2026-10-05', '2026-10-06', '2026-10-20'], '2026-10-02', ''), ['', '', '2026-10-05']);
  // 10/7 は 2 日前が 10/5 でちょうど置ける。10/30 も同じ締め切りにそろう
  assert.deepEqual(confirmByFor(['2026-10-07', '2026-10-30'], '2026-10-02', ''), ['2026-10-05', '2026-10-05']);
  // 翌月の授業だけなら今月25日（ただし全部の授業の 2 日前まで）
  assert.deepEqual(confirmByFor(['2026-11-03', '2026-11-20'], '2026-10-02', ''), ['2026-10-25', '2026-10-25']);
  // 締め切りを指定するときも 3 日以上あと
  assert.throws(() => confirmByFor(['2026-10-20'], '2026-10-02', '2026-10-04'), /3日以上あと/);
  assert.deepEqual(confirmByFor(['2026-10-20'], '2026-10-02', '2026-10-10'), ['2026-10-10']);
});

test('作る: 下書き（見えない）・調整中（見えるがメールなし・締め切りなし）・確認をお願いする（メール 1 通・LINE の文）', async () => {
  const { h, parent, L, familyMails, ids } = await world();
  const r0 = await h.ok('schedule/lessons/create', { ...L, date: '2026-10-20', send: 'hold' });
  assert.equal(r0.held, true);
  const r1 = await h.ok('schedule/lessons/create', { ...L, date: '2026-10-21', send: 'show' });
  assert.equal(r1.shown, true);
  assert.equal(familyMails().length, 0, '下書き・調整中はメールなし');
  let fl = (await h.ok('family/schedule', { auth: parent, to: '2026-10-31' })).lessons;
  assert.deepEqual(fl.map(l => [l.date, l.stage, l.confirmBy]), [['2026-10-21', 'adjusting', '']], '保護者には調整中だけが見える');
  const r2 = await h.ok('schedule/lessons/create', { ...L, date: '2026-10-22', send: 'ask', repeat: 2 });
  assert.deepEqual([r2.asked, r2.confirmBy], [true, '']);
  assert.equal(familyMails().length, 1, '承認のお願いはまとめて 1 通');
  assert.match(familyMails()[0].body, /10\/22\(木\) 17:00〜18:00 数学（受講計画に追加・3,000円）\n・10\/29\(木\)[\s\S]*「承認する」を押すと、この日時で確定します/);
  assert.doesNotMatch(familyMails()[0].body, /ご連絡がなければ/, '返事がなくても確定しない');
  assert.match(r2.lineText, /^【ステップワイズ】架空 一郎さんの授業の日程の承認をお願いします。[\s\S]*https:\/\/www\.stepwise-education\.jp\/family\/#confirm$/);
  fl = (await h.ok('family/schedule', { auth: parent, to: '2026-10-31' })).lessons;
  assert.deepEqual(fl.map(l => l.stage), ['adjusting', 'asking', 'asking']);
  assert.equal(ids().length, 4);
  // 何も指定しない古い呼び出しは、承認のお願い
  const old = await h.ok('schedule/lessons/create', { ...L, date: '2026-10-23' });
  assert.equal(old.asked, true);
});

test('進める: 下書き→調整中（メールなし）→ 確認待ち（下書きと調整中をまとめて 1 通）。二重には送らない。下書きに戻すと見えなくなる', async () => {
  const { h, auth, kid, parent, L, familyMails, row, ids } = await world();
  for (const d of ['2026-10-05', '2026-10-20', '2026-10-27']) await h.ok('schedule/lessons/create', { ...L, date: d, send: 'hold' });
  const [a, b, c] = ids();
  const shown = await h.ok('schedule/lessons/show', { auth, studentId: kid.id, lessonIds: [b] });
  assert.deepEqual([shown.shown, shown.left], [1, 2]);
  assert.equal(familyMails().length, 0);
  const range = await h.ok('schedule/staff/range', { auth, from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([range.heldAll.map(l => l.id), range.adjustingAll.map(l => l.id)], [[a, c], [b]], '「対応すること」に下書きと調整中');
  // 下書き a（近い）・調整中 b・下書き c をまとめて確認待ちへ
  const asked = await h.ok('schedule/lessons/ask', { auth, studentId: kid.id, lessonIds: [a, b, c] });
  assert.deepEqual([asked.asked, asked.confirmBy, asked.left], [3, '', 0]);
  assert.deepEqual([a, b, c].map(id => [row(id).status, row(id).confirmBy, !!row(id).askedAt]), [['proposed', '', true], ['proposed', '', true], ['proposed', '', true]]);
  assert.equal(familyMails().length, 1);
  assert.match(familyMails()[0].body, /10\/5\(月\)[^\n]*\n・10\/20\(火\)[^\n]*\n・10\/27\(火\)[^\n]*\n/);
  // もう確認待ちのものは二重に送らない
  const again = await h.call('schedule/lessons/ask', { auth, studentId: kid.id, lessonIds: [b] });
  assert.equal(again.error.code, 'badTargets');
  assert.equal(familyMails().length, 1);
  // 下書きに戻す
  const l = row(c);
  await h.ok('schedule/lessons/unsend', { auth, id: c, version: l.version });
  assert.deepEqual([row(c).status, row(c).askedAt, row(c).confirmBy], ['held', '', '']);
  const fl = (await h.ok('family/schedule', { auth: parent, to: '2026-10-31' })).lessons;
  assert.deepEqual(fl.map(x => x.id), [a, b], '下書きに戻した授業は保護者から見えない');
  assert.equal(familyMails().length, 1, '下書きに戻してもメールなし');
});

test('日時を直す: 調整中・確認待ちはメールなし（確認待ちは調整中に戻る）。確定はお知らせ', async () => {
  const { h, auth, kid, L, familyMails, row, ids } = await world();
  await h.ok('schedule/lessons/create', { ...L, date: '2026-10-20', send: 'show' });
  await h.ok('schedule/lessons/create', { ...L, date: '2026-10-21', send: 'ask' });
  await h.ok('schedule/lessons/create', { ...L, date: '2026-10-22', send: 'hold' });
  const [adj, ask, dec] = ids();
  await h.ok('schedule/lessons/decide', { auth, id: dec, version: row(dec).version, agreement: 'LINE 10/2 お母さんと合意' });
  assert.deepEqual([row(dec).status, row(dec).agreement, row(dec).decidedBy.startsWith('staff:')], ['decided', 'LINE 10/2 お母さんと合意', true]);
  const n0 = familyMails().length;
  const up = (id, date) => h.ok('schedule/lessons/update', { auth, id, version: row(id).version, date, start: '17:00', minutes: 60, subject: '数学', kind: '通常', deliveryMode: 'online', staffId: row(id).staffId });
  assert.equal((await up(adj, '2026-10-26')).backToAdjusting, false);
  const moved = await up(ask, '2026-10-27');
  assert.equal(moved.backToAdjusting, true);
  assert.deepEqual([row(ask).askedAt, row(ask).confirmBy, moved.lesson.stage], ['', '', 'adjusting'], '締め切りを外して調整中に戻る');
  assert.equal(familyMails().length, n0, '調整中・確認待ちの変更はメールなし');
  await up(dec, '2026-10-28');
  assert.equal(familyMails().length, n0 + 1, '確定した授業の変更はお知らせ');
  assert.match(familyMails().at(-1).subject, /授業の日時を変更しました/);
});

test('夜の自動確定: 前に締め切りを付けた確認待ちだけ、締め切りの翌日に 1 通。調整中と締め切りのない授業は確定しない', async () => {
  const { h, auth, kid, L, familyMails, row, ids, night } = await world();
  for (const d of ['2026-10-04', '2026-10-20', '2026-10-21']) await h.ok('schedule/lessons/create', { ...L, date: d, send: 'hold' });
  await h.ok('schedule/lessons/create', { ...L, date: '2026-10-22', send: 'show' });
  const [near, x, y, adj] = ids();
  await h.ok('schedule/lessons/ask', { auth, studentId: kid.id, lessonIds: [near, x, y] });
  h.db2._sqlite.prepare("update lessons set noticeState = 'external', noticeAt = askedAt where askedAt <> ''").run(); // synthetic LINE notice with the same deadline
  h.db2._sqlite.prepare("update lessons set confirmBy = '2026-10-05' where id in (?, ?)").run(x, y); // 2026-10-27 より前に締め切りを付けて送った授業
  const n0 = familyMails().length;
  assert.equal((await night('2026-10-05')).confirmed, 0, '締め切りの日のうちは決めない');
  const r = await night('2026-10-06');
  assert.deepEqual([r.confirmed, r.students], [2, 1], '同じ締め切りなので一晩でまとめて');
  assert.deepEqual([near, x, y, adj].map(id => row(id).status), ['proposed', 'decided', 'decided', 'proposed']);
  const sent = familyMails().slice(n0);
  assert.equal(sent.length, 1, '確定のお知らせは 1 通');
  assert.match(sent[0].body, /10\/20\(火\)[^\n]*\n・10\/21\(水\)/, '何が確定したかを書く');
  for (const d of ['2026-10-07', '2026-10-15', '2026-10-21']) assert.equal((await night(d)).confirmed, 0, '調整中は確定しない');
  assert.equal(row(adj).status, 'proposed');
});

test('保護者の「承認する」: 見ていた確認待ち（id と版）をそのまま確定。違えば何もしない。ほかの家族の授業や調整中は押せない', async () => {
  const { h, auth, kid, parent, L, row, ids } = await world();
  for (const d of ['2026-10-20', '2026-10-21', '2026-10-22']) await h.ok('schedule/lessons/create', { ...L, date: d, send: 'hold' });
  const [a, b, c] = ids();
  await h.ok('schedule/lessons/ask', { auth, studentId: kid.id, lessonIds: [a, b] });
  await h.ok('schedule/lessons/show', { auth, studentId: kid.id, lessonIds: [c] });
  const pick = id => ({ id, version: row(id).version });
  // 調整中は押せない
  assert.equal((await h.call('family/lessons/agree', { auth: parent, lessons: [pick(a), pick(c)] })).error.code, 'conflict');
  // 古い版は押せない（先生が直した）
  const stale = pick(a);
  await h.ok('schedule/lessons/update', { auth, id: a, version: row(a).version, date: '2026-10-20', start: '17:00', minutes: 60, subject: '数学（式）', kind: '通常', deliveryMode: 'online', staffId: row(a).staffId });
  assert.equal((await h.call('family/lessons/agree', { auth: parent, lessons: [stale, pick(b)] })).error.code, 'conflict');
  assert.deepEqual([row(a).status, row(b).status], ['proposed', 'proposed'], '何も確定しない');
  // 連絡を出している授業は押せない
  await h.ok('family/lessons/request', { auth: parent, lessonId: b, kind: 'move', note: '18時からにしたい' });
  assert.equal((await h.call('family/lessons/agree', { auth: parent, lessons: [pick(b)] })).error.code, 'hasRequest');
  // ほかの家族の授業は見つからない
  const fam2 = (await h.ok('admin/families/create', { auth, name: '別家', email: 'other@example.invalid' })).family;
  const other = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam2.id }), h.mails().at(-1))), password: 'family password 2' })).auth;
  assert.equal((await h.call('family/lessons/agree', { auth: other, lessons: [pick(a)] })).error.code, 'notFound');
  // 押す
  const staff0 = h.mails().filter(m => m.audience === 'staff').length;
  const ok = await h.ok('family/lessons/agree', { auth: parent, lessons: [pick(a)] });
  assert.equal(ok.decided, 1);
  const r = row(a);
  assert.deepEqual([r.status, r.decidedBy.startsWith('family:'), /承認する/.test(r.agreement), !!r.calendarEventId], ['decided', true, true, true]);
  const sm = h.mails().filter(m => m.audience === 'staff').slice(staff0);
  assert.equal(sm.length, 1, '塾に知らせる');
  assert.match(sm[0].body, /日程を承認しました[\s\S]*10\/20\(火\)/);
  assert.equal(h.mails().filter(m => m.audience === 'family' && /確定/.test(m.subject)).length, 0, '保護者にはメールを出さない');
  // 生徒の専用リンクからは押せない（合意は保護者）
  const k = new URL(kid.link).searchParams.get('k');
  assert.equal((await h.call('student/lessons/agree', { k, lessons: [pick(b)] })).ok, false);
});

test('スタッフの「今日」: 調整中のまま 5 日以内に来る授業を「対応すること」に出す', async () => {
  const { h, auth, L } = await world();
  await h.ok('schedule/lessons/create', { ...L, date: '2026-10-05', send: 'show' });
  await h.ok('schedule/lessons/create', { ...L, date: '2026-10-20', send: 'show' });
  const t = await h.ok('home/today', { auth });
  assert.deepEqual(t.todo.filter(x => x.key === 'adjusting').map(x => x.count), [1]);
});

// 2通り（2026-10-27 本人「LINEとかで…合意が取れたらそれを塾側がシステムに反映する。あるいは…リンクを送って…承認お願いします」
// 「受講計画合意書とセットで承認する…計画の分を超えていますがよろしいですかって聞く」）
test('2通り: ① 確定で入れる（メールなし）・② 承認のお願い（締め切りなし）。受講計画合意書を超える分は、その授業への合意で1回足す', async () => {
  const { h, auth, kid, parent, L, familyMails, row, ids } = await world();
  const pl = (await h.ok('billing/plans/save', { auth, studentId: kid.id, subject: '数学', kind: '通常', startDate: '2026-10-01', endDate: '2026-10-31', count: 1, minutes: 60, fee: 2800 })).line;
  await h.ok('billing/plans/consent', { auth, id: pl.id, version: pl.version, consentedAt: '2026-10-02T03:00:00Z', via: 'LINE', consenterName: '【テスト】架空 保護者' });
  const n0 = familyMails().length;
  // ① 計画の中: そのまま確定
  const r1 = await h.ok('schedule/lessons/create', { ...L, date: '2026-10-20', send: 'decide' });
  assert.deepEqual([r1.decided, r1.extra], [true, 0]);
  const [a] = ids();
  assert.deepEqual([row(a).status, row(a).agreement, !!row(a).calendarEventId], ['decided', 'LINE・対面などで合意（塾が登録）', true]);
  // ① 計画を超える: 「よろしいですか」→ 足して確定
  const w = await h.call('schedule/lessons/create', { ...L, date: '2026-10-21', send: 'decide' });
  assert.equal(w.error.code, 'needForce');
  assert.match(w.error.message, /受講計画合意書の回数を超える授業が1回あります（10\/21 数学、1回 2,800円）/);
  assert.equal(ids().length, 1, '確かめる前は何も作らない');
  const r2 = await h.ok('schedule/lessons/create', { ...L, date: '2026-10-21', send: 'decide', force: true });
  assert.equal(r2.extra, 1);
  assert.equal(familyMails().length, n0, '① はメールなし');
  let add = h.rows("select * from planLines where parentId = ? order by startDate", pl.id);
  assert.deepEqual(add.map(l => [l.status, l.startDate, l.endDate, l.count, l.fee, l.approvedBy.startsWith('staff:'), l.consenterName]), [['approved', '2026-10-21', '2026-10-21', 1, 2800, true, '架空家']]);
  // ② 承認のお願い: 保護者の画面に「追加」と金額。承認すると足す
  await h.ok('schedule/lessons/create', { ...L, date: '2026-10-22', send: 'ask' });
  const c = ids()[2];
  assert.deepEqual([row(c).status, row(c).confirmBy, !!row(c).askedAt], ['proposed', '', true]);
  assert.match(familyMails().at(-1).body, /10\/22\(木\) 17:00〜18:00 数学（受講計画に追加・2,800円）/);
  const fl = (await h.ok('family/schedule', { auth: parent, to: '2026-10-31' })).lessons.find(l => l.id === c);
  assert.equal(fl.extraFee, 2800);
  await h.ok('family/lessons/agree', { auth: parent, lessons: [{ id: c, version: row(c).version }] });
  add = h.rows("select * from planLines where parentId = ? order by startDate", pl.id);
  assert.deepEqual(add.map(l => [l.startDate, l.approvedBy, l.approvedVia]), [['2026-10-21', add[0].approvedBy, add[0].approvedVia], ['2026-10-22', 'family', '保護者ページ（授業の日程の承認）']]);
  // 3回とも請求に入る（受講計画合意書を作り直さない）
  const { studentBilling } = await import('../cf/v2/plan-calc.mjs');
  const sb = await studentBilling(h.db2, kid.id);
  assert.deepEqual(ids().map(id => !!sb.line[id]), [true, true, true]);
  // 管理画面の「確定する」（withExtras）も同じく確かめる
  await h.ok('schedule/lessons/create', { ...L, date: '2026-10-23', send: 'ask' });
  const d = ids()[3];
  const w2 = await h.call('schedule/lessons/decide', { auth, id: d, version: row(d).version, withExtras: true });
  assert.equal(w2.error.code, 'needForce');
  await h.ok('schedule/lessons/decide', { auth, id: d, version: row(d).version, withExtras: true, force: true });
  assert.equal(h.rows("select * from planLines where parentId = ?", pl.id).length, 3);
});

// まとめて返事（2026-10-27 本人「一括の承認はできるけども、それ以外は各個撃破で…大変な手間」）
test('まとめて返事: 選んだ授業は承認、外した授業は日時の変更のお願い（ひとことは全部に同じ）。塾へのお知らせはそれぞれ 1 通', async () => {
  const { h, auth, kid, parent, L, row, ids } = await world();
  for (const d of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) await h.ok('schedule/lessons/create', { ...L, date: d, send: 'hold' });
  const [a, b, c, d] = ids();
  await h.ok('schedule/lessons/ask', { auth, studentId: kid.id, lessonIds: [a, b, c, d] });
  const staff0 = h.mails().filter(m => m.audience === 'staff').length;
  // 見ていない授業を外そうとしたら何も変えない
  assert.equal((await h.call('family/lessons/respond', { auth: parent, lessons: [{ id: a, version: row(a).version }], move: ['ls_nothing'] })).error.code, 'notFound');
  assert.equal(row(a).status, 'proposed');
  const r = await h.ok('family/lessons/respond', { auth: parent, lessons: [a, b].map(id => ({ id, version: row(id).version })), move: [c, d], note: '【テスト】22・23日は部活' });
  assert.deepEqual([r.decided, r.moved], [2, 2]);
  assert.deepEqual([a, b, c, d].map(id => row(id).status), ['decided', 'decided', 'proposed', 'proposed']);
  const reqs = h.rows("select lessonId, kind, note, status from lessonRequests order by lessonId");
  assert.deepEqual(reqs.map(x => [x.kind, x.note, x.status]), [['move', '【テスト】22・23日は部活', 'open'], ['move', '【テスト】22・23日は部活', 'open']]);
  const sm = h.mails().filter(m => m.audience === 'staff').slice(staff0);
  assert.deepEqual(sm.map(m => /承認しました/.test(m.body) ? 'agree' : /日時の変更のお願い/.test(m.subject) ? 'move' : 'other'), ['agree', 'move']);
  assert.match(sm[1].body, /10\/22\(木\)[^\n]*\n・10\/23\(金\)/);
  // もう一度送っても二重にしない
  assert.equal((await h.ok('family/lessons/respond', { auth: parent, move: [c] })).moved, 0);
});
