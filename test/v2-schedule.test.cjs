'use strict';
// 作り直し（v2）3段目: 予定。仮予定・予定表・直接決定・変更とお休みの連絡・自動決定・講師の範囲・カレンダー・今の台帳からの写し。
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
  const lesson = { auth, studentId: kid.id, start: '17:00', minutes: 60, subject: '数学', deliveryMode: 'online', staffId: me.id };
  const k = new URL(kid.link).searchParams.get('k');
  return { h, auth, fam, kid, parent, me, lesson, k };
}
const lessonsOf = h => h.rows('select * from lessons order by date, start');
const at = (h, iso) => { h.clock = Date.parse(iso); };

test('a manager asks for approval without a deadline; held ones stay hidden until the schedule is sent once', async () => {
  const { h, auth, parent, lesson } = await world();
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-09' });
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-11-03', repeat: 2 });
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-03', start: '10:00' });
  assert.deepEqual(lessonsOf(h).map(l => [l.date, l.status, l.confirmBy]), [['2026-10-03', 'proposed', ''], ['2026-10-09', 'proposed', ''], ['2026-11-03', 'proposed', ''], ['2026-11-10', 'proposed', '']]);
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-12-01', hold: true });
  assert.equal((await h.ok('family/schedule', { auth: parent, to: '2026-12-31' })).lessons.length, 4, '未送信は保護者に見せない');
  assert.equal((await h.ok('schedule/lessons/sendHeld', { auth, studentId: lesson.studentId, lessonIds: [lessonsOf(h).at(-1).id] })).sent, 1);
  assert.equal(lessonsOf(h).at(-1).status, 'proposed');
  assert.ok(h.mails().filter(m => m.audience === 'family').every(m => m.status === 'dismissed' && m.error === 'まだ切り替え前のため送らない'), '切り替え前は保護者へ送らない');
  assert.equal((await h.call('schedule/lessons/create', { ...lesson, date: '2026-10-09', start: '17:30' })).error.code, 'overlap');
  await h.ok('schedule/unavailability/add', { auth, date: '2026-10-16' });
  assert.equal((await h.call('schedule/lessons/create', { ...lesson, date: '2026-10-16' })).error.code, 'needForce');
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-16', force: true });
});

