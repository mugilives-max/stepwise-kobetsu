'use strict';
// 作り直し（v2）7段目: 講師の給与（雇用・月末締め・翌月25日払い・源泉徴収税額表の甲欄乙欄）。cf/v2/payroll.mjs・cf/v2/tax-table.mjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const taxTable = () => import(pathToFileURL(path.join(__dirname, '..', 'cf', 'v2', 'tax-table.mjs')).href);

const at = s => Date.parse(s + '+09:00');
async function world() {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500 })).student;
  const tAuth = await h.staffWith(auth, ['teacher'], 'teacher@example.invalid'), t = (await h.ok('staff/me', { auth: tAuth })).me;
  const uAuth = await h.staffWith(auth, ['teacher'], 'other@example.invalid'), u = (await h.ok('staff/me', { auth: uAuth })).me;
  // 9/1 の時点で授業を作って決定する
  const lesson = async (date, start, staffId, minutes = 90) => {
    const keep = h.clock; h.clock = at('2026-09-01T09:00:00');
    await h.ok('schedule/lessons/create', { auth, studentId: kid.id, date, start, minutes, subject: '数学', deliveryMode: 'in_person', staffId, force: true });
    const l = h.rows('select * from lessons where date = ? and start = ?', date, start)[0];
    await h.ok('schedule/lessons/decide', { auth, id: l.id, version: l.version });
    h.clock = keep; return l.id;
  };
  const done = async id => { const l = h.rows('select * from lessons where id = ?', id)[0]; await h.ok('schedule/lessons/done', { auth, id, version: l.version }); };
  return { h, auth, fam, kid, tAuth, t, uAuth, u, lesson, done };
}

test('the month statement counts done lessons and past meetings at each instructor\'s rates, rounding each line down', async () => {
  const { h, auth, fam, kid, tAuth, t, u, lesson, done } = await world();
  const a = await lesson('2026-09-08', '17:00', t.id), b = await lesson('2026-09-15', '17:00', t.id, 45), sub = await lesson('2026-09-22', '17:00', u.id);
  h.clock = at('2026-09-01T09:00:00');
  await h.ok('schedule/meetings/create', { auth, familyId: fam.id, studentId: kid.id, staffId: t.id, date: '2026-09-20', start: '10:00', minutes: 30, title: '三者面談' });
  h.clock = at('2026-10-02T12:00:00');
  await done(a); await done(b);
  let m = await h.ok('payroll/month', { auth, month: '2026-09' });
  assert.match(m.staff.find(s => s.staffId === t.id).preview.issues.join(), /時給が決まっていません/);
  assert.equal(m.payOn, '2026-10-23', '翌月25日払い');
  await h.ok('payroll/rates/save', { auth, staffId: t.id, startsOn: '2026-09', lessonHourly: 1555, meetingHourly: 1500 });
  await h.ok('payroll/rates/save', { auth, staffId: u.id, startsOn: '2026-09', lessonHourly: 1400, meetingHourly: 1500 });
  const v = (await h.ok('payroll/staff', { auth, staffId: t.id, month: '2026-09' })).preview;
  assert.deepEqual(v.items.map(i => [i.kind, i.minutes, i.rate, i.amount]), [['lesson', 90, 1555, 2332], ['prep', 10, 1555, 259], ['lesson', 45, 1555, 1166], ['prep', 10, 1555, 259], ['meeting', 30, 1500, 750]], '1円未満は行ごとに切り捨て。準備・記録は授業の前後5分（その日の授業が1つなら10分）を授業の時給で');
  assert.deepEqual([v.lessonMinutes, v.meetingMinutes, v.prepMinutes, v.gross, v.withholding, v.net, v.taxColumn], [135, 30, 20, 4766, 145, 4621, 'otsu'], '扶養控除等申告書が出るまでは乙欄（105,000円未満は 3.063%、1円未満切り捨て）');
  const other = (await h.ok('payroll/staff', { auth, staffId: u.id, month: '2026-09' })).preview;
  assert.doesNotMatch(other.issues.join(), /実施済みになっていません/, '代講の講師の授業も、終わりの時刻を過ぎたら自動で実施済み（2026-10-27）');
  await done(sub);
  // 扶養控除等申告書を出した講師は甲欄（105,000円未満は0円）
  const tu = h.rows('select version, contractType from staff where id = ?', u.id)[0];
  assert.equal(tu.contractType, 'employee', '招待した講師は雇用');
  assert.equal((await h.call('payroll/withholding', { auth, staffId: u.id, version: tu.version, taxColumn: 'kou', dependents: 8 })).error.code, 'badDependents');
  await h.ok('payroll/withholding', { auth, staffId: u.id, version: tu.version, taxColumn: 'kou', dependents: 1 });
  const ov = (await h.ok('payroll/staff', { auth, staffId: u.id, month: '2026-09' })).preview;
  assert.deepEqual([ov.gross, ov.withholding, ov.net, ov.taxColumn, ov.dependents], [2333, 0, 2333, 'kou', 1], '授業 2,100円＋準備・記録10分 233円');
  assert.equal((await h.call('payroll/month', { auth: tAuth, month: '2026-09' })).error.code, 'forbidden', '講師はほかの講師の給与を見られない');
  assert.ok(sub);
});

