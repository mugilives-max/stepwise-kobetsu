'use strict';
// 支払期限の通常の日（assets/v2/invoice-due.js）。新しい請求は授業を実施した月の翌月末日（第19条3項）。規約の版の判断 monthEndDue は書面の文言だけに使う
const test = require('node:test');
const assert = require('node:assert/strict');

test('new invoices are due at the end of the month after the lessons, and issued ones keep their date', async () => {
  const { monthEndDue, normalDueDate, invoiceDueText } = await import('../assets/v2/invoice-due.js');
  for (const v of ['2026-11-20261028-r17', '2026-11-20261028-r18']) assert.equal(monthEndDue(v), true);
  for (const v of ['2026-11-20261028-r16', '2026-11-20261026-r14', '', null]) assert.equal(monthEndDue(v), false);
  assert.equal(normalDueDate('2026-10'), '2026-11-30');
  assert.equal(normalDueDate('2026-11'), '2026-12-31');
  assert.equal(normalDueDate('2026-12'), '2027-01-31');
  assert.equal(normalDueDate('2027-01'), '2027-02-28');
  assert.equal(invoiceDueText({ dueDate: '2026-11-30' }), '2026-11-30（期限の日までに振込の手続きをしてください）');
  assert.equal(invoiceDueText({ dueDate: '2026-11-15' }), '2026-11-15（土日祝日の場合は翌営業日）');
});
