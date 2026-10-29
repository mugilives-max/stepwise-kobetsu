'use strict';
// 作り直し（v2）: 退塾の手続き（cf/v2/withdrawal.mjs。共通規約 第22条、2026-10-28 本人の決定）。
// やめた予約のキャンセル料は規約どおり・保護者にはメール・在籍の「退会」は最終受講日のあとに代表が押す
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

const at = s => Date.parse(s + '+09:00');

test('withdrawal: keep or stop each lesson, fees follow the usual rule, one mail, and the owner makes it 退会 after the last day', async () => {
  const h = await createV2(); const auth = await h.owner(); h.clock = at('2026-10-20T09:00:00');
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500 })).student;
  await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam.id }), h.mails().at(-1))), password: 'family password 1' });
  const lesson = async (date, decide = true) => {
    await h.ok('schedule/lessons/create', { auth, studentId: kid.id, date, start: '18:00', minutes: 90, subject: '数学', deliveryMode: 'in_person', force: true });
    const l = h.rows('select * from lessons where studentId = ? and date = ?', kid.id, date)[0];
    if (decide) await h.ok('schedule/lessons/decide', { auth, id: l.id, version: l.version });
    return l.id;
  };
  const done = await lesson('2026-11-10'), today = await lesson('2026-11-17'), later = await lesson('2026-11-24'), asking = await lesson('2026-11-26', false), draft = await lesson('2026-11-28', false);
  h.db2._sqlite.prepare("update lessons set status = 'held', askedAt = '' where id = ?").run(draft); // 保護者に見せる前の下書き
  const get = id => h.rows('select * from lessons where id = ?', id)[0];
  const stu = () => h.rows('select * from students where id = ?', kid.id)[0];

  // 11/17 16:30。保護者から 16:00 に LINE で「11/10 で終わりにしたい」と連絡があった
  h.clock = at('2026-11-17T16:30:00');
  const show = await h.ok('admin/withdrawal/show', { auth, studentId: kid.id });
  assert.deepEqual(show.lessons.map(l => [l.date, l.stage]), [['2026-11-17', 'decided'], ['2026-11-24', 'decided'], ['2026-11-26', 'asking'], ['2026-11-28', 'draft']], '始まっていない授業だけ並べる');
  assert.equal(show.siblings, 0);
  assert.equal((await h.call('admin/withdrawal/save', { auth, studentId: kid.id, version: stu().version, lastDay: '2026-11-17', receivedAt: '2026-11-17T16:00', keep: [later] })).error.code, 'afterLast', '最終受講日より後の授業は受けられない');
  assert.equal((await h.call('admin/withdrawal/save', { auth, studentId: kid.id, version: stu().version, lastDay: '2026-11-17', receivedAt: '2026-11-17T16:00', keep: [draft] })).error.code, 'badLesson', '下書きは受けられない');
  const before = h.mails().length;
  const r = await h.ok('admin/withdrawal/save', { auth, studentId: kid.id, version: stu().version, lastDay: '2026-11-10', receivedAt: '2026-11-17T16:00', keep: [] });
  assert.deepEqual([r.kept, r.stopped, r.feeTotal, r.mailed], [0, 3, 2250, true]);
  assert.deepEqual([get(done).status, get(today).status, get(later).status, get(asking).status, get(draft)], ['done', 'cancelled', 'rested', 'rested', undefined],
    '前日23時を過ぎた連絡の授業はキャンセル（16:00 は開始2時間前で50%）、前日23時より前ならお休み、確認待ちは取り下げ、下書きは消す。終わった授業は変えない');
  assert.equal(h.rows('select amount from cancellationFees where lessonId = ?', today)[0].amount, 2250);
  assert.deepEqual([stu().leaveOn, stu().leaveNoticeAt, stu().status], ['2026-11-10', new Date(at('2026-11-17T16:00:00')).toISOString(), 'enrolled'], '在籍はまだ変えない');
  const mails = h.mails().slice(before).filter(m => m.to === 'parent@example.invalid');
  assert.equal(mails.length, 1, '保護者へのお知らせは 1 通');
  assert.match(mails[0].subject, /退塾の手続きをしました/);
  assert.match(mails[0].body, /最終受講日：11\/10\(火\)/);
  assert.match(mails[0].body, /これから受ける授業：\nありません/);
  assert.match(mails[0].body, /11\/17\(火\) 18:00〜19:30 数学（キャンセル料 2,250円）/);
  assert.match(mails[0].body, /11\/24\(火\) 18:00〜19:30 数学\n/);
  assert.match(mails[0].body, /11\/26\(木\) 18:00〜19:30 数学\n/);
  assert.doesNotMatch(mails[0].body, /11\/28/, '保護者に見せていない下書きは書かない');
  const hub = await h.ok('students/hub', { auth, studentId: kid.id });
  assert.equal(hub.student.leaveOn, '2026-11-10');
  assert.equal((await h.ok('students/list', { auth })).families[0].students[0].leaveOn, '2026-11-10');

  // 退会は代表が押す。最終受講日の翌日から「今日」に出る
  h.clock = at('2026-11-10T20:00:00');
  assert.equal((await h.call('admin/withdrawal/finish', { auth, studentId: kid.id, version: stu().version })).error.code, 'beforeLast');
  assert.equal((await h.ok('home/today', { auth })).todo.find(t => t.key === 'withdrawal'), undefined);
  h.clock = at('2026-11-18T09:00:00');
  const todo = (await h.ok('home/today', { auth })).todo.find(t => t.key === 'withdrawal');
  assert.deepEqual([todo.count, todo.link], [1, `#student=${kid.id}/basic`]);
  assert.equal(stu().status, 'enrolled', 'システムは自動で退会にしない');
  const fin = await h.ok('admin/withdrawal/finish', { auth, studentId: kid.id, version: stu().version });
  assert.deepEqual([stu().status, fin.siblings], ['left', 0]);
  assert.equal((await h.ok('home/today', { auth })).todo.find(t => t.key === 'withdrawal'), undefined);
  assert.equal((await h.call('admin/withdrawal/undo', { auth, studentId: kid.id, version: stu().version })).error.code, 'left');
});