test('confirming fixes the statement; corrections void it with a reason; instructors see only their own; later lessons go to the next statement', async () => {
  const { h, auth, tAuth, t, uAuth, lesson, done } = await world();
  const a = await lesson('2026-09-08', '17:00', t.id), late = await lesson('2026-09-29', '17:00', t.id);
  await h.ok('payroll/withholding', { auth, staffId: t.id, version: h.rows('select version from staff where id = ?', t.id)[0].version, taxColumn: 'kou', dependents: 0 });
  await h.ok('payroll/rates/save', { auth, staffId: t.id, startsOn: '2026-09', lessonHourly: 1500, meetingHourly: 1500 });
  h.clock = at('2026-09-30T20:00:00');
  await done(a);
  assert.equal((await h.call('payroll/confirm', { auth, staffId: t.id, month: '2026-09' })).error.code, 'tooEarly', '月末締め');
  h.clock = at('2026-10-02T12:00:00');
  await h.ok('payroll/adjust/add', { auth, staffId: t.id, month: '2026-09', label: '研修 1時間', amount: 1500 });
  // 9/29 の授業は、終わりの時刻を過ぎたので自動で実施済み（2026-10-27。前は手で実施済みにするまで確定できなかった）
  await done(late);
  const before = h.mails().length;
  const p = (await h.ok('payroll/confirm', { auth, staffId: t.id, month: '2026-09', expectedNet: 2250 + 250 + 2250 + 250 + 1500 })).payroll;
  assert.deepEqual([p.status, p.gross, p.withholding, p.taxColumn, p.dependents, p.items.length, p.payOn], ['confirmed', 6500, 0, 'kou', 0, 5, '2026-10-23'], '確定した明細に計算した欄を残す');
  assert.match(h.mails().slice(before).map(m => m.subject).join(), /9月分の給与明細/);
  assert.equal((await h.call('payroll/rates/save', { auth, staffId: t.id, startsOn: '2026-09', lessonHourly: 1600, meetingHourly: 1500 })).error.code, 'confirmed', '確定した月の時給は変えない');
  // 講師: 自分の明細だけ
  const mine = await h.ok('payroll/mine', { auth: tAuth });
  assert.deepEqual([mine.statements.length, mine.statements[0].net], [1, 6500]);
  assert.equal((await h.ok('payroll/mine', { auth: uAuth })).statements.length, 0);
  assert.equal((await h.ok('payroll/mine', { auth })).owner, true, '代表は給与明細を持たない');
  // 訂正: 取り消して確定し直す
  assert.equal((await h.call('payroll/void', { auth, id: p.id, version: p.version })).error.code, 'needReason');
  await h.ok('payroll/void', { auth, id: p.id, version: p.version, reason: '調整の金額の誤り' });
  assert.equal(h.rows("select count(*) n from lessons where payrollId <> ''")[0].n, 0, '取り消すと授業は明細の前に戻る');
  const adj = h.rows('select id from payrollAdjustments')[0].id;
  await h.ok('payroll/adjust/delete', { auth, id: adj });
  const p2 = (await h.ok('payroll/confirm', { auth, staffId: t.id, month: '2026-09' })).payroll;
  assert.equal(p2.gross, 5000, '授業 2,250円×2＋準備・記録 250円×2');
  assert.deepEqual(h.rows('select status, voidReason from payrollMonths order by createdAt').map(r => [r.status, r.voidReason]), [['void', '調整の金額の誤り'], ['confirmed', '']], '取り消した明細も記録に残る');
  await h.ok('payroll/paid', { auth, id: p2.id, version: p2.version, paidOn: '2026-10-02' });
  assert.equal((await h.call('payroll/void', { auth, id: p2.id, version: p2.version + 1, reason: 'x' })).error.code, 'paid');
  // 確定のあとで実施済みになった前の月の授業は、次の月の明細に入る
  const after = await lesson('2026-09-30', '17:00', t.id);
  await done(after);
  const oct = (await h.ok('payroll/staff', { auth, staffId: t.id, month: '2026-10' })).preview;
  assert.deepEqual(oct.items.map(i => [i.kind, i.date, i.carried]), [['lesson', '2026-09-30', true], ['prep', '2026-09-30', true]], '準備・記録も授業と一緒に次の月へ');
});

