'use strict';
// 作り直し（v2）: 入塾の案内と申込み（cf/v2/enrollment.mjs、0032_family_enrollment.sql）。2026-10-18 本人決定。
// 体験 → 代表の「入塾の案内」→ 保護者のパスワード → 1 画面の申込み（規約・受講条件書の同意つき）→ そのまま入塾 → 計画を承認できる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

const TERMS = { version: '2026-11-r9', title: '受講規約（2026年11月版）', url: 'https://www.stepwise-education.jp/terms/2026-11-20261015-r9/', from: '2026-11-01' };
const COND = { minutes: 90, fee: 4500, deliveryMode: 'in_person', subjects: '英語・数学', fromMonth: '2026-11', studentContact: true };
const APP = { guardianFamilyName: '【テスト】高橋', guardianGivenName: '花子', guardianFamilyKana: 'たかはし', guardianGivenKana: 'はなこ', phone: '090-1234-5678', zip: '3430002', address: '【テスト】越谷市1-2-3',
  student: { familyName: '【テスト】高橋', givenName: '夏帆', familyKana: 'たかはし', givenKana: 'かほ', grade: '中3', school: '【テスト】第一中学校' } };

async function world() {
  const h = await createV2(); const auth = await h.owner();
  const t = await h.ok('admin/trials/create', { auth, familyName: '【テスト】高橋', givenName: '夏帆', grade: '中3', school: '' });
  return { h, auth, sid: t.studentId, fid: t.familyId };
}

