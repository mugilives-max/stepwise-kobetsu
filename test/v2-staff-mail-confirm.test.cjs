'use strict';
// 設計の大原則「人にメールが届く操作は、押す前に必ず確かめる」（AGENTS.md、2026-11-04 本人）。
// スタッフの画面で、メールが届く道を呼ぶ前に confirm があることを見張る。メールが届く道を足したら、ここにも足す。
// 確認が別の形のもの: employment/invite（宛先を書いた必須のチェック）、admin/effects/test（代表あて）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = {
  'staff/schedule.js': ['schedule/lessons/ask', 'schedule/lessons/create', 'schedule/lessons/update', 'schedule/lessons/swap', 'schedule/lessons/cancel', 'schedule/lessons/renotify'],
  'staff/students.js': ['schedule/lessons/ask', 'admin/enrollment/offer', 'admin/enrollment/resend', 'admin/withdrawal/save'],
  'staff/billing.js': ['billing/plans/send', 'billing/plans/remind', 'billing/plans/consent', 'billing/confirm', 'billing/void', 'billing/fees/decide', 'billing/fees/relief'],
  'staff/families.js': ['admin/families/invite', 'admin/renewal/offer', 'admin/enrollment/resend', 'admin/conditions/propose', 'admin/conditions/record', 'admin/specials/propose', 'admin/specials/record'],
  'staff/app.js': ['admin/staff/invite', 'admin/staff/reinvite'],
  'staff/extras.js': ['admin/terms/request', 'admin/effects/retry'],
  'staff/payroll.js': ['payroll/confirm'],
};
const WINDOW = 1500; // 呼び出しの前のこの文字数の中に確認があること（確定の前の計算が長い画面がある）

for (const [file, routes] of Object.entries(ROUTES)) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  for (const route of routes) {
    test(`${file}: ${route} asks before sending mail`, () => {
      const calls = [...src.matchAll(new RegExp(`call\\('${route}'`, 'g'))];
      assert.ok(calls.length, '呼び出しが見つかりません（道の名前が変わったら一覧を直す）');
      for (const m of calls) {
        const before = src.slice(Math.max(0, m.index - WINDOW), m.index);
        assert.match(before, /confirm\(/, `${route} の前に confirm がありません`);
      }
    });
  }
}

test('staff/schedule.js: the plain cancel button says mail goes out', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'staff/schedule.js'), 'utf8');
  assert.match(src, /a === 'sch-cancel' && !confirm\('[^']*メール/);
});

test('staff/employment.js: issuing an electronic contract says mail goes out', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'staff/employment.js'), 'utf8');
  assert.match(src, /kind==='em-issue'\)\{if\(.*confirm\('[^']*メール/);
});