test('two lessons at once are paid by the time worked, not per student', async () => {
  const { h, auth, fam, t, lesson, done } = await world();
  const kid2 = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '花子', baseRate30: 1500 })).student;
  const a = await lesson('2026-09-08', '17:00', t.id, 60);
  // 2人目: 17:30〜18:30（同じ講師・対面の2人同時）
  const keep = h.clock; h.clock = at('2026-09-01T09:00:00');
  await h.ok('schedule/lessons/create', { auth, studentId: kid2.id, date: '2026-09-08', start: '17:30', minutes: 60, subject: '英語', deliveryMode: 'in_person', staffId: t.id, force: true });
  const b = h.rows('select * from lessons where studentId = ?', kid2.id)[0];
  await h.ok('schedule/lessons/decide', { auth, id: b.id, version: b.version }); h.clock = keep;
  const c = await lesson('2026-09-15', '17:00', t.id, 60);
  h.clock = at('2026-10-02T12:00:00');
  await done(a); await done(b.id); await done(c);
  await h.ok('payroll/rates/save', { auth, staffId: t.id, startsOn: '2026-09', lessonHourly: 2000, meetingHourly: 1500 });
  const v = (await h.ok('payroll/staff', { auth, staffId: t.id, month: '2026-09' })).preview;
  assert.deepEqual(v.items.map(i => [i.date, i.minutes, i.amount]), [['2026-09-08', 60, 2000], ['2026-09-08', 30, 1000], ['2026-09-08', 10, 333], ['2026-09-15', 60, 2000], ['2026-09-15', 10, 333]], '重なる30分は1回だけ。準備・記録も、同時の授業の前後で1回（前5分・後5分）');
  assert.match(v.items[1].label, /重なる30分を除く/);
  assert.deepEqual([v.lessonMinutes, v.prepMinutes, v.gross], [150, 20, 5666]);
  await h.ok('payroll/confirm', { auth, staffId: t.id, month: '2026-09', expectedNet: v.net });
  assert.equal(h.rows("select count(*) n from lessons where payrollId <> ''")[0].n, 3, '同時の授業も明細に入る（もう一度数えない）');
});

test('withholding follows the monthly tax table of the pay year (kou by dependents, otsu otherwise)', async () => {
  const { monthlyWithholding } = await taxTable();
  const w = (amount, year, column, dependents) => monthlyWithholding(amount, { year, column, dependents });
  // 令和8年分の月額表（国税庁）から
  assert.deepEqual([w(104999, 2026, 'kou', 0).tax, w(105000, 2026, 'kou', 0).tax, w(137000, 2026, 'kou', 1).tax, w(171000, 2026, 'kou', 2).tax], [0, 170, 190, 100]);
  assert.deepEqual([w(104999, 2026, 'otsu').tax, w(105000, 2026, 'otsu').tax, w(193000, 2026, 'otsu').tax], [3216, 3800, 17600]);
  assert.equal(w(737000, 2026, 'kou', 7).tax, 26110);
  // 令和9年分は 111,000円から（12月分は翌年1月25日払いなので令和9年分を使う）
  assert.deepEqual([w(110999, 2027, 'kou', 0).tax, w(111000, 2027, 'kou', 0).tax], [0, 140]);
  assert.match(w(740000, 2026, 'kou', 0).error, /税額表の計算式/);
  assert.match(w(50000, 2030, 'kou', 0).error, /2030年分/);

  const { h, auth, t, lesson } = await world();
  const dec = await lesson('2026-12-08', '17:00', t.id, 60);
  await h.ok('payroll/rates/save', { auth, staffId: t.id, startsOn: '2026-09', lessonHourly: 2000, meetingHourly: 1500 });
  await h.ok('payroll/adjust/add', { auth, staffId: t.id, month: '2026-12', label: '冬期講習の準備', amount: 107000 });
  await h.ok('payroll/withholding', { auth, staffId: t.id, version: h.rows('select version from staff where id = ?', t.id)[0].version, taxColumn: 'kou', dependents: 0 });
  await h.db2.prepare("update lessons set status = 'done' where id = ?").bind(dec).run(); // 実施済みにした（日をまたぐとログインが切れるので直接）
  const v = (await h.ok('payroll/staff', { auth, staffId: t.id, month: '2026-12' })).preview;
  assert.deepEqual([v.payOn, v.gross, v.withholding], ['2027-01-25', 109333, 0], '令和9年分の表では 109,333円の甲欄は0円（令和8年分なら380円）。授業2,000円＋準備・記録10分333円＋調整');
});