test('確認をお願いする（古い名前 sendHeld）: 選んだ下書きだけを確認待ちにし、ほかは下書きのまま。送れないものが入っていれば何も送らない。体験生は確定にする', async () => {
  const { h, auth, kid, parent, lesson } = await world();
  for (const d of ['2026-11-04', '2026-11-11', '2026-12-02']) await h.ok('schedule/lessons/create', { ...lesson, date: d, hold: true });
  const held = () => h.rows("select id, date, status from lessons where studentId = ? order by date", kid.id);
  const [a, b2, c2] = held();
  // 表示中の月に限らず、未送信は全部「対応すること」に出る
  const range = await h.ok('schedule/staff/range', { auth, from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(range.heldAll.map(l => l.id), [a.id, b2.id, c2.id]);
  // 選ばないと送らない
  assert.equal((await h.call('schedule/lessons/sendHeld', { auth, studentId: kid.id })).error.code, 'needIds');
  // ほかの生徒の授業が入っていれば何も送らない
  const fam2 = (await h.ok('admin/families/create', { auth, name: '別家', email: 'other@example.invalid' })).family;
  const other = (await h.ok('admin/students/create', { auth, familyId: fam2.id, familyName: '別', givenName: '花', baseRate30: 1500, deliveryMode: 'online' })).student;
  await h.ok('schedule/lessons/create', { ...lesson, studentId: other.id, date: '2026-11-05', hold: true });
  const otherId = h.rows('select id from lessons where studentId = ?', other.id)[0].id;
  const mails0 = h.mails().length;
  const bad = await h.call('schedule/lessons/sendHeld', { auth, studentId: kid.id, lessonIds: [a.id, otherId] });
  assert.equal(bad.error.code, 'badTargets');
  assert.deepEqual(held().map(l => l.status), ['held', 'held', 'held']);
  assert.equal(h.mails().length, mails0, '何も送らない');
  // 2 件だけ選ぶ
  const r = await h.ok('schedule/lessons/sendHeld', { auth, studentId: kid.id, lessonIds: [a.id, b2.id] });
  assert.deepEqual([r.sent, r.left], [2, 1]);
  assert.deepEqual(held().map(l => l.status), ['proposed', 'proposed', 'held']);
  const fm = h.mails().slice(mails0).filter(m => m.audience === 'family');
  assert.equal(fm.length, 1, '保護者に 1 回');
  assert.match(fm[0].subject, /授業の日程の承認のお願い/);
  assert.match(fm[0].body, /11\/4\(水\) 17:00〜18:00 数学[^\n]*\n・11\/11/, '選んだ授業を並べる');
  assert.doesNotMatch(fm[0].body, /12\/2/, '選ばなかった授業は書かない');
  assert.match(fm[0].body, /#confirm\?student=[^\s]+/, '保護者ページの「日程の確認」を開く');
  assert.match(r.lineText, /^【ステップワイズ】[\s\S]*family\/#confirm$/, 'LINE に貼る文');
  // 送ったあとの授業をもう一度選ぶと断る
  assert.equal((await h.call('schedule/lessons/sendHeld', { auth, studentId: kid.id, lessonIds: [a.id] })).error.code, 'badTargets');
  const fl = await h.ok('family/schedule', { auth: parent, to: '2026-12-31' });
  assert.deepEqual(fl.lessons.map(l => l.date), ['2026-11-04', '2026-11-11'], '保護者には送った授業だけ');
  // 体験生: 未送信（MCP で保存した形）を選ぶと決定にしてカレンダーへ（メールなし）
  const t = await h.ok('admin/trials/create', { auth, familyName: '体験', givenName: '彩', grade: '中2' });
  await h.env.DB2.prepare("insert into lessons (id, studentId, staffId, date, start, minutes, subject, kind, deliveryMode, status, confirmBy, note, createdAt, updatedAt) values ('ls_trial_held', ?, '', '2026-10-20', '18:00', 90, '英語', '体験', 'in_person', 'held', '', 'MCP で保存（x）', '2026-10-08T03:00:00Z', '2026-10-08T03:00:00Z')").bind(t.studentId).run();
  const mails1 = h.mails().length;
  const tr = await h.ok('schedule/lessons/sendHeld', { auth, studentId: t.studentId, lessonIds: ['ls_trial_held'] });
  assert.deepEqual([tr.sent, tr.trial, tr.left], [1, true, 0]);
  const tl = h.rows("select status, kind, confirmBy, calendarEventId from lessons where id = 'ls_trial_held'")[0];
  assert.deepEqual([tl.status, tl.kind, tl.confirmBy], ['decided', '体験', '']);
  assert.ok(tl.calendarEventId, 'カレンダーの予定を作る');
  assert.equal(h.mails().length, mails1, '体験はメールなし');
});

test('direct decision creates the calendar event (held before the switch-over) and records who decided', async () => {
  const { h, auth, lesson } = await world();
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-03', start: '10:00' });
  const l = lessonsOf(h)[0];
  const r = await h.ok('schedule/lessons/decide', { auth, id: l.id, version: l.version });
  assert.equal(r.lesson.status, 'decided');
  const cal = h.rows("select payload, status from effects where kind = 'calendarCreate'");
  assert.equal(cal.length, 1); assert.equal(cal[0].status, 'dismissed', '切り替え前はカレンダーに作らない');
  assert.equal(JSON.parse(cal[0].payload).wantMeet, true);
  assert.match(lessonsOf(h)[0].decidedBy, /^staff:/);
  assert.equal((await h.call('schedule/lessons/decide', { auth, id: l.id, version: l.version })).error.code, 'conflict');
});

test('parents: お休み before 23:00 the day before is free and immediate; after that only 開始を遅らせたい or キャンセル', async () => {
  const { h, auth, parent, lesson } = await world();
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-09' }); await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-10' });
  for (const l of lessonsOf(h)) await h.ok('schedule/lessons/decide', { auth, id: l.id, version: l.version });
  const [a, b] = (await h.ok('family/schedule', { auth: parent })).lessons;
  assert.deepEqual(a.choices, ['move', 'rest']);
  assert.equal((await h.call('family/lessons/request', { auth: parent, lessonId: a.id, kind: 'rest' })).error.code, 'needNote');
  assert.equal((await h.ok('family/lessons/request', { auth: parent, lessonId: a.id, kind: 'rest', note: '家族の用事' })).lesson.status, 'rested');
  assert.ok(h.mails().some(m => m.audience === 'staff' && m.subject.includes('【お休みの連絡】')), '教室管理者に知らせる');
  const move = await h.ok('family/lessons/request', { auth: parent, lessonId: b.id, kind: 'move', note: '11日だと助かります' });
  assert.equal(move.request.status, 'open');
  const open = (await h.ok('schedule/staff/range', { auth })).openRequests;
  assert.deepEqual(open.map(r => r.kind), ['move']);
  const lb = lessonsOf(h).find(l => l.id === b.id);
  await h.ok('schedule/lessons/update', { auth, id: b.id, version: lb.version, date: '2026-10-11' });
  assert.equal((await h.ok('schedule/staff/range', { auth })).openRequests.length, 0, '日時を直したらお願いは済み');
  at(h, '2026-10-10T23:30:00+09:00');
  const after = (await h.ok('family/schedule', { auth: parent })).lessons.find(l => l.id === b.id);
  assert.deepEqual(after.choices, ['late', 'cancel']);
  assert.equal((await h.call('family/lessons/request', { auth: parent, lessonId: b.id, kind: 'rest', note: 'x' })).error.code, 'notNow');
  const cancel = await h.ok('family/lessons/request', { auth: parent, lessonId: b.id, kind: 'cancel', note: '発熱' });
  assert.equal(cancel.lesson.status, 'cancelled');
  assert.ok(h.mails().some(m => m.subject.includes('【キャンセル】') && m.body.includes('キャンセル料の対象')));
  const back = await h.ok('family/lessons/withdraw', { auth: parent, requestId: cancel.request.id });
  assert.equal(back.lesson.status, 'decided', '開始前なら取り下げて元に戻せる');
});

test('autoConfirm (no longer run at night since 2026-10-27) decides 仮予定 asked with a deadline once, but not ones with an open date-change request', async () => {
  const { h, auth, parent, lesson } = await world();
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-09' }); await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-08' });
  const second = lessonsOf(h).find(l => l.date === '2026-10-09');
  await h.ok('family/lessons/request', { auth: parent, lessonId: second.id, kind: 'move', note: '別の日に' });
  h.db2._sqlite.prepare("update lessons set noticeState = 'external', noticeAt = askedAt, confirmBy = '2026-10-05' where askedAt <> ''").run(); // synthetic delivered notice with an old deadline
  const { autoConfirm } = await import('../cf/v2/schedule.mjs'), { recordEffects } = await import('../cf/v2/effects.mjs');
  const runV2Scheduled = async (env, now) => { const c = { db: env.DB2, env, now, effects: [], actor: { kind: 'system', id: 'test' } }; const r = await autoConfirm(c); await recordEffects(env.DB2, c.effects, now); return r; };
  const { runV2Scheduled: nightly } = await import('../cf/v2/index.mjs');
  assert.equal((await nightly(h.env, Date.parse('2026-10-06T00:10:00+09:00'))).confirmed, 0, '夜の定期実行では確定しない');
  assert.equal((await runV2Scheduled(h.env, Date.parse('2026-10-05T00:10:00+09:00'))).confirmed, 0, '締め切りの日のうちは決めない');
  const r = await runV2Scheduled(h.env, Date.parse('2026-10-06T00:10:00+09:00'));
  assert.deepEqual([r.confirmed, r.students], [1, 1]);
  assert.deepEqual(lessonsOf(h).map(l => [l.date, l.status, l.decidedBy]), [['2026-10-08', 'decided', 'system:auto'], ['2026-10-09', 'proposed', '']]);
  assert.equal((await runV2Scheduled(h.env, Date.parse('2026-10-07T00:10:00+09:00'))).confirmed, 0);
  const done = h.mails().filter(m => m.subject.includes('授業の日時が確定しました'));
  assert.equal(done.length, 1);
  assert.match(done[0].body, /10\/8\(木\) 17:00〜18:00 数学/, '何が確定したかを書く');
  assert.equal(lessonsOf(h).find(l => l.date === '2026-10-08').agreement, '締め切り（2026-10-05）までに連絡なし');
});

