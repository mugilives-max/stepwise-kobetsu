// 受講計画書の外の授業（回数を超える・期間外・計画にない科目）かどうかと、その1回の授業料を見る。保護者への承認のお願いと保護者の画面に書く。
// 受講計画書には足さない（2026-10-27 本人「自動で受講計画に足すのはやめましょう」）。合意のある授業は受講計画書がなくても請求する（cf/v2/lesson-plan.mjs）。
// - 承認済みの同じ科目・種類の計画がある: その計画の1回の授業料を授業の長さで割り戻した額
// - 計画がない: 特別単価合意書 → 個別受講条件書 → 生徒の基本単価
// - 承認待ち・下書きの計画に当たる: その計画の承認で入る（pending）
import { studentBilling, assignLines, lineMatches, base90 } from './plan-calc.mjs';
import { agreedSpecialFor } from './specials.mjs';


// lessons（これから決める授業。id・studentId・date・start・minutes・subject・kind）のうち、承認済みの計画に入らないもの。
// すでに決まっている授業を先に数え、lessons どうしも日付順に数える。{ [lessonId]: { pending } | { parent, fee } | { fee, conditionId, specialId } | { noFee } }
// inPeriod: その日を含む受講計画（下書き・承認待ち・承認済み）がある（受講計画を超えるかの確認は、計画のある期間だけ。計画がなければ超えるものがない）
export async function extrasFor(db, studentId, lessons) {
  const out = {}, list = lessons.filter(l => l.kind !== '体験');
  if (!list.length) return out;
  const sb = await studentBilling(db, studentId), ids = new Set(list.map(l => l.id));
  const { line } = assignLines(sb.lines, sb.lessons.filter(l => !ids.has(l.id)).concat(list.map(l => ({ ...l, status: 'decided' }))), sb.invoicedLine);
  let student = null;
  for (const l of list) {
    if (line[l.id]) continue;
    const m = Number(l.minutes), inPeriod = sb.lines.some(x => ['draft', 'proposed', 'approved'].includes(x.status) && x.startDate <= l.date && l.date <= x.endDate);
    if (sb.lines.some(x => ['draft', 'proposed'].includes(x.status) && lineMatches(x, l))) { out[l.id] = { pending: true, inPeriod }; continue; }
    const parent = sb.lines.find(x => x.status === 'approved' && !x.parentId && lineMatches(x, l));
    if (parent) { out[l.id] = { parent, inPeriod, fee: Number(parent.minutes) === m ? Number(parent.fee) : Math.floor(Number(parent.fee) * m / Number(parent.minutes)) }; continue; }
    student = student || await db.prepare('select * from students where id = ?').bind(studentId).first();
    const condition = await db.prepare("select * from conditions where studentId = ? and status = 'agreed' and fromMonth <= ? order by fromMonth desc, no desc limit 1").bind(studentId, l.date.slice(0, 7)).first();
    const sp = await agreedSpecialFor(db, studentId, l.kind, l.date);
    const fee = sp ? Math.floor(sp.fee * m / sp.minutes) : condition ? Math.floor(condition.fee * m / condition.minutes) : Math.floor(base90(student) * m / 90);
    out[l.id] = fee > 0 ? { fee, inPeriod, conditionId: condition ? condition.id : '', specialId: sp ? sp.id : '', instructionType: sp ? 'special' : 'regular' } : { noFee: true };
  }
  return out;
}
