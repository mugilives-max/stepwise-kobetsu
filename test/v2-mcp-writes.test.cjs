'use strict';
// 作り直し（v2）: MCP からの書き込み（cf/v2/mcp-writes.mjs、0021_mcp_writes.sql）。予定の保存と、選んだ授業だけのお知らせを分ける。
// Kura の reference/stepwise-mcp-write-claude-handoff.md の「必須テストと受入条件」に沿う。生徒・宛先はすべて架空（example.invalid）。
// 時計は 2026-10-02 12:00（日本時間）から始まる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

const RKEY = 'r'.repeat(40), WKEY = 'w'.repeat(40);
async function world({ scope = '' } = {}) {
  const h = await createV2(); const auth = await h.owner();
  h.db2._sqlite.prepare("insert into settings (key, value, updatedAt) values ('live', '1', '')").run(); // 切り替えたあと（メールは本当に送る扱い）
  h.env.V2_SERVICE_KEY = RKEY; h.env.V2_SERVICE_WRITE_KEY = WKEY; if (scope) h.env.V2_SERVICE_WRITE_SCOPE = scope;
  const family = async (name, email) => {
    const fam = (await h.ok('admin/families/create', { auth, name, email })).family;
    await h.ok('admin/families/invite', { auth, id: fam.id });
    const parent = (await h.ok('family/invite/accept', { token: h.linkFrom(h.mails().at(-1)), password: 'family password 1' })).auth;
    return { fam, parent };
  };
  const A = await family('【テスト】青木さん', 'aoki@example.invalid');
  const B = await family('【テスト】坂井さん', 'sakai@example.invalid');
  const a = (await h.ok('admin/students/create', { auth, familyId: A.fam.id, familyName: '【テスト】青木', givenName: '一郎', grade: '中3', baseRate30: 1500 })).student;
  const bb = (await h.ok('admin/students/create', { auth, familyId: B.fam.id, familyName: '【テスト】坂井', givenName: '花', grade: '中3', baseRate30: 1500 })).student;
  const trial = await h.ok('admin/trials/create', { auth, familyName: '【テスト】高田', givenName: '体験', grade: '中3' });
  const w = (route, body = {}) => h.call(route, { ...body, serviceWriteKey: WKEY });
  const wok = async (route, body = {}) => { const r = await w(route, body); assert.equal(r.ok, true, route + ' ' + JSON.stringify(r)); return r; };
  const familyMails = to => h.mails().filter(m => m.to === to && /日程の確認|日時を変更/.test(m.subject));
  const count = sql => h.rows(sql)[0].n;
  return { h, auth, A, B, a, b: bb, trialId: trial.studentId, w, wok, familyMails, count };
}
const item = (key, studentId, date, start, extra = {}) => ({ key, studentId, date, start, minutes: 90, subject: '英語', deliveryMode: 'in_person', ...extra });

test('keys: the read key cannot write, the write key opens only mcp routes, and the same value for both is refused', async () => {
  const { h, auth, a } = await world();
  assert.equal((await h.call('mcp/lessons/save', { serviceKey: RKEY, requestId: 'req-read-0001', items: [item('k1', a.id, '2026-10-20', '17:00')] })).error.code, 'service');
  assert.equal((await h.call('mcp/lessons/save', { serviceWriteKey: 'x'.repeat(40), requestId: 'req-bad-00001', items: [item('k1', a.id, '2026-10-20', '17:00')] })).error.code, 'badKey');
  assert.equal((await h.call('schedule/lessons/create', { serviceWriteKey: WKEY, studentId: a.id, date: '2026-10-20', start: '17:00', minutes: 90, subject: '英語', deliveryMode: 'in_person' })).error.code, 'service', '一般の管理 API は通さない');
  h.env.V2_SERVICE_WRITE_KEY = RKEY;
  assert.equal((await h.call('mcp/lessons/get', { serviceWriteKey: RKEY, lessonIds: ['x'] })).error.code, 'badKey', '読み取りの鍵と同じ値は書き込みに使えない');
  delete h.env.V2_SERVICE_WRITE_KEY;
  assert.equal((await h.call('mcp/lessons/get', { serviceWriteKey: WKEY, lessonIds: ['x'] })).error.code, 'badKey', '鍵が設定されていなければ誰も書けない');
  void auth;
});

