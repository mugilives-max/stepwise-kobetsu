'use strict';
// 作り直し（v2）: 書類のひな形（cf/v2/docs-sample.mjs）。教室管理者が、架空の家族で描いた各書面を開ける。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

test('docs sample: each stored document can be previewed with sample data by a manager only', async () => {
  const h = await createV2(); const auth = await h.owner();
  await h.ok('admin/billing/settings/set', { auth, bank: '見本銀行 見本支店 普通 0000000', note: '' });
  const expect = { condition: /受講条件書（通常指導）[\s\S]*見本 太郎[\s\S]*4,500円/, special: /受講条件書（特殊指導）[\s\S]*英検準1級対策[\s\S]*7,000円/, invoice: /請求書[\s\S]*見本家[\s\S]*19,000[\s\S]*見本銀行/, receipt: /領収書[\s\S]*19,000/, employment: /見本・架空の講師です[\s\S]*雇用契約書（兼 労働条件通知書）[\s\S]*見本 講師[\s\S]*2026-11-01から2027-03-31まで[\s\S]*週5〜6時間ほど。/ };
  for (const [type, re] of Object.entries(expect)) {
    const r = await h.ok('admin/docs/sample', { auth, type });
    assert.match(r.html, re, type); assert.doesNotMatch(r.html, /<script/, type);
  }
  assert.equal((await h.call('admin/docs/sample', { auth, type: 'plan' })).error.code, 'badType');
  const teacher = await h.staffWith(auth, ['teacher'], 'teacher@example.invalid');
  assert.equal((await h.call('admin/docs/sample', { auth: teacher, type: 'invoice' })).error.code, 'forbidden');
});
