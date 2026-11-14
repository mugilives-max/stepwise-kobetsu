'use strict';
// 学年・保護者の氏名は新しい形式だけ（2026-11-14 本人「以前のデータ形式を廃止して、新方式に統一」）。
// 学年は選択肢の値（中3・高1 …）、保護者の氏名は姓・名・ふりがなを分けて持つ。前の書き方（「中学３年生」・1 つの文の氏名）は受け付けない
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

test('grades: only the choices are stored; the old long forms are refused everywhere they are written', async () => {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, guardianFamilyName: '【テスト】架空', guardianGivenName: '花子' })).family;
  for (const grade of ['中学３年生', '中３', '高校1年']) assert.equal((await h.call('admin/students/create', { auth, familyId: fam.id, familyName: '【テスト】架空', givenName: '一郎', grade })).error.code, 'badGrade', grade);
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '【テスト】架空', givenName: '一郎', grade: '中3', baseRate30: 1500 })).student;
  assert.equal(kid.grade, '中3');
  assert.equal((await h.call('admin/students/update', { auth, id: kid.id, version: kid.version, grade: '中学３年生' })).error.code, 'badGrade');
  assert.equal((await h.call('admin/trials/create', { auth, familyName: '【テスト】体験', grade: '中学2年' })).error.code, 'badGrade');
  assert.ok((await h.ok('admin/trials/create', { auth, familyName: '【テスト】体験', grade: '' })).studentId, '学年は空でもよい');
});

test('guardian name: only family/given parts are accepted; the single-string name is derived from them', async () => {
  const h = await createV2(); const auth = await h.owner();
  assert.equal((await h.call('admin/families/create', { auth, guardianName: '【テスト】架空花子' })).error.code, 'splitName');
  const fam = (await h.ok('admin/families/create', { auth, guardianFamilyName: '【テスト】架空', guardianGivenName: '花子', guardianFamilyKana: 'かくう', guardianGivenKana: 'はなこ' })).family;
  assert.deepEqual([fam.guardianName, fam.guardianKana], ['【テスト】架空 花子', 'かくう はなこ']);
  assert.equal((await h.call('admin/families/update', { auth, id: fam.id, version: fam.version, guardianName: '別の名前' })).error.code, 'splitName');
  const up = (await h.ok('admin/families/update', { auth, id: fam.id, version: fam.version, guardianGivenName: '春子' })).family;
  assert.deepEqual([up.guardianFamilyName, up.guardianGivenName, up.guardianName], ['【テスト】架空', '春子', '【テスト】架空 春子']);
});
