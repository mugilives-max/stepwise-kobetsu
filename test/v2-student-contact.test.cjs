'use strict';
// 生徒本人からのお休み・変更の連絡を受け付けるかは、保護者ページのアカウントで保護者が決める（2026-10-26 本人）。受講条件書では変えない
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

test('parents switch whether the student may send absence requests; conditions do not change it', async () => {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500 })).student;
  const other = (await h.ok('admin/families/create', { auth, name: '別の家', email: 'other@example.invalid' })).family;
  const otherKid = (await h.ok('admin/students/create', { auth, familyId: other.id, familyName: '別', givenName: '二郎', baseRate30: 1500 })).student;
  const parent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam.id }), h.mails().at(-1))), password: 'family password 1' })).auth;
  const k = new URL(kid.link).searchParams.get('k');
  const contact = async () => (await h.ok('family/schedule', { auth: parent })).students.find(s => s.id === kid.id).studentContact;
  assert.equal(await contact(), true, '初めは受け付ける');
  await h.ok('family/students/contact', { auth: parent, studentId: kid.id, allow: false });
  assert.equal(await contact(), false);
  assert.equal((await h.ok('student/schedule', { k })).permissions.reschedule, false, '生徒の画面でも連絡できなくなる');
  assert.equal((await h.call('family/students/contact', { auth: parent, studentId: otherKid.id, allow: false })).error.code, 'notFound', 'ほかの家族の生徒は変えられない');
  assert.equal((await h.call('family/students/contact', { auth: parent, studentId: kid.id, allow: 'yes' })).error.code, 'badValue');
  await h.ok('admin/conditions/propose', { auth, studentId: kid.id, minutes: 90, fee: 4500, deliveryMode: 'in_person', studentContact: true, subjects: '数学', fromMonth: '2026-11' });
  assert.equal(await contact(), false, '受講条件書を作っても、保護者の設定は変わらない');
  await h.ok('family/students/contact', { auth: parent, studentId: kid.id, allow: true });
  assert.equal(await contact(), true);
});
