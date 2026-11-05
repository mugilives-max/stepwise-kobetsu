'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createSchedulingHarness } = require('./helpers/scheduling-harness.cjs');
const json = v => JSON.parse(JSON.stringify(v));
const save = (h, args) => h.admin('planLineSave', { studentId: 'test-a', subject: '英語', kind: '通常', count: 4, startDate: '2026-09-01', endDate: '2026-09-30', lessonMin: 90, lessonFee: 4500, comment: '', ...args });

test('student state lists proposed and approved lines whose period reaches this month, newest first, with comments', () => {
  const h = createSchedulingHarness();
  assert.deepEqual(json(h.context().studentState_('synthetic-link-a').planLines), []);
  h.approve({ ym: '2026-09', count: 4, subject: '英語', comment: '定期テスト対策で\r\n文法を固めます' });
  const r = save(h, { subject: '数学', startDate: '2026-09-22', endDate: '2026-10-05', count: 3, propose: true, comment: '入試の過去問' }); assert.equal(r.ok, true, JSON.stringify(r));
  const d = save(h, { subject: '国語', startDate: '2026-10-01', endDate: '2026-10-31', count: 2 }); assert.equal(d.ok, true, JSON.stringify(d));
  const old = save(h, { subject: '英語', startDate: '2026-08-01', endDate: '2026-08-31', count: 2, propose: true }); assert.equal(old.ok, true, JSON.stringify(old));
  const state = json(h.context().studentState_('synthetic-link-a'));
  assert.deepEqual(state.planLines.map(l => [l.subject, l.kind, l.count, l.period, l.status, l.lessonMin, l.lessonFee, l.comment]), [
    ['数学', '', 3, '2026/9/22〜10/5', 'proposed', 90, undefined, '入試の過去問'],
    ['英語', '', 4, '2026年9月', 'approved', 90, undefined, '定期テスト対策で\n文法を固めます']
  ]);
  assert.equal(state.planLines[1].approvedCount, 4);
  assert.deepEqual(state.plan, { '英語': 4, '数学': 3 }); assert.equal(state.planStatus, 'proposed');
  assert.deepEqual(json(h.context().studentState_('synthetic-link-b').planLines), []);
  const c = h.context(); const parent = json(c.parentDataForStudent_(c.findStudent_('test-a')));
  assert.deepEqual(parent.data.planLines.map(l => l.subject + ':' + l.startDate), ['数学:2026-09-22', '英語:2026-09-01', '英語:2026-08-01'], '保護者には、期間の過ぎた承認待ち（8月）も出す。生徒には出さない');
});

const {studentReady,state,line}=require('./helpers/operations-ui-harness.cjs');
test('student API exposes learning fields only including the teacher student preview',()=>{
 const h=createSchedulingHarness();save(h,{propose:true});const c=h.context();
 const st=json(c.studentState_('synthetic-link-a'));
 assert.doesNotMatch(JSON.stringify(st),/"(?:lessonFee|rate30|monthly|amount|billing|memo|parentAckMemo)"/);
 assert.equal(c.parentDataForStudent_(c.findStudent_('test-a')).data.planLines[0].lessonFee,4500);
});

// 計画と実施状況は常時表示の1つの節にまとめた（6f28c56）。登録回数は実施済み＋確定した予定（5dd85b6）

