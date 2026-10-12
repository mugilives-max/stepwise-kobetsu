'use strict';
// 授業計画の見せ方（assets/v2/plan-view.js）と、目的・教材ごとの回数（planLines.parts、0022_plan_parts.sql）。
// Kura reference/stepwise-plan-presentation-claude-handoff.md の受入条件。データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createV2 } = require('./helpers/v2-harness.cjs');

const pv = () => import(pathToFileURL(path.join(__dirname, '..', 'assets', 'v2', 'plan-view.js')).href);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let seq = 0;
const L = (o = {}) => ({ id: 'pl' + (++seq), studentId: 's1', parentId: '', subject: '数学', kind: '演習', startDate: '2026-11-01', endDate: '2026-11-30', count: 4, minutes: 90, fee: 2500, comment: '', status: 'draft', approvedCount: null, parts: [], ...o });

test('形: 通常・基礎/発展の授業は授業、演習・基礎/発展の演習は演習、講習は講習、ほかは種類の名前のまま', async () => {
  const { formOf } = await pv();
  assert.deepEqual(['通常', '', null, '基礎の授業', '発展の授業', '演習', '基礎の演習', '発展の演習', '講習', '英検準1級対策'].map(k => formOf(k)),
    [{ form: '授業', detail: '' }, { form: '授業', detail: '' }, { form: '授業', detail: '' }, { form: '授業', detail: '基礎の授業' }, { form: '授業', detail: '発展の授業' },
     { form: '演習', detail: '' }, { form: '演習', detail: '基礎の演習' }, { form: '演習', detail: '発展の演習' }, { form: '講習', detail: '' }, { form: 'その他', detail: '英検準1級対策' }]);
});

test('引継ぎの例: 科目ごとに授業・演習の回数、目的ごとの回数、全体の合計が元の行と一致する', async () => {
  const { subjectGroups, planTotals, formsText, planSets, planPreviewHtml } = await pv();
  const lines = [
    L({ subject: '数学', kind: '通常', count: 2, fee: 4500, parts: [{ label: 'テスト対策', count: 2 }], comment: '重要な問題に絞って解き方を学びます' }),
    L({ subject: '数学', kind: '演習', count: 5, fee: 2500, parts: [{ label: '教材の定着', count: 4 }, { label: 'テスト対策', count: 1 }] }),
    L({ subject: '英語', kind: '通常', count: 1, fee: 4500, parts: [{ label: '基本文の理解', count: 1 }] }),
    L({ subject: '英語', kind: '演習', count: 2, fee: 2500, parts: [{ label: '読解練習', count: 2 }] }),
  ];
  const before = JSON.stringify(lines);
  const [math, eng] = subjectGroups(lines);
  assert.equal(formsText(math.forms), '授業 2回／演習 5回');
  assert.deepEqual(math.purposes.map(p => [p.label, formsText(p.forms)]), [['テスト対策', '授業 2回／演習 1回'], ['教材の定着', '演習 4回']]);
  assert.equal(formsText(eng.forms), '授業 1回／演習 2回');
  assert.equal(math.amount, 2 * 4500 + 5 * 2500);
  const t = planTotals(lines);
  assert.equal(formsText(t.forms), '授業 3回／演習 7回');
  assert.equal(t.amount, lines.reduce((s, l) => s + l.count * l.fee, 0), '全体は元の行から直接');
  assert.equal(t.amount, math.amount + eng.amount, '科目の小計の和と同じ（二重に数えない）');
  const sets = planSets(lines);
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].lines.map(l => l.id), lines.map(l => l.id), '元の行の ID と件数はそのまま');
  const html = planPreviewHtml(sets[0], esc, { schedule: lines.map(l => ({ lineId: l.id, assigned: 1, tentative: 0 })) });
  assert.match(html, /授業 3回／演習 7回/);
  assert.match(html, /31,000円/);
  assert.match(html, /日程（計画とは別）/);
  assert.match(html, /日時がまだの回数 1回/);
  assert.equal(JSON.stringify(lines), before, 'まとめても元の行は変わらない');
});

test('まとまり: 期間・状態が違えば別。同じ科目・形でも時間・授業料・種類が違う行は 1 行のまま', async () => {
  const { planSets, subjectGroups } = await pv();
  const lines = [
    L({ status: 'approved', approvedCount: 6, count: 6, startDate: '2026-10-01', endDate: '2026-10-10' }),
    L({ status: 'draft', startDate: '2026-10-13', endDate: '2026-10-31' }),
    L({ status: 'proposed', startDate: '2026-10-13', endDate: '2026-10-31' }),
    L({ status: 'draft', startDate: '2026-10-13', endDate: '2026-10-31', studentId: 's2' }),
  ];
  const sets = planSets(lines);
  assert.deepEqual(sets.map(s => [s.studentId, s.startDate, s.status, s.lines.length]),
    [['s1', '2026-10-01', 'approved', 1], ['s1', '2026-10-13', 'draft', 1], ['s2', '2026-10-13', 'draft', 1], ['s1', '2026-10-13', 'proposed', 1]]);
  assert.equal(sets.reduce((n, s) => n + s.lines.length, 0), lines.length);
  const mixed = [L({ kind: '演習', minutes: 90, fee: 2500, count: 3 }), L({ kind: '演習', minutes: 60, fee: 2000, count: 2 }), L({ kind: '基礎の演習', minutes: 90, fee: 2500, count: 1 })];
  const [g] = subjectGroups(mixed);
  assert.equal(g.lines.length, 3, '条件の違う行を 1 行に潰さない');
  assert.equal(g.forms['演習'], 6);
  assert.equal(g.amount, 3 * 2500 + 2 * 2000 + 2500);
});

