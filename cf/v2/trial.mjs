// 体験生（まだ入塾していない人）を予定表に臨時で登録する（2026-10-12 本人、手順書 #48）。
// - 家族と生徒の行をそのまま使い、生徒に trial = 1 の印を付ける。メールを持たないので保護者ページの招待もお知らせも出ない。
// - 体験生の授業は、作ると種類が「体験」になり、そのまま決定（仮予定のお知らせ・締め切りなし。Google カレンダーには入る）。
// - 授業の種類「体験」は無料: 請求（plan-calc の studentBilling）にも取消料にも入れない。講師の給与には、ふつうの授業と同じく入る。
// - 入塾は、生徒の画面の「入塾の案内を送る」→ 保護者の申込みで、そのまま trial = 0（2026-10-18。enrollment.mjs）。同じ生徒の行のまま、記録・成績・体験の授業も残る。
//   admin/trials/enroll（印を外すだけ）は、書面などで手続きしたときのために残す。
import { fail, audit, newId, iso } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { normGrade } from '../../assets/v2/grade-options.js';

export const TRIAL_KIND = '体験';
export const isTrialLesson = l => !!l && String(l.kind || '') === TRIAL_KIND;
const todayJst = now => new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z'));
const newLinkCode = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const text = (v, max, name) => { const s = String(v ?? '').trim(); if (s.length > max) fail('tooLong', `${name}は${max}文字以内で入れてください`); return s; };

export const trialRoutes = {
  // 体験生を登録: 名字・名前（名前は空でもよい）・学年・学校・メモ。家族は「◯◯さん」で作る
  'admin/trials/create': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const familyName = text(b.familyName, 40, '名字'), givenName = text(b.givenName, 40, '名前');
    if (!familyName) fail('needName', '名字を入れてください');
    const grade = normGrade(text(b.grade, 20, '学年')), school = text(b.school, 60, '学校'), note = text(b.note, 1000, 'メモ');
    const now = iso(c.now), fid = newId('fa'), sid = newId('su');
    const link = newLinkCode();
    await c.db.batch([
      c.db.prepare("insert into families (id, name, guardianName, email, phone, note, status, testOnly, createdAt, updatedAt) values (?, ?, '', '', '', ?, 'invited', 0, ?, ?)")
        .bind(fid, familyName + 'さん', '体験の問い合わせ', now, now),
      c.db.prepare("insert into students (id, familyId, familyName, givenName, grade, school, note, status, linkCode, trial, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?, 'enrolled', ?, 1, ?, ?)")
        .bind(sid, fid, familyName, givenName, grade, school, note, link, now, now),
    ]);
    await audit(c, 'trialCreate', sid, { familyId: fid });
    return { studentId: sid, familyId: fid };
  },
  // 入塾にする: trial = 0、入塾日（既定は今日）。体験の授業はそのまま「体験」（無料）で残る
  'admin/trials/enroll': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const s = await c.db.prepare('select * from students where id = ?').bind(String(b.studentId || '')).first();
    if (!s) fail('notFound', '生徒が見つかりません', 404);
    if (!s.trial) fail('notTrial', 'この生徒は体験生ではありません');
    const on = String(b.enrolledOn || todayJst(c.now));
    if (!validDate(on)) fail('badDate', '入塾日を確かめてください');
    await c.db.prepare('update students set trial = 0, enrolledOn = ?, updatedAt = ?, version = version + 1 where id = ?').bind(on, iso(c.now), s.id).run();
    await audit(c, 'trialEnroll', s.id, { enrolledOn: on });
    return { studentId: s.id, enrolledOn: on };
  },
};
