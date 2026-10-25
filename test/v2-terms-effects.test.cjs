'use strict';
// 作り直し（v2）: 受講規約の版と同意（cf/v2/terms.mjs、0016_terms.sql）と、送れなかったメール・カレンダー（cf/v2/effects-admin.mjs）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');

const at = s => Date.parse(s + '+09:00');
async function world() {
  const h = await createV2(); const auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name: '架空家', email: 'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId: fam.id, familyName: '架空', givenName: '一郎', baseRate30: 1500 })).student;
  const parent = (await h.ok('family/invite/accept', { token: h.linkFrom((await h.ok('admin/families/invite', { auth, id: fam.id }), h.mails().at(-1))), password: 'family password 1' })).auth;
  const plan = async () => { const line = (await h.ok('billing/plans/save', { auth, studentId: kid.id, subject: '数学', kind: '通常', startDate: '2026-11-01', endDate: '2026-11-30', count: 4, minutes: 90, fee: 4500 })).line; await h.ok('billing/plans/send', { auth, familyId: fam.id }); return h.rows('select * from planLines where id = ?', line.id)[0]; };
  return { h, auth, fam, kid, parent, plan };
}
// 送る先（Apps Script）のふり。reply が関数なら呼ぶたびに決める
function withFetch(reply, fn) {
  const original = globalThis.fetch, asked = [];
  globalThis.fetch = async (url, init) => { asked.push(JSON.parse(init.body)); const r = typeof reply === 'function' ? reply(asked.length) : reply; return { ok: true, status: 200, json: async () => ({writebacks:[],results:asked.at(-1).items.map(it=>({id:it.deliveryId,status:r.fail?'failed':'sent',error:r.fail?'GAS error (not sent)':''}))}) }; };
  return fn().finally(() => { globalThis.fetch = original; }).then(() => asked);
}