test('金額: 承認は承認した回数、見送りは 0。授業料が無い行は「算出できない」、0 円は 0 円', async () => {
  const { planTotals, amountText, lineAmount } = await pv();
  assert.equal(lineAmount(L({ status: 'approved', count: 6, approvedCount: 4, fee: 2500 })), 10000);
  assert.equal(lineAmount(L({ status: 'declined', count: 6, approvedCount: 0 })), 0);
  assert.equal(lineAmount(L({ fee: 0 })), 0);
  for (const fee of [null, undefined, '', 'abc', -1]) assert.equal(lineAmount(L({ fee })), null, String(fee));
  assert.equal(amountText(planTotals([L({ fee: 2500, count: 2 }), L({ fee: null })])), '5,000円＋算出できない行 1件');
  assert.equal(amountText(planTotals([L({ fee: null })])), '算出できません');
  assert.equal(amountText(planTotals([L({ fee: 0 })])), '0円');
});

test('理科・社会のような共通枠は 1 つの科目として数え、理科と社会に分けて二重に数えない', async () => {
  const { subjectGroups, planTotals } = await pv();
  const lines = [L({ subject: '理科・社会', count: 3 }), L({ subject: '数学', count: 2 })];
  const gs = subjectGroups(lines);
  assert.deepEqual(gs.map(g => [g.subject, g.forms['演習']]), [['理科・社会', 3], ['数学', 2]]);
  assert.equal(planTotals(lines).forms['演習'], 5);
});

test('目的の内訳: 足りない分は「内訳なし」、超えた分は知らせる、壊れた値・旧データは内訳なしで読める', async () => {
  const { subjectGroups, subjectInfoHtml, partsOf } = await pv();
  const [g] = subjectGroups([L({ count: 5, parts: [{ label: 'A', count: 3 }] }), L({ kind: '通常', count: 2, parts: '' , comment: '説明だけの旧データ' })]);
  assert.deepEqual(g.unallocated.map(u => [u.form, u.count]), [['演習', 2], ['授業', 2]]);
  const html = subjectInfoHtml(g, esc);
  assert.match(html, /目的の内訳なし/);
  assert.match(html, /説明だけの旧データ/);
  const [o] = subjectGroups([L({ count: 2, parts: [{ label: 'A', count: 3 }] })]);
  assert.equal(o.over.length, 1);
  assert.match(subjectInfoHtml(o, esc), /超えています/);
  assert.deepEqual(partsOf({ parts: '{broken' }), []);
  assert.deepEqual(partsOf({ parts: '[{"label":"","count":2},{"label":"B","count":0},{"label":"C","count":1}]' }), [{ label: 'C', count: 1 }]);
  assert.deepEqual(partsOf({}), []);
  // 承認で回数が減った行は、内訳はお知らせしたときのもの、と書く
  const [r] = subjectGroups([L({ status: 'approved', count: 4, approvedCount: 3, parts: [{ label: 'A', count: 4 }] })]);
  assert.match(subjectInfoHtml(r, esc), /お知らせしたときの内訳/);
  // 名前はエスケープ
  const [x] = subjectGroups([L({ parts: [{ label: '<img src=x onerror=1>', count: 1 }], comment: '<script>' })]);
  const xh = subjectInfoHtml(x, esc);
  assert.doesNotMatch(xh, /<img|<script/);
});

// ---- サーバー: 保存・読み戻し・保護者の画面・先月の写し ----
async function world() {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500 })).student;
  const parent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam.id }), h.mails().at(-1))), password: 'family password 1' })).auth;
  const fam2 = (await h.ok('admin/families/create', { auth, name: '別家', email: 'other@example.invalid' })).family;
  await h.ok('admin/students/create', { auth, familyId: fam2.id, familyName: '別', givenName: '花', baseRate30: 1500 });
  const parent2 = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam2.id }), h.mails().at(-1))), password: 'family password 2' })).auth;
  return { h, auth, kid, fam, parent, parent2 };
}
const base = (studentId, o = {}) => ({ studentId, subject: '数学', kind: '演習', startDate: '2026-11-01', endDate: '2026-11-30', count: 14, minutes: 90, fee: 2500, ...o });

