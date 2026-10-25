'use strict';
// 2026-10-25 規約の名前を「ご利用規約」に（r10）。前に出した受講合意書は同じ文字・同じ様式のまま、ご利用規約の版を参照する行だけ新しい名前で出す。
const test = require('node:test');
const assert = require('node:assert/strict');

const line = { id: 'pl_1', version: 1, status: 'approved', startDate: '2026-11-01', endDate: '2026-11-30', subject: '数学', kind: '通常', minutes: 90, fee: 4500, count: 4, approvedCount: 4, instructionType: 'regular', conditionId: 'cond_1', termsVersion: 'v' };
const rec = title => ({ line, studentName: '架空 一郎', studentId: 's1', familyId: 'f1', capturedAt: '2026-10-25T00:00:00.000Z', terms: { version: 'v', title, url: '' } });

test('agreement documents keep the old wording unless the row refers to ご利用規約', async () => {
  const { agreementDocHtml, agreementLayout, AGREEMENT_LAYOUT, AGREEMENT_LAYOUT_R10 } = await import('../cf/v2/agreement-doc-20261016.mjs');
  assert.equal(agreementLayout([rec('受講規約（2026年11月版）')]), AGREEMENT_LAYOUT);
  assert.equal(agreementLayout([rec('')]), AGREEMENT_LAYOUT, '規約の版がない行も前の様式');
  assert.equal(agreementLayout([rec('ご利用規約（2026年11月版・10月25日改訂）')]), AGREEMENT_LAYOUT_R10);
  const old = agreementDocHtml({ records: [rec('受講規約（2026年11月版）')], documentId: 'AG-x' });
  assert.match(old, /適用される受講規約に基づき/); assert.match(old, new RegExp('書類様式：' + AGREEMENT_LAYOUT));
  const now = agreementDocHtml({ records: [rec('ご利用規約（2026年11月版・10月25日改訂）')], documentId: 'AG-y' });
  assert.match(now, /適用されるご利用規約に基づき/); assert.doesNotMatch(now, /受講規約/); assert.match(now, new RegExp('書類様式：' + AGREEMENT_LAYOUT_R10));
});