test('withdrawal: the plan can be undone before 退会, and 退会 cannot be chosen directly while lessons are ahead', async () => {
  const h = await createV2(); const auth = await h.owner(); h.clock = at('2026-10-20T09:00:00');
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500 })).student;
  await h.ok('schedule/lessons/create', { auth, studentId: kid.id, date: '2026-10-30', start: '18:00', minutes: 90, subject: '数学', deliveryMode: 'in_person', force: true });
  const stu = () => h.rows('select * from students where id = ?', kid.id)[0];
  assert.equal((await h.call('admin/students/update', { auth, id: kid.id, version: stu().version, status: 'left' })).error.code, 'lessonsLeft', '先の授業があるうちは在籍の欄から退会にしない');
  const r = await h.ok('admin/withdrawal/save', { auth, studentId: kid.id, version: stu().version, lastDay: '2026-10-28', keep: [] });
  assert.equal(r.mailed, false, '保護者ページを使っていない家族にはメールを送らない');
  assert.equal(stu().leaveOn, '2026-10-28');
  await h.ok('admin/withdrawal/undo', { auth, studentId: kid.id, version: stu().version });
  assert.deepEqual([stu().leaveOn, stu().leaveNoticeAt], ['', '']);
  assert.deepEqual(h.rows('select status from lessons where studentId = ?', kid.id).map(l => l.status), ['rested'], '取り消しても、やめた授業は戻さない');
  // 先の授業がなければ、今までどおり在籍の欄から退会にできる（記録の直しなど）。在籍に戻すと退塾の予定は消える
  await h.ok('admin/students/update', { auth, id: kid.id, version: stu().version, status: 'left' });
  await h.ok('admin/students/update', { auth, id: kid.id, version: stu().version, status: 'enrolled' });
  assert.deepEqual([stu().status, stu().leaveOn], ['enrolled', '']);
});