test('scope: by default only test students can be written to', async () => {
  const { h, auth, w } = await world();
  const fam = (await h.ok('admin/families/create', { auth, name: '本物風さん', email: 'real@example.invalid' })).family;
  const real = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '本物風', givenName: '太郎', baseRate30: 1500 })).student;
  const r = await w('mcp/lessons/save', { requestId: 'req-scope-001', items: [item('k1', real.id, '2026-10-20', '17:00')] });
  assert.equal(r.items[0].status, 'invalid');
  assert.match(r.items[0].error, /テスト用/);
  assert.equal((await w('mcp/trials/create', { requestId: 'req-scope-002', familyName: '山田' })).error.code, 'outOfScope');
});

test('save: many lessons are stored unsent with zero mail and zero calendar; ids, DB and every reader agree; dryRun writes nothing', async () => {
  const { h, A, a, trialId, wok, count } = await world();
  const before = { lessons: count('select count(*) n from lessons'), effects: count('select count(*) n from effects'), reqs: count('select count(*) n from mcpRequests') };
  const items = [item('a1', a.id, '2026-10-20', '17:00'), item('a2', a.id, '2026-10-22', '17:00', { subject: '数学' }), item('t1', trialId, '2026-10-21', '18:00')];
  const dry = await wok('mcp/lessons/save', { dryRun: true, items });
  assert.deepEqual(dry.items.map(i => i.status), ['wouldCreate', 'wouldCreate', 'wouldCreate']);
  assert.equal(dry.items[2].kind, '体験', '体験生の授業は体験');
  assert.deepEqual({ lessons: count('select count(*) n from lessons'), effects: count('select count(*) n from effects'), reqs: count('select count(*) n from mcpRequests') }, before, 'dryRun は何も書かない');

  const r = await wok('mcp/lessons/save', { requestId: 'req-save-0001', items });
  assert.deepEqual(r.items.map(i => i.status), ['created', 'created', 'created']);
  assert.equal(r.mails, 0);
  assert.equal(count('select count(*) n from effects'), before.effects, 'メールもカレンダーも 0');
  const ids = r.items.map(i => i.lessonId);
  assert.deepEqual(r.lessons.map(l => l.id).sort(), ids.slice().sort());
  assert.ok(r.lessons.every(l => l.status === 'held' && l.unsent && l.notices.length === 0));
  assert.equal(count("select count(*) n from lessons where status = 'held'"), 3);
  // 管理画面・MCP の読み取り（サービスの読み取り鍵）・保護者ページで同じ授業 ID と日時・状態
  const staff = await h.ok('schedule/staff/range', { serviceKey: RKEY, from: '2026-10-20', to: '2026-10-22' });
  for (const l of r.lessons) { const s = staff.lessons.find(x => x.id === l.id); assert.ok(s, '管理画面に出る'); assert.deepEqual([s.date, s.start, s.status], [l.date, l.start, 'held']); }
  const fam = await h.ok('family/schedule', { auth: A.parent, from: '2026-10-20', to: '2026-10-22' });
  assert.equal(fam.lessons.length, 0, '未送信は保護者ページに出ない');
  const back = await wok('mcp/lessons/get', { lessonIds: ids });
  assert.deepEqual(back.lessons.map(l => [l.id, l.status]).sort(), r.lessons.map(l => [l.id, l.status]).sort());
});

