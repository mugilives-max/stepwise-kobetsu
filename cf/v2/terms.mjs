// 共通規約の版と同意の記録（migrations-v2/0016_terms.sql・0034_terms_requests.sql）。
// 「使う規約を決める」と「保護者に同意をお願いする」は別の操作（2026-10-20 本人「決定するのと、同意をお願いするのが同時…気持ち悪い」）。
// - 使う規約（今の版）は settings に置く（教室管理者が「設定 → 共通規約」で決める）。これから作る書面と、新しく入塾する家族の申込みはこの版による
// - 決めただけでは、今の家族には何も出ない。代表が家族を選んで同意をお願いすると（admin/terms/request）、その家族の保護者ページに同意のお願いが出る
// - お願いしている家族は、同意するまで受講計画書を承認できない（billing.mjs）。お願いしていない家族は、規約 第28条のとおり前の約束のまま
// - 保護者は保護者ページで全文を読んで同意する（family/terms/accept）
// - 書面や LINE でもらった同意は、教室管理者が記録する（admin/families/terms）
// - 計画の行には、承認したときの規約の版を残す（billing.mjs）
import { fail, iso, audit, newId } from './util.mjs';
import { isLive } from './accounts.mjs';
import { FAMILY_URL } from './schedule.mjs';
import { requireStaff } from './staff.mjs';
import { requireFamily } from './family.mjs';
import { consentEvidence } from './consent-evidence.mjs';