test('enrollment: offer → password → one application with consents → enrolled at once, then the plan can be approved', async () => {
  const { h, auth, sid, fid } = await world();
  // 規約を公開する前は案内できない（保護者が同意できないため）
  assert.equal((await h.call('admin/enrollment/offer', { auth, studentId: sid, email: 'enroll@example.invalid', ...COND })).error.code, 'needTerms');
  await h.ok('admin/terms/set', { auth, ...TERMS });
  assert.equal((await h.call('admin/enrollment/offer', { auth, studentId: sid, email: 'bad', ...COND })).error.code, 'badEmail');
  const mails = h.mails().length;
  const o = await h.ok('admin/enrollment/offer', { auth, studentId: sid, email: 'enroll@example.invalid', ...COND });
  assert.equal(o.enrollment.status, 'offered');
  assert.ok(o.inviteUrl.includes('/family/#invite='), '招待のリンク（コピーして渡せる）');
  assert.equal(h.mails().length, mails + 1, 'メールは招待の 1 通だけ（受講条件書の別のお知らせは送らない）');
  const mail = h.mails().at(-1);
  assert.equal(mail.subject, '【ステップワイズ】入塾のお手続きのご案内');
  assert.match(mail.body, /1回90分 4,500円/);
  const cond = h.rows('select * from conditions where studentId = ?', sid)[0];
  assert.deepEqual([cond.status, cond.fee, cond.fromMonth], ['proposed', 4500, '2026-11'], '受講条件書の案ができる');
  // 一覧と生徒の画面に「申込み待ち」
  const list = await h.ok('students/list', { auth });
  assert.equal(list.families.flatMap(f => f.students).find(s => s.id === sid).offered, true);
  const hub = await h.ok('students/hub', { auth, studentId: sid });
  assert.deepEqual([hub.enrollment.offer.status, hub.enrollment.termsReady], ['offered', true]);

  // ② パスワード。招待のあとは申込みの画面へ戻る
  const acc = await h.ok('family/invite/accept', { token: h.linkFrom(mail), password: 'family password 1' });
  assert.equal(acc.returnTo, 'enroll');
  assert.equal(acc.me.guardianName, '', '保護者の名前はまだない');
  const parent = acc.auth;
  const page = await h.ok('family/enrollment', { auth: parent });
  assert.equal(page.offers.length, 1);
  assert.deepEqual([page.offers[0].student.familyName, page.offers[0].condition.fee, page.terms.version], ['【テスト】高橋', 4500, TERMS.version]);
  assert.ok(page.offers[0].condition.docFileId, '受講条件書の案を開ける');

  // ③ 申込み: 同意の印・最新の版が要る。項目の検査
  const base = { auth: parent, offerId: o.enrollment.id, termsVersion: TERMS.version, conditionId: cond.id, ...APP };
  assert.equal((await h.call('family/enrollment/apply', { ...base })).error.code, 'needAgree');
  assert.equal((await h.call('family/enrollment/apply', { ...base, agree: true, termsVersion: 'old' })).error.code, 'staleVersion');
  assert.equal((await h.call('family/enrollment/apply', { ...base, agree: true, guardianGivenKana: 'Hanako' })).error.code, 'badKana');
  assert.equal((await h.call('family/enrollment/apply', { ...base, agree: true, phone: '12' })).error.code, 'badPhone');
  assert.equal((await h.call('family/enrollment/apply', { ...base, agree: true, zip: '12' })).error.code, 'badZip');
  assert.equal((await h.call('family/enrollment/apply', { ...base, agree: true, student: { ...APP.student, grade: '中学3年' } })).error.code, 'badGrade', '学年は選択肢から');
  assert.equal((await h.call('family/enrollment/apply', { ...base, agree: true, student: { ...APP.student, school: '' } })).error.code, 'needField', '学校は必須');
  h.db2._sqlite.prepare("update students set linkCode = 'off.mcp' where id = ?").run(sid); // MCP で登録した体験生の使えない鍵
  const staffMails = h.mails().filter(m => m.audience === 'staff').length;
  const done = await h.ok('family/enrollment/apply', { ...base, agree: true });
  assert.deepEqual([done.enrollment.status, done.enrolledOn], ['applied', '2026-11-01'], '開始月の1日が入塾日');

  // ④ そのまま入塾: 体験の印が外れ、規約・受講条件書の同意が、入れた氏名で残る
  const s = h.rows('select * from students where id = ?', sid)[0], f = h.rows('select * from families where id = ?', fid)[0];
  assert.deepEqual([s.trial, s.enrolledOn, s.familyKana, s.givenKana, s.school], [0, '2026-11-01', 'たかはし', 'かほ', '【テスト】第一中学校']);
  assert.ok(!s.linkCode.startsWith('off.') && s.linkCode.length > 20, '入塾したら生徒の専用リンクが使えるように');
  assert.deepEqual([f.name, f.guardianName, f.guardianKana, f.phone, f.address, f.termsVersion], ['【テスト】高橋家', '【テスト】高橋 花子', 'たかはし はなこ', '090-1234-5678', '〒343-0002 【テスト】越谷市1-2-3', TERMS.version]);
  assert.deepEqual([f.guardianFamilyName, f.guardianGivenName, f.guardianFamilyKana, f.guardianGivenKana], ['【テスト】高橋', '花子', 'たかはし', 'はなこ'], '保護者の氏名は姓・名に分けても持つ');
  const tc = h.rows('select * from termsConsents where familyId = ?', fid);
  assert.deepEqual([tc.length, tc[0].consenterName, tc[0].via], [1, '【テスト】高橋 花子', '保護者ページ（入塾の申込み）']);
  const agreed = h.rows('select * from conditions where id = ?', cond.id)[0];
  assert.deepEqual([agreed.status, agreed.consenterName], ['agreed', '【テスト】高橋 花子']);
  const offer = h.rows('select * from enrollmentOffers where id = ?', o.enrollment.id)[0];
  assert.equal(JSON.parse(offer.application).guardian.phone, '090-1234-5678', '受講申込書の控え');
  assert.throws(() => h.db2._sqlite.prepare("update enrollmentOffers set consenterName = 'x' where id = ?").run(offer.id), /immutable/, '申込みの控えは変えられない');
  assert.equal(h.mails().filter(m => m.audience === 'staff').length, staffMails + 1, '代表にお知らせ');
  assert.equal((await h.call('family/enrollment/apply', { ...base, agree: true })).error.code, 'closed', '二重に申し込めない');
  assert.equal((await h.ok('family/me', { auth: parent })).me.guardianName, '【テスト】高橋 花子', 'ほかの同意の欄に氏名が最初から入る');
  assert.equal((await h.call('admin/enrollment/offer', { auth, studentId: sid, email: 'enroll@example.invalid', ...COND })).error.code, 'notTrial');

  // そのあと: 11月の計画（受講合意書）を、規約・条件書の同意をし直さずに承認できる
  const line = (await h.ok('billing/plans/save', { auth, studentId: sid, subject: '英語', kind: '通常', startDate: '2026-11-01', endDate: '2026-11-30', count: 4, minutes: 90, fee: 4500 })).line;
  await h.ok('billing/plans/send', { auth, familyId: fid });
  const v = h.rows('select version from planLines where id = ?', line.id)[0].version;
  assert.equal((await h.ok('family/plans/decide', { consenterName: '【テスト】高橋 花子', auth: parent, id: line.id, version: v, approvedCount: 4 })).line.status, 'approved');
});