test('idempotency: the same requestId does not add lessons (again, in parallel, after a lost reply); a different input with the same id fails; a partial failure keeps what was made', async () => {
  const { a, b, w, wok, count } = await world();
  const items = [item('a1', a.id, '2026-10-20', '17:00'), item('a2', a.id, '2026-10-22', '17:00')];
  const [x, y] = await Promise.all([w('mcp/lessons/save', { requestId: 'req-idem-0001', items }), w('mcp/lessons/save', { requestId: 'req-idem-0001', items })]);
  assert.ok(x.ok && y.ok);
  assert.equal(count('select count(*) n from lessons'), 2, '並行でも 2 件のまま');
  const again = await wok('mcp/lessons/save', { requestId: 'req-idem-0001', items }); // 応答が消えたあとの再実行
  assert.equal(again.repeated, true);
  assert.equal(count('select count(*) n from lessons'), 2);
  assert.equal((await w('mcp/lessons/save', { requestId: 'req-idem-0001', items: [items[0]] })).error.code, 'requestMismatch');
  // 一部が重なる: 作れた分の ID と、失敗の理由。作れた分は作り直さない
  const mixed = [item('b1', b.id, '2026-10-23', '17:00'), item('a3', a.id, '2026-10-20', '17:30')];
  const p = await wok('mcp/lessons/save', { requestId: 'req-idem-0002', items: mixed });
  assert.deepEqual(p.items.map(i => i.status), ['created', 'conflict']);
  assert.ok(p.items[0].lessonId && !p.items[1].lessonId);
  const st = await wok('mcp/requests/get', { requestId: 'req-idem-0002' });
  assert.deepEqual(st.savedItems.map(i => i.key), ['b1']);
  assert.equal(st.requestStatus, 'running', '一部が通らなかった依頼は済みにしない');
  const re = await wok('mcp/lessons/save', { requestId: 'req-idem-0002', items: mixed });
  assert.deepEqual(re.items.map(i => i.status), ['exists', 'conflict']);
  assert.equal(count('select count(*) n from lessons'), 3);
  // 同じ依頼の中の重なりも止める
  const dup = await wok('mcp/lessons/save', { dryRun: true, items: [item('x1', b.id, '2026-10-27', '17:00'), item('x2', b.id, '2026-10-27', '18:00')] });
  assert.deepEqual(dup.items.map(i => i.status), ['wouldCreate', 'conflict']);
  assert.equal((await w('mcp/lessons/save', { requestId: 'req-idem-0003', items: [item('k', a.id, '2026-10-24', '17:00'), item('k', a.id, '2026-10-25', '17:00')] })).error.code, 'duplicateKey');
});

test('wrong student: save unsent → fix to the right student → preview shows the right family → send reaches only them; the wrong family gets nothing', async () => {
  const { h, a, b, wok, w, familyMails } = await world();
  const saved = await wok('mcp/lessons/save', { requestId: 'req-wrong-001', items: [item('k1', a.id, '2026-10-20', '17:00')] }); // 誤って青木さんを選んだ
  const l = saved.lessons[0];
  assert.equal(familyMails('aoki@example.invalid').length, 0, '保存の段階では誰にも届かない');
  const dry = await wok('mcp/lessons/fix', { lessonId: l.id, version: l.version, studentId: b.id, dryRun: true });
  assert.deepEqual(dry.changes.studentId, { before: a.id, after: b.id });
  const fixed = await wok('mcp/lessons/fix', { lessonId: l.id, version: l.version, studentId: b.id });
  assert.equal(fixed.lesson.studentId, b.id);
  assert.equal((await w('mcp/notices/preview', { lessonIds: [l.id], studentIds: [a.id] })).error.code, 'badTargets', '前の生徒の名前では送れない');
  const pv = await wok('mcp/notices/preview', { lessonIds: [l.id], studentIds: [b.id] });
  assert.equal(pv.mailCount, 1);
  assert.equal(pv.mails[0].to, 'sa***@example.invalid', '宛先は伏せ字');
  assert.equal(pv.mails[0].student.name, '【テスト】坂井 花');
  assert.equal(familyMails('sakai@example.invalid').length, 0, 'プレビューでは送らない');
  const sent = await wok('mcp/notices/send', { requestId: 'req-wrong-002', lessonIds: [l.id], studentIds: [b.id], confirm: pv.confirm });
  assert.equal(sent.mailCount, 1);
  assert.equal(familyMails('sakai@example.invalid').length, 1);
  assert.equal(familyMails('aoki@example.invalid').length, 0, '誤った生徒の家族には 0 通');
  const back = (await wok('mcp/lessons/get', { lessonIds: [l.id] })).lessons[0];
  assert.deepEqual([back.status, back.notices.length, back.notices[0].action, back.notices[0].to], ['proposed', 1, 'propose', 'sa***@example.invalid']);
  assert.equal((await w('mcp/lessons/fix', { lessonId: l.id, version: back.version, studentId: a.id })).error.code, 'notUnsent', '送ったあとは「未送信に戻す」ことはしない');
  void h;
});

