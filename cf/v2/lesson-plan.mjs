// 生徒の授業の計画（月ごと）。受講計画書ではなく、授業そのものに焦点を当てる
// （2026-10-27 本人「今まで作っていたページはあくまでも受講計画書に焦点を当てていたが、今度は授業の計画に焦点を当てる」
//  「受講計画書にない授業が承認済みであるかどうかが不明なのが問題…受講計画書がなかったとしても、それらの合意があれば問題がない」）。
// - 科目ごとに、その月の授業の数（実施・確定・合意待ち）
// - 合意待ち（調整中・承認待ち・下書き）と、合意の記録がない授業（確定・実施済みなのに、受講計画書にも授業ごとの合意にも当たらない）
// - 授業料の見込み
// 合意している授業: 承認済みの受講計画書に入る、または授業ごとの合意の記録がある（decidedBy・agreement）
import { fail, iso, audit } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { studentBilling, assignLines, lineMatches, lessonAmount, base90 } from './plan-calc.mjs';
import { agreedSpecialFor } from './specials.mjs';

const validMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const monthEnd = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
export const agreedByLesson = l => !!(l.decidedBy || l.agreement);

// 受講計画書に入らない授業の1回の授業料: 同じ科目・種類の承認済みの受講計画書 → 特別単価合意書 → 個別受講条件書 → 生徒の基本単価
export async function feeOutsidePlan(db, student, lines, lesson) {
  const m = Number(lesson.minutes) - Number(lesson.lostMinutes || 0);
  const l = lines.find(x => x.status === 'approved' && lineMatches(x, lesson));
  if (l) return Number(l.minutes) === m ? Number(l.fee) : Math.floor(Number(l.fee) * m / Number(l.minutes));
  const sp = await agreedSpecialFor(db, student.id, lesson.kind, lesson.date);
  if (sp) return Math.floor(sp.fee * m / sp.minutes);
  const cond = await db.prepare("select * from conditions where studentId = ? and status = 'agreed' and fromMonth <= ? order by fromMonth desc, no desc limit 1").bind(student.id, lesson.date.slice(0, 7)).first();
  if (cond) return Math.floor(cond.fee * m / cond.minutes);
  return Math.floor(base90(student) * m / 90);
}

export async function monthPlan(c, student, month) {
  const from = month + '-01', to = monthEnd(month);
  const sb = await studentBilling(c.db, student.id);
  const waitingRows = (await c.db.prepare("select * from lessons where studentId = ? and status in ('held', 'proposed') and kind <> '体験' and date between ? and ? order by date, start").bind(student.id, from, to).all()).results;
  const fixed = sb.lessons.filter(l => l.date >= from && l.date <= to);
  // 合意待ちも決まったものとして受講計画書に入れてみる（入る分は計画の範囲）
  const hyp = assignLines(sb.lines, sb.lessons.concat(waitingRows.map(l => ({ ...l, status: 'decided' }))), sb.invoicedLine);
  const view = l => ({ id: l.id, date: l.date, start: l.start, minutes: l.minutes, subject: l.subject, kind: l.kind || '通常', status: l.status, asked: !!l.askedAt, version: l.version, inPlan: !!sb.line[l.id] || !!hyp.line[l.id] });
  const unrecorded = fixed.filter(l => !sb.line[l.id] && !agreedByLesson(l));
  const subjects = new Map();
  // 授業料の総額（2026-10-27 本人「既に確定しているもの、カレンダー上で登録されている見込み分、もともと計画してる分」）
  let estimate = 0, fixedTotal = 0;
  for (const l of fixed.concat(waitingRows)) {
    const key = l.subject + '|' + (l.kind || '通常');
    const g = subjects.get(key) || { subject: l.subject, kind: l.kind || '通常', total: 0, done: 0, decided: 0, waiting: 0, minutes: l.minutes, fee: 0 };
    g.total++; if (l.status === 'done') g.done++; else if (l.status === 'decided') g.decided++; else g.waiting++;
    const line = sb.line[l.id] || hyp.line[l.id];
    const fee = line ? lessonAmount(line, { ...l, lostMinutes: l.status === 'done' ? l.lostMinutes : 0 }) : await feeOutsidePlan(c.db, student, sb.lines, l);
    if (!g.fee) { g.fee = fee; g.minutes = l.minutes; }
    estimate += fee; if (['done', 'decided'].includes(l.status)) fixedTotal += fee;
    subjects.set(key, g);
  }
  const plans = sb.lines.filter(l => l.startDate <= to && from <= l.endDate && l.status !== 'declined')
    .map(l => ({ id: l.id, subject: l.subject, kind: l.kind, startDate: l.startDate, endDate: l.endDate, status: l.status, count: l.status === 'approved' ? l.approvedCount : l.count, fee: l.fee, used: Object.values(hyp.line).filter(x => x && x.id === l.id).length, version: l.version }));
  const planTotal = plans.reduce((n, p) => n + Number(p.count) * Number(p.fee), 0);
  return { month, subjects: [...subjects.values()], waiting: waitingRows.map(view), unrecorded: unrecorded.map(view), estimate, fixedTotal, planTotal, planPending: plans.some(p => p.status !== 'approved'), plans };
}

export const lessonPlanRoutes = {
  'students/plan': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const s = await c.db.prepare('select * from students where id = ?').bind(String(b.studentId || '')).first();
    if (!s) fail('notFound', '生徒が見つかりません', 404);
    const month = validMonth(b.month) ? b.month : new Date(c.now + 9 * 3600e3).toISOString().slice(0, 7);
    return monthPlan(c, s, month);
  },
  // 授業ごとの合意を記録する（確定・実施済みなのに合意の記録がない授業。LINE・電話・面談で合意していたとき）
  'schedule/lessons/agreement': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const l = await c.db.prepare('select * from lessons where id = ?').bind(String(b.id || '')).first();
    if (!l) fail('notFound', '授業が見つかりません', 404);
    if (Number(b.version) !== Number(l.version)) fail('conflict', 'ほかの操作で変わりました。画面を更新してください', 409);
    if (!['decided', 'done'].includes(l.status)) fail('badStatus', '確定・実施済みの授業だけ合意を記録できます');
    if (l.invoiceId) fail('locked', '請求に入った授業は直せません', 409);
    const agreement = String(b.agreement || '').trim().slice(0, 200);
    if (!agreement) fail('needAgreement', 'いつ・どの方法で・だれと合意したかを書いてください（例: LINE 10/20 お母さんと合意）');
    const now = iso(c.now);
    await c.db.prepare("update lessons set agreement = ?, decidedBy = case when decidedBy = '' then ? else decidedBy end, decidedAt = case when decidedAt = '' then ? else decidedAt end, updatedAt = ?, version = version + 1 where id = ? and version = ?")
      .bind(agreement, 'staff:' + me.id, now, now, l.id, l.version).run();
    await audit(c, 'lessonAgreement', l.id, { agreement });
    return { ok: true };
  },
};
