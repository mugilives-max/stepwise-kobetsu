'use strict';
// 管理画面の「生徒一覧」「計画」: カードではなく1人1行の一覧。
const test = require('node:test'), assert = require('node:assert/strict');
const { createUI, flush } = require('./helpers/operations-ui-harness.cjs');
const { createBillingHarness } = require('./helpers/billing-harness.cjs');

const student = (o = {}) => ({ id: 'test-a', name: '【テスト】A', grade: '中2', school: '架空中', status: '在籍', doneThisMonth: 1, bookedThisMonth: 3, plannedThisMonth: 4, feeThisMonth: 4500, planStatus: 'approved', planNext: { status: 'proposed', total: 4 }, next: { date: '2026-10-07', start: '17:00' }, unpaid: 0, ...o });
const dashboard = (students, extra = {}) => ({ today: '2026-10-01', month: '2026-10', nextMonth: '2026-11', students, inactive: [], lessonKinds: [], ...extra });
async function open(hash, data) {
  const ui = createUI('admin', { hash, now: '2026-10-01T12:00:00+09:00' });
  for (const r of ui.requests) {
    if (r.body.op === 'kanriDashboard') r.reply({ ok: true, data });
    else if (r.body.op === 'familyList') r.reply({ ok: true, families: [], students: [], paymentReports: [] });
  }
  await flush(); return ui;
}



test('the dashboard reports next month plan status for each student', () => {
  const h = createBillingHarness();
  const save = (ym, end, propose) => { const r = h.admin('planLineSave', { studentId: 'test-a', subject: '数学', kind: '通常', count: 3, startDate: ym + '-01', endDate: ym + '-' + end, lessonMin: 60, lessonFee: 3000, propose }); assert.ok(r.ok, JSON.stringify(r)); };
  save('2026-09', '30', false); save('2026-10', '31', true);
  const d = h.admin('kanriDashboard').data, a = d.students.find(s => s.id === 'test-a'), b = d.students.find(s => s.id === 'test-b');
  assert.equal(d.month, '2026-09'); assert.equal(d.nextMonth, '2026-10');
  assert.equal(a.planStatus, 'draft'); assert.deepEqual(JSON.parse(JSON.stringify(a.planNext)), { status: 'proposed', total: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(b.planNext)), { status: 'none', total: 0 });
});

