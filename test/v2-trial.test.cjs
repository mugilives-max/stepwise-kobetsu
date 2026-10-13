'use strict';
// 作り直し（v2）: 体験生（cf/v2/trial.mjs、0020_trial.sql）。手順書 #48。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

test('trial students: registered without email, their lessons are decided as 体験 without notice, never billed, and enrolling keeps the same student', async () => {
  const h = await createV2(); const auth = await h.owner();
  const r = await h.ok('admin/trials/create', { auth, familyName: '高橋', givenName: '香帆', grade: '中3', note: '紹介' });
  const s = h.rows('select * from students where id = ?', r.studentId)[0], f = h.rows('select * from families where id = ?', r.familyId)[0];
  assert.deepEqual([s.trial, s.status, f.name, f.email], [1, 'enrolled', '高橋さん', '']);
  const mails = h.mails().length;
  // 1 日に 2 コマ（休憩をはさむ）: extra で同じ日にもう 1 つ
  const made = await h.ok('schedule/lessons/create', { auth, studentId: r.studentId, date: '2026-10-23', start: '18:00', minutes: 100, subject: '英語', deliveryMode: 'in_person', extra: [{ start: '19:50', minutes: 100, subject: '数学', deliveryMode: 'in_person' }] });
  assert.deepEqual([made.created, made.trial], [2, true]);
  const ls = h.rows('select kind, status, confirmBy, calendarEventId from lessons where studentId = ? order by start', r.studentId);
  assert.deepEqual(ls.map(l => [l.kind, l.status, l.confirmBy]), [['体験', 'decided', ''], ['体験', 'decided', '']]);
  assert.ok(ls.every(l => l.calendarEventId), 'カレンダーの予定を作る');
  assert.equal(h.mails().length, mails, '仮予定のお知らせは送らない');
  // 請求に入らない（計画が無くても「計画に入っていない授業」にも数えない）
  const plans = await h.ok('billing/plans/list', { auth, month: '2026-10' });
  const row = plans.students.find(x => x.id === r.studentId);
  assert.equal(row ? row.unplanned || 0 : 0, 0);
  const { studentBilling } = await import('../cf/v2/plan-calc.mjs');
  assert.equal((await studentBilling(h.env.DB2, r.studentId)).lessons.length, 0);
  // キャンセルしても取消料は無い
  const id = h.rows('select id, version from lessons where studentId = ? order by start limit 1', r.studentId)[0];
  await h.ok('schedule/lessons/cancel', { auth, id: id.id, version: id.version, receivedAt: '2026-10-22T10:00:00+09:00' });
  assert.equal(h.rows('select count(*) n from cancellationFees where lessonId = ?', id.id)[0].n, 0);
  // スタッフの一覧・予定の生徒に体験の印
  const list = await h.ok('students/list', { auth });
  assert.equal(list.families.flatMap(x => x.students).find(x => x.id === r.studentId).trial, true);
  // 入塾にする: 同じ生徒の行のまま trial = 0
  await h.ok('admin/trials/enroll', { auth, studentId: r.studentId, enrolledOn: '2026-11-01' });
  const en = h.rows('select trial, enrolledOn from students where id = ?', r.studentId)[0];
  assert.deepEqual([en.trial, en.enrolledOn], [0, '2026-11-01']);
  assert.equal((await h.call('admin/trials/enroll', { auth, studentId: r.studentId })).error.code, 'notTrial');
  // 入塾後の授業はふつう（仮予定のお知らせ）。体験の授業は体験のまま
  const after = await h.ok('schedule/lessons/create', { auth, studentId: r.studentId, date: '2026-11-04', start: '18:00', minutes: 90, subject: '英語', deliveryMode: 'in_person' });
  assert.equal(after.trial, undefined);
  const nx = h.rows("select kind, status from lessons where studentId = ? and date = '2026-11-04'", r.studentId)[0];
  assert.deepEqual([nx.kind, nx.status], ['通常', 'proposed']);
  // 講師はできない
  const teacher = await h.staffWith(auth, ['teacher'], 'teacher@example.invalid');
  assert.equal((await h.call('admin/trials/create', { auth: teacher, familyName: '山田' })).error.code, 'forbidden');
  assert.equal((await h.call('admin/trials/create', { auth, familyName: '' })).error.code, 'needName');
});
