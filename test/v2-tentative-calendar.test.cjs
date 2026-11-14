'use strict';
// 調整中・確認待ちの授業を、毎晩 22 時に代表のカレンダーへ写す（2026-11-14 本人「調整中の授業も１日の終わりとかにカレンダーに反映してほしい」）。cf/v2/tentative-calendar.mjs
// - 調整中・確認待ちが【調整中】【確認待ち】の題名で入る（下書きは設定で選んだときだけ）。【塾】は付けない（Kura が授業として数えるため）
// - 日時が変われば作り直し、お休み・キャンセル・削除で消え、確定するとその場で消えて【塾】の予定に替わる
// - 保護者・生徒へのメールは 1 通も増えない
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

const GOOGLE_ID = /^[a-v0-9]{5,1024}$/;
const GAS = { GAS_URL: 'https://gas.example.invalid', SYNC_KEY: 'x'.repeat(30) };
// Apps Script（gas-effects/Code.gs）の代わり。カレンダーを Map で持つ（予定 ID の規則と、消えた ID を使い回せないことも Google と同じに確かめる）
function fakeCalendar() {
  const events = new Map(), used = new Set(), calls = [];
  const fetcher = async (url, init) => {
    const req = JSON.parse(init.body), writebacks = [], results = [];
    for (const it of req.items) {
      calls.push(it.kind);
      let status = 'sent', error = '';
      if (it.kind === 'calendarCreate') {
        if (!GOOGLE_ID.test(String(it.body.id || '')) || used.has(it.body.id)) { status = 'failed'; error = 'Invalid or duplicate id'; }
        else { used.add(it.body.id); events.set(it.body.id, it.body); writebacks.push({ marker: it.marker, eventId: it.body.id + '@google.com', meetUrl: '' }); }
      } else if (it.kind === 'calendarDelete') events.delete(String(it.eventId).split('@')[0]);
      else if (it.kind === 'mail') calls.push('MAIL:' + it.to);
      results.push({ id: it.deliveryId, status, error });
    }
    return { ok: true, json: async () => ({ ok: true, done: results.filter(r => r.status === 'sent').length, writebacks, failed: [], results }) };
  };
  return { events, calls, fetcher, titles: () => [...events.values()].map(e => e.summary).sort() };
}

async function world() {
  const h = await createV2(); const auth = await h.owner();
  h.db2._sqlite.prepare("insert into settings (key, value, updatedAt) values ('live', '1', '')").run();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500, deliveryMode: 'in_person' })).student;
  const me = (await h.ok('staff/me', { auth })).me;
  const base = { auth, studentId: kid.id, minutes: 90, subject: '数学', deliveryMode: 'in_person', staffId: me.id };
  const { syncTentativeCalendar } = await import('../cf/v2/tentative-calendar.mjs');
  const cal = fakeCalendar();
  const sync = () => syncTentativeCalendar(GAS, h.env.DB2, h.clock, cal.fetcher);
  const lessonAt = (date, start) => h.rows('select * from lessons where date = ? and start = ?', date, start)[0];
  const mailCount = () => h.rows("select count(*) n from effects where kind = 'mail'")[0].n;
  return { h, auth, kid, base, cal, sync, lessonAt, mailCount };
}

test('調整中・確認待ちが入り、下書きは入らない。題名・色・予定なしで確定と見分けられ、メールは増えない', async () => {
  const { h, base, cal, sync, mailCount } = await world();
  await h.ok('schedule/lessons/create', { ...base, date: '2026-10-09', start: '18:00', send: 'show' });
  await h.ok('schedule/lessons/create', { ...base, date: '2026-10-10', start: '18:00', send: 'ask' });
  await h.ok('schedule/lessons/create', { ...base, date: '2026-10-11', start: '18:00', send: 'hold' });
  const mails = mailCount();
  const r = await sync();
  assert.deepEqual([r.created, r.sent, r.failed], [2, 2, 0]);
  assert.deepEqual(cal.titles(), ['【確認待ち】架空 一郎さん 数学 (対面)', '【調整中】架空 一郎さん 数学 (対面)']);
  for (const e of cal.events.values()) {
    assert.equal(e.transparency, 'transparent');
    assert.equal(e.colorId, '8');
    assert.deepEqual(e.reminders, { useDefault: false, overrides: [] });
    assert.doesNotMatch(e.summary, /【塾】/);
    assert.ok(!e.conferenceData);
  }
  const one = [...cal.events.values()].find(e => e.summary.startsWith('【調整中】'));
  assert.equal(one.start.dateTime, '2026-10-09T09:00:00.000Z');
  assert.equal(one.end.dateTime, '2026-10-09T10:30:00.000Z');
  assert.equal(mailCount(), mails, 'メールは増えない');
  assert.ok(!cal.calls.some(k => k.startsWith('MAIL')));
  // 2 回目は何もしない
  const again = await sync();
  assert.deepEqual([again.kept, again.created, again.recreated, again.deleted], [2, 0, 0, 0]);
  assert.equal(cal.events.size, 2);
});

