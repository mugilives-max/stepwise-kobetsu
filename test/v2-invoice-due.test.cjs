'use strict';
// 支払期限の通常の日（assets/v2/invoice-due.js）。共通規約 r17 以降に同意した家族は請求確定月の末日、それより前の版は15日（第19条3項）
const test = require('node:test');
const assert = require('node:assert/strict');

test('the month-end payment date applies to terms r17 and later, including r18', async () => {
  const { monthEndDue, normalDueDate, invoiceDueText } = await import('../assets/v2/invoice-due.js');
  for (const v of ['2026-11-20261028-r17', '2026-11-20261028-r18']) {
    assert.equal(monthEndDue(v), true);
    assert.equal(normalDueDate('2026-11-03', v), '2026-11-30');
    assert.equal(normalDueDate('2027-02-03', v), '2027-02-28');
  }
  for (const v of ['2026-11-20261028-r16', '2026-11-20261026-r14', '', null]) assert.equal(normalDueDate('2026-11-03', v), '2026-11-15');
  assert.equal(invoiceDueText({ dueDate: '2026-11-30' }), '2026-11-30（期限の日までに振込の手続きをしてください）');
  assert.equal(invoiceDueText({ dueDate: '2026-11-15' }), '2026-11-15（土日祝日の場合は翌営業日）');
});