test('teachers see only their own lessons; students use their link; parents can switch off the student’s own changes', async () => {
  const { h, auth, lesson, k, kid } = await world();
  const teacherAuth = await h.staffWith(auth, ['teacher'], 'teacher@example.invalid');
  const teacher = (await h.ok('staff/me', { auth: teacherAuth })).me;
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-02', start: '09:00', staffId: teacher.id });
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-02', start: '11:00' });
  for (const l of lessonsOf(h)) await h.ok('schedule/lessons/decide', { auth, id: l.id, version: l.version });
  const seen = await h.ok('schedule/staff/range', { auth: teacherAuth });
  assert.deepEqual(seen.lessons.map(l => l.start), ['09:00']); assert.equal(seen.openRequests.length, 0);
  assert.equal((await h.call('schedule/lessons/create', { ...lesson, auth: teacherAuth, date: '2026-10-20' })).error.code, 'forbidden');
  const mine = lessonsOf(h).find(l => l.start === '09:00'), other = lessonsOf(h).find(l => l.start === '11:00');
  assert.equal((await h.ok('schedule/lessons/done', { auth: teacherAuth, id: mine.id, version: mine.version })).lesson.status, 'done');
  assert.equal((await h.call('schedule/lessons/done', { auth: teacherAuth, id: other.id, version: other.version })).error.code, 'forbidden');
  const st = await h.ok('student/schedule', { k });
  assert.equal(st.me.name, '架空 一郎'); assert.equal(st.lessons[0].staffId, undefined, '生徒には講師の ID を出さない');
  h.db2._sqlite.prepare('update students set permissions = ? where id = ?').run(JSON.stringify({ reschedule: false }), kid.id);
  assert.equal((await h.call('student/lessons/request', { k, lessonId: other.id, kind: 'move', note: 'x' })).error.code, 'forbidden');
  assert.equal((await h.ok('student/events/add', { k, kind: 'test', date: '2026-10-20', title: '中間テスト' })).event.kind, 'test');
});

