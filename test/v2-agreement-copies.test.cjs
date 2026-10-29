'use strict';
// 合意した書面の控えを保護者にメールで送る（2026-10-29 本人「個別受講条件書と受講計画書は合意したら控えを送ってほしい」）。
// 保護者ページで同意・承認したときも、教室が LINE などでもらった同意を記録したときも送る。受講計画書の見送りは送らない
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

const at = s => Date.parse(s + '+09:00');
const SPECIAL = { title: '英検準1級対策', purpose: '試験対策', content: '過去問の長文とライティングの添削', reason: '毎回の答案の添削に時間がかかる', prep: '過去問の解答作成、添削', minutes: 90, fee: 7000, fromDate: '2026-11-01', toDate: '2027-01-31', note: '' };

async function world() {
  const h = await createV2(); const auth = await h.owner(); h.clock = at('2026-10-20T09:00:00');
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500 })).student;
  const parent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam.id }), h.mails().at(-1))), password: 'family password 1' })).auth;
  const toParent = since => h.mails().slice(since).filter(m => m.audience === 'family' && m.to === 'parent@example.invalid');
  return { h, auth, kid, parent, toParent };
}

test('a copy is mailed when the parent agrees to a condition and when the classroom records a consent', async () => {
  const { h, auth, kid, parent, toParent } = await world();
  const c1 = (await h.ok('admin/conditions/propose', { auth, studentId: kid.id, minutes: 90, fee: 4500, deliveryMode: 'in_person', studentContact: true, subjects: '数学', note: '', fromMonth: '2026-11' })).condition;
  let n = h.mails().length;
  await h.ok('family/conditions/agree', { consenterName: '架空 保護者', auth: parent, id: c1.id, agree: true });
  let m = toParent(n);
  assert.equal(m.length, 1);
  assert.match(m[0].subject, /個別受講条件書の控え/);
  assert.match(m[0].body, /架空 一郎さんの個別受講条件書（第1版）に同意いただきました。\n同意：10月20日・保護者ページ・架空 保護者\n主な条件：2026年11月から・1回90分 4,500円（税込）・教室/);
  assert.match(m[0].body, /#contracts/);
  const c2 = (await h.ok('admin/conditions/propose', { auth, studentId: kid.id, minutes: 90, fee: 5000, deliveryMode: 'online', studentContact: true, subjects: '数学', note: '', fromMonth: '2026-12' })).condition;
  n = h.mails().length;
  await h.ok('admin/conditions/record', { auth, id: c2.id, consenterName: '架空 保護者', consentedAt: '2026-10-19T20:00:00+09:00', via: 'LINE' });
  m = toParent(n);
  assert.equal(m.length, 1, '教室が記録したときも控えを送る');
  assert.match(m[0].body, /第2版）に同意いただきました。\n同意：10月19日・LINE・架空 保護者/);
});

test('a copy is mailed for an approved special rate and an approved plan, but not for a declined plan', async () => {
  const { h, auth, kid, parent, toParent } = await world();
  const c1 = (await h.ok('admin/conditions/propose', { auth, studentId: kid.id, minutes: 90, fee: 4500, deliveryMode: 'in_person', studentContact: true, subjects: '数学', note: '', fromMonth: '2026-11' })).condition;
  await h.ok('admin/conditions/record', { auth, id: c1.id, consenterName: '架空 保護者', consentedAt: '2026-10-19T20:00:00+09:00', via: 'LINE' });
  const sp = (await h.ok('admin/specials/propose', { auth, studentId: kid.id, ...SPECIAL })).special;
  let n = h.mails().length;
  await h.ok('family/specials/agree', { consenterName: '架空 保護者', auth: parent, id: sp.id, agree: true });
  let m = toParent(n);
  assert.equal(m.length, 1);
  assert.match(m[0].subject, /特別単価合意書の控え/);
  assert.match(m[0].body, /「英検準1級対策」を承認いただきました。\n承認：10月20日・保護者ページ・架空 保護者\n主な条件：11\/1〜1\/31・1回90分 7,000円（税込）/);
  // 受講計画書: 保護者の承認は控えを送る。見送りは送らない。教室が記録した承諾も送る
  const line = async subject => (await h.ok('billing/plans/save', { auth, studentId: kid.id, subject, kind: '通常', startDate: '2026-11-01', endDate: '2026-11-30', count: 4, minutes: 90, fee: 4500 })).line;
  const a = await line('数学'), b = await line('英語'), d = await line('国語');
  await h.ok('billing/plans/send', { auth, familyId: kid.familyId });
  const cur = id => h.rows('select * from planLines where id = ?', id)[0];
  n = h.mails().length;
  await h.ok('family/plans/decide', { consenterName: '架空 保護者', auth: parent, id: a.id, version: cur(a.id).version, approvedCount: 3 });
  m = toParent(n);
  assert.equal(m.length, 1);
  assert.match(m[0].subject, /受講計画書の控え/);
  assert.match(m[0].body, /受講計画書（数学・11\/1〜11\/30）を承認いただきました。\n承認：10月20日・保護者ページ・架空 保護者\n内容：3回・1回90分 4,500円（税込）/);
  n = h.mails().length;
  await h.ok('family/plans/decide', { consenterName: '架空 保護者', auth: parent, id: b.id, version: cur(b.id).version, approvedCount: 0 });
  assert.equal(toParent(n).length, 0, '見送りは控えを送らない');
  n = h.mails().length;
  await h.ok('billing/plans/consent', { auth, id: d.id, version: cur(d.id).version, consenterName: '架空 保護者', consentedAt: '2026-10-19T21:00:00+09:00', via: '電話' });
  m = toParent(n);
  assert.equal(m.length, 1, '教室が記録した承諾も控えを送る');
  assert.match(m[0].body, /国語・11\/1〜11\/30）を承認いただきました。\n承認：10月19日・電話・架空 保護者\n内容：4回/);
});
