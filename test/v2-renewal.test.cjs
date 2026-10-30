'use strict';
// 作り直し（v2）: 以前からの家族の「契約の更新」（cf/v2/enrollment.mjs の kind = renewal、0036_offer_kind.sql）。
// 2026-10-29 本人「新しい規約と契約書類に以前から利用している顧客に承認してもらう…入塾手続きを転用」「11月から」「契約者の情報も確かめてもらう」
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

const TERMS = { version: '2026-11-r18', title: '共通規約（2026年11月版）', url: 'https://www.stepwise-education.jp/terms/2026-11-20261028-r18/', from: '2026-11-01' };
const APP = { guardianFamilyName: '【テスト】岡野', guardianGivenName: '花子', guardianFamilyKana: 'おかの', guardianGivenKana: 'はなこ', phone: '090-1234-5678', zip: '3430002', address: '【テスト】越谷市1-2-3' };
const stu = s => ({ familyName: s.familyName, givenName: s.givenName, familyKana: 'おかの', givenKana: 'かな', grade: '中3', school: '【テスト】第一中学校' });

async function world() {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '【テスト】岡野家', email: 'renew@example.invalid', guardianName: '【テスト】岡野 花子' })).family;
  const a = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '【テスト】岡野', givenName: '一郎', grade: '中学３年生', baseRate30: 1500, deliveryMode: 'in_person', enrolledOn: '2025-04-01' })).student;
  const b = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '【テスト】岡野', givenName: '二郎', grade: '小6', baseRate30: 1500, deliveryMode: 'online' })).student;
  const parent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam.id }), h.mails().at(-1))), password: 'family password 1' })).auth;
  return { h, auth, fam, a, b, parent };
}
const offer = (a, b) => [{ studentId: a.id, minutes: 90, fee: 4500, deliveryMode: 'in_person', subjects: '英語・数学' }, { studentId: b.id, minutes: 60, fee: 3000, deliveryMode: 'online', subjects: '算数' }];