test('enrollment: a new offer replaces the old one, withdraw closes it, resend reissues the link, and a family already registered gets a page notice', async () => {
  const { h, auth, sid, fid } = await world();
  await h.ok('admin/terms/set', { auth, ...TERMS });
  const a = await h.ok('admin/enrollment/offer', { auth, studentId: sid, email: 'enroll2@example.invalid', ...COND });
  const b = await h.ok('admin/enrollment/offer', { auth, studentId: sid, email: 'enroll2@example.invalid', ...COND, fee: 5000 });
  assert.deepEqual(h.rows('select status from enrollmentOffers where studentId = ? order by offeredAt, rowid', sid).map(r => r.status), ['withdrawn', 'offered']);
  assert.deepEqual(h.rows('select status, fee from conditions where studentId = ? order by no', sid).map(r => [r.status, r.fee]), [['replaced', 4500], ['proposed', 5000]]);
  const first = h.mails().at(-2), second = h.mails().at(-1);
  assert.equal((await h.call('family/invite/accept', { token: h.linkFrom(first), password: 'family password 1' })).error.code, 'expiredLink', '前のリンクは使えない');
  const again = await h.ok('admin/enrollment/resend', { auth, offerId: b.enrollment.id });
  assert.ok(again.inviteUrl && h.linkFrom(h.mails().at(-1)) !== h.linkFrom(second));
  await h.ok('admin/enrollment/withdraw', { auth, offerId: b.enrollment.id });
  assert.equal((await h.call('admin/enrollment/resend', { auth, offerId: b.enrollment.id })).error.code, 'closed');
  assert.equal(h.rows("select count(*) n from conditions where studentId = ? and status = 'proposed'", sid)[0].n, 0, '取り消すと条件書の案も閉じる');
  // パスワード登録済みの家族（兄弟の入塾など）は、招待ではなく保護者ページのお知らせ
  const parent = (await h.ok('family/invite/accept', { token: h.linkFrom(h.mails().at(-1)), password: 'family password 1' })).auth;
  const c = await h.ok('admin/enrollment/offer', { auth, studentId: sid, email: 'enroll2@example.invalid', ...COND });
  assert.equal(c.inviteUrl, '');
  assert.equal(h.mails().at(-1).subject, '【ステップワイズ】入塾のお手続きのお願い');
  assert.match(h.mails().at(-1).body, /family\/#enroll/);
  assert.equal((await h.call('admin/enrollment/offer', { auth, studentId: sid, email: 'other@example.invalid', ...COND })).error.code, 'emailFixed');
  assert.equal((await h.ok('family/enrollment', { auth: parent })).offers.length, 1);
  // 代表の家族の画面でも、保護者の氏名は姓・名で入れ、「姓 名」も合わせて持つ
  const fam = h.rows('select version from families where id = ?', fid)[0];
  const up = (await h.ok('admin/families/update', { auth, id: fid, version: fam.version, name: '【テスト】高橋家', guardianFamilyName: '【テスト】高橋', guardianGivenName: '一郎', guardianFamilyKana: 'たかはし', guardianGivenKana: 'いちろう' })).family;
  assert.deepEqual([up.guardianName, up.guardianFamilyName, up.guardianGivenName, up.guardianKana], ['【テスト】高橋 一郎', '【テスト】高橋', '一郎', 'たかはし いちろう']);
  void a;
});
