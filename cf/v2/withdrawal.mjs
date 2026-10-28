// 退塾の手続き（教室管理者）。共通規約 第22条: 終了の申出を受けたら、受ける予約とやめる予約、最終受講日を確かめる。
// 2026-10-28 本人の決定: やめた予約のキャンセル料は規約どおり（連絡を受けた時刻で、ふだんのキャンセルと同じ）・保護者にはシステムからメール・
// 在籍の「退会」は最終受講日のあとに代表が押す（システムは自動で切り替えない）。
// - admin/withdrawal/show: 手続きの画面に出す先の授業と、兄弟・保護者ページの状態
// - admin/withdrawal/save: 最終受講日と連絡を受けた日時を記録し、やめる授業をお休み・キャンセル・取り下げにして、保護者に 1 通知らせる
// - admin/withdrawal/finish: 最終受講日のあと、在籍を「退会」にする（生徒の専用リンクも使えなくなる）
// - admin/withdrawal/undo: 退会にする前なら、退塾の予定を取り消す（やめた授業は戻さない）
import { fail, iso, audit } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { todayJst, freeDeadline, stageOf, lessonLine, familyNotice, calendarEffect, noticeAt, setLesson, closeRequests } from './schedule.mjs';
import { usesRate, setRateFee, createCancelFee } from './plan-calc.mjs';
import { familyTarget } from '../../assets/v2/family-target.js';