test('terms: deciding the version asks nobody; families asked to agree must agree before approving a plan', async () => {
  const { h, auth, parent, plan } = await world();
  const empty = (await h.ok('family/terms', { auth: parent })).terms;
  assert.equal(empty.current.version, ''); assert.equal(empty.agreed.version, ''); assert.equal(empty.needs, false); assert.deepEqual(empty.history, []);
  const l1 = await plan();
  assert.equal((await h.ok('family/plans/decide', { consenterName:'架空 保護者', auth: parent, id: l1.id, version: l1.version, approvedCount: 4 })).line.status, 'approved', '版がなければ同意なしで承認できる');
  assert.equal((await h.call('admin/terms/set', { auth, version: '2026-11', title: '' })).error.code, 'needTitle');
  assert.equal((await h.call('admin/terms/set', { auth, version: '2026-11', title: '受講規約', url: 'http://insecure' })).error.code, 'badUrl');
  const set = await h.ok('admin/terms/set', { auth, version: '2026-11', title: '受講規約（2026年11月版）', url: 'https://example.invalid/terms.pdf', from: '2026-11-01', note: '取消料の決まりが新しくなります' });
  assert.equal(set.terms.version, '2026-11');
  const before = (await h.ok('family/money', { auth: parent })).terms;
  assert.deepEqual([before.needs, before.request, before.current.title], [false, null, '受講規約（2026年11月版）'], '決めただけでは、今の家族に同意のお願いは出ない');
  const l2 = (await h.ok('billing/plans/save', { auth, studentId: l1.studentId, subject: '英語', kind: '通常', startDate: '2026-11-01', endDate: '2026-11-30', count: 4, minutes: 90, fee: 4500 })).line;
  const fam = (await h.ok('family/me', { auth: parent })).me.id;
  await h.ok('billing/plans/send', { auth, familyId: fam });
  const cur = () => h.rows('select * from planLines where id = ?', l2.id)[0];
  // 家族を選んで同意をお願いする（一言とメール）
  assert.equal((await h.call('admin/terms/request', { auth, familyIds: [] })).error.code, 'needFamilies');
  const mails = h.mails().length;
  const asked = await h.ok('admin/terms/request', { auth, familyIds: [fam, fam], note: '11月からのきまりです', mail: true });
  assert.deepEqual([asked.requested, asked.mailed, asked.skipped], [1, 1, 0]);
  assert.equal(h.mails().length, mails + 1); assert.match(h.mails().at(-1).subject, /ご利用規約への同意のお願い/); assert.match(h.mails().at(-1).body, /11月からのきまりです/);
  assert.equal((await h.call('admin/terms/request', { auth, familyIds: [fam] })).error.code, 'nothingToRequest', 'お願い中の家族には重ねない');
  const t = (await h.ok('family/money', { auth: parent })).terms;
  assert.deepEqual([t.needs, t.current.note, t.agreed.version, !!t.request], [true, '11月からのきまりです', '', true]);
  assert.deepEqual((await h.ok('admin/terms/get', { auth })).requests.map(r => [r.familyId, r.mailed]), [[fam, 1]]);
  // 取り下げると消え、もう一度お願いできる
  await h.ok('admin/terms/request/withdraw', { auth, familyId: fam });
  assert.equal((await h.ok('family/terms', { auth: parent })).terms.needs, false);
  assert.throws(() => h.db2._sqlite.prepare("update termsRequests set status = 'open'").run(), /immutable/, '取り下げた記録は戻さない');
  assert.throws(() => h.db2._sqlite.prepare('delete from termsRequests').run(), /retain/);
  await h.ok('admin/terms/request', { auth, familyIds: [fam] });
  assert.equal(h.mails().length, mails + 1, 'メールは望んだときだけ');
  assert.equal((await h.call('family/plans/decide', { consenterName:'架空 保護者', auth: parent, id: l2.id, version: cur().version, approvedCount: 4 })).error.code, 'needTerms', '同意していないと承認できない');
  assert.equal((await h.ok('family/plans/decide', { consenterName:'架空 保護者', auth: parent, id: l2.id, version: cur().version, approvedCount: 0 })).line.status, 'declined', '見送りは同意がなくてもよい');
  assert.equal((await h.call('family/terms/accept', { consenterName:'架空 保護者', auth: parent, version: '2026-11' })).error.code, 'needAgree');
  assert.equal((await h.call('family/terms/accept', { consenterName:'架空 保護者', auth: parent, version: '2026-10', agree: true })).error.code, 'staleVersion');
  const acc = await h.ok('family/terms/accept', { consenterName:'架空 保護者', auth: parent, version: '2026-11', agree: true });
  assert.deepEqual([acc.terms.needs, acc.terms.agreed.version], [false, '2026-11']);
  assert.deepEqual(h.rows('select version, via, actorKind from termsConsents').map(r => [r.version, r.via, r.actorKind]), [['2026-11', '保護者ページ', 'family']]);
  // 同意したあとの承認は、行に版が残る
  const l3 = (await h.ok('billing/plans/save', { auth, studentId: l1.studentId, subject: '国語', kind: '通常', startDate: '2026-11-01', endDate: '2026-11-30', count: 2, minutes: 90, fee: 4500 })).line;
  await h.ok('billing/plans/send', { auth, familyId: (await h.ok('family/me', { auth: parent })).me.id });
  const c3 = h.rows('select * from planLines where id = ?', l3.id)[0];
  const ok = await h.ok('family/plans/decide', { consenterName:'架空 保護者', auth: parent, id: l3.id, version: c3.version, approvedCount: 2 });
  assert.deepEqual([ok.line.status, ok.line.termsVersion], ['approved', '2026-11']);
  // 版を変えても、お願いするまでは同意は要らない。お願いすると要る。教室管理者が書面の同意を記録できる
  await h.ok('admin/terms/set', { auth, version: '2026-12', title: '受講規約（12月版）', url: '' });
  assert.equal((await h.ok('family/terms', { auth: parent })).terms.needs, false);
  const fid = (await h.ok('family/me', { auth: parent })).me.id;
  await h.ok('admin/terms/request', { auth, familyIds: [fid] });
  assert.equal((await h.ok('family/terms', { auth: parent })).terms.needs, true);
  assert.equal((await h.call('admin/families/terms', { auth, id: fid, date: '2026-11-20' })).error.code, 'needVia');
  const rec = await h.ok('admin/families/terms', { auth, id: fid, date: '2026-10-02', consenterName: '架空 保護者', consentedAt: '2026-10-02T12:00:00+09:00', via: '書面', note: '面談で署名' });
  assert.deepEqual([rec.terms.needs, rec.terms.agreed.version, rec.terms.agreed.at], [false, '2026-12', '2026-10-02T03:00:00.000Z']);
  const g = await h.ok('admin/terms/get', { auth });
  assert.deepEqual([g.terms.version, g.families, g.history.length, g.history[0].via], ['2026-12', { total: 1, agreed: 1 }, 2, '書面']);
  const f = (await h.ok('admin/families/get', { auth, id: fid }));
  assert.deepEqual([f.terms.version, f.family.termsVersion], ['2026-12', '2026-12']);
  // 先生が LINE の承諾を記録した行にも、そのときの版が残る
  const l4 = (await h.ok('billing/plans/save', { auth, studentId: l1.studentId, subject: '理科', kind: '通常', startDate: '2026-12-01', endDate: '2026-12-31', count: 2, minutes: 90, fee: 4500 })).line;
  await h.ok('billing/plans/consent', { auth, id: l4.id, version: h.rows('select version from planLines where id = ?', l4.id)[0].version, consentDate: '2026-10-02', consenterName: '架空 保護者', consentedAt: '2026-10-02T12:00:00+09:00', via: 'LINE' });
  assert.equal(h.rows('select termsVersion from planLines where id = ?', l4.id)[0].termsVersion, '2026-12');
});

