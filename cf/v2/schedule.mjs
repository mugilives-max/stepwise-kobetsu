import { familyTarget, targetRefs } from '../../assets/v2/family-target.js';
// 予定（3段目）。授業は行を消さずに状態で表す（migrations-v2/0003_schedule.sql）。
// 段階（2026-10-14 本人決定、2026-10-16 実装。Kura issues/stepwise-lesson-stages、規約 r9 第13〜15条。0026_lesson_stages.sql）:
//   下書き（held。塾だけ）→ 調整中（proposed・askedAt 空。お互いに見える。締め切りなし・メールなし・自動で確定しない）
//   → 確認待ち（proposed・askedAt あり。1 回のお願いで締め切りを 1 つ・メール 1 通）→ 確定（decided）
// - 教室管理者: 下書きを作る・調整中として見せる・確認をお願いする・確定（合意の記録つき）・下書きに戻す・日時の変更・お休み・キャンセル・実施済み・削除（入力ミス）
// - 講師: 自分の担当の授業を見る・実施済みにする・自分の休みを登録する
// - 保護者: 予定を見る、確認待ちの授業に「この日程で大丈夫」（確定）、「変更・お休みの連絡」、予定の共有（テスト・行事・授業ができない日）
// - 生徒: 予定を見る、「変更・お休みの連絡」（許されていれば）、予定の共有
// - 毎日0時10分: 締め切りを過ぎた確認待ちを確定する（autoConfirm）
// カレンダー・Meet と保護者へのメールは、切り替え（settings.live）まで実際には行わない（effects に held で残る）。
import { fail, newId, iso, audit, sha256Hex } from './util.mjs';
import { requireStaff, rolesOf } from './staff.mjs';
import { requireFamily } from './family.mjs';
import { isLive } from './accounts.mjs';
import { createCancelFee, dropCancelFee, usesRate, setRateFee, lessonFee, parseParts, cancelRuleFrom } from './plan-calc.mjs';
import { ratePct } from '../../assets/v2/cancel-rate.js';
import { isPreviewToken, previewSubject } from './preview.mjs';

const CAL_PREFIX = '【塾】';
const ACTIVE = ['held', 'proposed', 'decided', 'done'];
const DAY = 86400e3;

// ---- 日本時間の日付と時刻 ----
export const todayJst = now => new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const nextMonthStart = d => { const [y, m] = d.split('-').map(Number); return (m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0')) + '-01'; };
const toMin = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
const startMs = (date, start) => Date.parse(date + 'T' + start + ':00+09:00');
export const freeDeadline = date => Date.parse(date + 'T23:00:00+09:00') - DAY; // 前日23時
const overlap = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.start) + Number(b.minutes) && toMin(b.start) < toMin(a.start) + Number(a.minutes);
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z'));
const validTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));

// 確認待ちの締め切り（規約 r9 第14条4項）: 1 回のお願いで 1 つにそろえる（締め切りが授業ごとにずれて「確定しました」が毎晩届かないように）。
// お知らせから 3 日以上あと（翌月以降の授業だけなら今月25日と遅い方）、かつ締め切りを置く授業すべての 2 日前まで。
// 2 日前が 3 日後より前に来る近い授業（直前の提案）には締め切りを置かない（第15条1項。無回答では確定せず、「この日程で大丈夫」か合意の記録で確定する）
export function confirmByFor(dates, today, requested) {
  const min = addDays(today, 3);
  let base = min;
  if (requested) { if (!validDate(requested) || requested < min) fail('badConfirmBy', '締め切りはお知らせから3日以上あとの日付にしてください'); base = requested; }
  else if (dates.every(d => d >= nextMonthStart(today))) { const d25 = today.slice(0, 8) + '25'; if (d25 > base) base = d25; }
  const far = dates.filter(d => addDays(d, -2) >= min).sort();
  if (!far.length) return dates.map(() => '');
  const limit = addDays(far[0], -2), by = base < limit ? base : limit;
  return dates.map(d => addDays(d, -2) >= min ? by : '');
}
// 段階（画面の言葉）: draft 下書き / adjusting 調整中 / asking 確認待ち / decided 確定 / done・rested・cancelled
export const stageOf = l => l.status === 'held' ? 'draft' : l.status === 'proposed' ? (l.askedAt ? 'asking' : 'adjusting') : l.status;

// ---- 見せ方 ----
const fullName = s => [s.familyName, s.givenName].filter(Boolean).join(' ');
export function lessonView(l, extra = {}) {
  return { id: l.id, studentId: l.studentId, staffId: l.staffId, date: l.date, start: l.start, minutes: l.minutes, subject: l.subject, kind: l.kind, deliveryMode: l.deliveryMode,
    noticeState: l.noticeState || '', noticeAt: l.noticeAt || '', status: l.status, stage: stageOf(l), asked: !!l.askedAt, confirmBy: l.confirmBy, meetUrl: l.meetUrl, lateStart: !!l.lateStart, lostMinutes: Number(l.lostMinutes || 0), version: l.version, ...extra };
}
// 連絡を受けた時刻（新しい決まりの取消料）。b.noNotice = 連絡なし（''）。b.receivedAt は ISO か 'YYYY-MM-DDTHH:MM'（日本時間）。空なら fallback（ふつうは今）
function noticeAt(c, b, fallback) {
  if (b.noNotice === true) return '';
  const raw = String(b.receivedAt || '');
  if (!raw) return fallback === undefined ? iso(c.now) : fallback;
  const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? Date.parse(raw + ':00+09:00') : Date.parse(raw);
  if (isNaN(ms)) fail('badTime', '連絡を受けた時刻を確かめてください');
  if (ms > c.now + 60e3) fail('futureTime', '連絡を受けた時刻が、今より先になっています');
  return iso(ms);
}
// 保護者へのお知らせに添える取消料の説明
const hm = t => new Date(Date.parse(t) + 9 * 3600e3).toISOString().slice(11, 16);
const feeText = (fee, what) => !fee ? '' : `\n${what}は ${fee.amount.toLocaleString('ja-JP')}円です（${fee.parts.map(p => p.receivedAt ? `${hm(p.receivedAt)} にご連絡、率 ${ratePct(p.rate)}%` : 'ご連絡がなかったため率 100%').join('・')}）。`;
const requestView = r => ({ id: r.id, lessonId: r.lessonId, kind: r.kind, note: r.note, fromKind: r.fromKind, receivedAt: r.receivedAt, status: r.status });
const eventView = e => ({ id: e.id, studentId: e.studentId, kind: e.kind, date: e.date, dateTo: e.dateTo, start: e.start, end: e.end, title: e.title, createdByKind: e.createdByKind, version: e.version });