test('renewal: one mail for the siblings, the parent confirms details and agrees per student, enrollment marks stay as they are', async () => {
  const { h, auth, fam, a, b, parent } = await world();
  assert.equal((await h.call('admin/renewal/offer', { auth, familyId: fam.id, fromMonth: '2026-11', students: offer(a, b) })).error.code, 'needTerms');
  await h.ok('admin/terms/set', { auth, ...TERMS });
  const before = h.mails().length;
  const r = await h.ok('admin/renewal/offer', { auth, familyId: fam.id, fromMonth: '2026-11', students: offer(a, b) });
  assert.deepEqual([r.renewals[a.id].status, r.renewals[a.id].kind, r.renewals[b.id].fromMonth], ['offered', 'renewal', '2026-11']);
  const mails = h.mails().slice(before);
  assert.equal(mails.length, 1, '兄弟でもメールは 1 通');
  assert.match(mails[0].subject, /共通規約と個別受講条件書のご確認のお願い/);
  assert.match(mails[0].body, /^【テスト】岡野 一郎さん・【テスト】岡野 二郎さんの共通規約と個別受講条件書/);
  assert.match(mails[0].body, /#enroll/);
  // 体験生ではない生徒の印は、入塾の案内の扱いにしない
  assert.equal((await h.ok('students/list', { auth })).families[0].students.find(s => s.id === a.id).offered, false);
  assert.equal((await h.ok('students/hub', { auth, studentId: a.id })).enrollment, undefined, '生徒の画面に入塾の枠を出さない');
  // 保護者: 申込みの画面に 2 人分。今の情報が入っている
  const page = await h.ok('family/enrollment', { auth: parent });
  assert.deepEqual(page.offers.map(o => [o.kind, o.student.givenName]), [['renewal', '一郎'], ['renewal', '二郎']]);
  assert.equal(page.offers[0].student.grade, '中3', '前の書き方の学年もそろえて出す');
  const o1 = page.offers[0], o2 = page.offers[1];
  const apply = (o, s) => h.ok('family/enrollment/apply', { auth: parent, offerId: o.id, conditionId: o.conditionId, termsVersion: TERMS.version, agree: true, ...APP, student: stu(s) });
  const m0 = h.mails().length;
  await apply(o1, a);
  const toParent = h.mails().slice(m0).filter(m => m.audience === 'family');
  assert.equal(toParent.length, 1, '保護者にも受付のメール');
  assert.match(toParent[0].subject, /契約更新の手続きを受け付けました/);
  assert.match(toParent[0].body, /2026年11月からの授業は、新しい個別受講条件書の内容で行います/);
  const sa = h.rows('select * from students where id = ?', a.id)[0];
  assert.deepEqual([sa.trial, sa.enrolledOn, sa.grade], [0, '2025-04-01', '中3'], '入塾日は変えない。学年は入れた値');
  const f1 = h.rows('select * from families where id = ?', fam.id)[0];
  assert.deepEqual([f1.name, f1.termsVersion, f1.address], ['【テスト】岡野家', TERMS.version, '〒343-0002 【テスト】越谷市1-2-3'], '家族の表示名は変えず、規約の同意と住所が入る');
  const c1 = h.rows("select * from conditions where studentId = ? and status = 'agreed'", a.id)[0];
  assert.deepEqual([c1.agreedVia, c1.consenterName, c1.fromMonth], ['保護者ページ（契約更新の手続き）', '【テスト】岡野 花子', '2026-11']);
  assert.equal(h.rows("select via from termsConsents where familyId = ?", fam.id)[0].via, '保護者ページ（契約更新の手続き）');
  assert.match(h.mails().filter(m => m.audience === 'staff').at(-1).subject, /【契約更新】/);
  // 2 人目: 規約は同意済みなので重ねて記録しない
  await apply(o2, b);
  assert.equal(h.rows('select count(*) n from termsConsents where familyId = ?', fam.id)[0].n, 1);
  assert.equal(h.rows("select count(*) n from conditions where studentId = ? and status = 'agreed'", b.id)[0].n, 1);
  assert.equal((await h.ok('family/enrollment', { auth: parent })).offers.filter(o => o.status === 'offered').length, 0);
  assert.deepEqual((await h.ok('admin/families/get', { auth, id: fam.id })).family.students.map(s => s.renewal && s.renewal.status), ['applied', 'applied']);
});

test('renewal: trial students and other families are refused, resending sends one mail for those still open, a new offer replaces the old one', async () => {
  const { h, auth, fam, a, b } = await world();
  await h.ok('admin/terms/set', { auth, ...TERMS });
  const t = await h.ok('admin/trials/create', { auth, familyName: '【テスト】体験', givenName: '三郎', grade: '中1', school: '' });
  assert.equal((await h.call('admin/renewal/offer', { auth, familyId: fam.id, fromMonth: '2026-11', students: [{ ...offer(a, b)[0], studentId: t.studentId }] })).error.code, 'notFound', 'ほかの家族の生徒は選べない');
  const r = await h.ok('admin/renewal/offer', { auth, familyId: fam.id, fromMonth: '2026-11', students: offer(a, b) });
  const before = h.mails().length;
  await h.ok('admin/enrollment/resend', { auth, offerId: r.renewals[a.id].id });
  assert.equal(h.mails().length, before + 1);
  assert.match(h.mails().at(-1).subject, /共通規約と個別受講条件書のご確認のお願い/);
  const again = await h.ok('admin/renewal/offer', { auth, familyId: fam.id, fromMonth: '2026-11', students: [{ ...offer(a, b)[0], fee: 4800 }] });
  assert.notEqual(again.renewals[a.id].id, r.renewals[a.id].id, '前の案内は取り下げて新しく');
  assert.equal(h.rows("select count(*) n from enrollmentOffers where studentId = ? and status = 'offered'", a.id)[0].n, 1);
  assert.deepEqual(h.rows("select fee from conditions where studentId = ? and status = 'proposed'", a.id).map(x => x.fee), [4800]);
});

// 兄弟はまとめて 1 回で（2026-10-30 本人「兄弟が複数人いるときに、２回同じ手順をやることに違和感」）。保護者の情報と規約は 1 回、受付のメールも 1 通
test('renewal: the parent agrees for all siblings at once; one write, one mail each to the parent and the classroom', async () => {
  const { h, auth, fam, a, b, parent } = await world();
  await h.ok('admin/terms/set', { auth, ...TERMS });
  await h.ok('admin/renewal/offer', { auth, familyId: fam.id, fromMonth: '2026-11', students: offer(a, b) });
  const page = await h.ok('family/enrollment', { auth: parent });
  const [o1, o2] = page.offers;
  const items = [{ offerId: o1.id, conditionId: o1.conditionId, student: stu(a) }, { offerId: o2.id, conditionId: o2.conditionId, student: { ...stu(b), grade: '小6' } }];
  assert.equal((await h.call('family/enrollment/apply-all', { auth: parent, termsVersion: TERMS.version, agree: false, ...APP, items })).error.code, 'needAgree');
  assert.equal((await h.call('family/enrollment/apply-all', { auth: parent, termsVersion: TERMS.version, agree: true, ...APP, items: [items[0], items[0]] })).error.code, 'badRequest', '同じ生徒を 2 回は入れない');
  const m0 = h.mails().length;
  const r = await h.ok('family/enrollment/apply-all', { auth: parent, termsVersion: TERMS.version, agree: true, ...APP, items });
  assert.deepEqual(r.enrollments.map(e => e.status), ['applied', 'applied']);
  const mails = h.mails().slice(m0), toParent = mails.filter(m => m.audience === 'family'), toStaff = mails.filter(m => m.audience === 'staff');
  assert.equal(toParent.length, 1, '保護者への受付のメールは 1 通');
  assert.match(toParent[0].subject, /契約更新の手続きを受け付けました/);
  assert.match(toParent[0].body, /【テスト】岡野 一郎さん・【テスト】岡野 二郎さんの契約更新の手続き/);
  assert.match(toParent[0].body, /【テスト】岡野 二郎さん：個別受講条件書（第1版）/);
  assert.equal(toStaff.length, 1);
  assert.match(toStaff[0].subject, /【契約更新】【テスト】岡野 一郎さん・【テスト】岡野 二郎さん/);
  assert.equal(h.rows('select count(*) n from termsConsents where familyId = ?', fam.id)[0].n, 1, '規約の同意は 1 回');
  for (const s of [a, b]) assert.equal(h.rows("select agreedVia from conditions where studentId = ? and status = 'agreed'", s.id)[0].agreedVia, '保護者ページ（契約更新の手続き）');
  assert.equal(h.rows('select grade from students where id = ?', b.id)[0].grade, '小6');
  assert.equal((await h.ok('family/enrollment', { auth: parent })).offers.filter(o => o.status === 'offered').length, 0);
  assert.equal((await h.call('family/enrollment/apply-all', { auth: parent, termsVersion: TERMS.version, agree: true, ...APP, items })).error.code, 'closed', '2 回目は受け付けない');
});

// 保護者の氏名に空白がない家族（例: 「山本あさこ」）は、生徒の名字で姓と名に分けて入れておく（2026-10-30 山本さんの手続きの前に）
test('renewal: a guardian name without a space is split at the students\' surname', async () => {
  const h = await createV2(); const auth = await h.owner();
  await h.ok('admin/terms/set', { auth, ...TERMS });
  const fam = (await h.ok('admin/families/create', { auth, name: '【テスト】山本さん', email: 'yama@example.invalid', guardianName: '【テスト】山本あさこ' })).family;
  const s = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '【テスト】山本', givenName: '一郎', grade: '中3', baseRate30: 1500 })).student;
  const parent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam.id }), h.mails().at(-1))), password: 'family password 1' })).auth;
  await h.ok('admin/renewal/offer', { auth, familyId: fam.id, fromMonth: '2026-11', students: [{ studentId: s.id, minutes: 90, fee: 4500, deliveryMode: 'in_person', subjects: '数学' }] });
  const g = (await h.ok('family/enrollment', { auth: parent })).guardian;
  assert.deepEqual([g.familyName, g.givenName], ['【テスト】山本', 'あさこ']);
});