test('準備・記録: 授業の前後5分を、授業・面談をしていない時間の分だけ数え、同じ1分を二重に数えない（2026-10-14 本人決定）', async () => {
  const { h, auth, fam, kid, t, lesson, done } = await world();
  // 9/7: 10分の間（18:00〜19:30・19:40〜21:10）→ 前5＋間10＋後5＝20分
  // 9/8: 続けて（18:00〜19:30・19:30〜21:00）→ 前5＋間0＋後5＝10分
  // 9/9: 5分の間（18:00〜19:30・19:35〜21:05）→ 前5＋間5＋後5＝15分
  // 9/10: 30分の間（17:00〜18:30・19:00〜20:30）→ 前5＋間10（残りは休憩）＋後5＝20分
  // 9/11: 間に面談（17:00〜18:00・面談 18:00〜18:30・18:30〜19:30）→ 前5＋後5＝10分（面談の時間は面談として払う）
  // 9/12: 授業の中の面談（17:00〜18:30・面談 17:30〜18:00）→ 面談は授業と重なるので0分、準備・記録は10分
  const plan = [['2026-09-07', '18:00', 90], ['2026-09-07', '19:40', 90], ['2026-09-08', '18:00', 90], ['2026-09-08', '19:30', 90], ['2026-09-09', '18:00', 90], ['2026-09-09', '19:35', 90],
    ['2026-09-10', '17:00', 90], ['2026-09-10', '19:00', 90], ['2026-09-11', '17:00', 60], ['2026-09-11', '18:30', 60], ['2026-09-12', '17:00', 90]];
  const ids = [];
  for (const [d, st, min] of plan) ids.push(await lesson(d, st, t.id, min));
  h.clock = at('2026-09-01T09:00:00');
  await h.ok('schedule/meetings/create', { auth, familyId: fam.id, studentId: kid.id, staffId: t.id, date: '2026-09-11', start: '18:00', minutes: 30, title: '面談A' });
  // 授業と重なる面談（画面からは作れないことがあるので、表に直接入れて確かめる）
  const mA = h.rows("select * from meetings where title = '面談A'")[0];
  h.db2._sqlite.prepare("insert into meetings (id, familyId, studentId, staffId, date, start, minutes, deliveryMode, title, meetUrl, calendarEventId, status, createdAt, updatedAt) values ('mt_inlesson', ?, ?, ?, '2026-09-12', '17:30', 30, 'in_person', '面談B', '', '', 'scheduled', ?, ?)").run(mA.familyId, mA.studentId, t.id, mA.createdAt, mA.createdAt);
  h.clock = at('2026-10-02T12:00:00');
  for (const id of ids) await done(id);
  await h.ok('payroll/rates/save', { auth, staffId: t.id, startsOn: '2026-09', lessonHourly: 2000, meetingHourly: 1500 });
  const v = (await h.ok('payroll/staff', { auth, staffId: t.id, month: '2026-09' })).preview;
  const prep = Object.fromEntries(v.items.filter(i => i.kind === 'prep').map(i => [i.date, i.minutes]));
  assert.deepEqual(prep, { '2026-09-07': 20, '2026-09-08': 10, '2026-09-09': 15, '2026-09-10': 20, '2026-09-11': 10, '2026-09-12': 10 });
  assert.ok(v.items.filter(i => i.kind === 'prep').every(i => i.rate === 2000), '業務給は授業の時給');
  const meet = v.items.filter(i => i.kind === 'meeting');
  assert.equal(meet.find(i => i.date === '2026-09-11').minutes, 30, '授業の間の面談は面談として払う');
  const inLesson = meet.find(i => i.date === '2026-09-12');
  assert.equal(inLesson.minutes, 0, '授業と重なる面談の時間は二重に払わない');
  assert.match(inLesson.label, /授業と重なる30分を除く/);
  // 日ごとに、払う分の合計が「授業・面談・準備の時間の和集合」を超えない（同じ1分を二重に数えない）
  const byDay = {}; for (const i of v.items) if (i.date) byDay[i.date] = (byDay[i.date] || 0) + i.minutes;
  assert.deepEqual(byDay, { '2026-09-07': 180 + 20, '2026-09-08': 180 + 10, '2026-09-09': 180 + 15, '2026-09-10': 180 + 20, '2026-09-11': 120 + 30 + 10, '2026-09-12': 90 + 10 });
  assert.equal(v.prepMinutes, 85);
  assert.equal(v.prepAmount, [20, 10, 15, 20, 10, 10].reduce((n, m) => n + Math.floor(m * 2000 / 60), 0), '1円未満は日ごとの行で切り捨て');
  const p = (await h.ok('payroll/confirm', { auth, staffId: t.id, month: '2026-09', expectedNet: v.net })).payroll;
  assert.deepEqual([p.prepMinutes, p.prepAmount], [85, v.prepAmount], '確定した明細に準備・記録の時間と金額を残す');
});
