// 特殊指導の承認（規約 第6条。migrations-v2/0019_specials.sql）
// - 教室管理者が「特殊指導を提案」する（admin/specials/propose）：名称、内容と範囲、通常指導との違い、準備、1回の時間と税込料金、対象期間。
//   提案すると、その名称で「授業の種類」（lessonKinds）ができ、保護者にメールが届く。書面（特殊指導条件書・案）も残す
// - 保護者は保護者ページで内容を見て承認する（family/specials/agree）。承認された名称の種類でだけ、通常指導の基準単価を超える料金の計画を作れる
//   （billing/plans/save の needSpecial）。計画の承認そのものは止めない（特殊指導は任意）
// - 書面・LINE でもらった承諾は教室管理者が記録する（admin/specials/record）。終わったら「終える」（admin/specials/end）
import { fail, newId, iso, audit } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { requireFamily } from './family.mjs';
import { familyNotice } from './schedule.mjs';
import { currentTerms, termsForVersion } from './terms.mjs';
import { putGenerated } from './files.mjs';
import { specialDocHtml } from './special-doc.mjs';
import { consentEvidence, evidenceView } from './consent-evidence.mjs';

const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const fullName = s => `${s.familyName} ${s.givenName}`.trim();
export const STATUS_LABEL = { proposed: '承認待ち', agreed: '承認済み', replaced: '置き換え', ended: '終了' };

export const specialView = r => r ? ({ ...evidenceView(r), id: r.id, studentId: r.studentId, no: r.no, title: r.title, purpose: r.purpose || '', content: r.content, reason: r.reason, prep: r.prep, minutes: r.minutes, fee: r.fee, fromDate: r.fromDate, toDate: r.toDate, note: r.note,
  termsVersion: r.termsVersion, status: r.status, statusLabel: STATUS_LABEL[r.status] || r.status, proposedAt: r.proposedAt, agreedAt: r.agreedAt, agreedVia: r.agreedVia, agreedNote: r.agreedNote, endedAt: r.endedAt }) : null;

async function docIdOf(db, id) {
  const f = await db.prepare("select id from files where refType = 'special' and refId = ? and status = 'ready' order by createdAt desc, rowid desc limit 1").bind(id).first();
  return f ? f.id : '';
}
async function withDoc(db, v) { return v ? { ...v, docFileId: await docIdOf(db, v.id) } : null; }

// 生徒の特殊指導: 生きているもの（proposed・agreed）と、終わった・置き換えたもの
export async function studentSpecials(db, studentId) {
  const rows = (await db.prepare('select * from specials where studentId = ? order by no desc').bind(studentId).all()).results;
  const items = []; for (const r of rows) items.push(await withDoc(db, specialView(r)));
  return { items: items.filter(x => x.status === 'proposed' || x.status === 'agreed'), past: items.filter(x => x.status === 'replaced' || x.status === 'ended'), needs: rows.some(r => r.status === 'proposed') };
}
export async function familySpecials(db, students) {
  const out = [], past = [];
  for (const s of students) { const sp = await studentSpecials(db, s.id); for (const x of sp.items) out.push({ ...x, studentName: fullName(s) }); for (const x of sp.past) past.push({ ...x, studentName: fullName(s) }); }
  return { items: out, past, needs: out.some(x => x.status === 'proposed') };
}
// 計画の料金の根拠: その生徒・その種類（名称）・その日に承認済みの特殊指導があるか
export async function agreedSpecialFor(db, studentId, kind, date) {
  return db.prepare("select * from specials where studentId = ? and title = ? and status = 'agreed' and fromDate <= ? and toDate >= ? order by no desc limit 1").bind(studentId, String(kind || ''), date, date).first();
}

