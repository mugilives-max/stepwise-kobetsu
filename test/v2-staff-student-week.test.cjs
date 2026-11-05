'use strict';
// 生徒の概要の「今週の授業」: 7 日分のカレンダーと、合計・科目ごとのコマ数
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const load = () => import('data:text/javascript,' + encodeURIComponent(fs.readFileSync('staff/student-week.js', 'utf8')));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const l = (id, date, start, subject, status, kind = '通常') => ({ id, date, start, subject, status, kind });
const world = (past, upcoming) => ({ today: '2026-11-05', student: { id: 's1' }, past, upcoming });

test('the week runs Sunday to Saturday like the month calendar, across a month end', async () => {
  const { weekDates } = await load();
  assert.deepEqual(weekDates('2026-11-05'), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.equal(weekDates('2026-11-01')[0], '2026-11-01');
  assert.equal(weekDates('2026-11-07')[6], '2026-11-07');
  assert.deepEqual([weekDates('2026-12-31')[0], weekDates('2026-12-31')[6]], ['2026-12-27', '2027-01-02']);
});

test('finished and coming lessons of this week are counted by subject; rests, cancellations and other weeks are not', async () => {
  const { weekBox } = await load();
  const h = weekBox(esc, world(
    [l('a', '2026-11-02', '17:00', '数学', 'done'), l('b', '2026-11-03', '17:00', '英語', 'rested'), l('c', '2026-11-04', '17:00', '英語', 'cancelled'), l('d', '2026-10-31', '17:00', '英語', 'done')],
    [l('e', '2026-11-05', '16:20', '英語', 'decided'), l('f', '2026-11-06', '19:30', '数学', 'proposed', '演習'), l('g', '2026-11-08', '10:00', '数学', 'decided')],
  ));
  assert.match(h, /<strong>3<\/strong>コマ/);
  assert.match(h, /数学 <b>2<\/b>/);
  assert.match(h, /英語 <b>1<\/b>/);
  assert.match(h, /調整中 1/);
  assert.match(h, /wk-d today/);
  assert.match(h, /wk-l tent"[^>]*><b>19:30<\/b>数学<small>演習<\/small>/);
  assert.match(h, /wk-l done"/);
  assert.doesNotMatch(h, /次の授業/, '今週これから授業があれば、次の授業は出さない');
});

test('a lesson in both lists counts once, and an empty week points to the next lesson', async () => {
  const { weekBox, weekLessons } = await load();
  const same = l('a', '2026-11-05', '16:20', '英語', 'decided');
  assert.equal(weekLessons(world([same], [same])).length, 1);
  const h = weekBox(esc, world([], [l('g', '2026-11-12', '10:00', '数学', 'decided')]));
  assert.match(h, /<strong>0<\/strong>コマ/);
  assert.match(h, /次の授業 11\/12 10:00 数学/);
});