test('after the switch-over, the calendar event id and Meet link are written back to the lesson', async () => {
  const { h, auth, lesson } = await world();
  h.db2._sqlite.prepare("insert into settings (key, value, updatedAt) values ('live', '1', '')").run();
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-03', start: '10:00' });
  const l = lessonsOf(h)[0];
  await h.ok('schedule/lessons/decide', { auth, id: l.id, version: l.version });
  const marker = lessonsOf(h)[0].calendarEventId;
  assert.match(marker, /^v2m[a-v0-9]{40}$/, 'Google の予定 ID に使える文字だけ（英小文字 a-v と数字）');
  const { deliverEffects } = await import('../cf/v2/effects.mjs');
  const queued = h.rows("select id, payload from effects where kind = 'calendarCreate' and status = 'pending'").map(r => ({ id: r.id, item: JSON.parse(r.payload) }));
  assert.equal(queued.length, 1, '切り替え後は送る');
  await deliverEffects({ GAS_URL: 'https://gas.example.invalid', SYNC_KEY: 'x'.repeat(30) }, h.env.DB2, queued, async () => ({ ok: true, json: async () => ({ ok: true, writebacks: [{ marker, eventId: 'real-event@google.com', meetUrl: 'https://meet.example.invalid/abc' }] }) }));
  assert.deepEqual([lessonsOf(h)[0].calendarEventId, lessonsOf(h)[0].meetUrl], ['real-event@google.com', 'https://meet.example.invalid/abc']);
});

