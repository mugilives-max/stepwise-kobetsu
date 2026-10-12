// 基本指導条件（規約 第2条の「基本指導条件書」。migrations-v2/0018_conditions.sql）
// - 教室管理者が生徒ごとに「条件を決めてお知らせ」する（admin/conditions/propose）。基本の授業時間と1回の税込通常指導の基準単価、形式、人数、
//   生徒本人の連絡の可否、科目、特記、適用開始月。お知らせすると保護者にメールが届き、保護者ページに同意のお願いが出る
// - 保護者は保護者ページで内容を見て同意する（family/conditions/agree）。同意していない条件がある家族は、計画を承認できない（規約と同じ）
// - 書面・LINE でもらった承諾は、教室管理者が記録する（admin/conditions/record）
// - お知らせした内容は生徒の登録（通常指導の基準単価・形式・生徒本人の連絡の許可）にも写す。見込みの料金や生徒ページの連絡がそのまま合う
import { fail, newId, iso, audit } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { requireFamily } from './family.mjs';
import { familyNotice } from './schedule.mjs';
import { currentTerms, termsForVersion } from './terms.mjs';
import { putGenerated } from './files.mjs';
import { conditionDocHtml } from './condition-doc.mjs';
import { consentEvidence, evidenceView } from './consent-evidence.mjs';

const MODES = { in_person: '教室', online: 'オンライン', both: '教室とオンライン' };
export const MODE_LABEL = MODES;
const validMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const fullName = s => `${s.familyName} ${s.givenName}`.trim();

export const conditionView = r => r ? ({ ...evidenceView(r), id: r.id, studentId: r.studentId, no: r.no, minutes: r.minutes, fee: r.fee, deliveryMode: r.deliveryMode, deliveryLabel: MODES[r.deliveryMode] || '', groupSize: r.groupSize,
  studentContact: !!r.studentContact, subjects: r.subjects, note: r.note, fromMonth: r.fromMonth, termsVersion: r.termsVersion, status: r.status,
  proposedAt: r.proposedAt, agreedAt: r.agreedAt, agreedVia: r.agreedVia, agreedNote: r.agreedNote }) : null;

// 生徒の今の条件: 最新の版（latest。proposed か agreed）と、有効な合意（agreed。最新が proposed なら前の agreed）
// 書面（条件書の HTML。files 表の refType=condition）の最新の id
async function docIdOf(db, condId) {
  const f = await db.prepare("select id from files where refType = 'condition' and refId = ? and status = 'ready' order by createdAt desc, rowid desc limit 1").bind(condId).first();
  return f ? f.id : '';
}
async function withDoc(db, v) { return v ? { ...v, docFileId: await docIdOf(db, v.id) } : null; }
export async function studentConditions(db, studentId) {
  const rows = (await db.prepare("select * from conditions where studentId = ? order by no desc").bind(studentId).all()).results;
  const latest = rows.find(r => r.status !== 'replaced') || null, agreed = rows.find(r => r.status === 'agreed') || null;
  return { latest: await withDoc(db, conditionView(latest)), agreed: await withDoc(db, conditionView(agreed)), needs: !!latest && latest.status === 'proposed', history: await Promise.all(rows.map(r => withDoc(db, conditionView(r)))) };
}
// 条件書の書面を作って置く（案 → 同意したら確定の版）。請求書と同じ A4 の HTML。保護者はいつでも保護者ページから開ける
async function storeDoc(c, condId) {
  const cond = await c.db.prepare('select * from conditions where id = ?').bind(condId).first();
  const student = await c.db.prepare('select * from students where id = ?').bind(cond.studentId).first();
  const family = await c.db.prepare('select * from families where id = ?').bind(student.familyId).first();
  const staffId = String(cond.proposedBy || '').replace(/^staff:/, '');
  const proposer = staffId ? await c.db.prepare('select name from staff where id = ?').bind(staffId).first() : null;
  const html = conditionDocHtml({ cond, student, family, terms: await termsForVersion(c.db, cond.termsVersion), proposer: proposer ? proposer.name : '', now: iso(c.now) });
  const final = cond.status === 'agreed';
  return putGenerated(c, { category: 'contract', familyId: family.id, studentId: student.id, refType: 'condition', refId: cond.id,
    name: `基本指導条件書_第${cond.no}版${final ? '' : '_案'}_${fullName(student)}.html`, mime: 'text/html; charset=utf-8', bytes: new TextEncoder().encode(html), note: final ? '同意済み' : '案' });
}
// 家族: 子どもごとの条件。同意していない条件があれば needs
export async function familyConditions(db, students) {
  const out = [];
  for (const s of students) { const c = await studentConditions(db, s.id); if (c.history.length) out.push({ studentId: s.id, studentName: fullName(s), latest: c.latest, agreed: c.agreed, needs: c.needs, history: c.history }); }
  return { items: out, needs: out.some(x => x.needs) };
}
export async function familyNeedsConditions(db, familyId) {
  const students = (await db.prepare("select * from students where familyId = ? and status <> 'left'").bind(familyId).all()).results;
  return (await familyConditions(db, students)).needs;
}