test('目的・教材の内訳: 保存・確かめ・直す・一覧・保護者の画面・先月の写しで同じ内容', async () => {
  const { h, auth, kid, parent, parent2 } = await world();
  const parts = [{ label: '教材の定着', count: 12 }, { label: 'テスト対策', count: 2 }];
  // 確かめ: 合計が回数を超える・同じ名前・空の名前・9 つ以上は保存しない
  for (const bad of [[{ label: 'A', count: 15 }], [{ label: 'A', count: 1 }, { label: 'A', count: 1 }], [{ label: '', count: 1 }], [{ label: 'A', count: 0 }], Array.from({ length: 9 }, (_, i) => ({ label: 'p' + i, count: 1 }))]) {
    assert.equal((await h.call('billing/plans/save', { auth, ...base(kid.id), parts: bad })).error.code, 'badParts', JSON.stringify(bad));
  }
  assert.equal(h.rows('select count(*) n from planLines')[0].n, 0, '断ったときは何も作らない');
  const line = (await h.ok('billing/plans/save', { auth, ...base(kid.id), parts })).line;
  assert.deepEqual(line.parts, parts);
  const other = (await h.ok('billing/plans/save', { auth, ...base(kid.id, { kind: '通常', count: 2, fee: 4500 }) })).line;
  assert.deepEqual(other.parts, [], '内訳なしの行（今までの行と同じ）');
  // 直す: 内訳を送らなければそのまま。回数を内訳の合計より減らすときは止める
  const kept = (await h.ok('billing/plans/save', { auth, id: line.id, version: line.version, comment: '説明を直す' })).line;
  assert.deepEqual(kept.parts, parts);
  assert.equal((await h.call('billing/plans/save', { auth, id: kept.id, version: kept.version, count: 10 })).error.code, 'badParts');
  const cleared = (await h.ok('billing/plans/save', { auth, id: kept.id, version: kept.version, parts: [] })).line;
  assert.deepEqual(cleared.parts, []);
  const again = (await h.ok('billing/plans/save', { auth, id: cleared.id, version: cleared.version, parts })).line;
  // 一覧を何度読んでも、行も版も変わらない
  const snap = JSON.stringify(h.rows('select * from planLines order by id'));
  const list = await h.ok('billing/plans/list', { auth, month: '2026-11' });
  await h.ok('billing/plans/list', { auth, month: '2026-11' });
  assert.equal(JSON.stringify(h.rows('select * from planLines order by id')), snap, '読むだけで書き換えない');
  const mine = list.students.find(s => s.id === kid.id).lines;
  assert.deepEqual(mine.find(l => l.id === again.id).parts, parts);
  // 下書きは保護者に見えない。お知らせしたあとは、同じ内訳が見える。別の家族には見えない
  assert.equal((await h.ok('family/money', { auth: parent })).plans.length, 0);
  await h.ok('billing/plans/send', { auth, studentId: kid.id });
  const fam = (await h.ok('family/money', { auth: parent })).plans;
  assert.deepEqual(Object.fromEntries(fam.map(l => [l.id, l.parts])), { [again.id]: parts, [other.id]: [] });
  assert.equal((await h.ok('family/money', { auth: parent2 })).plans.length, 0, 'ほかの家族の計画は見えない');
  // お知らせ・承認の状態は、見せ方の変更で変わらない
  assert.deepEqual(h.rows('select status from planLines order by id').map(r => r.status), ['proposed', 'proposed']);
});

test('先月と同じ内容で下書き: 目的・教材の内訳も写る（承認で回数が内訳の合計を下回ったら写さない）', async () => {
  const { h, auth, kid } = await world();
  const now = '2026-10-01T00:00:00.000Z';
  await h.env.DB2.prepare("insert into planLines (id, studentId, subject, kind, startDate, endDate, count, minutes, fee, comment, status, approvedCount, parts, createdAt, updatedAt) values ('pa', ?, '数学', '演習', '2026-10-01', '2026-10-31', 6, 90, 2500, '', 'approved', 6, ?, ?, ?), ('pb', ?, '英語', '演習', '2026-10-01', '2026-10-31', 6, 90, 2500, '', 'approved', 3, ?, ?, ?)")
    .bind(kid.id, JSON.stringify([{ label: 'A', count: 4 }, { label: 'B', count: 2 }]), now, now, kid.id, JSON.stringify([{ label: 'C', count: 6 }]), now, now).run();
  await h.ok('billing/plans/copyMonth', { auth, month: '2026-11' });
  const made = h.rows("select subject, count, parts from planLines where startDate = '2026-11-01' order by subject");
  assert.deepEqual(made.map(r => [r.subject, r.count, r.parts]), [['数学', 6, JSON.stringify([{ label: 'A', count: 4 }, { label: 'B', count: 2 }])], ['英語', 3, '']]);
});