function fields(b) {
  const purpose = String(b.purpose || '').trim();
  if (!purpose) fail('needPurpose', '指導の目的を書いてください');
  const title = String(b.title || '').trim().slice(0, 20), content = String(b.content || '').trim(), reason = String(b.reason || '').trim(), prep = String(b.prep || '').trim();
  const minutes = Number(b.minutes), fee = Number(b.fee), fromDate = String(b.fromDate || ''), toDate = String(b.toDate || ''), note = String(b.note || '').trim();
  if (!title) fail('badTitle', '特殊指導の名称を20文字以内で入れてください（例: 英検準1級対策）');
  if (title === '通常') fail('badTitle', '「通常」は特殊指導の名称にできません');
  if (!content) fail('needContent', '指導の内容と範囲を書いてください');
  if (!reason) fail('needReason', '通常指導との違い（なぜ特殊指導か）を書いてください');
  if ([purpose, content, reason, prep, note].some(v => v.length > 1000)) fail('tooLong', '各項目は1000文字以内にしてください');
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 300) fail('badMinutes', '1回の時間は15〜300分で入れてください');
  if (!Number.isInteger(fee) || fee < 0 || fee > 100000) fail('badFee', '1回の税込料金は0〜100,000円の整数で入れてください');
  if (!validDate(fromDate) || !validDate(toDate) || toDate < fromDate) fail('badDate', '対象期間を確かめてください');
  return { title, purpose, content, reason, prep, minutes, fee, fromDate, toDate, note };
}
const studentRow = (c, id) => c.db.prepare('select * from students where id = ?').bind(String(id || '')).first();

async function storeDoc(c, id) {
  const sp = await c.db.prepare('select * from specials where id = ?').bind(id).first();
  const student = await studentRow(c, sp.studentId), family = await c.db.prepare('select * from families where id = ?').bind(student.familyId).first();
  const staffId = String(sp.proposedBy || '').replace(/^staff:/, '');
  const proposer = staffId ? await c.db.prepare('select name from staff where id = ?').bind(staffId).first() : null;
  const html = specialDocHtml({ sp, student, family, terms: await termsForVersion(c.db, sp.termsVersion), proposer: proposer ? proposer.name : '', now: iso(c.now) });
  const final = sp.status === 'agreed';
  return putGenerated(c, { category: 'contract', familyId: family.id, studentId: student.id, refType: 'special', refId: sp.id,
    name: `特殊指導条件書_${sp.title}_第${sp.no}版${final ? '' : '_案'}_${fullName(student)}.html`, mime: 'text/html; charset=utf-8', bytes: new TextEncoder().encode(html), note: final ? '承認済み' : '案' });
}
async function markAgreed(c, row, { at, via, by, note, evidence }) {
  const saved = await c.db.prepare("update specials set status = 'agreed', agreedAt = ?, agreedVia = ?, agreedBy = ?, agreedNote = ?, consenterName = ?, recordedAt = ?, recordedByName = ?, updatedAt = ? where id = ? and status = 'proposed'").bind(at, via, by, note, evidence.consenterName, evidence.recordedAt, evidence.recordedByName, iso(c.now), row.id).run();
  if (saved.meta.changes !== 1) fail('conflict', 'ほかの操作で内容が変わりました。画面を更新して確認してください', 409);
}