function fields(b) {
  const minutes = Number(b.minutes), fee = Number(b.fee), deliveryMode = String(b.deliveryMode || ''), groupSize = String(b.groupSize || '').trim().slice(0, 80);
  const subjects = String(b.subjects || '').trim().slice(0, 100), note = String(b.note || '').trim(), fromMonth = String(b.fromMonth || '').trim();
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 300) fail('badMinutes', '基本の授業時間は15〜300分で入れてください');
  if (!Number.isInteger(fee) || fee < 0 || fee > 100000) fail('badFee', '1回の通常指導の基準単価は0〜100,000円の整数で入れてください');
  if (!MODES[deliveryMode]) fail('badMode', '指導の形式（教室・オンライン・両方）を選んでください');
  if (note.length > 1000) fail('tooLong', '特記事項は1000文字以内にしてください');
  if (!validMonth(fromMonth)) fail('badMonth', '適用開始月を YYYY-MM で入れてください');
  return { minutes, fee, deliveryMode, groupSize: groupSize || (deliveryMode === 'online' ? 'オンラインは1対1' : deliveryMode === 'in_person' ? '教室は講師1名につき生徒最大2名' : '教室は講師1名につき生徒最大2名、オンラインは1対1'), studentContact: b.studentContact === true ? 1 : 0, subjects, note, fromMonth };
}
function studentRow(c, id) { return c.db.prepare('select * from students where id = ?').bind(String(id || '')).first(); }

async function markAgreed(c, row, { at, via, by, note, evidence }) {
  const now = iso(c.now);
  await c.db.prepare("update conditions set status = 'agreed', agreedAt = ?, agreedVia = ?, agreedBy = ?, agreedNote = ?, consenterName = ?, recordedAt = ?, recordedByName = ?, updatedAt = ? where id = ? and status = 'proposed'").bind(at, via, by, note, evidence.consenterName, evidence.recordedAt, evidence.recordedByName, now, row.id).run();
}