// ---- カレンダー（切り替え前は held） ----
// 予定の仮の目印（予定ができたら Apps Script が本物の ID「…@google.com」を書き戻す）。目印はそのまま Google の予定 ID に使うので、
// 使える文字は英小文字 a-v と数字だけ（base32hex）。2026-10-14 まで使っていた「swv2…」は w が使えず、作成が毎回断られていた（Kura 調査 #195）。
// 「swv2…」が残っている行も仮の目印として扱い、作り直すときは新しい形の目印にする
export const CAL_MARK = 'v2m';
export const isCalMarker = id => !!id && !String(id).includes('@') && /^(swv2|v2m)/.test(String(id));
export async function calendarEffect(c, kind, lesson, studentName) {
  const live = await isLive(c);
  if (kind === 'delete') {
    if (lesson.calendarEventId && !isCalMarker(lesson.calendarEventId)) c.effects.push({ kind: 'calendarDelete', eventId: lesson.calendarEventId, audience: 'calendar', held: !live });
    return '';
  }
  const marker = lesson.calendarEventId && !isCalMarker(lesson.calendarEventId) ? lesson.calendarEventId : CAL_MARK + sha256Hex(lesson.id + ':' + c.now).slice(0, 40);
  const end = new Date(startMs(lesson.date, lesson.start) + lesson.minutes * 60000).toISOString();
  const body = { summary: CAL_PREFIX + studentName + 'さん ' + (lesson.subject || '授業') + ' (' + (lesson.deliveryMode === 'online' ? 'オンライン' : '対面') + ')',
    start: { dateTime: new Date(startMs(lesson.date, lesson.start)).toISOString(), timeZone: 'Asia/Tokyo' }, end: { dateTime: end, timeZone: 'Asia/Tokyo' },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] }, extendedProperties: { private: { stepwiseLesson: lesson.id } } };
  const wantMeet = lesson.deliveryMode === 'online';
  if (kind === 'create' || isCalMarker(marker)) {
    body.id = marker;
    if (wantMeet) body.conferenceData = { createRequest: { requestId: marker, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
    c.effects.push({ kind: 'calendarCreate', marker, body, wantMeet, audience: 'calendar', held: !live });
  } else c.effects.push({ kind: 'calendarPatch', marker, body, wantMeet, audience: 'calendar', held: !live });
  return marker;
}
// 保護者あての短いお知らせ（中身は保護者ページで見る）。切り替え前は held
// page: 保護者ページの開く画面（例 'confirm' → …/family/#confirm。ログインしていなければ、ログインのあとその画面へ）
export const FAMILY_URL = 'https://www.stepwise-education.jp/family/';
export async function familyNotice(c, studentId, subject, text, page = 'money', notice = null) {
  const s = await c.db.prepare('select f.email, f.testOnly, f.status from students s join families f on f.id = s.familyId where s.id = ?').bind(studentId).first();
  if (!s || !s.email || s.status !== 'active') return false;
  c.effects.push({ kind: 'mail', to: s.email, name: 'ステップワイズ個別指導', subject: '【ステップワイズ】' + subject, body: text + (text.includes('保護者ページ') ? '' : '\n保護者ページでご確認ください。') + '\n\n確認する：\n' + FAMILY_URL + (page ? '#' + page : '') + '\n\nご不明な点・変更のご希望は、いつものLINEまたは mugilives@gmail.com へご連絡ください。', replyTo: 'mugilives@gmail.com', notice, testOnly: !!s.testOnly, audience: 'family', held: !(await isLive(c)) });
  return true;
}
// Bind the exact notice to the lessons it covers (including the MCP sender).
export async function notifySchedule(c,studentId,text,ids) {
  const rows=[];
  for(const id of ids) {const l=await c.db.prepare('select * from lessons where id = ?').bind(id).first();if(l)rows.push(l);}
  const noticeId=newId('notice');
  await c.db.batch(rows.map(l=>c.db.prepare("update lessons set noticeState = 'pending', noticeAt = '', noticeId = ? where id = ? and askedAt = ?").bind(noticeId,l.id,l.askedAt)));
  const sent=await familyNotice(c,studentId,'授業の日程の確認のお願い',text,
    familyTarget('confirm',{student:studentId,month:rows[0]?.date.slice(0,7)}),
    {type:'schedule',targets:rows.map(l=>({id:l.id,askedAt:l.askedAt,noticeId}))});
  if(!sent) await c.db.batch(rows.map(l=>c.db.prepare("update lessons set noticeState = 'hold' where id = ? and askedAt = ?").bind(l.id,l.askedAt)));
}
// 授業の 1 行（お知らせの本文・LINE に貼る文）
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const mdText = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8)) + '(' + WD[new Date(d + 'T00:00:00Z').getUTCDay()] + ')';
const endText = (start, minutes) => { const m = toMin(start) + Number(minutes); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
export const lessonLine = l => `・${mdText(l.date)} ${l.start}〜${endText(l.start, l.minutes)} ${l.subject}${l.kind && l.kind !== '通常' ? '（' + l.kind + '）' : ''}`;
// 確認のお願いの本文（メールと LINE で同じ）。lessons は締め切り（confirmBy）を付けたあとの行
export function askText(name, lessons) {
  const far = lessons.filter(l => l.confirmBy), near = lessons.filter(l => !l.confirmBy);
  let t = `${name}さんの授業の日程の確認をお願いします。\n`;
  if (far.length) t += far.map(lessonLine).join('\n') + `\n${mdText(far[0].confirmBy)}までにご連絡がなければ、この日時で確定します。\n`;
  if (near.length) t += (far.length ? '\n' : '') + near.map(lessonLine).join('\n') + '\n' + (far.length ? '上の授業は' : near.length > 1 ? 'これらの授業は' : 'この授業は') + '日が近いため、ご返事をいただいてから確定します。\n';
  return t + 'これは授業日時の確認です。科目・回数・料金の承認（受講合意書）とは別です。\n保護者ページの「この日程で大丈夫」を押すか、ご都合の悪い授業をお知らせください。';
}
// スタッフ（教室管理者）あてのお知らせ
export async function staffNotice(c, subject, text) {
  const rows = (await c.db.prepare("select email, roles from staff where status = 'active'").all()).results.filter(r => rolesOf(r).includes('manager'));
  for (const r of rows) c.effects.push({ kind: 'mail', to: r.email, name: 'ステップワイズ', subject: '[ステップワイズ] ' + subject, body: text + '\n\nhttps://www.stepwise-education.jp/staff/', audience: 'staff' });
}

// ---- 読み書きの共通 ----
async function getLesson(c, id) { const l = await c.db.prepare('select * from lessons where id = ?').bind(String(id || '')).first(); if (!l) fail('notFound', '授業が見つかりません', 404); return l; }
const sameVersion = (row, b) => { if (Number(b.version) !== Number(row.version)) fail('conflict', 'ほかの操作で変わりました。画面を更新してください', 409); };
async function studentRow(c, id) { const s = await c.db.prepare('select * from students where id = ?').bind(String(id || '')).first(); if (!s) fail('notFound', '生徒が見つかりません', 404); return s; }
async function setLesson(c, l, patch) {
  const cols = Object.keys(patch);
  const saved = await c.db.prepare(`update lessons set ${cols.map(k => k + ' = ?').join(', ')}, updatedAt = ?, version = version + 1 where id = ? and version = ?`)
    .bind(...cols.map(k => patch[k]), iso(c.now), l.id, l.version).run();
  if(!saved.meta?.changes) fail('conflict','ほかの操作で日程が変わりました。画面を更新してください',409);
  return { ...l, ...patch, version: l.version + 1 };
}
async function closeRequests(c, lessonId, kinds, by) {
  await c.db.prepare(`update lessonRequests set status = 'done', resolvedAt = ?, resolvedBy = ?, updatedAt = ?, version = version + 1 where lessonId = ? and status = 'open' and kind in (${kinds.map(() => '?').join(', ')})`)
    .bind(iso(c.now), by, iso(c.now), lessonId, ...kinds).run();
}

// 授業の中身の確かめ（作る・直す共通）
export function lessonFields(b, base = {}) {
  const out = { ...base };
  for (const k of ['date', 'start', 'minutes', 'subject', 'kind', 'deliveryMode', 'staffId']) if (b[k] !== undefined) out[k] = b[k];
  out.minutes = Number(out.minutes);
  if (!validDate(out.date) || !validTime(out.start)) fail('badTime', '日付と開始時刻を確かめてください');
  if (!Number.isInteger(out.minutes) || out.minutes < 15 || out.minutes > 480) fail('badMinutes', '授業の長さは15〜480分にしてください');
  if (toMin(out.start) + out.minutes > 24 * 60) fail('badTime', '日をまたぐ授業は登録できません');
  out.subject = String(out.subject || '').trim(); if (!out.subject || out.subject.length > 30) fail('badSubject', '科目を入れてください');
  out.kind = String(out.kind || '通常').trim().slice(0, 20) || '通常';
  if (!['in_person', 'online'].includes(out.deliveryMode)) fail('badMode', '授業の形式（対面・オンライン）を選んでください');
  out.staffId = String(out.staffId || '');
  return out;
}
// 重なりの確かめ。同じ生徒の授業が重なれば断る。同じ講師は対面2人までなら確かめを求め、オンラインが入るか3人以上なら断る。休み・授業ができない日は、force がなければ確かめを求める
export async function checkConflicts(c, candidates, { force, exceptId = '' } = {}) {
  const dates = [...new Set(candidates.map(x => x.date))];
  const q = `(${dates.map(() => '?').join(', ')})`;
  const lessons = (await c.db.prepare(`select * from lessons where date in ${q} and status in ('held', 'proposed', 'decided', 'done') and id <> ?`).bind(...dates, exceptId).all()).results;
  const offs = (await c.db.prepare(`select * from staffUnavailability where date in ${q}`).bind(...dates).all()).results;
  const events = (await c.db.prepare(`select * from sharedEvents where kind = 'unavailable' and date <= ? and dateTo >= ?`).bind(dates.slice().sort().at(-1), dates.slice().sort()[0]).all()).results;
  const errors = [], warnings = [];
  candidates.forEach((x, i) => {
    const others = lessons.concat(candidates.filter((_, j) => j !== i));
    if (others.some(o => o.studentId === x.studentId && overlap(o, x))) errors.push(`${x.date} ${x.start} は同じ生徒の授業と重なっています`);
    // 同じ講師の授業の重なり: 対面どうしなら2人まで（2人同時の授業。確かめてから）。オンラインが入るなら同時にはできない。給与は講師が働いた時間で数える（重なりは1回。cf/v2/payroll.mjs）
    const same = x.staffId ? others.filter(o => o.staffId === x.staffId && overlap(o, x)) : [];
    if (same.length) {
      if (x.deliveryMode === 'online' || same.some(o => o.deliveryMode === 'online')) errors.push(`${x.date} ${x.start} は同じ講師の授業と重なっています（オンラインの授業は同時にできません）`);
      else if (same.some((o, k) => same.some((p, m) => m > k && overlap(o, p)))) errors.push(`${x.date} ${x.start} は同じ講師の授業が3つ重なります（同時の授業は2人まで）`);
      else warnings.push(`${x.date} ${x.start} は同じ講師のほかの授業と同時（2人同時）になります`);
    }
    const span = o => o.start ? { date: o.date, start: o.start, minutes: toMin(o.end) - toMin(o.start) } : { date: o.date, start: '00:00', minutes: 1440 };
    if (offs.some(o => (!o.staffId || o.staffId === x.staffId) && overlap(span(o), x))) warnings.push(`${x.date} ${x.start} は講師の休みに入っています`);
    if (events.some(e => e.studentId === x.studentId && e.date <= x.date && x.date <= e.dateTo && (!e.start || overlap({ date: x.date, start: e.start, minutes: toMin(e.end) - toMin(e.start) }, x)))) warnings.push(`${x.date} ${x.start} は生徒が「授業ができない」と共有した日です`);
  });
  if (errors.length) fail('overlap', [...new Set(errors)].join('。'), 409);
  if (warnings.length && !force) fail('needForce', [...new Set(warnings)].join('。') + '。それでも登録しますか？', 409, { needForce: true });
}

// 講師が見てよい生徒（担当中か、前後90日に担当した生徒）
async function teacherStudentIds(c, staffId) {
  const today = todayJst(c.now);
  return (await c.db.prepare('select distinct studentId from lessons where staffId = ? and date between ? and ?').bind(staffId, addDays(today, -90), addDays(today, 90)).all()).results.map(r => r.studentId);
}

// ---- 毎日0時10分（Worker の定期実行）: 締め切りを過ぎた確認待ちを確定する（調整中は締め切りがないので確定しない） ----
export async function autoConfirm(c) {
  const today = todayJst(c.now);
  const due = (await c.db.prepare(`select l.*, s.familyName, s.givenName from lessons l join students s on s.id = l.studentId
    where l.status = 'proposed' and l.askedAt <> '' and l.confirmBy <> '' and l.confirmBy < ? and l.date >= ?
    and not exists (select 1 from lessonRequests r where r.lessonId = l.id and r.status = 'open' and r.kind = 'move') order by l.date, l.start`).bind(today, today).all()).results;
  const byStudent = {};
  for (const l of due) {
    if (!['sent','external'].includes(l.noticeState) || !l.noticeAt || l.confirmBy < addDays(todayJst(Date.parse(l.noticeAt)),3)) continue;
    const saved=await c.db.prepare("update lessons set status = 'decided', decidedAt = ?, decidedBy = 'system:auto', agreement = ?, updatedAt = ?, version = version + 1 where id = ? and version = ? and status = 'proposed' and noticeState in ('sent','external') and not exists (select 1 from lessonRequests where lessonId = lessons.id and status = 'open')")
      .bind(iso(c.now),'締め切り（'+l.confirmBy+'）までに連絡なし',iso(c.now),l.id,l.version).run();
    if(!saved.meta?.changes)continue;
    const marker=await calendarEffect(c,'create',l,fullName(l));
    await c.db.prepare('update lessons set calendarEventId = ? where id = ?').bind(marker,l.id).run();
    (byStudent[l.studentId] = byStudent[l.studentId] || []).push(l);
  }
  for (const [sid, list] of Object.entries(byStudent)) {
    await familyNotice(c, sid, '授業の日時が確定しました', `${fullName(list[0])}さんの次の授業の日時が確定しました（締め切りまでにご連絡がなかったため）。\n${list.map(lessonLine).join('\n')}\n変更・お休みは、授業の前日23時までにご連絡ください。`, familyTarget('schedule',{student:sid,month:list[0].date.slice(0,7)}),{type:'lesson',targets:list.map(l=>({id:l.id,version:l.version+1}))});
  }
  if (Object.keys(byStudent).length) { c.actor = { kind: 'system', id: 'autoConfirm' }; await audit(c, 'autoConfirm', '', { lessons: Object.values(byStudent).reduce((n,ls)=>n+ls.length,0) }); }
  return { confirmed: Object.values(byStudent).reduce((n,ls)=>n+ls.length,0), students: Object.keys(byStudent).length };
}

// ---- 生徒・保護者からの「変更・お休みの連絡」 ----
// いつ押したかで選べるものが決まる。rest と cancel は受け付けた時点で授業の状態を変える
export function choicesFor(l, now) {
  if (l.status === 'proposed') return ['move', 'rest'];
  if (l.status !== 'decided') return [];
  if (now <= freeDeadline(l.date)) return ['move', 'rest'];
  return now < startMs(l.date, l.start) ? ['late', 'cancel'] : [];
}
async function lessonRequest(c, studentIds, who, b) {
  const l = await getLesson(c, b.lessonId);
  if (!studentIds.includes(l.studentId) || l.status === 'held') fail('notFound', '授業が見つかりません', 404);
  const kind = String(b.kind || ''), note = String(b.note || '').trim();
  if (!choicesFor(l, c.now).includes(kind)) fail('notNow', kind === 'move' || kind === 'rest' ? '前日23時を過ぎたため、日時の変更・お休みは連絡できません。画面を更新してください' : 'この授業には今この連絡はできません。画面を更新してください', 409);
  if (note.length > 500) fail('tooLong', '500文字以内で書いてください');
  if (kind !== 'rest' || l.status !== 'proposed') if (!note) fail('needNote', kind === 'move' ? '希望の日時などを書いてください' : kind === 'late' ? '何分ほど遅らせたいかを書いてください' : '理由を書いてください');
  if ((await c.db.prepare("select 1 from lessonRequests where lessonId = ? and status = 'open' and kind = ?").bind(l.id, kind).first())) return { lesson: lessonView(l), replayed: true };
  const id = newId('rq'), s = await studentRow(c, l.studentId), name = fullName(s);
  const stmts = [c.db.prepare('insert into lessonRequests (id, lessonId, studentId, kind, note, fromKind, fromId, receivedAt, status, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, l.id, l.studentId, kind, note, who.kind, who.id, iso(c.now), kind === 'rest' ? 'done' : 'open', iso(c.now), iso(c.now))];
  let next = l;
  if (kind === 'rest' || kind === 'cancel') {
    next = { ...l, status: kind === 'rest' ? 'rested' : 'cancelled', version: l.version + 1 };
    stmts.push(c.db.prepare('update lessons set status = ?, updatedAt = ?, version = version + 1 where id = ? and version = ?').bind(next.status, iso(c.now), l.id, l.version));
    if (l.status === 'decided') await calendarEffect(c, 'delete', l, name);
  }
  await c.db.batch(stmts);
  // 取消料: 新しい決まりは連絡を受けた今の時刻で自動に計算。今までの決まりは開始前の連絡なので規定額 1,000円（判断は教室管理者）
  let fee = null;
  if (kind === 'cancel') { if (await usesRate(c.db, l)) fee = await setRateFee(c, l, 'cancel', Number(l.minutes), iso(c.now)); else await createCancelFee(c, l, 'late', iso(c.now)); }
  const when = `${l.date.slice(5).replace('-', '/')} ${l.start}〜（${l.subject}）`, from = who.kind === 'family' ? name + 'さんの保護者' : name + 'さん';
  const title = { move: '日時の変更のお願い', rest: 'お休みの連絡', late: '開始を遅らせたい', cancel: 'キャンセル' }[kind];
  await staffNotice(c, `【${title}】${name}さん`, `${from}から${title}が届きました。\n${when}${l.status === 'proposed' ? (l.askedAt ? '（確認待ち）' : '（調整中）') : ''}\n${note ? '内容: ' + note : ''}${kind === 'cancel' ? (fee ? `\n前日23時を過ぎた連絡です（キャンセル料 ${fee.amount.toLocaleString('ja-JP')}円）。` : '\n前日23時を過ぎた連絡です（キャンセル料の対象）。') : ''}`);
  await audit(c, 'lessonRequest:' + kind, l.id, { request: id });
  return { lesson: lessonView(next), request: { id, kind, status: kind === 'rest' ? 'done' : 'open' }, ...(fee ? { fee: { amount: fee.amount } } : {}) };
}
// 取り下げ: 開始前なら、日時の変更・開始を遅らせたいのお願いを取り下げられる。お休み・キャンセルは授業を決定に戻す
async function withdrawRequest(c, studentIds, b) {
  const r = await c.db.prepare('select * from lessonRequests where id = ?').bind(String(b.requestId || '')).first();
  if (!r || !studentIds.includes(r.studentId)) fail('notFound', '連絡が見つかりません', 404);
  const l = await getLesson(c, r.lessonId);
  if (c.now >= startMs(l.date, l.start)) fail('started', '授業が始まっているため、取り下げられません', 409);
  if (r.status === 'withdrawn') return { lesson: lessonView(l) };
  let next = l;
  if (['rest', 'cancel'].includes(r.kind) && l.status === (r.kind === 'rest' ? 'rested' : 'cancelled')) {
    const back = (await c.db.prepare("select decidedAt from lessons where id = ?").bind(l.id).first()).decidedAt ? 'decided' : 'proposed';
    next = await setLesson(c, l, { status: back });
    if (r.kind === 'cancel') await dropCancelFee(c, l.id);
    if (back === 'decided') next = await setLesson(c, next, { calendarEventId: await calendarEffect(c, 'create', next, fullName(await studentRow(c, l.studentId))) });
  } else if (r.status !== 'open') fail('closed', 'この連絡はもう対応が済んでいます', 409);
  await c.db.prepare("update lessonRequests set status = 'withdrawn', updatedAt = ?, version = version + 1 where id = ?").bind(iso(c.now), r.id).run();
  await audit(c, 'lessonRequestWithdraw', l.id, { request: r.id });
  return { lesson: lessonView(next) };
}

// 生徒・保護者が見る予定（未送信の仮予定は見せない。講師名・メモは出さない）
async function familyScheduleOf(c, studentIds, from, to) {
  if (!studentIds.length) return { lessons: [], events: [], requests: [] };
  const q = `(${studentIds.map(() => '?').join(', ')})`;
  const lessons = (await c.db.prepare(`select * from lessons where studentId in ${q} and date between ? and ? and status <> 'held' order by date, start`).bind(...studentIds, from, to).all()).results;
  const events = (await c.db.prepare(`select * from sharedEvents where studentId in ${q} and dateTo >= ? and date <= ? order by date`).bind(...studentIds, from, to).all()).results;
  const ids = lessons.map(l => l.id);
  const requests = ids.length ? (await c.db.prepare(`select * from lessonRequests where lessonId in (${ids.map(() => '?').join(', ')}) and status <> 'withdrawn' order by receivedAt`).bind(...ids).all()).results : [];
  // 新しい決まりの授業で、開始を遅らせる・キャンセルを選べるものには、取消料の計算に使う1回の授業料を添える（画面で今の金額を出す）
  const quote = {};
  for (const l of lessons) if (choicesFor(l, c.now).includes('cancel') && await usesRate(c.db, l)) quote[l.id] = await lessonFee(c.db, l);
  return {
    lessons: lessons.map(l => { const v = lessonView(l, { choices: choicesFor(l, c.now), requests: requests.filter(r => r.lessonId === l.id).map(requestView), ...(l.id in quote ? { feeBase: quote[l.id] } : {}) }); delete v.staffId; return v; }),
    events: events.map(eventView),
  };
}
function range(b, today) {
  const from = validDate(b.from) ? b.from : addDays(today, -7), to = validDate(b.to) ? b.to : addDays(today, 62);
  if (to < from || Date.parse(to) - Date.parse(from) > 400 * DAY) fail('badRange', '期間を確かめてください');
  return { from, to };
}
export async function studentByLink(c, b) {
  // スタッフのプレビュー（読むだけ。書き込みは index.mjs の入口で断る）
  if (isPreviewToken(b.k)) { const s = await previewSubject(c, b.k, 'student'); if (!s) fail('badLink', 'プレビューの期限が切れました。管理画面からもう一度開いてください', 401); return s; }
  const code = String(b.k || '');
  const s = code && code.length <= 100 ? await c.db.prepare("select * from students where linkCode = ? and linkCode not like 'off.%' and status <> 'left'").bind(code).first() : null;
  if (!s) fail('badLink', '専用リンクが正しくありません。先生から届いたリンクを開き直してください', 401);
  c.actor = { kind: 'student', id: s.id };
  return s;
}
const studentMay = (s, key) => { try { return JSON.parse(s.permissions || '{}')[key] !== false; } catch { return true; } };
const EVENT_KINDS = ['test', 'event', 'unavailable'];
async function addEvent(c, studentId, by, b) {
  const kind = String(b.kind || ''), date = String(b.date || ''), dateTo = String(b.dateTo || b.date || ''), title = String(b.title || '').trim();
  if (!EVENT_KINDS.includes(kind)) fail('badKind', '種類を選んでください（テスト・行事・授業ができない日）');
  if (!validDate(date) || !validDate(dateTo) || dateTo < date || Date.parse(dateTo) - Date.parse(date) > 62 * DAY) fail('badDate', '日付を確かめてください');
  const start = b.start ? String(b.start) : '', end = b.end ? String(b.end) : '';
  if ((start || end) && (!validTime(start) || !validTime(end) || end <= start)) fail('badTime', '時間帯を確かめてください（開始 < 終了）');
  if (title.length > 60 || (kind !== 'unavailable' && !title)) fail('needTitle', '内容を60文字以内で入れてください（例: 2学期中間テスト）');
  const id = newId('ev');
  await c.db.prepare('insert into sharedEvents (id, studentId, kind, date, dateTo, start, end, title, createdByKind, createdById, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, studentId, kind, date, dateTo, start, end, title, by.kind, by.id, iso(c.now), iso(c.now)).run();
  await audit(c, 'eventAdd', id, { kind });
  return { event: eventView(await c.db.prepare('select * from sharedEvents where id = ?').bind(id).first()) };
}
async function deleteEvent(c, studentIds, by, b) {
  const e = await c.db.prepare('select * from sharedEvents where id = ?').bind(String(b.id || '')).first();
  if (!e || (studentIds && !studentIds.includes(e.studentId))) fail('notFound', '予定が見つかりません', 404);
  await c.db.prepare('delete from sharedEvents where id = ?').bind(e.id).run();
  await audit(c, 'eventDelete', e.id);
  return {};
}

// ---- 段階を進める（下書き → 調整中 → 確認待ち）----
// 選んだ授業（b.studentId の、今日以降の、stages のどれか）。1 つでも合わなければ何もしない
async function pickedLessons(c, b, stages) {
  const s = await studentRow(c, b.studentId), today = todayJst(c.now);
  const ids = Array.isArray(b.lessonIds) ? [...new Set(b.lessonIds.map(String))] : [];
  if (!ids.length) fail('needIds', '授業を選んでください');
  if (ids.length > 200) fail('tooMany', '一度に選べるのは200件までです');
  const rows = (await c.db.prepare(`select * from lessons where id in (${ids.map(() => '?').join(', ')})`).bind(...ids).all()).results;
  const problems = ids.map(id => {
    const l = rows.find(r => r.id === id);
    return !l ? { lessonId: id, problem: 'notFound' } : l.studentId !== s.id ? { lessonId: id, problem: 'otherStudent' } : !stages.includes(stageOf(l)) ? { lessonId: id, problem: 'badStage', stage: stageOf(l) } : l.date < today ? { lessonId: id, problem: 'past' } : null;
  }).filter(Boolean);
  if (problems.length) fail('badTargets', problems.some(p => p.problem === 'badStage') ? 'ほかの操作で段階が変わった授業が入っています。画面を読み直してください（何も変えていません）' : '選んだ授業に扱えないものがあります。画面を読み直してください（何も変えていません）', 409, { problems });
  return { s, rows: rows.slice().sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start)), today };
}
const draftsLeft = async (c, sid) => Number((await c.db.prepare("select count(*) n from lessons where studentId = ? and status = 'held' and date >= ?").bind(sid, todayJst(c.now)).first()).n || 0);
// 体験生の授業は確定にして Google カレンダーに入れる（保護者ページもメールもない）
async function decideTrial(c, s, rows) {
  for (const l of rows) {
    const r = await c.db.prepare("update lessons set status = 'decided', kind = ?, confirmBy = '', askedAt = '', decidedAt = ?, decidedBy = ?, updatedAt = ?, version = version + 1 where id = ? and status in ('held', 'proposed')").bind('体験', iso(c.now), 'staff:' + c.actor.id, iso(c.now), l.id).run();
    if (!r.meta || !r.meta.changes) continue;
    const now = await getLesson(c, l.id);
    await c.db.prepare('update lessons set calendarEventId = ? where id = ?').bind(await calendarEffect(c, 'create', now, fullName(s)), l.id).run();
  }
  await audit(c, 'scheduleSend', s.id, { count: rows.length, trial: true });
  return { sent: rows.length, decided: rows.length, trial: true, left: await draftsLeft(c, s.id) };
}
// LINE に貼る文（件名・本文・保護者ページの「日程の確認」。開くとログインのあとその画面）
const lineForLine = text => `【ステップワイズ】${text}\n${FAMILY_URL}#confirm`;
async function askLessons(c, b) {
  await requireStaff(c, b, 'manager');
  const { s, rows, today } = await pickedLessons(c, b, ['draft', 'adjusting']);
  if (s.trial) return decideTrial(c, s, rows);
  const bys = confirmByFor(rows.map(l => l.date), today, b.confirmBy || ''), now = iso(c.now);
  const res = await c.db.batch(rows.map((l, i) => c.db.prepare("update lessons set status = 'proposed', confirmBy = ?, askedAt = ?, updatedAt = ?, version = version + 1 where id = ? and version = ? and status in ('held', 'proposed') and askedAt = ''").bind(bys[i], now, now, l.id, l.version)));
  if (res.some(r => !r.meta || !r.meta.changes)) {
    // 途中でほかの操作が入った: 変えた分を元に戻して止める
    await c.db.batch(rows.map((l, i) => res[i] && res[i].meta && res[i].meta.changes ? c.db.prepare('update lessons set status = ?, confirmBy = ?, askedAt = ?, updatedAt = ?, version = version + 1 where id = ?').bind(l.status, l.confirmBy, '', now, l.id) : null).filter(Boolean));
    fail('conflict', 'ほかの操作で変わりました。画面を読み直してください（何も送っていません）', 409);
  }
  const text = askText(fullName(s), rows.map((l, i) => ({ ...l, confirmBy: bys[i] })));
  await notifySchedule(c, s.id, text, rows.map(l=>l.id));
  await audit(c, 'lessonsAsk', s.id, { count: rows.length, confirmBy: bys.find(Boolean) || '' });
  return { sent: rows.length, asked: rows.length, confirmBy: bys.find(Boolean) || '', near: bys.filter(x => !x).length, lineText: lineForLine(text), left: await draftsLeft(c, s.id) };
}
// 保護者の「この日程で大丈夫」（規約 r9 第14条1項の合意）: 画面で見ていた確認待ちの授業（id と版）をそのまま確定する。
// 見ていたものと違えば（版が変わった・確認待ちでない・連絡を出している）、何も確定しない
async function agreeLessons(c, me, b) {
  const picks = Array.isArray(b.lessons) ? b.lessons.slice(0, 100) : [];
  if (!picks.length) fail('needIds', '確定する授業がありません');
  const mine = (await c.db.prepare('select id from students where familyId = ?').bind(me.id).all()).results.map(r => r.id);
  const rows = [];
  for (const p of picks) {
    const l = await c.db.prepare('select * from lessons where id = ?').bind(String((p && p.id) || '')).first();
    if (!l || !mine.includes(l.studentId)) fail('notFound', '授業が見つかりません', 404);
    if (Number(p.version) !== Number(l.version) || stageOf(l) !== 'asking') fail('conflict', '日程が変わった授業があります。画面を読み直してください（まだ確定していません）', 409);
    if (c.now >= startMs(l.date, l.start)) fail('started', '始まっている授業が入っています。画面を読み直してください', 409);
    if ((await c.db.prepare("select 1 from lessonRequests where lessonId = ? and status = 'open'").bind(l.id).first())) fail('hasRequest', '連絡を出している授業が入っています。先生の返事をお待ちください', 409);
    rows.push(l);
  }
  const who = String(me.guardianName || me.name || '').slice(0, 60);
  if(new Set(rows.map(l=>l.id)).size!==rows.length) fail('duplicate','同じ授業が重複しています');
  const cases=rows.map(()=>'(id = ? and version = ?)').join(' or ');
  const params=rows.flatMap(l=>[l.id,l.version]);
  const guard="status = 'proposed' and askedAt <> '' and not exists (select 1 from lessonRequests r where r.lessonId = lessons.id and r.status = 'open')";
  const saved=await c.db.prepare("update lessons set status = 'decided', decidedAt = ?, decidedBy = ?, agreement = ?, updatedAt = ?, version = version + 1 where ("+cases+") and "+guard+" and (select count(*) from lessons where ("+cases+") and "+guard+") = ?")
    .bind(iso(c.now),'family:'+me.id,'保護者ページ「この日程で大丈夫」'+(who?'（'+who+'）':''),iso(c.now),...params,...params,rows.length).run();
  if(Number(saved.meta?.changes)!==rows.length) fail('conflict','日程が変わりました。画面を読み直してください（まだ確定していません）',409);
  const done=[];
  for(const l of rows) {
    const st=await studentRow(c,l.studentId), next=await getLesson(c,l.id);
    const marker=await calendarEffect(c,'create',next,fullName(st));
    await c.db.prepare('update lessons set calendarEventId = ? where id = ?').bind(marker,l.id).run();
    done.push({...next,calendarEventId:marker});
    await audit(c,'lessonAgree',l.id);
  }
  const bySid = {}; done.forEach(l => { (bySid[l.studentId] = bySid[l.studentId] || []).push(l); });
  for (const [sid, list] of Object.entries(bySid)) { const s = await studentRow(c, sid); await staffNotice(c, `【日程の確認】${fullName(s)}さん`, `${fullName(s)}さんの保護者が「この日程で大丈夫」を押しました。次の授業を確定しました。\n${list.map(lessonLine).join('\n')}`); }
  return { decided: done.length, lessons: done.map(l => lessonView(l)) };
}

export const scheduleRoutes = {
  // Recovery is a new notice with a fresh response window, never a change to consent.
  'schedule/lessons/renotify': async (c,b) => {
    await requireStaff(c,b,'manager');
    const {s,rows,today}=await pickedLessons(c,b,['asking']);
    const via=String(b.via||'email'), note=String(b.note||'').trim();
    if(!['email','LINE','電話','対面'].includes(via)) fail('badVia','連絡方法を選んでください');
    if(b.preview!==true && via!=='email' && !note) fail('needEvidence','実際に案内した日時と内容が分かる記録を書いてください');
    const bys=confirmByFor(rows.map(l=>l.date),today,b.confirmBy||''), now=iso(c.now);
    if(b.preview===true)return {lineText:lineForLine(askText(fullName(s),rows.map((l,i)=>({...l,confirmBy:bys[i]})))),confirmBy:bys.find(Boolean)||''};
    await c.db.batch(rows.map((l,i)=>c.db.prepare("update lessons set askedAt = ?, confirmBy = ?, noticeState = ?, noticeAt = ?, updatedAt = ?, version = version + 1 where id = ? and version = ?")
      .bind(now,bys[i],via==='email'?'pending':'external',via==='email'?'':now,now,l.id,l.version)));
    const text=askText(fullName(s),rows.map((l,i)=>({...l,confirmBy:bys[i]})));
    if(via==='email') await notifySchedule(c,s.id,text,rows.map(l=>l.id));
    await audit(c,'scheduleRenotice',s.id,{ids:rows.map(l=>l.id),via,note,at:now,deadlines:bys});
    return {asked:rows.length,lineText:lineForLine(text),confirmBy:bys.find(Boolean)||''};
  },

  // ---- スタッフ ----
  'schedule/staff/range': async (c, b) => {
    const me = await requireStaff(c, b, 'manager', 'teacher'), manager = rolesOf(me).includes('manager');
    const { from, to } = range(b, todayJst(c.now));
    let lessons = (await c.db.prepare('select * from lessons where date between ? and ? order by date, start').bind(from, to).all()).results;
    let allowed = null;
    if (!manager) { allowed = await teacherStudentIds(c, me.id); lessons = lessons.filter(l => l.staffId === me.id); }
    if (b.studentId) lessons = lessons.filter(l => l.studentId === b.studentId);
    const students = (await c.db.prepare('select * from students').all()).results.filter(s => !allowed || allowed.includes(s.id));
    const staff = (await c.db.prepare("select id, name, roles, status from staff where status = 'active'").all()).results;
    const ids = lessons.map(l => l.id);
    const requests = ids.length ? (await c.db.prepare(`select * from lessonRequests where lessonId in (${ids.map(() => '?').join(', ')}) and status <> 'withdrawn'`).bind(...ids).all()).results : [];
    const openRequests = manager ? (await c.db.prepare("select r.*, l.date, l.start, l.subject, l.status lessonStatus from lessonRequests r join lessons l on l.id = r.lessonId where r.status = 'open' order by r.receivedAt").all()).results : [];
    const nameOf = Object.fromEntries(students.map(s => [s.id, fullName(s)]));
    const events = (await c.db.prepare('select * from sharedEvents where dateTo >= ? and date <= ? order by date').bind(from, to).all()).results.filter(e => !allowed || allowed.includes(e.studentId));
    const offs = (await c.db.prepare('select * from staffUnavailability where date between ? and ? order by date, start').bind(from, to).all()).results.filter(o => manager || !o.staffId || o.staffId === me.id);
    const meetings = manager ? (await c.db.prepare("select * from meetings where date between ? and ? and status <> 'cancelled' order by date, start").bind(from, to).all()).results : [];
    const kinds = (await c.db.prepare('select name from lessonKinds where active = 1 order by sortOrder, name').all()).results.map(k => k.name);
    // 下書きと調整中（今日以降）は、表示している月に限らず全部（「対応すること」で選んで、見せる・確認をお願いする）
    const heldAll = manager ? (await c.db.prepare("select * from lessons where status = 'held' and date >= ? order by date, start").bind(todayJst(c.now)).all()).results : [];
    const adjustingAll = manager ? (await c.db.prepare("select * from lessons where status = 'proposed' and askedAt = '' and date >= ? order by date, start").bind(todayJst(c.now)).all()).results : [];
    return {
      from, to, today: todayJst(c.now),
      heldAll: heldAll.map(l => lessonView(l, { studentName: nameOf[l.studentId] || '（不明）', note: l.note })),
      adjustingAll: adjustingAll.map(l => lessonView(l, { studentName: nameOf[l.studentId] || '（不明）', note: l.note })),
      lessons: lessons.map(l => lessonView(l, { studentName: nameOf[l.studentId] || '（不明）', note: l.note, agreement: l.agreement || '', decidedBy: l.decidedBy || '', requests: requests.filter(r => r.lessonId === l.id).map(requestView) })),
      openRequests: openRequests.map(r => ({ ...requestView(r), studentName: nameOf[r.studentId] || '', date: r.date, start: r.start, subject: r.subject, lessonStatus: r.lessonStatus })),
      events: events.map(e => ({ ...eventView(e), studentName: nameOf[e.studentId] || '' })),
      unavailability: offs.map(o => ({ id: o.id, staffId: o.staffId, date: o.date, start: o.start, end: o.end, note: o.note })),
      meetings: meetings.map(m => ({ id: m.id, familyId: m.familyId, withName: m.withName || '', studentId: m.studentId, staffId: m.staffId, date: m.date, start: m.start, minutes: m.minutes, deliveryMode: m.deliveryMode, title: m.title, meetUrl: m.meetUrl, status: m.status, version: m.version })),
      students: students.filter(s => s.status !== 'left').map(s => ({ id: s.id, name: fullName(s), familyId: s.familyId, deliveryMode: s.deliveryMode, trial: !!s.trial })),
      staff: staff.map(s => ({ id: s.id, name: s.name, teacher: rolesOf(s).includes('teacher') })),
      kinds: kinds.length ? kinds : ['通常'], live: await isLive(c), cancelRuleFrom: await cancelRuleFrom(c.db),
    };
  },
  // 仮予定を作る。hold=true は予定表にまとめてあとで送る（生徒・保護者に見せない）
  'schedule/lessons/create': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const s = await studentRow(c, b.studentId);
    if (s.status === 'left') fail('left', '退会した生徒には授業を登録できません');
    const repeat = Number(b.repeat || 1);
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 12) fail('badRepeat', 'くり返しは1〜12回にしてください');
    // 体験生（trial）の授業は、種類を選んでいても必ず「体験」にする（無料。請求・取消料に入らない）
    const rows = [b, ...(Array.isArray(b.extra) ? b.extra.slice(0, 11) : [])].map(x => lessonFields({ ...x, date: b.date, ...(s.trial ? { kind: '体験' } : {}) }));
    const today = todayJst(c.now);
    const candidates = [];
    for (let w = 0; w < repeat; w++) for (const x of rows) candidates.push({ ...x, studentId: s.id, date: addDays(b.date, w * 7) });
    // 実施した授業をあとから登録する（done）: 今日までの日付で、はじめから実施済み。仮予定のお知らせも締め切りも無い。
    // 請求は、その月の承認済みの計画に（科目・種類が合う行へ）入る（2026-10-11 本人「授業を実施済みなのですが、授業計画も送ってないし、過去の記録だし」）
    // 送り方（send）: hold 下書き / show 調整中として見せる（メールなし）/ ask 確認をお願いする（締め切りとメール 1 通）/ done 実施済み。
    // 古い呼び出し（hold・done の印だけ。何もなければ今までの「今すぐ送る」）も受ける
    const mode = b.done === true || b.send === 'done' ? 'done' : b.hold === true ? 'hold' : ['hold', 'show', 'ask'].includes(b.send) ? b.send : 'ask';
    const done = mode === 'done', trial = !!s.trial && !done && mode !== 'hold'; // 体験生はお知らせ先がないので、そのまま確定
    if (done && candidates.some(x => x.date > today)) fail('future', '実施済みで登録できるのは今日までの授業です');
    if (!done && candidates.some(x => x.date < today)) fail('past', '過去の日付には授業を作れません。実施した授業なら「実施済みとして登録」にしてください');
    await checkConflicts(c, candidates, { force: !!b.force });
    const hold = mode === 'hold', ask = mode === 'ask' && !trial, bys = ask ? confirmByFor(candidates.map(x => x.date), today, b.confirmBy || '') : candidates.map(() => '');
    const status = done ? 'done' : hold ? 'held' : trial ? 'decided' : 'proposed';
    const stmts = candidates.map((x, i) => c.db.prepare('insert into lessons (id, studentId, staffId, date, start, minutes, subject, kind, deliveryMode, status, confirmBy, askedAt, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(x.id = newId('ls'), s.id, x.staffId, x.date, x.start, x.minutes, x.subject, x.kind, x.deliveryMode, status, bys[i], ask ? iso(c.now) : '', iso(c.now), iso(c.now)));
    await c.db.batch(stmts);
    if (done) { await audit(c, 'lessonsDone', s.id, { count: candidates.length, dates: candidates.map(x => x.date) }); return { created: candidates.length, done: true }; }
    if (trial) {
      for (const x of candidates) {
        const l = await getLesson(c, x.id);
        await c.db.prepare("update lessons set decidedAt = ?, decidedBy = ?, calendarEventId = ? where id = ?").bind(iso(c.now), 'staff:' + c.actor.id, await calendarEffect(c, 'create', l, fullName(s)), l.id).run();
      }
      await audit(c, 'lessonsTrial', s.id, { count: candidates.length });
      return { created: candidates.length, decided: true, trial: true };
    }
    let lineText = '';
    if (ask) {
      lineText = askText(fullName(s), candidates.map((x, i) => ({ ...x, confirmBy: bys[i] })));
      await notifySchedule(c, s.id, lineText, candidates.map(l=>l.id));
    }
    await audit(c, hold ? 'lessonsHold' : ask ? 'lessonsAsk' : 'lessonsShow', s.id, { count: candidates.length });
    return { created: candidates.length, held: hold, shown: mode === 'show', asked: ask, confirmBy: bys.find(Boolean) || '', near: ask ? bys.filter(x => !x).length : 0, ...(ask ? { lineText: lineForLine(lineText) } : {}) };
  },
  // 下書きを調整中として見せる（保護者・生徒のページに出す。締め切りなし・メールなし）。体験生は確定にする（お知らせ先がない）
  'schedule/lessons/show': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const { s, rows } = await pickedLessons(c, b, ['draft']);
    if (s.trial) return decideTrial(c, s, rows);
    await c.db.batch(rows.map(l => c.db.prepare("update lessons set status = 'proposed', confirmBy = '', askedAt = '', updatedAt = ?, version = version + 1 where id = ? and status = 'held'").bind(iso(c.now), l.id)));
    await audit(c, 'lessonsShow', s.id, { count: rows.length });
    return { shown: rows.length, left: await draftsLeft(c, s.id) };
  },
  // 確認をお願いする（下書き・調整中 → 確認待ち）。選んだ授業に締め切りを 1 つ付けて、保護者に 1 通。LINE に貼る文も返す
  'schedule/lessons/ask': async (c, b) => askLessons(c, b),
  'schedule/lessons/sendHeld': async (c, b) => askLessons(c, b), // 古い画面（予定表を送る）。確認のお願いと同じ
  // 下書きに戻す（調整中・確認待ち → 下書き）。保護者・生徒のページから消える。メールなし。開いている「日時の変更のお願い」は済みにする
  'schedule/lessons/unsend': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const l = await getLesson(c, b.id); sameVersion(l, b);
    if (l.status !== 'proposed') fail('badStatus', '調整中・確認待ちの授業だけ下書きに戻せます');
    const next = await setLesson(c, l, { status: 'held', confirmBy: '', askedAt: '' });
    await closeRequests(c, l.id, ['move'], 'staff:' + c.actor.id);
    await audit(c, 'lessonUnsend', l.id);
    return { lesson: lessonView(next) };
  },
  // 先生が確定する（LINE・電話・面談などで日時に合意したとき。直前の授業や締め切りのない授業も）。agreement に合意の記録（手段・日時・相手。規約 r9 第14条1項・第11条5項）
  'schedule/lessons/decide': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const l = await getLesson(c, b.id); sameVersion(l, b);
    if (!['held', 'proposed'].includes(l.status)) fail('badStatus', '下書き・調整中・確認待ちの授業だけ確定できます');
    const s = await studentRow(c, l.studentId);
    const agreement = String(b.agreement || '').trim().slice(0, 200);
    const next = await setLesson(c, l, { status: 'decided', decidedAt: iso(c.now), decidedBy: 'staff:' + c.actor.id, agreement, calendarEventId: '' });
    const done = await setLesson(c, next, { calendarEventId: await calendarEffect(c, 'create', next, fullName(s)) });
    await closeRequests(c, l.id, ['move'], 'staff:' + c.actor.id);
    await audit(c, 'lessonDecide', l.id);
    return { lesson: lessonView(done) };
  },
  // 日時・長さ・科目・形式・担当を直す。日時を直すと「日時の変更のお願い」は済みになる。前日23時を過ぎた開始時刻の変更は lateStart で記録（料金は変わらない）
  'schedule/lessons/update': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const l = await getLesson(c, b.id); sameVersion(l, b);
    if (!['held', 'proposed', 'decided'].includes(l.status)) fail('badStatus', 'この授業は直せません');
    const n = lessonFields(b, l);
    const moved = n.date !== l.date || n.start !== l.start || n.minutes !== l.minutes;
    if (moved || n.staffId !== l.staffId || n.deliveryMode !== l.deliveryMode) await checkConflicts(c, [{ ...n, studentId: l.studentId }], { force: !!b.force, exceptId: l.id });
    const patch = { date: n.date, start: n.start, minutes: n.minutes, subject: n.subject, kind: n.kind, deliveryMode: n.deliveryMode, staffId: n.staffId };
    // 確認待ちの日時を変えたら調整中に戻す（締め切りを外す。新しい日時は、もう一度確認をお願いしたときに新しい締め切りで知らせる）
    const backToAdjusting = moved && l.status === 'proposed' && !!l.askedAt;
    if (backToAdjusting) { patch.askedAt = ''; patch.confirmBy = ''; }
    if (b.note !== undefined) patch.note = String(b.note).slice(0, 1000);
    const late = moved && l.status === 'decided' && c.now > freeDeadline(l.date) && b.lateStart === true;
    if (late) patch.lateStart = 1;
    // 新しい決まり: 生徒の申し出で開始を遅らせた（塾が承諾した）ら、遅らせた分の取消料（規約案 第6条）。連絡の時刻は、指定がなければ「開始を遅らせたい」の連絡の時刻、なければ今
    let delay = null;
    if (late && n.date === l.date && await usesRate(c.db, l)) {
      const cur = await c.db.prepare('select * from cancellationFees where lessonId = ?').bind(l.id).first();
      const prev = cur ? parseParts(cur).find(p => p.reason === 'delay') : null;
      const orig = prev && prev.start ? { ...l, start: prev.start, minutes: prev.of } : l;
      const ask = await c.db.prepare("select receivedAt from lessonRequests where lessonId = ? and kind = 'late' and status <> 'withdrawn' order by receivedAt desc").bind(l.id).first();
      const mins = Math.max(0, toMin(n.start) - toMin(orig.start));
      delay = { orig, mins, at: noticeAt(c, b, prev ? prev.receivedAt : ask ? ask.receivedAt : iso(c.now)) };
    }
    let next = await setLesson(c, l, patch);
    if (delay) delay.fee = await setRateFee(c, delay.orig, 'delay', delay.mins, delay.at);
    if (l.status === 'decided' && (moved || n.subject !== l.subject || n.deliveryMode !== l.deliveryMode)) next = await setLesson(c, next, { calendarEventId: await calendarEffect(c, 'patch', next, fullName(await studentRow(c, l.studentId))) });
    if (moved) {
      await closeRequests(c, l.id, ['move', 'late'], 'staff:' + c.actor.id);
      // メールは確定した授業だけ（調整中・確認待ちはページの表示が変わるだけ）
      if (l.status === 'decided') await familyNotice(c, l.studentId, '授業の日時を変更しました', `${fullName(await studentRow(c,l.studentId))}さん ${l.subject}の授業の日時を変更しました。\n変更前: ${l.date} ${l.start}（${l.minutes}分）\n変更後: ${n.date} ${n.start}（${n.minutes}分）${delay ? feeText(delay.fee, '開始を遅らせた分の取消料') : ''}`,familyTarget('schedule',{student:l.studentId,month:n.date.slice(0,7),kind:'lesson',refs:n.id+'.'+n.version}),{type:'lesson',targets:[{id:n.id,version:n.version}]});
    }
    await audit(c, 'lessonUpdate', l.id, { moved, lateStart: !!patch.lateStart, ...(delay ? { delayMinutes: delay.mins } : {}) });
    return { lesson: lessonView(next), backToAdjusting, ...(delay && delay.fee ? { fee: { amount: delay.fee.amount } } : {}) };
  },
  // 先生が記録するお休み・キャンセル（LINE などで連絡を受けたとき）。生徒・保護者からの連絡も、ここで済みにする
  'schedule/lessons/rest': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const l = await getLesson(c, b.id); sameVersion(l, b);
    if (!['proposed', 'decided'].includes(l.status)) fail('badStatus', '調整中・確認待ち・確定した授業だけお休みにできます');
    const next = await setLesson(c, l, { status: 'rested' });
    if (l.status === 'decided') await calendarEffect(c, 'delete', l, '');
    await closeRequests(c, l.id, ['move', 'late', 'rest'], 'staff:' + c.actor.id);
    await audit(c, 'lessonRest', l.id);
    return { lesson: lessonView(next) };
  },
  'schedule/lessons/cancel': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const l = await getLesson(c, b.id); sameVersion(l, b);
    if (l.status !== 'decided') fail('badStatus', '決定した授業だけキャンセルにできます');
    let fee = null, next;
    if (await usesRate(c.db, l)) {
      // 新しい決まり: 連絡を受けた時刻（b.receivedAt。連絡なしは b.noNotice）の率で自動に計算（規約案 第4・5条）
      const at = noticeAt(c, b);
      if (at && Date.parse(at) <= freeDeadline(l.date)) fail('useRest', '前日23時までの連絡なので、「お休みにする」を使ってください');
      next = await setLesson(c, l, { status: 'cancelled' });
      fee = await setRateFee(c, l, 'cancel', Number(l.minutes), at);
    } else {
      // 今までの決まり: 指定がなければ、今が開始前なら late（1,000円）、開始後なら noshow（授業料）
      const type = ['late', 'noshow'].includes(b.feeType) ? b.feeType : c.now < startMs(l.date, l.start) ? 'late' : 'noshow';
      next = await setLesson(c, l, { status: 'cancelled' });
      await createCancelFee(c, l, type, type === 'late' ? iso(c.now) : '');
    }
    // 保護者へのお知らせ（切り替え前は送らずに残す）
    const st = await c.db.prepare('select familyName, givenName from students where id = ?').bind(l.studentId).first();
    const wd = '日月火水木金土'[new Date(l.date + 'T00:00:00Z').getUTCDay()];
    await familyNotice(c, l.studentId, '授業をキャンセルしました', `${st ? [st.familyName, st.givenName].filter(Boolean).join(' ') + 'さんの' : ''}${Number(l.date.slice(5, 7))}/${Number(l.date.slice(8))}(${wd}) ${l.start}〜 ${l.subject}の授業をキャンセルしました。${feeText(fee, 'キャンセル料')}\nこの通知だけでのお振込みは不要です。料金がある場合は請求の案内をご確認ください。`,familyTarget('schedule',{student:l.studentId,month:l.date.slice(0,7),kind:'lesson',refs:l.id+'.'+(l.version+1)}),{type:'lesson',targets:[{id:l.id,version:l.version+1}]});
    await calendarEffect(c, 'delete', l, '');
    await closeRequests(c, l.id, ['move', 'late', 'cancel', 'rest'], 'staff:' + c.actor.id);
    await audit(c, 'lessonCancel', l.id, fee ? { amount: fee.amount } : {});
    return { lesson: lessonView(next), ...(fee ? { fee: { amount: fee.amount } } : {}) };
  },
  // 実施済み（教室管理者か、担当の講師）
  'schedule/lessons/done': async (c, b) => {
    const me = await requireStaff(c, b, 'manager', 'teacher');
    const l = await getLesson(c, b.id); sameVersion(l, b);
    if (!rolesOf(me).includes('manager') && l.staffId !== me.id) fail('forbidden', '担当の授業だけ実施済みにできます', 403);
    if (l.status !== 'decided') fail('badStatus', '決定した授業だけ実施済みにできます');
    if (l.date > todayJst(c.now)) fail('future', 'まだ授業の日になっていません');
    const next = await setLesson(c, l, { status: 'done' });
    await closeRequests(c, l.id, ['late'], 'staff:' + c.actor.id);
    await audit(c, 'lessonDone', l.id);
    return { lesson: lessonView(next) };
  },
  // 遅刻（新しい決まりの授業だけ。規約案 第7条）。授業は予定の時刻に終わり、遅れた分は授業料に入れず、連絡を受けた時刻の率で取消料にする。
  // lateMinutes = 0 で取り消し。教室管理者か、担当の講師
  'schedule/lessons/tardy': async (c, b) => {
    const me = await requireStaff(c, b, 'manager', 'teacher');
    const l = await getLesson(c, b.id); sameVersion(l, b);
    if (!rolesOf(me).includes('manager') && l.staffId !== me.id) fail('forbidden', '担当の授業だけ記録できます', 403);
    if (!['decided', 'done'].includes(l.status)) fail('badStatus', '決定・実施済みの授業だけ遅刻を記録できます');
    if (!(await usesRate(c.db, l))) fail('oldRule', 'この授業は今までの決まりなので、遅刻の取消料はかかりません');
    if (c.now < startMs(l.date, l.start)) fail('notStarted', '授業が始まってから記録してください');
    if (l.invoiceId) fail('invoiced', '請求に入った授業は直せません', 409);
    const mins = Number(b.lateMinutes);
    if (!Number.isInteger(mins) || mins < 0 || mins >= Number(l.minutes)) fail('badMinutes', `遅れた分数は0〜${Number(l.minutes) - 1}分にしてください（来なかったときはキャンセルにします）`);
    const at = mins ? noticeAt(c, b, '') : '';
    const fee = await setRateFee(c, l, 'tardy', mins, at);
    const next = await setLesson(c, l, { lostMinutes: mins });
    await audit(c, 'lessonTardy', l.id, { minutes: mins, ...(fee ? { amount: fee.amount } : {}) });
    return { lesson: lessonView(next), fee: fee ? { amount: fee.amount } : null };
  },
  // 入力ミスの削除（記録を残さない）。実施済みは消せない
  'schedule/lessons/delete': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const l = await getLesson(c, b.id); sameVersion(l, b);
    if (l.status === 'done') fail('badStatus', '実施済みの授業は消せません');
    if ((await c.db.prepare("select 1 from cancellationFees where lessonId = ? and invoiceId <> ''").bind(l.id).first())) fail('invoiced', 'キャンセル料を請求した授業は消せません', 409);
    if (l.status === 'decided') await calendarEffect(c, 'delete', l, '');
    await c.db.batch([c.db.prepare('delete from lessonRequests where lessonId = ?').bind(l.id), c.db.prepare('delete from cancellationFees where lessonId = ?').bind(l.id), c.db.prepare('delete from lessons where id = ?').bind(l.id)]);
    await audit(c, 'lessonDelete', l.id, { date: l.date, start: l.start, status: l.status });
    return {};
  },
  'schedule/requests/resolve': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const r = await c.db.prepare('select * from lessonRequests where id = ?').bind(String(b.id || '')).first();
    if (!r) fail('notFound', '連絡が見つかりません', 404);
    await c.db.prepare("update lessonRequests set status = 'done', resolvedAt = ?, resolvedBy = ?, updatedAt = ?, version = version + 1 where id = ? and status = 'open'").bind(iso(c.now), 'staff:' + c.actor.id, iso(c.now), r.id).run();
    await audit(c, 'requestResolve', r.lessonId, { request: r.id });
    return {};
  },
  // 講師の休み（講師は自分の分、教室管理者は全員分と教室全体）
  'schedule/unavailability/add': async (c, b) => {
    const me = await requireStaff(c, b, 'manager', 'teacher'), manager = rolesOf(me).includes('manager');
    const staffId = manager ? String(b.staffId ?? me.id) : me.id;
    const date = String(b.date || ''), start = b.start ? String(b.start) : '', end = b.end ? String(b.end) : '';
    if (!validDate(date)) fail('badDate', '日付を確かめてください');
    if ((start || end) && (!validTime(start) || !validTime(end) || end <= start)) fail('badTime', '時間帯を確かめてください（開始 < 終了）。終日なら空のまま');
    const id = newId('un');
    await c.db.prepare('insert into staffUnavailability (id, staffId, date, start, end, note, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, staffId, date, start, end, String(b.note || '').slice(0, 100), iso(c.now), iso(c.now)).run();
    await audit(c, 'unavailabilityAdd', id);
    return { id };
  },
  'schedule/unavailability/delete': async (c, b) => {
    const me = await requireStaff(c, b, 'manager', 'teacher');
    const o = await c.db.prepare('select * from staffUnavailability where id = ?').bind(String(b.id || '')).first();
    if (!o || (!rolesOf(me).includes('manager') && o.staffId !== me.id)) fail('notFound', '休みが見つかりません', 404);
    await c.db.prepare('delete from staffUnavailability where id = ?').bind(o.id).run();
    await audit(c, 'unavailabilityDelete', o.id);
    return {};
  },
  'schedule/events/add': async (c, b) => { await requireStaff(c, b, 'manager'); await studentRow(c, b.studentId); return addEvent(c, String(b.studentId), { kind: 'staff', id: c.actor.id }, b); },
  'schedule/events/delete': async (c, b) => { await requireStaff(c, b, 'manager'); return deleteEvent(c, null, null, b); },
  // 面談。登録した家族（familyId）か、登録していない人（withName に名前。問い合わせ・体験前。2026-10-11）
  'schedule/meetings/create': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const familyId = String(b.familyId || ''), withName = String(b.withName || '').trim().slice(0, 60);
    const fam = familyId ? await c.db.prepare('select * from families where id = ?').bind(familyId).first() : null;
    if (familyId && !fam) fail('notFound', '家族が見つかりません', 404);
    if (!fam && !withName) fail('needWho', '相手を選ぶか、登録していない人の名前を入れてください');
    const date = String(b.date || ''), start = String(b.start || ''), minutes = Number(b.minutes || 30);
    if (!validDate(date) || !validTime(start) || !Number.isInteger(minutes) || minutes < 10 || minutes > 180) fail('badTime', '日時と長さを確かめてください');
    const id = newId('mt'), mode = b.deliveryMode === 'online' ? 'online' : 'in_person';
    await c.db.prepare('insert into meetings (id, familyId, withName, studentId, staffId, date, start, minutes, deliveryMode, title, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, fam ? fam.id : '', fam ? '' : withName, fam ? String(b.studentId || '') : '', String(b.staffId || c.actor.id), date, start, minutes, mode, String(b.title || '面談').slice(0, 60), iso(c.now), iso(c.now)).run();
    const m = await c.db.prepare('select * from meetings where id = ?').bind(id).first();
    const marker = await calendarEffect(c, 'create', { ...m, id, subject: m.title, calendarEventId: '' }, fam ? fam.name.replace(/さん$/, '') : withName);
    await c.db.prepare('update meetings set calendarEventId = ? where id = ?').bind(marker, id).run();
    await audit(c, 'meetingCreate', id);
    return { id };
  },
  'schedule/meetings/cancel': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const m = await c.db.prepare('select * from meetings where id = ?').bind(String(b.id || '')).first();
    if (!m || m.status !== 'scheduled') fail('notFound', '面談が見つかりません', 404);
    await c.db.prepare("update meetings set status = 'cancelled', updatedAt = ?, version = version + 1 where id = ?").bind(iso(c.now), m.id).run();
    await calendarEffect(c, 'delete', m, '');
    await audit(c, 'meetingCancel', m.id);
    return {};
  },

  // ---- 保護者 ----
  'family/schedule': async (c, b) => {
    const me = await requireFamily(c, b), { from, to } = range(b, todayJst(c.now));
    const kids = (await c.db.prepare("select * from students where familyId = ? and status <> 'left'").bind(me.id).all()).results;
    return { today: todayJst(c.now), students: kids.map(s => ({ id: s.id, name: fullName(s) })), ...(await familyScheduleOf(c, kids.map(s => s.id), from, to)) };
  },
  'family/lessons/request': async (c, b) => { const me = await requireFamily(c, b); const ids = (await c.db.prepare('select id from students where familyId = ?').bind(me.id).all()).results.map(r => r.id); return lessonRequest(c, ids, { kind: 'family', id: me.id }, b); },
  'family/lessons/agree': async (c, b) => agreeLessons(c, await requireFamily(c, b), b),
  'family/lessons/withdraw': async (c, b) => { const me = await requireFamily(c, b); const ids = (await c.db.prepare('select id from students where familyId = ?').bind(me.id).all()).results.map(r => r.id); return withdrawRequest(c, ids, b); },
  'family/events/add': async (c, b) => { const me = await requireFamily(c, b); const s = await studentRow(c, b.studentId); if (s.familyId !== me.id) fail('notFound', '生徒が見つかりません', 404); return addEvent(c, s.id, { kind: 'family', id: me.id }, b); },
  'family/events/delete': async (c, b) => { const me = await requireFamily(c, b); const ids = (await c.db.prepare('select id from students where familyId = ?').bind(me.id).all()).results.map(r => r.id); return deleteEvent(c, ids, null, b); },

  // ---- 生徒（専用リンク）。保護者が「保護者だけ」にした操作はできない ----
  'student/schedule': async (c, b) => { const s = await studentByLink(c, b), { from, to } = range(b, todayJst(c.now)); return { today: todayJst(c.now), me: { id: s.id, name: fullName(s) }, permissions: { reschedule: studentMay(s, 'reschedule'), events: studentMay(s, 'events') }, ...(await familyScheduleOf(c, [s.id], from, to)) }; },
  'student/lessons/request': async (c, b) => { const s = await studentByLink(c, b); if (!studentMay(s, 'reschedule')) fail('forbidden', 'この連絡は保護者の方からお願いします', 403); return lessonRequest(c, [s.id], { kind: 'student', id: s.id }, b); },
  'student/lessons/withdraw': async (c, b) => { const s = await studentByLink(c, b); if (!studentMay(s, 'reschedule')) fail('forbidden', 'この連絡は保護者の方からお願いします', 403); return withdrawRequest(c, [s.id], b); },
  'student/events/add': async (c, b) => { const s = await studentByLink(c, b); if (!studentMay(s, 'events')) fail('forbidden', '予定の共有は保護者の方からお願いします', 403); return addEvent(c, s.id, { kind: 'student', id: s.id }, b); },
  'student/events/delete': async (c, b) => { const s = await studentByLink(c, b); if (!studentMay(s, 'events')) fail('forbidden', '予定の共有は保護者の方からお願いします', 403); return deleteEvent(c, [s.id], null, b); },
};
