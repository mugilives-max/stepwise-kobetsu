'use strict';
// 作り直し（v2）: 基本指導条件（cf/v2/conditions.mjs、0018_conditions.sql）。お知らせ → 保護者の同意 → 計画の承認。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

async function world() {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', grade: '中3', baseRate30: 1500 })).student;
  const parent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam.id }), h.mails().at(-1))), password: 'family password 1' })).auth;
  const plan = async () => { const line = (await h.ok('billing/plans/save', { auth, studentId: kid.id, subject: '数学', kind: '通常', startDate: '2026-11-01', endDate: '2026-11-30', count: 4, minutes: 90, fee: 4500 })).line; await h.ok('billing/plans/send', { auth, familyId: fam.id }); return line; };
  return { h, auth, fam, kid, parent, plan };
}

test('conditions: the manager proposes, the family must agree before approving a plan, and the student record follows', async () => {
  const { h, auth, fam, kid, parent, plan } = await world();
  assert.deepEqual((await h.ok('family/conditions', { auth: parent })).conditions, { items: [], needs: false }, '条件が無ければ求めない');
  const mails = h.mails().length;
  const c1 = (await h.ok('admin/conditions/propose', { auth, studentId: kid.id, minutes: 90, fee: 4500, deliveryMode: 'in_person', studentContact: true, subjects: '数学・英語', note: '', fromMonth: '2026-11' })).condition;
  assert.deepEqual([c1.no, c1.status, c1.groupSize, c1.studentContact], [1, 'proposed', '教室は講師1名につき生徒最大2名', true]);
  assert.equal(h.mails().length, mails + 1, '保護者にお知らせが 1 通');
  assert.match(h.mails().at(-1).subject, /基本指導条件/);
  const s = h.rows('select baseRate30, deliveryMode, permissions from students where id = ?', kid.id)[0];
  assert.deepEqual([s.baseRate30, s.deliveryMode, JSON.parse(s.permissions).reschedule], [1500, 'in_person', true], '生徒の登録にも写す');

  const fc = (await h.ok('family/conditions', { auth: parent })).conditions;
  assert.equal(fc.needs, true); assert.equal(fc.items[0].latest.id, c1.id); assert.equal(fc.items[0].agreed, null);
  const money = await h.ok('family/money', { auth: parent });
  assert.equal(money.conditions.needs, true, 'お支払いの画面に出る');

  const line = await plan();
  assert.equal((await h.call('family/plans/decide', { consenterName:'架空 保護者', auth: parent, id: line.id, version: line.version + 1, approvedCount: 4 })).error.code, 'needConditions', '同意するまで承認できない');
  assert.equal((await h.call('family/conditions/agree', { consenterName:'架空 保護者', auth: parent, id: c1.id })).error.code, 'needAgree');
  const after = (await h.ok('family/conditions/agree', { consenterName:'架空 保護者', auth: parent, id: c1.id, agree: true })).conditions;
  assert.deepEqual([after.needs, after.items[0].agreed.no, after.items[0].agreed.agreedVia], [false, 1, '保護者ページ']);
  const v = h.rows('select version from planLines where id = ?', line.id)[0].version;
  assert.equal((await h.ok('family/plans/decide', { consenterName:'架空 保護者', auth: parent, id: line.id, version: v, approvedCount: 4 })).line.status, 'approved');

  // 新しい版をお知らせすると、前の合意は残ったまま「同意が要る」に戻る。教室管理者が LINE の承諾を記録できる
  const c2 = (await h.ok('admin/conditions/propose', { auth, studentId: kid.id, minutes: 90, fee: 2500, deliveryMode: 'online', studentContact: false, subjects: '英語', note: '演習が中心のため', fromMonth: '2026-12' })).condition;
  const st = await h.ok('admin/conditions/get', { auth, studentId: kid.id });
  assert.deepEqual([st.latest.no, st.latest.status, st.agreed.no, st.needs, st.history.length], [2, 'proposed', 1, true, 2]);
  assert.deepEqual([st.student.baseRate30, st.student.deliveryMode, st.student.studentContact], [833, 'online', false]);
  assert.equal((await h.call('admin/conditions/record', { auth, id: c2.id, date: '2026-10-20', via: '' })).error.code, 'needVia');
  const rec = await h.ok('admin/conditions/record', { auth, id: c2.id, date: '2026-10-02', consenterName: '架空 保護者', consentedAt: '2026-10-02T12:00:00+09:00', via: 'LINE', note: '母' });
  assert.deepEqual([rec.latest.status, rec.agreed.no, rec.needs], ['agreed', 2, false]);
  assert.equal((await h.call('admin/conditions/record', { auth, id: c2.id, date: '2026-10-21', via: 'LINE' })).error.code, 'closed');
  assert.equal((await h.call('admin/conditions/propose', { auth, studentId: kid.id, minutes: 90, fee: 2500, deliveryMode: 'online', fromMonth: '2026/12' })).error.code, 'badMonth');
  void fam;
});