test('the schedule copy from the current ledger maps statuses, requests, shared events and days off', async () => {
  const h = await createV2(); const auth = await h.owner();
  const q = (sql, ...a) => h.db._sqlite.prepare(sql).run(...a);
  q("insert into students (id, name, active, code, rate30, deliveryMode) values ('s1', '架空 一郎', 1, 'code-one-xxxxxxxx', 1500, 'online')");
  q("insert into familyAccounts (id, label, status, email) values ('A', '架空 一郎さんのグループ', 'pending', 'p@example.invalid')");
  q("insert into familyLinks (id, familyId, studentId, active) values ('l1', 'A', 's1', 1)");
  q("insert into slots (id, date, start, min, status, studentId, done, subject, deliveryMode, kind, req) values ('a', '2026-09-20', '17:00', 60, 'booked', 's1', 'true', '数学', 'online', '', ''), ('b', '2026-10-09', '17:00', 60, 'booked', 's1', '', '数学', 'online', '', ?)", JSON.stringify({ kind: 'cancel', reason: '旅行', receivedAt: '2026-10-01T00:00:00Z', requestType: 'normal' }));
  q("insert into slots (id, date, start, min, status, studentId, subject, deliveryMode, confirmBy, changeReqAt, changeReqBy, changeReqKind, changeReqNote) values ('c', '2026-10-20', '18:00', 90, 'offered', 's1', '英語', 'in_person', '2026-10-05', '2026-10-02T01:00:00Z', 'parent', 'move', '21日に'), ('d', '2026-11-01', '18:00', 90, 'offered', 's1', '英語', '', 'hold', '', '', '', '')");
  q("insert into events (id, studentId, date, dateTo, title, kind) values ('e1', 's1', '2026-10-15', '2026-10-16', '中間テスト', 'test')");
  q("insert into blocked (id, studentId, date, note, start, end) values ('b1', 's1', '2026-10-12', '部活', '', '')");
  q("insert into teacherOff (id, date, note, start, end) values ('t1', '2026-10-13', '出張', '10:00', '12:00')");
  q("insert into lessonKinds (name, standardMin, standardFee, active, sortOrder) values ('講習', 120, 6000, 1, 2)");
  assert.equal((await h.call('admin/migrate/schedule/apply', { auth, confirm: true })).error.code, 'noStudents');
  await h.ok('admin/migrate/identity/apply', { auth, confirm: true });
  const pre = await h.ok('admin/migrate/schedule/preview', { auth });
  assert.deepEqual(pre.lessons, { total: 4, held: 1, proposed: 1, decided: 1, done: 1 });
  const done = await h.ok('admin/migrate/schedule/apply', { auth, confirm: true });
  assert.deepEqual([done.lessons, done.requests, done.sharedEvents, done.unavailability], [4, 2, 2, 1]);
  const rows = h.rows('select legacyId, status, confirmBy, deliveryMode, staffId from lessons order by date');
  assert.deepEqual(rows.map(r => [r.legacyId, r.status, r.confirmBy, r.deliveryMode]), [['a', 'done', '', 'online'], ['b', 'decided', '', 'online'], ['c', 'proposed', '2026-10-05', 'in_person'], ['d', 'held', '', 'online']]);
  assert.ok(rows.every(r => r.staffId), '担当は代表');
  assert.deepEqual(h.rows('select kind, fromKind from lessonRequests order by id').map(r => [r.kind, r.fromKind]), [['rest', 'student'], ['move', 'family']]);
  assert.deepEqual(h.rows('select kind from sharedEvents order by date').map(r => r.kind), ['unavailable', 'test']);
  assert.ok(h.rows('select name from lessonKinds').some(k => k.name === '講習'));
  await h.ok('admin/migrate/schedule/apply', { auth, confirm: true });
  assert.equal(h.rows('select count(*) n from lessons')[0].n, 4, '写し直しても増えない');
});