const fullName = s => [s.familyName, s.givenName].filter(Boolean).join(' ');
const startMs = l => Date.parse(l.date + 'T' + l.start + ':00+09:00');
const endMs = l => startMs(l) + Number(l.minutes) * 60e3;
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z'));
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const WD = '日月火水木金土';
const mdw = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${WD[new Date(d + 'T00:00:00Z').getUTCDay()]})`;

async function studentOf(c, b) {
  const s = await c.db.prepare('select s.*, f.status familyStatus from students s join families f on f.id = s.familyId where s.id = ?').bind(String(b.studentId || '')).first();
  if (!s) fail('notFound', '生徒が見つかりません', 404);
  return s;
}
const sameVersion = (s, b) => { if (Number(b.version) !== Number(s.version)) fail('conflict', 'ほかの操作で変わりました。画面を更新してください', 409); };
// これから始まる授業（下書き・調整中・確認待ち・確定）。始まった授業は手続きでは変えない
const ahead = async (c, sid) => (await c.db.prepare("select * from lessons where studentId = ? and status in ('held', 'proposed', 'decided') order by date, start").bind(sid).all()).results.filter(l => startMs(l) > c.now);
const view = s => ({ id: s.id, name: fullName(s), status: s.status, trial: !!s.trial, version: s.version, leaveOn: s.leaveOn || '', leaveNoticeAt: s.leaveNoticeAt || '' });

export const withdrawalRoutes = {
  'admin/withdrawal/show': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const s = await studentOf(c, b);
    const others = (await c.db.prepare("select count(*) n from students where familyId = ? and id <> ? and status <> 'left'").bind(s.familyId, s.id).first()).n;
    const lessons = (await ahead(c, s.id)).map(l => ({ id: l.id, date: l.date, start: l.start, minutes: l.minutes, subject: l.subject, kind: l.kind, stage: stageOf(l), freeBefore: iso(freeDeadline(l.date)) }));
    const last = await c.db.prepare("select max(date) d from lessons where studentId = ? and status = 'done'").bind(s.id).first();
    return { today: todayJst(c.now), student: view(s), lessons, lastDone: (last && last.d) || '', siblings: Number(others || 0), familyId: s.familyId, familyStatus: s.familyStatus };
  },

  'admin/withdrawal/save': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const s = await studentOf(c, b); sameVersion(s, b);
    if (s.status === 'left') fail('left', 'もう退会になっています');
    if (!validDate(b.lastDay)) fail('badDate', '最終受講日を入れてください');
    const at = noticeAt(c, b), lastDay = String(b.lastDay);
    const lessons = await ahead(c, s.id), keep = new Set((Array.isArray(b.keep) ? b.keep : []).map(String));
    for (const id of keep) {
      const l = lessons.find(x => x.id === id);
      if (!l) fail('badLesson', '受ける授業が見つかりません。画面を更新してください', 409);
      if (!['proposed', 'decided'].includes(l.status)) fail('badLesson', '下書きの授業は受けられません。「やめる」にしてください');
      if (l.date > lastDay) fail('afterLast', `${mdw(l.date)} の授業は最終受講日より後です。最終受講日を直すか「やめる」にしてください`);
    }
    // 先に生徒の行を変える（ほかの操作と重なったら、授業は何も変えない）
    const saved = await c.db.prepare('update students set leaveOn = ?, leaveNoticeAt = ?, updatedAt = ?, version = version + 1 where id = ? and version = ?').bind(lastDay, at, iso(c.now), s.id, s.version).run();
    if (!saved.meta?.changes) fail('conflict', 'ほかの操作で変わりました。画面を更新してください', 409);
    const stopped = [], by = 'staff:' + c.actor.id;
    let feeTotal = 0;
    for (const l of lessons.filter(x => !keep.has(x.id))) {
      if (l.status === 'held') { // 下書きは保護者に見せていないので消す
        await c.db.batch([c.db.prepare('delete from lessonRequests where lessonId = ?').bind(l.id), c.db.prepare('delete from cancellationFees where lessonId = ?').bind(l.id), c.db.prepare('delete from lessons where id = ?').bind(l.id)]);
        continue;
      }
      // 調整中・確認待ちはまだ合意していないので、お休み（取り下げ）。確定した授業は、連絡を受けた時刻が前日23時までならお休み、過ぎていればキャンセル料つきのキャンセル
      let fee = null, cancel = l.status === 'decided' && Date.parse(at) > freeDeadline(l.date);
      if (!cancel) await setLesson(c, l, { status: 'rested' });
      else {
        await setLesson(c, l, { status: 'cancelled' });
        if (await usesRate(c.db, l)) fee = await setRateFee(c, l, 'cancel', Number(l.minutes), at);
        else await createCancelFee(c, l, 'late', at);
        if (!fee) fee = await c.db.prepare('select amount from cancellationFees where lessonId = ?').bind(l.id).first();
      }
      if (l.status === 'decided') await calendarEffect(c, 'delete', l, '');
      await closeRequests(c, l.id, ['move', 'late', 'cancel', 'rest'], by);
      if (fee && fee.amount) feeTotal += Number(fee.amount);
      if (l.status === 'decided' || l.askedAt) stopped.push({ ...l, fee: fee ? Number(fee.amount || 0) : 0 }); // 調整中（保護者に見せる前）はお知らせに書かない
    }
    const kept = lessons.filter(x => keep.has(x.id));
    const text = `${fullName(s)}さんの受講終了のご連絡を受け、退塾の手続きをしました。\n最終受講日：${mdw(lastDay)}\n\n`
      + `これから受ける授業：\n${kept.length ? kept.map(lessonLine).join('\n') : 'ありません'}\n\n`
      + (stopped.length ? `やめた授業：\n${stopped.map(l => lessonLine(l) + (l.fee ? `（キャンセル料 ${yen(l.fee)}）` : '')).join('\n')}\n\n` : '')
      + '最後の月の授業料は、いつもどおり翌月にお知らせします。';
    const mailed = await familyNotice(c, s.id, '退塾の手続きをしました', text, familyTarget('schedule', { student: s.id, month: lastDay.slice(0, 7) }));
    await audit(c, 'studentWithdraw', s.id, { lastDay, receivedAt: at, kept: kept.length, stopped: stopped.length, feeTotal });
    return { lastDay, kept: kept.length, stopped: stopped.length, feeTotal, mailed };
  },

  'admin/withdrawal/finish': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const s = await studentOf(c, b); sameVersion(s, b);
    if (s.status === 'left') fail('left', 'もう退会になっています');
    if (!s.leaveOn) fail('noPlan', '先に退塾の手続きをしてください');
    if (todayJst(c.now) <= s.leaveOn) fail('beforeLast', `最終受講日（${mdw(s.leaveOn)}）のあとに退会にできます`);
    const rest = (await c.db.prepare("select * from lessons where studentId = ? and status in ('held', 'proposed', 'decided')").bind(s.id).all()).results.filter(l => endMs(l) > c.now);
    if (rest.length) fail('lessonsLeft', `まだ先の授業があります（${rest.map(l => mdw(l.date)).join('・')}）。お休みかキャンセルにしてください`);
    const saved = await c.db.prepare("update students set status = 'left', updatedAt = ?, version = version + 1 where id = ? and version = ?").bind(iso(c.now), s.id, s.version).run();
    if (!saved.meta?.changes) fail('conflict', 'ほかの操作で変わりました。画面を更新してください', 409);
    await audit(c, 'studentLeft', s.id, { leaveOn: s.leaveOn });
    const others = (await c.db.prepare("select count(*) n from students where familyId = ? and id <> ? and status <> 'left'").bind(s.familyId, s.id).first()).n;
    return { siblings: Number(others || 0), familyId: s.familyId };
  },

  'admin/withdrawal/undo': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const s = await studentOf(c, b); sameVersion(s, b);
    if (s.status === 'left') fail('left', 'もう退会になっています。在籍に戻すときは家族の画面で生徒の情報を直してください');
    if (!s.leaveOn) return {};
    await c.db.prepare("update students set leaveOn = '', leaveNoticeAt = '', updatedAt = ?, version = version + 1 where id = ? and version = ?").bind(iso(c.now), s.id, s.version).run();
    await audit(c, 'studentWithdrawUndo', s.id, { leaveOn: s.leaveOn });
    return {};
  },
};
