'use strict';
// 学年の書き方をそろえる（assets/v2/grade-options.js の normGrade。2026-10-29 本人「学年の表示スタイルが統一されていない」）
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createV2 } = require('./helpers/v2-harness.cjs');

test('long grade forms from the old ledger are shown in the short form used by the choices', async () => {
  const { normGrade } = await import(pathToFileURL(path.join(__dirname, '..', 'assets', 'v2', 'grade-options.js')).href);
  assert.deepEqual(['中学３年生', '高校１年生', '小学６年生', '中３', '高等学校2年', '中3', '既卒', ''].map(normGrade), ['中3', '高1', '小6', '中3', '高2', '中3', '既卒', '']);
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500 })).student;
  h.db2._sqlite.prepare("update students set grade = '中学３年生' where id = ?").run(kid.id); // 前の台帳から移した書き方
  assert.equal((await h.ok('students/list', { auth })).families[0].students[0].grade, '中3');
  assert.equal((await h.ok('students/hub', { auth, studentId: kid.id })).student.grade, '中3');
});