export const specialRoutes = {
  'admin/specials/get': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const s = await studentRow(c, b.studentId); if (!s) fail('notFound', '生徒が見つかりません', 404);
    return { student: { id: s.id, name: fullName(s), baseRate30: s.baseRate30 }, ...(await studentSpecials(c.db, s.id)) };
  },
  // 特殊指導を提案する（新しい版）。replaceId を渡すと、その提案・承認を置き換える
  'admin/specials/propose': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const s = await studentRow(c, b.studentId); if (!s) fail('notFound', '生徒が見つかりません', 404);
    if (s.status === 'left') fail('left', '退会した生徒には作れません');
    const f = fields(b), now = iso(c.now), terms = await currentTerms(c.db);
    const last = await c.db.prepare('select max(no) no from specials where studentId = ?').bind(s.id).first();
    const no = Number(last && last.no || 0) + 1, id = newId('sp');
    const stmts = [];
    if (b.replaceId) stmts.push(c.db.prepare("update specials set status = 'replaced', updatedAt = ? where id = ? and studentId = ? and status in ('proposed', 'agreed')").bind(now, String(b.replaceId), s.id));
    stmts.push(c.db.prepare('insert into specials (id, studentId, no, title, content, reason, prep, minutes, fee, fromDate, toDate, note, termsVersion, status, proposedAt, proposedBy, createdAt, updatedAt, purpose, templateVersion) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, s.id, no, f.title, f.content, f.reason, f.prep, f.minutes, f.fee, f.fromDate, f.toDate, f.note, terms.version, 'proposed', now, 'staff:' + me.id, now, now, f.purpose, '20261012-r3'));
    // 同じ名称の「授業の種類」を用意する（計画の種類に選べるように）
    stmts.push(c.db.prepare('insert into lessonKinds (name, standardMinutes, standardFee, active, sortOrder, createdAt, updatedAt) values (?, ?, ?, 1, 50, ?, ?) on conflict(name) do update set standardMinutes = excluded.standardMinutes, standardFee = excluded.standardFee, active = 1, updatedAt = excluded.updatedAt')
      .bind(f.title, f.minutes, f.fee, now, now));
    await c.db.batch(stmts);
    await storeDoc(c, id);
    await familyNotice(c, s.id, '特殊指導のご提案', `${fullName(s)}さんの特殊指導「${f.title}」をご提案します。保護者ページの「お支払い」で内容（特殊指導条件書）を確かめて、承認をお願いします。\n・1回${f.minutes}分 ${f.fee.toLocaleString('ja-JP')}円（税込）\n・期間：${f.fromDate}〜${f.toDate}`);
    await audit(c, 'specialPropose', id, { studentId: s.id, no, title: f.title, fee: f.fee, minutes: f.minutes });
    return { special: await withDoc(c.db, specialView(await c.db.prepare('select * from specials where id = ?').bind(id).first())) };
  },
  'admin/specials/record': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const row = await c.db.prepare('select * from specials where id = ?').bind(String(b.id || '')).first();
    if (!row) fail('notFound', '特殊指導が見つかりません', 404);
    if (row.status !== 'proposed') fail('closed', 'この提案はもう承認済みか、置き換わっています', 409);
    const date = String(b.date || ''), via = String(b.via || '').trim(), note = String(b.note || '').trim();
    if (date && !validDate(date)) fail('badDate', '承諾をもらった日を確かめてください');
    if (!via || via.length > 40) fail('needVia', '承諾の方法（書面・LINE など）を入れてください');
    if (note.length > 300) fail('tooLong', 'メモは300文字以内にしてください');
    const evidence = consentEvidence(c, b, me);
    await markAgreed(c, row, { at: evidence.consentedAt, via, by: 'staff:' + me.id, note, evidence });
    await storeDoc(c, row.id);
    await audit(c, 'specialRecorded', row.id, { via, date });
    return await studentSpecials(c.db, row.studentId);
  },
  'admin/specials/end': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const row = await c.db.prepare('select * from specials where id = ?').bind(String(b.id || '')).first();
    if (!row) fail('notFound', '特殊指導が見つかりません', 404);
    if (!['proposed', 'agreed'].includes(row.status)) fail('closed', 'もう終わっています', 409);
    await c.db.prepare("update specials set status = 'ended', endedAt = ?, updatedAt = ? where id = ?").bind(iso(c.now), iso(c.now), row.id).run();
    await audit(c, 'specialEnd', row.id);
    return await studentSpecials(c.db, row.studentId);
  },
  // ---- 保護者 ----
  'family/specials': async (c, b) => {
    const me = await requireFamily(c, b);
    const students = (await c.db.prepare("select * from students where familyId = ? and status <> 'left' order by createdAt").bind(me.id).all()).results;
    return { specials: await familySpecials(c.db, students) };
  },
  'family/specials/agree': async (c, b) => {
    const me = await requireFamily(c, b);
    const row = await c.db.prepare('select p.* from specials p join students s on s.id = p.studentId where p.id = ? and s.familyId = ?').bind(String(b.id || ''), me.id).first();
    if (!row) fail('notFound', '特殊指導が見つかりません', 404);
    if (row.status !== 'proposed') fail('closed', 'この提案はもう承認済みか、置き換わっています。画面を更新してください', 409);
    if (b.agree !== true) fail('needAgree', '内容を確かめて「承認します」に印を付けてください');
    await markAgreed(c, row, { at: iso(c.now), via: '保護者ページ', by: 'family:' + me.id, note: '', evidence: consentEvidence(c, b, me, me) });
    await storeDoc(c, row.id);
    await audit(c, 'specialAgreed', row.id, { familyId: me.id });
    const students = (await c.db.prepare("select * from students where familyId = ? and status <> 'left' order by createdAt").bind(me.id).all()).results;
    return { specials: await familySpecials(c.db, students) };
  },
};