test('effects: failed mail shows up for the manager, can be re-sent, and the nightly run retries up to 3 times', async () => {
  const { h, auth, fam } = await world();
  h.env.GAS_URL = 'https://gas.example.invalid/exec'; h.env.SYNC_KEY = 'x'.repeat(32);
  h.db2._sqlite.prepare("insert into settings (key, value, updatedAt) values ('live', '1', ?)").run(new Date(h.clock).toISOString());
  // 送る先が落ちている: 招待のメールが failed になる
  await withFetch({ fail: true }, async () => { await h.ok('admin/families/invite', { auth, id: fam.id }); });
  let list = await h.ok('admin/effects/list', { auth });
  assert.equal(list.failed.length, 1);
  assert.deepEqual([list.failed[0].kind, list.failed[0].label, list.failed[0].status, list.failed[0].attempts, list.failed[0].to], ['mail', 'メール', 'failed', 1, 'parent@example.invalid']);
  assert.match(list.failed[0].error, /GAS error/);
  const id = list.failed[0].id;
  // 送り直す（今度は届く）
  const asked = await withFetch({ fail: false }, async () => { const r = await h.ok('admin/effects/retry', { auth, ids: [id] }); assert.deepEqual([r.sent, r.failed], [1, 0]); });
  assert.equal(asked.length, 1); assert.equal(asked[0].items[0].kind, 'mail');
  list = await h.ok('admin/effects/list', { auth });
  assert.deepEqual([list.failed.length, list.recent.length, list.recent[0].status], [0, 1, 'sent']);
  assert.equal((await h.call('admin/effects/retry', { auth, ids: [id] })).error.code, 'nothing', '送ったものはもう送り直せない');
  // 失敗したままのものは、定期実行が 3 回まで送り直す
  await withFetch({ fail: true }, async () => { await h.ok('family/reset/request', { email: 'parent@example.invalid' }); });
  const failedId = h.rows("select id from effects where status = 'failed'")[0].id;
  const { runV2Scheduled } = await import('../cf/v2/index.mjs');
  await withFetch({ fail: true }, async () => { await runV2Scheduled(h.env, h.clock + 60e3); await runV2Scheduled(h.env, h.clock + 120e3); });
  assert.equal(h.rows('select attempts from effects where id = ?', failedId)[0].attempts, 3);
  const asked2 = await withFetch({ fail: false }, async () => { await runV2Scheduled(h.env, h.clock + 180e3); });
  assert.equal(asked2.length, 0, '3 回失敗したものは自動では送り直さない');
  // 取り下げる
  assert.equal((await h.ok('admin/effects/dismiss', { auth, ids: [failedId] })).dismissed, 1);
  assert.equal(h.rows('select status from effects where id = ?', failedId)[0].status, 'dismissed');
  assert.equal((await h.call('admin/effects/list', { auth: 'bad' })).error.code, 'needLogin');
});