test('notices: only the chosen lessons are sent, once; stale previews, bad ids and missing confirmation send nothing; trial lessons are decided without mail', async () => {
  const { h, b, trialId, wok, w, familyMails, count } = await world();
  const s = await wok('mcp/lessons/save', { requestId: 'req-note-0001', items: [item('b1', b.id, '2026-10-20', '17:00'), item('b2', b.id, '2026-10-22', '17:00'), item('b3', b.id, '2026-10-24', '17:00'), item('t1', trialId, '2026-10-21', '18:00')] });
  const [b1, b2, b3, t1] = s.items.map(i => i.lessonId);
  const pv = await wok('mcp/notices/preview', { lessonIds: [b1, b2], studentIds: [b.id] });
  assert.deepEqual([pv.targets.length, pv.mailCount, pv.otherUnsent], [2, 1, 1]);
  assert.match(pv.mails[0].body, /10\/20/); assert.match(pv.mails[0].body, /10\/22/); assert.doesNotMatch(pv.mails[0].body, /10\/24/);
  // プレビューを取り消した・送信の指示がない → 0 通
  assert.equal(familyMails('sakai@example.invalid').length, 0);
  assert.equal((await w('mcp/notices/send', { requestId: 'req-note-0002', lessonIds: [b1, b2], studentIds: [b.id] })).error.code, 'needConfirm');
  // プレビューのあとで対象が変わった → stale、何も送らない
  const l3 = (await wok('mcp/lessons/get', { lessonIds: [b2] })).lessons[0];
  await wok('mcp/lessons/fix', { lessonId: b2, version: l3.version, start: '17:30' });
  assert.equal((await w('mcp/notices/send', { requestId: 'req-note-0003', lessonIds: [b1, b2], studentIds: [b.id], confirm: pv.confirm })).error.code, 'stale');
  assert.equal(familyMails('sakai@example.invalid').length, 0);
  assert.equal(count("select count(*) n from lessons where status = 'held'"), 4, '何も変わっていない');
  // 不正な ID・重複・ほかの生徒
  assert.equal((await w('mcp/notices/preview', { lessonIds: [b1, b1], studentIds: [b.id] })).error.code, 'duplicate');
  const bad = await w('mcp/notices/preview', { lessonIds: [b1, 'ls_nothing', t1], studentIds: [b.id] });
  assert.equal(bad.error.code, 'badTargets');
  assert.deepEqual(bad.error.problems.map(p => p.problem).sort(), ['notFound', 'otherStudent']);
  // 選んだ 2 件だけを送る
  const pv2 = await wok('mcp/notices/preview', { lessonIds: [b1, b2], studentIds: [b.id] });
  const sent = await wok('mcp/notices/send', { requestId: 'req-note-0004', lessonIds: [b1, b2], studentIds: [b.id], confirm: pv2.confirm });
  assert.deepEqual(sent.sentLessons.map(x => x.becomes), ['proposed', 'proposed']);
  assert.equal(familyMails('sakai@example.invalid').length, 1, 'プレビューの通数どおり');
  assert.deepEqual(h.rows('select id, status from lessons where id in (?, ?, ?) order by date', b1, b2, b3).map(r => r.status), ['proposed', 'proposed', 'held'], '選ばれていない授業は未送信のまま');
  // 二重送信しない: 同じ requestId は結果を返すだけ、送った ID をもう一度選ぶと断る
  const rep = await wok('mcp/notices/send', { requestId: 'req-note-0004', lessonIds: [b1, b2], studentIds: [b.id], confirm: pv2.confirm });
  assert.equal(rep.repeated, true);
  assert.equal(familyMails('sakai@example.invalid').length, 1);
  const dupSend = await w('mcp/notices/preview', { lessonIds: [b1], studentIds: [b.id] });
  assert.deepEqual(dupSend.error.problems.map(p => p.problem), ['notUnsent']);
  // 体験: メールなしで決定、カレンダーへ
  const pvT = await wok('mcp/notices/preview', { lessonIds: [t1], studentIds: [trialId] });
  assert.deepEqual([pvT.mailCount, pvT.targets[0].action], [0, 'decideTrial']);
  const calBefore = count("select count(*) n from effects where kind = 'calendarCreate'");
  await wok('mcp/notices/send', { requestId: 'req-note-0005', lessonIds: [t1], studentIds: [trialId], confirm: pvT.confirm });
  assert.equal(h.rows('select status from lessons where id = ?', t1)[0].status, 'decided');
  assert.equal(count("select count(*) n from effects where kind = 'calendarCreate'"), calBefore + 1);
  const st = await wok('mcp/requests/get', { requestId: 'req-note-0004' });
  assert.equal(st.mailsNow.length, 1);
  assert.equal(st.requestStatus, 'done');
  assert.ok(['pending', 'sent', 'failed'].includes(st.mailsNow[0].status));
});