export const conditionRoutes = {
  'admin/conditions/get': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const s = await studentRow(c, b.studentId); if (!s) fail('notFound', '生徒が見つかりません', 404);
    let perms = {}; try { perms = JSON.parse(s.permissions || '{}'); } catch {}
    return { ...(await studentConditions(c.db, s.id)), student: { id: s.id, name: fullName(s), baseRate30: s.baseRate30, deliveryMode: s.deliveryMode, subjects: s.subjects, studentContact: perms.reschedule !== false } };
  },
  // 条件を決めて保護者にお知らせする（新しい版）。生徒の登録にも写す
  'admin/conditions/propose': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const s = await studentRow(c, b.studentId); if (!s) fail('notFound', '生徒が見つかりません', 404);
    if (s.status === 'left') fail('left', '退会した生徒には条件を作れません');
    const f = fields(b), now = iso(c.now), terms = await currentTerms(c.db);
    const last = await c.db.prepare('select max(no) no from conditions where studentId = ?').bind(s.id).first();
    const no = Number(last && last.no || 0) + 1, id = newId('cd');
    let perms = {}; try { perms = JSON.parse(s.permissions || '{}'); } catch {}
    perms.reschedule = !!f.studentContact;
    await c.db.batch([
      c.db.prepare("update conditions set status = 'replaced', updatedAt = ? where studentId = ? and status = 'proposed'").bind(now, s.id),
      c.db.prepare('insert into conditions (id, studentId, no, minutes, fee, deliveryMode, groupSize, studentContact, subjects, note, fromMonth, termsVersion, status, proposedAt, proposedBy, createdAt, updatedAt, templateVersion) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, s.id, no, f.minutes, f.fee, f.deliveryMode, f.groupSize, f.studentContact, f.subjects, f.note, f.fromMonth, terms.version, 'proposed', now, 'staff:' + me.id, now, now, '20261012-r3'),
      c.db.prepare('update students set baseRate30 = ?, deliveryMode = ?, permissions = ?, updatedAt = ?, version = version + 1 where id = ?')
        .bind(Math.round(f.fee * 30 / f.minutes), f.deliveryMode === 'both' ? s.deliveryMode : f.deliveryMode, JSON.stringify(perms), now, s.id),
    ]);
    await storeDoc(c, id);
    await familyNotice(c, s.id, '基本指導条件のお知らせ', `${fullName(s)}さんの基本指導条件（第${no}版）をお送りしました。保護者ページの「お支払い」で内容（基本指導条件書）を確かめて、同意をお願いします。\n・基本の授業：1回${f.minutes}分 ${f.fee.toLocaleString('ja-JP')}円（税込）\n・形式：${MODES[f.deliveryMode]}\n・適用開始：${f.fromMonth.replace('-', '年')}月`);
    await audit(c, 'conditionPropose', id, { studentId: s.id, no, minutes: f.minutes, fee: f.fee, fromMonth: f.fromMonth });
    return { condition: await withDoc(c.db, conditionView(await c.db.prepare('select * from conditions where id = ?').bind(id).first())) };
  },
  // 書面・LINE でもらった承諾を記録する
  'admin/conditions/record': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const row = await c.db.prepare('select * from conditions where id = ?').bind(String(b.id || '')).first();
    if (!row) fail('notFound', '条件が見つかりません', 404);
    if (row.status !== 'proposed') fail('closed', 'この条件はもう同意済みか、新しい版に置き換わっています', 409);
    const date = String(b.date || ''), via = String(b.via || '').trim(), note = String(b.note || '').trim();
    if (date && !validDate(date)) fail('badDate', '承諾をもらった日を確かめてください');
    if (!via || via.length > 40) fail('needVia', '承諾の方法（書面・LINE など）を入れてください');
    if (note.length > 300) fail('tooLong', 'メモは300文字以内にしてください');
    const evidence = consentEvidence(c, b, me);
    await markAgreed(c, row, { at: evidence.consentedAt, via, by: 'staff:' + me.id, note, evidence });
    await storeDoc(c, row.id);
    await audit(c, 'conditionRecorded', row.id, { via, date });
    return await studentConditions(c.db, row.studentId);
  },
  // ---- 保護者 ----
  'family/conditions': async (c, b) => {
    const me = await requireFamily(c, b);
    const students = (await c.db.prepare("select * from students where familyId = ? order by createdAt").bind(me.id).all()).results;
    return { conditions: await familyConditions(c.db, students) };
  },
  'family/conditions/agree': async (c, b) => {
    const me = await requireFamily(c, b);
    const row = await c.db.prepare('select c.* from conditions c join students s on s.id = c.studentId where c.id = ? and s.familyId = ?').bind(String(b.id || ''), me.id).first();
    if (!row) fail('notFound', '条件が見つかりません', 404);
    if (row.status !== 'proposed') fail('closed', 'この条件はもう同意済みか、新しい版に置き換わっています。画面を更新してください', 409);
    if (b.agree !== true) fail('needAgree', '内容を確かめて「同意します」に印を付けてください');
    await markAgreed(c, row, { at: iso(c.now), via: '保護者ページ', by: 'family:' + me.id, note: '', evidence: consentEvidence(c, b, me, me) });
    await storeDoc(c, row.id);
    await audit(c, 'conditionAgreed', row.id, { familyId: me.id });
    const students = (await c.db.prepare("select * from students where familyId = ? order by createdAt").bind(me.id).all()).results;
    return { conditions: await familyConditions(c.db, students) };
  },
};