test('effects: the manager can send one test mail to the owner to check the relay', async () => {
  const { h, auth } = await world();
  h.env.GAS_URL = 'https://gas.example.invalid/exec'; h.env.SYNC_KEY = 's'.repeat(30);
  const asked = await withFetch({ fail: false }, async () => { assert.equal((await h.ok('admin/effects/test', { auth })).sent, 1); });
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].items.map(i => [i.kind, i.to, i.subject]), [['mail', 'TEACHER', '[ステップワイズ] 送信の確認']]);
  assert.equal(h.mails().at(-1).status, 'sent');
  await withFetch({ fail: true }, async () => { assert.equal((await h.call('admin/effects/test', { auth })).error.code, 'failed'); });
  assert.equal(h.mails().at(-1).status, 'failed');
  delete h.env.GAS_URL; delete h.env.SYNC_KEY;
  assert.equal((await h.call('admin/effects/test', { auth })).error.code, 'unavailable');
});

test('effects: a delivery that was cut off after the response is picked up by the next request, and by the nightly retry', async () => {
  const { h, auth } = await world();
  h.env.GAS_URL = 'https://gas.example.invalid/exec'; h.env.SYNC_KEY = 's'.repeat(30);
  const { sweepStaleEffects, retryFailedEffects } = await import('../cf/v2/effects-admin.mjs');
  const old = new Date(h.clock - 5 * 60e3).toISOString(), fresh = new Date(h.clock - 60e3).toISOString();
  h.db2._sqlite.prepare("insert into effects (createdAt, kind, payload, status, error) values (?, 'mail', ?, 'pending', '')").run(old, JSON.stringify({ kind: 'mail', to: 'TEACHER', subject: '古い', body: 'x' }));
  h.db2._sqlite.prepare("insert into effects (createdAt, kind, payload, status, error) values (?, 'mail', ?, 'pending', '')").run(fresh, JSON.stringify({ kind: 'mail', to: 'TEACHER', subject: '新しい', body: 'x' }));
  const asked = await withFetch({ fail: false }, async () => { const r = await sweepStaleEffects(h.env, h.env.DB2, h.clock); assert.deepEqual([r.swept, r.sent], [1, 1]); });
  assert.deepEqual(asked[0].items.map(i => i.subject), ['古い'], '3 分より前のものだけ');
  const mine = () => h.mails().filter(m => m.subject === '古い' || m.subject === '新しい');
  assert.deepEqual(mine().map(m => [m.subject, m.status]), [['古い', 'sent'], ['新しい', 'pending']]);
  // Legacy in-flight delivery cannot be classified as unsent: operator confirmation required.
  h.db2._sqlite.prepare("update effects set error = '送っている途中' where status = 'pending'").run();
  await withFetch({ fail: false }, async () => { const r = await retryFailedEffects(h.env, h.env.DB2, h.clock + 15 * 60e3); assert.equal(r.retried, 0); });
  assert.deepEqual(mine().map(m => m.status), ['sent', 'pending'],'legacy in-flight outcome is not automatically replayed');
  delete h.env.GAS_URL; delete h.env.SYNC_KEY;
  void auth;
});