test('conditions: a teacher cannot propose, another family cannot agree, and the family-get and student-hub carry the state', async () => {
  const { h, auth, fam, kid } = await world();
  const teacher = await h.staffWith(auth, ['teacher'], 'teacher@example.invalid');
  assert.equal((await h.call('admin/conditions/propose', { auth: teacher, studentId: kid.id, minutes: 90, fee: 4500, deliveryMode: 'in_person', fromMonth: '2026-11' })).error.code, 'forbidden');
  const c1 = (await h.ok('admin/conditions/propose', { auth, studentId: kid.id, minutes: 90, fee: 4500, deliveryMode: 'in_person', fromMonth: '2026-11' })).condition;
  const other = (await h.ok('admin/families/create', { auth, name: '別家', email: 'other@example.invalid' })).family;
  const otherParent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: other.id }), h.mails().at(-1))), password: 'family password 2' })).auth;
  assert.equal((await h.call('family/conditions/agree', { consenterName:'架空 保護者', auth: otherParent, id: c1.id, agree: true })).error.code, 'notFound');
  const got = (await h.ok('admin/families/get', { auth, id: fam.id })).family.students[0].condition;
  assert.deepEqual([got.latest.no, got.needs], [1, true]);
  const hub = await h.ok('students/hub', { auth, studentId: kid.id });
  assert.equal(hub.basic.condition.latest.fee, 4500);
});

test('conditions: a written document (HTML, like the invoice template) is stored as a draft and again when agreed, and the family can open it', async () => {
  const { h, auth, kid, parent } = await world();
  const c1 = (await h.ok('admin/conditions/propose', { auth, studentId: kid.id, minutes: 90, fee: 4500, deliveryMode: 'in_person', studentContact: true, subjects: '数学', note: '兄弟割引なし', fromMonth: '2026-11' })).condition;
  assert.ok(c1.docFileId, '案の書面がある');
  const draft = h.rows('select category, name, mime, refType, refId, familyId from files where id = ?', c1.docFileId)[0];
  assert.deepEqual([draft.category, draft.refType, draft.refId, draft.mime], ['contract', 'condition', c1.id, 'text/html; charset=utf-8']);
  assert.match(draft.name, /基本指導条件書_第1版_案/);
  const link = await h.ok('files/link', { auth: parent, id: c1.docFileId });
  const res = await h.raw('GET', link.url.replace(/^.*\/v2\//, ''));
  const html = await res.text();
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /基本指導条件書/); assert.match(html, /4,500円/); assert.match(html, /兄弟割引なし/); assert.match(html, /まだ同意いただいていません/);
  assert.doesNotMatch(html, /<script/);
  await h.ok('family/conditions/agree', { consenterName:'架空 保護者', auth: parent, id: c1.id, agree: true });
  const after = (await h.ok('family/conditions', { auth: parent })).conditions.items[0].agreed;
  assert.notEqual(after.docFileId, c1.docFileId, '同意したら確定の書面がもう 1 つできる');
  const fin = h.rows('select name, note from files where id = ?', after.docFileId)[0];
  assert.match(fin.name, /基本指導条件書_第1版_/); assert.doesNotMatch(fin.name, /_案/); assert.equal(fin.note, '同意済み');
  const html2 = await (await h.raw('GET', (await h.ok('files/link', { auth: parent, id: after.docFileId })).url.replace(/^.*\/v2\//, ''))).text();
  assert.match(html2, /保護者の同意/); assert.match(html2, /保護者ページ/);
});