test('reschedule: unsent lessons move silently; sent lessons need a previewed confirmation; versions, overlaps and late changes are refused without force', async () => {
  const { h, b, wok, w, familyMails } = await world();
  const s = await wok('mcp/lessons/save', { requestId: 'req-move-0001', items: [item('b1', b.id, '2026-10-20', '17:00'), item('b2', b.id, '2026-10-22', '17:00')] });
  const [b1, b2] = s.items.map(i => i.lessonId);
  let l1 = (await wok('mcp/lessons/get', { lessonIds: [b1] })).lessons[0];
  const quiet = await wok('mcp/lessons/reschedule', { requestId: 'req-move-0002', lessonId: b1, version: l1.version, date: '2026-10-21', start: '17:00' });
  assert.equal(quiet.mails.length, 0);
  assert.equal(familyMails('sakai@example.invalid').length, 0);
  const pv = await wok('mcp/notices/preview', { lessonIds: [b2], studentIds: [b.id] });
  await wok('mcp/notices/send', { requestId: 'req-move-0003', lessonIds: [b2], studentIds: [b.id], confirm: pv.confirm });
  const sentBefore = familyMails('sakai@example.invalid').length;
  let l2 = (await wok('mcp/lessons/get', { lessonIds: [b2] })).lessons[0];
  const dry = await wok('mcp/lessons/reschedule', { lessonId: b2, version: l2.version, date: '2026-10-23', start: '18:00', dryRun: true });
  // 確認待ちの日時を変えると調整中に戻る（締め切りを外す）。メールは出さない（確定した授業だけ）
  assert.deepEqual([dry.effects.mails, dry.effects.to, dry.effects.cancelFee, dry.stage, dry.becomes], [0, '', 'none', 'asking', 'adjusting']);
  assert.equal((await w('mcp/lessons/reschedule', { requestId: 'req-move-0004', lessonId: b2, version: l2.version, date: '2026-10-23', start: '18:00' })).error.code, 'needConfirm');
  assert.equal((await w('mcp/lessons/reschedule', { requestId: 'req-move-0005', lessonId: b2, version: l2.version - 1, date: '2026-10-23', start: '18:00', dryRun: true })).error.code, 'conflict', '版が違う');
  assert.equal((await w('mcp/lessons/reschedule', { requestId: 'req-move-0006', lessonId: b2, version: l2.version, date: '2026-10-21', start: '17:30', dryRun: true })).error.code, 'overlap', '重なりは強制しない');
  const moved = await wok('mcp/lessons/reschedule', { requestId: 'req-move-0007', lessonId: b2, version: l2.version, date: '2026-10-23', start: '18:00', confirm: dry.confirm });
  assert.deepEqual([moved.lesson.date, moved.lesson.start, moved.mails.length, moved.lesson.stage, moved.lesson.confirmBy], ['2026-10-23', '18:00', 0, 'adjusting', '']);
  assert.equal(familyMails('sakai@example.invalid').length, sentBefore);
  l2 = (await wok('mcp/lessons/get', { lessonIds: [b2] })).lessons[0];
  assert.deepEqual(l2.notices.map(n => n.action), ['propose'], '送った履歴は事実どおり残る（日時の変更はメールなし）');
  // 調整中に戻った授業は、もう一度確認をお願いできる（新しい締め切り）
  const pv2 = await wok('mcp/notices/preview', { lessonIds: [b2], studentIds: [b.id] });
  assert.equal(pv2.targets[0].stage, 'asking');
  // 決定の授業で、前日23時を過ぎた変更は取消料の判断が要るので断る
  h.db2._sqlite.prepare("update lessons set status = 'decided', date = '2026-10-02', start = '18:00' where id = ?").run(b1);
  l1 = (await wok('mcp/lessons/get', { lessonIds: [b1] })).lessons[0];
  assert.equal((await w('mcp/lessons/reschedule', { lessonId: b1, version: l1.version, date: '2026-10-25', start: '17:00', dryRun: true })).error.code, 'late');
});

