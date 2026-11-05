'use strict';
// 定期実行は朝に動く。請求の確定などのメールを、夜中に保護者へ送らない（2026-11-06 本人）
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

test('the daily job runs at 8:10 JST, not in the middle of the night', () => {
  const m = fs.readFileSync('cf/wrangler.jsonc', 'utf8').match(/"crons":\s*\["(\d+) (\d+) \* \* \*"\]/);
  assert.ok(m, 'one daily cron');
  const jst = (Number(m[2]) + 9) % 24;
  assert.equal(jst, 8);
  assert.equal(Number(m[1]), 10);
});
