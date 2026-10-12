'use strict';
// 作り直し（v2）: 特殊指導の承認（cf/v2/specials.mjs、0019_specials.sql）。提案 → 保護者の承認 → その名称の種類でだけ基本単価を超える計画が作れる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

async function world() {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', grade: '中3', baseRate30: 1500 })).student;
  const parent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam.id }), h.mails().at(-1))), password: 'family password 1' })).auth;
  return { h, auth, fam, kid, parent };
}
const PLAN = { subject: '英語', startDate: '2026-11-01', endDate: '2026-11-30', count: 4, minutes: 90 };

test('specials: a plan above the base rate needs an agreed special of that kind; proposing creates the kind and a document; the family approves', async () => {
  const { h, auth, kid, parent } = await world();
  // 基本単価 1,500 円/30 分 → 90 分は 4,500 円まで。それ以上は特殊指導の承認が要る
  assert.equal((await h.ok('billing/plans/save', { auth, studentId: kid.id, kind: '通常', fee: 4500, ...PLAN })).line.fee, 4500, '基本単価ちょうどは通常でよい');
  assert.equal((await h.call('billing/plans/save', { auth, studentId: kid.id, kind: '英検準1級対策', fee: 7000, ...PLAN })).error.code, 'needSpecial');
  const mails = h.mails().length;
  const sp = (await h.ok('admin/specials/propose', { auth, studentId: kid.id, title: '英検準1級対策', purpose: '試験対策', content: '過去問の長文とライティングの添削。毎回、前回の答案を講師が採点して返す', reason: '毎回の答案の添削と、準1級の語彙・長文の準備に1回あたり2時間かかる。ほかの生徒には使えない', prep: '過去問の解答作成、添削', minutes: 90, fee: 7000, fromDate: '2026-11-01', toDate: '2027-01-31', note: '' })).special;
  assert.deepEqual([sp.no, sp.status, sp.title], [1, 'proposed', '英検準1級対策']);
  assert.ok(sp.docFileId, '案の書面');
  assert.equal(h.mails().length, mails + 1);
  assert.deepEqual({ ...h.rows("select name, standardMinutes, standardFee, active from lessonKinds where name = '英検準1級対策'")[0] }, { name: '英検準1級対策', standardMinutes: 90, standardFee: 7000, active: 1 }, '授業の種類ができる');
  assert.equal((await h.call('billing/plans/save', { auth, studentId: kid.id, kind: '英検準1級対策', fee: 7000, ...PLAN })).error.code, 'needSpecial', '承認されるまでは作れない');
  const fs = (await h.ok('family/specials', { auth: parent })).specials;
  assert.deepEqual([fs.needs, fs.items[0].title, fs.items[0].studentName], [true, '英検準1級対策', '架空 一郎']);
  assert.equal((await h.ok('family/money', { auth: parent })).specials.items.length, 1, 'お支払いの画面に出る');
  assert.equal((await h.call('family/specials/agree', { auth: parent, id: sp.id })).error.code, 'needAgree');
  const after = (await h.ok('family/specials/agree', { auth: parent, id: sp.id, agree: true })).specials;
  assert.deepEqual([after.needs, after.items[0].status, after.items[0].agreedVia], [false, 'agreed', '保護者ページ']);
  assert.notEqual(after.items[0].docFileId, sp.docFileId, '承認で確定の書面');
  const html = await (await h.raw('GET', (await h.ok('files/link', { auth: parent, id: after.items[0].docFileId })).url)).text();
  assert.match(html, /特殊指導条件書/); assert.match(html, /7,000円/); assert.match(html, /保護者の承認/); assert.doesNotMatch(html, /<script/);
  const line = (await h.ok('billing/plans/save', { auth, studentId: kid.id, kind: '英検準1級対策', fee: 7000, ...PLAN })).line;
  assert.equal(line.fee, 7000, '承認後は作れる');
  assert.equal((await h.call('billing/plans/save', { auth, studentId: kid.id, kind: '英検準1級対策', fee: 7000, ...PLAN, startDate: '2027-02-01', endDate: '2027-02-28' })).error.code, 'needSpecial', '期間の外は作れない');
  assert.equal((await h.call('billing/plans/save', { auth, studentId: kid.id, kind: '英検準1級対策', fee: 9000, ...PLAN, subject: '数学' })).error.code, 'needSpecial', '承認した料金を超えるものは作れない');
  // 終えると、もう根拠にならない
  await h.ok('admin/specials/end', { auth, id: sp.id });
  assert.equal((await h.call('billing/plans/save', { auth, studentId: kid.id, kind: '英検準1級対策', fee: 7000, ...PLAN, subject: '国語' })).error.code, 'needSpecial');
});

test('specials: staff can record a LINE approval, replace a proposal with a new version, and teachers or other families cannot touch it', async () => {
  const { h, auth, kid, fam } = await world();
  const teacher = await h.staffWith(auth, ['teacher'], 'teacher@example.invalid');
  const body = { studentId: kid.id, title: '過去問解説', purpose: '試験対策', content: '毎回の模試の全問解説', reason: '事前に全問を解く準備が要る', minutes: 90, fee: 6000, fromDate: '2026-11-01', toDate: '2026-12-31' };
  assert.equal((await h.call('admin/specials/propose', { auth: teacher, ...body })).error.code, 'forbidden');
  const a = (await h.ok('admin/specials/propose', { auth, ...body })).special;
  const b = (await h.ok('admin/specials/propose', { auth, ...body, fee: 5500, replaceId: a.id })).special;
  const st = await h.ok('admin/specials/get', { auth, studentId: kid.id });
  assert.deepEqual([st.items.map(x => x.no), st.past.map(x => [x.no, x.status])], [[2], [[1, 'replaced']]]);
  assert.equal((await h.call('admin/specials/record', { auth, id: b.id, date: '2026-10-01', via: '' })).error.code, 'needVia');
  const rec = await h.ok('admin/specials/record', { auth, id: b.id, date: '2026-10-01', consenterName: '架空 保護者', consentedAt: '2026-10-01T09:00:00+09:00', via: 'LINE', note: '母' });
  assert.deepEqual([rec.items[0].status, rec.items[0].agreedVia, rec.needs], ['agreed', 'LINE', false]);
  const other = (await h.ok('admin/families/create', { auth, name: '別家', email: 'other@example.invalid' })).family;
  const otherParent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: other.id }), h.mails().at(-1))), password: 'family password 2' })).auth;
  assert.equal((await h.call('family/specials/agree', { auth: otherParent, id: b.id, agree: true })).error.code, 'notFound');
  const got = (await h.ok('admin/families/get', { auth, id: fam.id })).family.students[0].specials;
  assert.equal(got.items[0].title, '過去問解説');
  assert.equal((await h.call('admin/specials/propose', { auth, ...body, title: '通常' })).error.code, 'badTitle');
});