test('the same teacher may teach two lessons at once (after a check), never three. Online lessons follow the same rule (共通規約 r15 第4条)', async () => {
  const { h, auth, fam, me, lesson } = await world();
  const kid2 = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '二郎', baseRate30: 1500 })).student;
  const kid3 = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '三郎', baseRate30: 1500 })).student;
  const face = { ...lesson, deliveryMode: 'in_person', date: '2026-10-09' };
  await h.ok('schedule/lessons/create', face);
  const second = await h.call('schedule/lessons/create', { ...face, studentId: kid2.id, start: '17:30' });
  assert.equal(second.error.code, 'needForce', '2人同時は確かめてから');
  assert.match(second.error.message, /2人同時/);
  await h.ok('schedule/lessons/create', { ...face, studentId: kid2.id, start: '17:30', force: true });
  assert.match((await h.call('schedule/lessons/create', { ...face, studentId: kid3.id, start: '17:45', force: true })).error.message, /2人まで/, '3人は重ねられない');
  await h.ok('schedule/lessons/create', { ...face, studentId: kid3.id, start: '18:00', force: true }); // 17:00〜18:00 とは重ならず、17:30〜18:30 とだけ重なる＝同時は2人
  // オンラインも2人まで（2026-10-27 本人「オンラインも例外なく1:2まで行える」）。対面と同じく確かめてから、3人は重ねられない
  await h.ok('schedule/lessons/create', { ...face, date: '2026-10-16', deliveryMode: 'online' });
  const online = await h.call('schedule/lessons/create', { ...face, studentId: kid2.id, date: '2026-10-16', start: '17:30', deliveryMode: 'online' });
  assert.deepEqual([online.error.code, /2人同時/.test(online.error.message)], ['needForce', true]);
  await h.ok('schedule/lessons/create', { ...face, studentId: kid2.id, date: '2026-10-16', start: '17:30', deliveryMode: 'online', force: true });
  assert.match((await h.call('schedule/lessons/create', { ...face, studentId: kid3.id, date: '2026-10-16', start: '17:45', force: true })).error.message, /2人まで/);
  const l = h.rows("select * from lessons where studentId = ? and date = '2026-10-16'", kid2.id)[0];
  await h.ok('schedule/lessons/update', { auth, id: l.id, version: l.version, date: l.date, start: l.start, minutes: l.minutes, subject: l.subject, deliveryMode: 'in_person', staffId: me.id, force: true });
});

test('cancelling a decided lesson tells the family (held before the switch-over)', async () => {
  const { h, auth, lesson } = await world();
  await h.ok('schedule/lessons/create', { ...lesson, date: '2026-10-09' });
  let l = h.rows('select * from lessons')[0];
  await h.ok('schedule/lessons/decide', { auth, id: l.id, version: l.version });
  l = h.rows('select * from lessons')[0];
  const before = h.mails().length;
  await h.ok('schedule/lessons/cancel', { auth, id: l.id, version: l.version });
  const m = h.mails().slice(before).filter(x => x.audience === 'family');
  assert.equal(m.length, 1, '保護者へ1通');
  assert.match(m[0].subject, /授業をキャンセルしました/);
  assert.match(m[0].body, /架空 一郎さんの10\/9\(金\) 17:00〜 数学の授業をキャンセルしました/);
  assert.equal(m[0].status, 'dismissed', '切り替え前は送らない');
});