test('日時を変えると作り直し、お休み・削除で消え、確定するとその場で消えて【塾】に替わる', async () => {
  const { h, auth, base, cal, sync, lessonAt } = await world();
  await h.ok('schedule/lessons/create', { ...base, date: '2026-10-09', start: '18:00', send: 'show' });
  await h.ok('schedule/lessons/create', { ...base, date: '2026-10-10', start: '18:00', send: 'show' });
  await h.ok('schedule/lessons/create', { ...base, date: '2026-10-12', start: '18:00', send: 'show' });
  await h.ok('schedule/lessons/create', { ...base, date: '2026-10-13', start: '18:00', send: 'show' });
  await sync();
  assert.equal(cal.events.size, 4);
  // 日時の変更
  let l = lessonAt('2026-10-09', '18:00');
  await h.ok('schedule/lessons/update', { ...base, id: l.id, version: l.version, date: '2026-10-09', start: '19:00' });
  // お休み
  l = lessonAt('2026-10-12', '18:00');
  await h.ok('schedule/lessons/rest', { auth, id: l.id, version: l.version });
  // 入力ミスの削除
  l = lessonAt('2026-10-13', '18:00');
  await h.ok('schedule/lessons/delete', { auth, id: l.id, version: l.version });
  const r = await sync();
  assert.deepEqual([r.recreated, r.deleted, r.kept], [1, 2, 1]);
  assert.equal(cal.events.size, 2);
  assert.ok([...cal.events.values()].some(e => e.start.dateTime === '2026-10-09T10:00:00.000Z'));
  // 確定: その場で調整中の予定を消し、【塾】の予定を作る（次の晩を待たない）
  l = lessonAt('2026-10-10', '18:00');
  const tent = h.rows('select eventId from tentativeEvents where lessonId = ?', l.id)[0].eventId;
  await h.ok('schedule/lessons/decide', { auth, id: l.id, version: l.version });
  const queued = h.rows("select payload from effects where status = 'pending' and kind like 'calendar%' order by id").map(x => JSON.parse(x.payload));
  assert.deepEqual(queued.map(x => x.kind), ['calendarDelete', 'calendarCreate']);
  assert.equal(queued[0].eventId, tent);
  assert.match(queued[1].body.summary, /^【塾】/);
  assert.equal(h.rows('select count(*) n from tentativeEvents where lessonId = ?', l.id)[0].n, 0);
  const after = await sync();
  assert.deepEqual([after.created, after.deleted, after.kept], [0, 0, 1]);
});

test('設定で下書きも入れる・止める。テスト用の家族の授業と、過ぎた授業には触らない', async () => {
  const { h, auth, base, cal, sync } = await world();
  await h.ok('schedule/lessons/create', { ...base, date: '2026-10-09', start: '18:00', send: 'show' });
  await h.ok('schedule/lessons/create', { ...base, date: '2026-10-11', start: '18:00', send: 'hold' });
  const tf = (await h.ok('admin/families/create', { auth, name: 'テスト家', email: 'test@example.invalid' })).family;
  h.db2._sqlite.prepare('update families set testOnly = 1 where id = ?').run(tf.id);
  const tk = (await h.ok('admin/students/create', { auth, familyId: tf.id, familyName: '【テスト】', givenName: '花子', baseRate30: 1500, deliveryMode: 'in_person' })).student;
  await h.ok('schedule/lessons/create', { ...base, studentId: tk.id, date: '2026-10-09', start: '20:00', send: 'show' });
  await sync();
  assert.deepEqual(cal.titles(), ['【調整中】架空 一郎さん 数学 (対面)']);
  h.db2._sqlite.prepare("insert into settings (key, value, updatedAt) values ('calendarTentative', 'held', '')").run();
  await sync();
  assert.deepEqual(cal.titles(), ['【下書き】架空 一郎さん 数学 (対面)', '【調整中】架空 一郎さん 数学 (対面)']);
  // 10/9 の授業が過ぎたあと（10/10 の夜）: 過ぎた予定は残し、表から外すだけ
  h.clock = Date.parse('2026-10-10T13:00:00Z');
  const r = await sync();
  assert.deepEqual([r.forgotten, r.deleted, r.kept], [1, 0, 1]);
  assert.equal(cal.events.size, 2);
  h.db2._sqlite.prepare("update settings set value = 'off' where key = 'calendarTentative'").run();
  const off = await sync();
  assert.deepEqual([off.mode, off.deleted], ['off', 1]);
  assert.deepEqual(cal.titles(), ['【調整中】架空 一郎さん 数学 (対面)']); // 過ぎた 10/9 の予定だけが残る
});

test('作成が送れなかった予定は、次の晩に新しい ID で作り直す（前の頼みは取り下げ、二重にしない）', async () => {
  const { h, base, cal, sync } = await world();
  await h.ok('schedule/lessons/create', { ...base, date: '2026-10-09', start: '18:00', send: 'show' });
  const { syncTentativeCalendar } = await import('../cf/v2/tentative-calendar.mjs');
  const down = async () => { throw new Error('network down'); };
  const r = await syncTentativeCalendar(GAS, h.env.DB2, h.clock, down);
  assert.equal(r.sent, 0);
  const first = h.rows('select * from tentativeEvents')[0];
  assert.equal(h.rows('select status from effects where id = ?', first.effectId)[0].status, 'failed');
  h.db2._sqlite.prepare("update effects set deliveryState = 'failed' where id = ?").run(first.effectId); // 未送信と確かめられたもの
  const again = await sync();
  assert.deepEqual([again.recreated, again.sent], [1, 2]); // 前の ID の削除（無ければそのまま）と、新しい作成
  assert.equal(cal.events.size, 1);
  assert.equal(h.rows('select status from effects where id = ?', first.effectId)[0].status, 'dismissed');
  assert.notEqual(h.rows('select eventId from tentativeEvents')[0].eventId, first.eventId);
});