test('trial students: dry run writes nothing, no permanent link is made, same names are caught, and no secret leaves the API', async () => {
  const { h, auth, w, wok, count } = await world();
  const n0 = count('select count(*) n from students');
  const dry = await wok('mcp/trials/create', { dryRun: true, familyName: '【テスト】森', givenName: '彩', grade: '中2' });
  assert.match(dry.studentPage, /作らない/);
  assert.equal(count('select count(*) n from students'), n0);
  const r = await wok('mcp/trials/create', { requestId: 'req-trial-001', familyName: '【テスト】森', givenName: '彩', grade: '中2' });
  const row = h.rows('select linkCode, trial, testOnly from students where id = ?', r.studentId)[0];
  assert.match(row.linkCode, /^off\./);
  assert.deepEqual([row.trial, row.testOnly], [1, 1]);
  assert.equal(JSON.stringify(r).includes(row.linkCode), false, '応答に鍵を出さない');
  assert.equal(h.rows('select detail from auditLog').some(x => String(x.detail).includes(row.linkCode)), false, '監査にも出さない');
  assert.equal((await h.call('student/me', { k: row.linkCode })).ok, false, 'off. の鍵では生徒ページを開けない');
  const fam = (await h.ok('admin/families/list', { auth })).families.find(f => f.students.some(s => s.id === r.studentId));
  assert.equal(fam.students.find(s => s.id === r.studentId).link, '', '管理画面にもリンクは出ない（作り直すまで）');
  assert.equal((await wok('mcp/trials/create', { requestId: 'req-trial-001', familyName: '【テスト】森', givenName: '彩', grade: '中2' })).repeated, true);
  assert.equal(count('select count(*) n from students'), n0 + 1);
  assert.equal((await w('mcp/trials/create', { requestId: 'req-trial-002', familyName: '【テスト】森', givenName: '彩', grade: '中2' })).error.code, 'sameName');
});
