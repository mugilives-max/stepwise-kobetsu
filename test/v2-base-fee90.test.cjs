'use strict';
// 通常指導の基準単価を 90 分あたりで持つ（0025_base_fee90.sql、2026-10-14 本人）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

test('基準単価は 90 分の授業料で入れて読み、計画の上限もそれで決まる（30 分で割り切れない額も）', async () => {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseFee90: 4000 })).student;
  assert.deepEqual([kid.baseFee90, kid.baseRate30], [4000, 1333], '30分は互換のための四捨五入');
  const plan = o => h.call('billing/plans/save', { auth, studentId: kid.id, subject: '数学', kind: '通常', startDate: '2026-11-01', endDate: '2026-11-30', count: 4, minutes: 90, ...o });
  assert.equal((await plan({ fee: 4000 })).ok, true, '90分 4,000円まで');
  assert.equal((await plan({ subject: '英語', fee: 4001 })).error.code, 'needSpecial', '超えると特殊指導が要る');
  assert.equal((await plan({ subject: '理科', minutes: 60, fee: 2666 })).ok, true, '60分は 4,000×60÷90 の切り捨て');
  assert.equal((await plan({ subject: '社会', minutes: 60, fee: 2667 })).error.code, 'needSpecial');
  const list = await h.ok('billing/plans/list', { auth, month: '2026-11' });
  assert.equal(list.students.find(s => s.id === kid.id).baseFee90, 4000);
  // 直す: 90分で入れる。古い呼び出し（30分）も × 3 で受ける
  const up = (await h.ok('admin/students/update', { auth, id: kid.id, version: kid.version, baseFee90: 4500 })).student;
  assert.deepEqual([up.baseFee90, up.baseRate30], [4500, 1500]);
  const old = (await h.ok('admin/students/update', { auth, id: kid.id, version: up.version, baseRate30: 1200 })).student;
  assert.deepEqual([old.baseFee90, old.baseRate30], [3600, 1200]);
  assert.equal((await h.call('admin/students/update', { auth, id: kid.id, version: old.version, baseFee90: -1 })).error.code, 'badRate');
});
