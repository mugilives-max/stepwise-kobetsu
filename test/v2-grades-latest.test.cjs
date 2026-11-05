'use strict';
// 成績の箱: ふだんは最新の回を大きく、過去の一覧とグラフは開いたときだけ（2026-11-05 本人）
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const stub = 'data:text/javascript,' + encodeURIComponent("export const API='';export const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\"/g,'&quot;');");
const load = () => import('data:text/javascript,' + encodeURIComponent(fs.readFileSync('assets/v2/grades-view.js', 'utf8').replace("'/assets/v2/api.js'", JSON.stringify(stub))));
const row = (subject, deviation, score = null, max = null, more = {}) => ({ subject, deviation, score, max, ...more });
const mock = (id, date, total, scores) => ({ id, kind: 'mock', series: '北辰テスト', name: id, date, total: { deviation: total }, scores });
const hokushin = () => [
  mock('3年3回', '2026-07-19', 57.3, [row('英語', 48, 60, 100), row('数学', 63, 70, 100), row('3教科', 57, 190, 300)]),
  mock('3年4回', '2026-09-06', 58.7, [row('英語', 56, 72, 100), row('数学', 60, 66, 100), row('3教科', 62.8, 205, 300)]),
];

test('the latest exam leads, with its difference from the previous one, and the past stays closed', async () => {
  const { trendBox } = await load();
  const h = trendBox(hokushin(), 's1');
  assert.match(h, /最新の結果/);
  assert.match(h, /class="nm">3年4回</);
  assert.match(h, /前回 3年3回 との差/);
  assert.match(h, /class="lb">合計<\/span><span class="v">58\.7<\/span><span class="d up">▲1\.4<\/span>/);
  assert.match(h, /class="lb">英語<\/span><span class="v">56<\/span><span class="d up">▲8<\/span><small>72\/100点<\/small>/);
  assert.match(h, /class="lb">数学<\/span><span class="v">60<\/span><span class="d down">▼3<\/span>/);
  assert.ok(h.indexOf('>3教科<') < h.indexOf('>英語<'), '合計と 3教科を科目より先に');
  assert.match(h, /aria-expanded="false"/);
  assert.match(h, /過去の結果<\/span><small>1回/);
  assert.doesNotMatch(h, /gsum|gchart/, '一覧とグラフは閉じている');
});

test('opening the past shows the table and the chart, and changing the kind of test closes it', async () => {
  const { trendBox, gradesClickShared, gradeSel } = await load();
  assert.equal(gradesClickShared('gv-past', { dataset: { sid: 's2' } }), true);
  const h = trendBox(hokushin(), 's2');
  assert.match(h, /aria-expanded="true"/);
  assert.match(h, /gsum/); assert.match(h, /gchart/);
  gradesClickShared('gv-series', { dataset: { sid: 's2', s: '定期テスト' } });
  assert.equal(gradeSel('s2').past, false);
});

test('one exam has nothing to compare or open', async () => {
  const { trendBox } = await load();
  const h = trendBox(hokushin().slice(1), 's3');
  assert.doesNotMatch(h, /との差|gpast|class="d/);
  assert.match(h, /58\.7/);
  assert.equal(trendBox([], 's3'), '');
});

test('school tests lead with the score, and different full marks are not compared', async () => {
  const { trendBox } = await load();
  const exam = (id, date, score, max) => ({ id, kind: 'regular', series: '定期テスト', name: id, date, total: { score, max, fromSubjects: true }, scores: [row('英語', null, score, max, { average: 62.3, rank: 18, rankOf: 160 })] });
  const same = trendBox([exam('1学期', '2026-07-03', 70, 100), exam('2学期', '2026-10-15', 81, 100)], 's4');
  assert.match(same, /class="lb">英語<\/span><span class="v">81<\/span><span class="d up">▲11<\/span><small>満点 100<\/small><small>平均 62\.3<\/small><small>18位\/160<\/small>/);
  const other = trendBox([exam('1学期', '2026-07-03', 40, 50), exam('2学期', '2026-10-15', 81, 100)], 's4');
  assert.doesNotMatch(other, /class="d/);
});

test('staff can open the latest exam to fix it and open its sheet from the card', async () => {
  const { trendBox } = await load();
  const h = trendBox(hokushin(), 's5', '<b>add</b>', { edit: true, sheets: e => e.id === '3年4回' ? [{ id: 'f1', mime: 'application/pdf' }] : [] });
  assert.match(h, /data-action="gr-edit" data-id="3年4回"/);
  assert.match(h, /data-action="gr-open" data-id="f1"/);
  assert.match(h, /<b>add<\/b>/);
});

test('a dismissed sheet can be brought back from the list', async () => {
  const { fileList } = await load();
  const h = fileList([{ id: 'f1', name: 'a.pdf', status: 'dismissed', createdAt: '2026-11-05T03:35:13.872Z', note: '' }], 'gr-open', f => `<button data-status="new" data-id="${f.id}">戻す</button>`);
  assert.match(h, /data-action="gr-open" data-id="f1"/);
  assert.match(h, /data-status="new" data-id="f1"/);
  assert.doesNotMatch(fileList([{ id: 'f1', name: 'a.pdf', status: 'new', createdAt: '2026-11-05T03:35:13.872Z', note: '' }], 'gr-open'), /data-status/);
});