test('lessons that already took place can be registered as done by a manager (no notice, no deadline, up to 8 hours)', async () => {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500 })).student;
  const mails = h.mails().length;
  const r = await h.ok('schedule/lessons/create', { auth, studentId: kid.id, date: '2026-09-26', start: '13:00', minutes: 390, subject: '英語', kind: '演習', deliveryMode: 'in_person', done: true });
  assert.deepEqual([r.created, r.done], [1, true]);
  const l = h.rows('select status, confirmBy, minutes from lessons where studentId = ?', kid.id)[0];
  assert.deepEqual([l.status, l.confirmBy, l.minutes], ['done', '', 390]);
  assert.equal(h.mails().length, mails, 'お知らせは送らない');
  assert.equal((await h.call('schedule/lessons/create', { auth, studentId: kid.id, date: '2026-09-27', start: '13:00', minutes: 90, subject: '英語', deliveryMode: 'in_person' })).error.code, 'past', '仮予定は過去に作れないまま');
  assert.equal((await h.call('schedule/lessons/create', { auth, studentId: kid.id, date: '2027-01-01', start: '13:00', minutes: 90, subject: '英語', deliveryMode: 'in_person', done: true })).error.code, 'future');
  const teacher = await h.staffWith(auth, ['teacher'], 'teacher@example.invalid');
  assert.equal((await h.call('schedule/lessons/create', { auth: teacher, studentId: kid.id, date: '2026-09-25', start: '13:00', minutes: 90, subject: '英語', deliveryMode: 'in_person', done: true })).error.code, 'forbidden');
});

test('meetings can be with someone who is not registered yet (name only), and they show on the staff schedule', async () => {
  const h = await createV2(); const auth = await h.owner();
  const r = await h.ok('schedule/meetings/create', { auth, withName: '高橋さん（体験前）', date: '2026-10-11', start: '16:00', minutes: 60, title: '体験前の面談' });
  assert.ok(r.id);
  const day = await h.ok('schedule/staff/range', { auth, from: '2026-10-11', to: '2026-10-11' });
  assert.deepEqual(day.meetings.map(m => [m.withName, m.familyId, m.title]), [['高橋さん（体験前）', '', '体験前の面談']]);
  assert.equal((await h.call('schedule/meetings/create', { auth, date: '2026-10-11', start: '17:00', minutes: 30 })).error.code, 'needWho');
  assert.equal((await h.call('schedule/meetings/create', { auth, familyId: 'fa_nothing', date: '2026-10-11', start: '17:00', minutes: 30 })).error.code, 'notFound');
});

// D1 は1回の問い合わせに渡せる値が100個まで（2026-10-27 授業が100件を超えて本番の予定が開かなくなった）
test('the staff and family schedules open with more than 100 lessons in the range', async () => {
  const { h, auth, parent, lesson } = await world();
  const ids = [];
  for (let d = 1; d <= 28; d++) for (const start of ['09:00', '11:00', '13:00', '15:00']) {
    const date = '2026-11-' + String(d).padStart(2, '0');
    h.db2._sqlite.prepare("insert into lessons (id, studentId, staffId, date, start, minutes, subject, kind, deliveryMode, status, createdAt, updatedAt) values (?, ?, ?, ?, ?, 60, '数学', '通常', 'online', 'decided', ?, ?)")
      .run('ls_many_' + date + start, lesson.studentId, lesson.staffId, date, start, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
  }
  const staff = await h.ok('schedule/staff/range', { auth, from: '2026-11-01', to: '2026-11-30' });
  assert.equal(staff.lessons.length >= 112, true);
  const fam = await h.ok('family/schedule', { auth: parent, from: '2026-11-01', to: '2026-11-30' });
  assert.equal(fam.lessons.length >= 112, true);
});

// 200件まで選べる授業の確認のお願いも、D1 の上限（100個）を超えない
test('asking about more than 100 held lessons at once works within the D1 parameter limit', async () => {
  const { h, auth, lesson } = await world();
  const ids = [];
  for (let d = 1; d <= 28; d++) for (const start of ['09:00', '11:00', '13:00', '15:00']) {
    const id = 'ls_held_' + d + start.replace(':', '');
    h.db2._sqlite.prepare("insert into lessons (id, studentId, staffId, date, start, minutes, subject, kind, deliveryMode, status, createdAt, updatedAt) values (?, ?, ?, ?, ?, 60, '数学', '通常', 'online', 'held', ?, ?)")
      .run(id, lesson.studentId, lesson.staffId, '2026-12-' + String(d).padStart(2, '0'), start, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
    ids.push(id);
  }
  const r = await h.ok('schedule/lessons/show', { auth, studentId: lesson.studentId, lessonIds: ids });
  assert.equal(r.shown, 112);
});
