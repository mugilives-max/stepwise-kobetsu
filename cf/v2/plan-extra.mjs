// 受講計画合意書の回数を超える授業・期間外の授業（2026-10-27 本人「受講計画合意書とセットで承認する…あるいは、計画の分を超えていますがよろしいですかって聞く」
// 「LINEとかで…両者の合意が取れたらそれを塾側がシステムに反映する。あるいは…リンクを送って…承認お願いします」「スムーズであるというのが何よりも大事」）。
// その授業の日時・料金に保護者が合意したとき（保護者ページの「承認する」、または LINE・対面で合意して塾が確定したとき）に、
// その1回を受講計画合意書の追加（承認済みの行）にする。合意書を作り直さない。
// - 承認済みの同じ科目・種類の計画がある: その計画への追加（parentId）。1回の授業料は元の計画を授業の長さで割り戻した額
// - 計画がない: 個別受講条件書の単価（特別単価合意書があればその単価）で、その日だけの計画
// - 承認待ち・下書きの計画に当たる: 足さない（その計画の承認で入る）
import { newId, iso, audit } from './util.mjs';
import { studentBilling, assignLines, lineMatches, base90 } from './plan-calc.mjs';
import { agreedSpecialFor } from './specials.mjs';
import { familyTerms } from './terms.mjs';

const jstDay = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

// lessons（これから決める授業。id・studentId・date・start・minutes・subject・kind）のうち、承認済みの計画に入らないもの。
// すでに決まっている授業を先に数え、lessons どうしも日付順に数える。{ [lessonId]: { pending } | { parent, fee } | { fee, conditionId, specialId } | { noFee } }
export async function extrasFor(db, studentId, lessons) {
  const out = {}, list = lessons.filter(l => l.kind !== '体験');
  if (!list.length) return out;
  const sb = await studentBilling(db, studentId), ids = new Set(list.map(l => l.id));
  const { line } = assignLines(sb.lines, sb.lessons.filter(l => !ids.has(l.id)).concat(list.map(l => ({ ...l, status: 'decided' }))), sb.invoicedLine);
  let student = null;
  for (const l of list) {
    if (line[l.id]) continue;
    const m = Number(l.minutes);
    if (sb.lines.some(x => ['draft', 'proposed'].includes(x.status) && lineMatches(x, l))) { out[l.id] = { pending: true }; continue; }
    const parent = sb.lines.find(x => x.status === 'approved' && !x.parentId && lineMatches(x, l));
    if (parent) { out[l.id] = { parent, fee: Number(parent.minutes) === m ? Number(parent.fee) : Math.floor(Number(parent.fee) * m / Number(parent.minutes)) }; continue; }
    student = student || await db.prepare('select * from students where id = ?').bind(studentId).first();
    const condition = await db.prepare("select * from conditions where studentId = ? and status = 'agreed' and fromMonth <= ? order by fromMonth desc, no desc limit 1").bind(studentId, l.date.slice(0, 7)).first();
    const sp = await agreedSpecialFor(db, studentId, l.kind, l.date);
    const fee = sp ? Math.floor(sp.fee * m / sp.minutes) : condition ? Math.floor(condition.fee * m / condition.minutes) : Math.floor(base90(student) * m / 90);
    out[l.id] = fee > 0 ? { fee, conditionId: condition ? condition.id : '', specialId: sp ? sp.id : '', instructionType: sp ? 'special' : 'regular' } : { noFee: true };
  }
  return out;
}

// 画面に出す一言（塾が登録する前の確かめ）
const md = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8));
const yen = n => Number(n).toLocaleString('ja-JP') + '円';
export function extraWarning(lessons, extras, how) {
  const add = lessons.filter(l => extras[l.id] && extras[l.id].fee), pending = lessons.filter(l => extras[l.id] && extras[l.id].pending), nofee = lessons.filter(l => extras[l.id] && extras[l.id].noFee);
  const w = [];
  const list = ls => ls.map(l => `${md(l.date)} ${l.subject}`).join('・');
  if (add.length) w.push(`受講計画合意書の回数を超える授業が${add.length}回あります（${list(add)}、1回 ${yen(extras[add[0].id].fee)}）。${how === 'ask' ? '保護者が承認すると、受講計画合意書に追加になります' : '保護者がこの授業と料金に同意していれば、受講計画合意書に追加して確定します'}`);
  if (pending.length) w.push(`受講計画合意書がまだ承認されていない授業があります（${list(pending)}）。請求はその承認のあとです`);
  if (nofee.length) w.push(`単価が決まっていないため、受講計画合意書に入らない授業があります（${list(nofee)}）`);
  return w;
}

// 合意した授業を受講計画合意書に足す。ev: { by: 'family' | 'staff:…', via, consenterName, recordedByName }
export async function addExtras(c, studentId, lessons, ev) {
  const extras = await extrasFor(c.db, studentId, lessons), added = [];
  const fam = await c.db.prepare('select f.* from families f join students s on s.familyId = f.id where s.id = ?').bind(studentId).first();
  const terms = fam ? await familyTerms(c.db, fam) : null, version = terms && terms.agreed ? terms.agreed.version || '' : '';
  const now = iso(c.now);
  for (const l of lessons) {
    const x = extras[l.id]; if (!x || !x.fee) continue;
    const p = x.parent || null, id = newId('pl');
    await c.db.prepare(`insert into planLines (id, studentId, parentId, subject, kind, startDate, endDate, count, minutes, fee, comment, parts, status, approvedCount, proposedAt, approvedAt, approvedBy, approvedVia, consentDate, termsVersion,
      consenterName, consentedAt, recordedAt, recordedByName, proposedByName, conditionId, specialId, instructionType, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, '', 'approved', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, studentId, p ? p.id : '', l.subject, l.kind || '通常', l.date, l.date, Number(l.minutes), x.fee, `${md(l.date)} ${l.start}〜の授業の日時への合意で追加`, now, now, ev.by, ev.via, jstDay(c.now), version,
        ev.consenterName || '', now, now, ev.recordedByName || '', ev.recordedByName || '', p ? p.conditionId || '' : x.conditionId, p ? p.specialId || '' : x.specialId, p ? p.instructionType || '' : x.instructionType, now, now).run();
    await audit(c, 'planExtra', id, { lessonId: l.id, fee: x.fee, parentId: p ? p.id : '' });
    added.push({ lessonId: l.id, lineId: id, fee: x.fee });
  }
  return added;
}
