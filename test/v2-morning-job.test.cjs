'use strict';
// 定期実行は朝に動く。請求の確定などのメールを、夜中に保護者へ送らない（2026-11-06 本人）
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

test('the daily job runs at 8:10 JST, not in the middle of the night', () => {
  const m = fs.readFileSync('cf/wrangler.jsonc', 'utf8').match(/"crons":\s*\["(\d+) (\d+) \* \* \*"(?:,\s*"0 13 \* \* \*")?\]/);
  assert.ok(m, 'the morning cron first (and only the 22:00 calendar cron besides)');
  const jst = (Number(m[2]) + 9) % 24;
  assert.equal(jst, 8);
  assert.equal(Number(m[1]), 10);
});

// 22:00 JST の定時は、調整中の授業を代表のカレンダーへ写すだけ（2026-11-14）。保護者へのメールや請求などの朝の処理は動かさない
test('the 22:00 JST cron only runs the tentative calendar copy', () => {
  const src = fs.readFileSync('cf/worker/index.mjs', 'utf8');
  assert.match(src, /const NIGHTLY_CRON = "0 13 \* \* \*";/);
  assert.match(src, /if \(event && event\.cron === NIGHTLY_CRON\) \{ await runV2Nightly\(env\); return; \}/);
  const v2 = fs.readFileSync('cf/v2/index.mjs', 'utf8'), body = v2.slice(v2.indexOf('export async function runV2Nightly'), v2.indexOf('export async function runV2Scheduled'));
  assert.match(body, /syncTentativeCalendar/);
  assert.doesNotMatch(body, /retryFailedEffects|autoCloseInvoices|familyNotice|mail/);
});