const KEYS = { version: 'termsVersion', title: 'termsTitle', url: 'termsUrl', from: 'termsFrom', note: 'termsNote' };
export async function currentTerms(db) {
  const rows = (await db.prepare(`select key, value from settings where key in (${Object.values(KEYS).map(() => '?').join(',')})`).bind(...Object.values(KEYS)).all()).results;
  const v = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { version: v.termsVersion || '', title: v.termsTitle || '', url: v.termsUrl || '', from: v.termsFrom || '', note: v.termsNote || '' };
}
export async function termsForVersion(db, version) {
  if (!version) return { version: '', title: '', url: '', from: '', note: '', contentHash: '' };
  const r = await db.prepare('select * from termsVersions where version = ?').bind(version).first();
  return r ? { version: r.version, title: r.title, url: r.url, from: r.fromDate, note: r.note, contentHash: r.contentHash } : { version, title: '', url: '', from: '', note: '', contentHash: '' };
}
function consentView(r, terms) {
  let fixed; try { fixed = JSON.parse(r.termsSnapshot || 'null'); } catch {}
  return { id: r.id, version: r.version, at: r.acceptedAt, via: r.via, consenterName: r.consenterName || '',
    recordedAt: r.recordedAt || '', recordedByName: r.recordedByName || '', ...(fixed || terms), note: r.note, termsNote: (fixed || terms).note };
}
// 今の版について、その家族にお願いしている同意（まだ同意していないもの）
async function openRequest(db, familyId, version) {
  if (!version) return null;
  return db.prepare("select * from termsRequests where familyId = ? and version = ? and status = 'open' order by requestedAt desc").bind(familyId, version).first();
}
// 家族から見た規約: 今の版、同意した版、同意が要るか（代表がお願いしていて、まだ同意していないとき）
export async function familyTerms(db, f) {
  const current = await currentTerms(db);
  const rows = (await db.prepare('select * from termsConsents where familyId = ? order by id desc').bind(f.id).all()).results;
  const history = [];
  for (const r of rows) history.push(consentView(r, await termsForVersion(db, r.version)));
  const agreed = history.find(r => r.version === f.termsVersion && r.at === f.termsAcceptedAt)
    || { ...(await termsForVersion(db, f.termsVersion || '')), at: f.termsAcceptedAt || '', consenterName: '', recordedAt: '', recordedByName: '', via: '' };
  const req = agreed.version !== current.version ? await openRequest(db, f.id, current.version) : null;
  return { current: req && req.note ? { ...current, note: req.note } : current, agreed, history,
    request: req ? { requestedAt: req.requestedAt, note: req.note } : null, needs: !!req };
}
export async function needsTerms(db, f) { return (await familyTerms(db, f)).needs; }
const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// 規約の同意を書く文（入塾の申込みは、ほかの記録と同じ batch で書く。enrollment.mjs）
export async function termsConsentStatements(c, familyId, version, { at, via, actorKind, actorId, note, evidence }) {
  const fixed = await termsForVersion(c.db, version);
  return [
    c.db.prepare('update families set termsVersion = ?, termsAcceptedAt = ?, updatedAt = ?, version = version + 1 where id = ?').bind(version, at, iso(c.now), familyId),
    c.db.prepare('insert into termsConsents (familyId, version, acceptedAt, via, actorKind, actorId, note, consenterName, recordedAt, recordedByName, termsSnapshot) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(familyId, version, at, via, actorKind, actorId, note, evidence.consenterName, evidence.recordedAt, evidence.recordedByName, JSON.stringify(fixed)),
  ];
}
async function recordConsent(c, familyId, version, { at, via, actorKind, actorId, note, evidence }) {
  const fixed = await termsForVersion(c.db, version);
  await c.db.batch([
    c.db.prepare('update families set termsVersion = ?, termsAcceptedAt = ?, updatedAt = ?, version = version + 1 where id = ?').bind(version, at, iso(c.now), familyId),
    c.db.prepare('insert into termsConsents (familyId, version, acceptedAt, via, actorKind, actorId, note, consenterName, recordedAt, recordedByName, termsSnapshot) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(familyId, version, at, via, actorKind, actorId, note, evidence.consenterName, evidence.recordedAt, evidence.recordedByName, JSON.stringify(fixed)),
  ]);
}

export const termsRoutes = {
  'admin/terms/get': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const terms = await currentTerms(c.db);
    const fam = (await c.db.prepare("select termsVersion, count(*) n from families where status <> 'stopped' and testOnly = 0 group by termsVersion").all()).results;
    const total = fam.reduce((n, r) => n + r.n, 0), agreed = terms.version ? fam.filter(r => r.termsVersion === terms.version).reduce((n, r) => n + r.n, 0) : 0;
    const history = (await c.db.prepare('select t.*, f.name familyName from termsConsents t join families f on f.id = t.familyId order by t.id desc limit 50').all()).results;
    const requests = terms.version ? (await c.db.prepare("select familyId, requestedAt, requestedByName, note, mailed from termsRequests where version = ? and status = 'open' order by requestedAt").bind(terms.version).all()).results : [];
    return { terms, catalogue: (await c.db.prepare('select version,title,url,fromDate,note,contentHash,registeredAt from termsVersions order by registeredAt desc').all()).results, families: { total, agreed }, requests, history: history.map(h => ({ id: h.id, familyName: h.familyName, version: h.version, acceptedAt: h.acceptedAt, via: h.via, actorKind: h.actorKind, note: h.note, consenterName: h.consenterName, recordedAt: h.recordedAt, recordedByName: h.recordedByName })) };
  },
  // 使う規約（今の版）を決める。決めただけでは、今の家族に同意のお願いは出ない（お願いは admin/terms/request）
  'admin/terms/set': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const version = String(b.version || '').trim(), title = String(b.title || '').trim(), url = String(b.url || '').trim(), from = String(b.from || '').trim(), note = String(b.note || '').trim();
    if (version.length > 40) fail('badVersion', '版は40文字以内にしてください');
    if (version && !title) fail('needTitle', '規約の名前を入れてください');
    if (title.length > 80 || note.length > 500) fail('tooLong', '名前は80文字、説明は500文字以内にしてください');
    if (url && !/^https:\/\/\S{1,500}$/.test(url)) fail('badUrl', '全文のリンクは https:// で始めてください');
    if (from && !validDate(from)) fail('badDate', '適用日は YYYY-MM-DD で入れてください');
    const now = iso(c.now);
    if (version) {
      const old = await c.db.prepare('select * from termsVersions where version = ?').bind(version).first();
      if (old && (old.title !== title || old.url !== url || old.fromDate !== from || old.note !== note))
        fail('immutableVersion', '登録済みの版の本文リンク・適用日・説明は変更できません。変更する場合は新しい版を登録してください', 409);
      if (!old) await c.db.prepare('insert into termsVersions (version,title,url,fromDate,note,registeredAt) values (?,?,?,?,?,?)').bind(version,title,url,from,note,now).run();
    }
    await c.db.batch(Object.entries({ version, title, url, from, note }).map(([k, v]) => c.db.prepare('insert into settings (key, value, updatedAt) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updatedAt = excluded.updatedAt').bind(KEYS[k], v, now)));
    await audit(c, 'termsSet', version, { title, from, by: me.id });
    return { terms: await currentTerms(c.db) };
  },
  // 家族を選んで、今の版への同意をお願いする。保護者ページに同意のお願いが出る。登録済みの保護者には、望めばメールでも知らせる
  'admin/terms/request': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const terms = await currentTerms(c.db);
    if (!terms.version) fail('noTerms', '先に、共通規約を使い始めてください');
    const ids = [...new Set((Array.isArray(b.familyIds) ? b.familyIds : []).map(String))];
    if (!ids.length) fail('needFamilies', '同意をお願いする家族を選んでください');
    if (ids.length > 300) fail('tooMany', '一度に選べるのは300家族までです');
    const note = String(b.note || '').trim(); if (note.length > 500) fail('tooLong', '保護者への一言は500文字以内にしてください');
    const now = iso(c.now), stmts = [], done = [];
    for (const id of ids) {
      const f = await c.db.prepare('select * from families where id = ?').bind(id).first();
      if (!f) fail('notFound', '家族が見つかりません', 404);
      if (f.status === 'stopped') fail('stopped', `${f.name}は利用を止めています`);
      if (f.termsVersion === terms.version || await openRequest(c.db, f.id, terms.version)) continue; // 同意済み・お願い中
      const mailed = b.mail === true && !!f.passHash && f.status === 'active' && !!f.email;
      stmts.push(c.db.prepare('insert into termsRequests (id, familyId, version, note, requestedAt, requestedBy, requestedByName, mailed) values (?, ?, ?, ?, ?, ?, ?, ?)').bind(newId('treq'), f.id, terms.version, note, now, me.id, String(me.name || ''), mailed ? 1 : 0));
      done.push({ f, mailed });
    }
    if (!stmts.length) fail('nothingToRequest', '選んだ家族は、もう同意済みか、同意をお願いしているところです');
    await c.db.batch(stmts);
    const held = !(await isLive(c));
    for (const { f, mailed } of done) if (mailed) c.effects.push({ kind: 'mail', to: f.email, name: 'ステップワイズ個別指導', subject: '【ステップワイズ】共通規約への同意のお願い',
      body: `${f.guardianName ? f.guardianName + ' 様' : '保護者さま'}\n\nステップワイズ個別指導です。「${terms.title}」${terms.from ? `（${Number(terms.from.slice(5, 7))}月${Number(terms.from.slice(8))}日から）` : ''}への同意をお願いいたします。\n${note ? note + '\n' : ''}\n保護者ページで全文をお読みいただき、「同意する」を押してください。同意いただくまで、次の受講計画書は承認できません。\n\n確認する：\n${FAMILY_URL}#money\n\nご不明な点は、いつものLINEまたは mugilives@gmail.com へご連絡ください。`,
      replyTo: 'mugilives@gmail.com', notice: null, testOnly: !!f.testOnly, audience: 'family', held });
    await audit(c, 'termsRequested', terms.version, { families: done.map(x => x.f.id), mailed: done.filter(x => x.mailed).length });
    return { requested: done.length, mailed: done.filter(x => x.mailed).length, skipped: ids.length - done.length };
  },
  // 同意のお願いを取り下げる（間違えてお願いしたとき）。記録は残る
  'admin/terms/request/withdraw': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const terms = await currentTerms(c.db), familyId = String(b.familyId || '');
    if (!(await openRequest(c.db, familyId, terms.version))) fail('notFound', 'この家族には、今お願いしている同意はありません', 404);
    await c.db.prepare("update termsRequests set status = 'withdrawn', withdrawnAt = ?, withdrawnBy = ? where familyId = ? and version = ? and status = 'open'").bind(iso(c.now), me.id, familyId, terms.version).run();
    await audit(c, 'termsRequestWithdrawn', familyId, { version: terms.version });
    return {};
  },
  // 書面・LINE などでもらった同意を記録する（教室管理者）
  'admin/families/terms': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const f = await c.db.prepare('select * from families where id = ?').bind(String(b.id || '')).first();
    if (!f) fail('notFound', '家族が見つかりません', 404);
    const terms = await currentTerms(c.db);
    const version = String(b.version || terms.version || '').trim(), date = String(b.date || ''), via = String(b.via || '').trim(), note = String(b.note || '').trim();
    if (!version) fail('needVersion', '規約の版がまだありません。設定の「共通規約」で決めてください');
    if (date && !validDate(date)) fail('badDate', '同意をもらった日を確かめてください');
    if (!via || via.length > 40) fail('needVia', '同意の方法（書面・LINE など）を入れてください');
    if (note.length > 300) fail('tooLong', 'メモは300文字以内にしてください');
    if (!(await c.db.prepare('select 1 from termsVersions where version = ?').bind(version).first())) fail('unknownVersion', '同意した規約の版を先に登録してください');
    const evidence = consentEvidence(c, b, me);
    await recordConsent(c, f.id, version, { at: evidence.consentedAt, via, actorKind: 'staff', actorId: me.id, note, evidence });
    await audit(c, 'termsConsentRecorded', f.id, { version, via, date });
    return { terms: await familyTerms(c.db, await c.db.prepare('select * from families where id = ?').bind(f.id).first()) };
  },
  'family/terms': async (c, b) => ({ terms: await familyTerms(c.db, await requireFamily(c, b)) }),
  // 保護者が全文を読んで同意する
  'family/terms/accept': async (c, b) => {
    const me = await requireFamily(c, b);
    const terms = await currentTerms(c.db);
    if (!terms.version) fail('noTerms', '今、同意をお願いしている規約はありません');
    if (String(b.version || '') !== terms.version) fail('staleVersion', '規約が新しくなっています。画面を更新して、もう一度確かめてください', 409);
    if (b.agree !== true) fail('needAgree', '全文を読んで「同意します」に印を付けてください');
    await recordConsent(c, me.id, terms.version, { at: iso(c.now), via: '保護者ページ', actorKind: 'family', actorId: me.id, note: '', evidence: consentEvidence(c, b, me, me) });
    await audit(c, 'termsAccepted', me.id, { version: terms.version });
    return { terms: await familyTerms(c.db, await c.db.prepare('select * from families where id = ?').bind(me.id).first()) };
  },
};
