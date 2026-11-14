// 調整中・確認待ちの授業を、毎晩 22 時に代表の Google カレンダーへ写す（2026-11-14 本人「調整中の授業も１日の終わりとかにカレンダーに反映してほしい…
// じゃないと予定が重なっているのかどうかとかが分からない」）。確定の授業の写し（schedule.mjs の calendarEffect、題名「【塾】…」）はそのまま。
// - 題名は「【調整中】山田 太郎さん 数学 (対面)」「【確認待ち】…」。色はグラファイト、通知なし、「予定なし」（transparent）。
//   「【塾】」を題名に入れないのは、Kura が「【塾】」の予定を塾の授業（時給の換算）として数えるため。「予定なし」は Kura の予定の写しに入らない
// - 毎晩、今あるべき予定と、前に作った予定（tentativeEvents）を比べて、足す・作り直す・消す。日時・科目・形・段階が変われば作り直す
//   （直すより作り直す方が、本人が手で消した予定も次の晩に戻る）。過ぎた授業の予定には触らない（表から外すだけ）
// - 確定したときは、その場で調整中の予定を消す（確定の「【塾】」の予定と二重に並ばないように。calendarEffect から dropTentative）
// - 保護者・生徒へのメールや表示は増えない。送り先は代表のカレンダーだけ（Apps Script の 'primary'）
// - 設定 settings.calendarTentative: 'off' で写さない（あるものは次の晩に消す）、'held' で下書きも写す。既定（空）は調整中・確認待ちだけ
import { sha256Hex } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { isLive } from './accounts.mjs';
import { recordEffects, deliverEffects } from './effects.mjs';
import { todayJst, addDays, stageOf } from './schedule.mjs';

export const TENTATIVE_MARK = 'v2t'; // Google の予定 ID（base32hex: a-v と 0-9）。確定の目印 v2m とは別
export const TENTATIVE_DAYS = 92;    // 今日から 3 か月先まで
const LABEL = { draft: '【下書き】', adjusting: '【調整中】', asking: '【確認待ち】' };
const startMs = (date, start) => Date.parse(date + 'T' + start + ':00+09:00');
const fullName = s => [s.familyName, s.givenName].filter(Boolean).join(' ');

export async function tentativeMode(db) {
  const r = await db.prepare("select value from settings where key = 'calendarTentative'").first();
  const v = r ? String(r.value || '') : '';
  return v === 'off' || v === 'held' ? v : 'proposed';
}

export function tentativeBody(l, name) {
  const s = startMs(l.date, l.start);
  return {
    summary: LABEL[stageOf(l)] + name + 'さん ' + (l.subject || '授業') + ' (' + (l.deliveryMode === 'online' ? 'オンライン' : '対面') + ')',
    description: 'ステップワイズの管理システムで' + (stageOf(l) === 'asking' ? '確認待ち' : stageOf(l) === 'draft' ? '下書き' : '調整中') + 'の授業です。毎晩 22 時に反映し、確定すると【塾】の予定に替わります。',
    start: { dateTime: new Date(s).toISOString(), timeZone: 'Asia/Tokyo' },
    end: { dateTime: new Date(s + Number(l.minutes) * 60000).toISOString(), timeZone: 'Asia/Tokyo' },
    colorId: '8', transparency: 'transparent',
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { stepwiseLesson: l.id, stepwiseTentative: '1' } },
  };
}
const bodyHash = b => sha256Hex(JSON.stringify([b.summary, b.description, b.start.dateTime, b.end.dateTime, b.colorId, b.transparency]));

// 確定・削除などで、その授業の調整中の予定をすぐ消す（c.effects に積む。行も消す）
export async function dropTentative(c, lessonId, live) {
  const r = await c.db.prepare('select * from tentativeEvents where lessonId = ?').bind(lessonId).first();
  if (!r) return false;
  c.effects.push({ kind: 'calendarDelete', eventId: r.eventId, audience: 'calendar', held: !live });
  await c.db.prepare('delete from tentativeEvents where lessonId = ?').bind(lessonId).run();
  return true;
}

// 毎晩の写し。返り値は件数（作った・作り直した・消した・外した）
export async function syncTentativeCalendar(env, db, now = Date.now(), fetcher = fetch) {
  const c = { env, db, now };
  const live = await isLive(c), mode = await tentativeMode(db);
  const today = todayJst(now), until = addDays(today, TENTATIVE_DAYS);
  const statuses = mode === 'off' ? [] : mode === 'held' ? ['held', 'proposed'] : ['proposed'];
  const want = statuses.length ? (await db.prepare(`select l.*, s.familyName, s.givenName from lessons l join students s on s.id = l.studentId join families f on f.id = s.familyId
    where l.status in (${statuses.map(() => '?').join(',')}) and l.date >= ? and l.date <= ? and f.testOnly = 0 order by l.date, l.start`).bind(...statuses, today, until).all()).results
    .filter(l => startMs(l.date, l.start) + Number(l.minutes) * 60000 > now) : [];
  const have = (await db.prepare('select t.*, l.date, l.start, l.minutes, e.status effectStatus from tentativeEvents t left join lessons l on l.id = t.lessonId left join effects e on e.id = t.effectId').all()).results;
  const byLesson = new Map(have.map(r => [r.lessonId, r]));
  const wanted = new Set(want.map(l => l.id));
  const items = [], rows = [], counts = { created: 0, recreated: 0, deleted: 0, forgotten: 0, kept: 0 };
  const del = eventId => items.push({ kind: 'calendarDelete', eventId, audience: 'calendar', held: !live });
  for (const r of have) {
    if (wanted.has(r.lessonId)) continue;
    const past = !!r.date && startMs(r.date, r.start) + Number(r.minutes) * 60000 <= now;
    if (!past) { del(r.eventId); counts.deleted++; } else counts.forgotten++;
    rows.push({ op: 'drop', lessonId: r.lessonId });
  }
  for (const l of want) {
    const body = tentativeBody(l, fullName(l)), hash = bodyHash(body), r = byLesson.get(l.id);
    if (r && r.hash === hash && r.effectStatus === 'sent') { counts.kept++; continue; }
    if (r) {
      del(r.eventId); counts.recreated++;
      // 前の作成がまだ送れていない（失敗・待ち）なら取り下げる（あとの自動の送り直しで二重にしない）
      if (r.effectId) await db.prepare("update effects set status = 'dismissed', error = '調整中の予定を作り直したため取り下げ' where id = ? and status in ('pending','failed') and deliveryState not in ('unknown','sending')").bind(r.effectId).run();
    } else counts.created++;
    const marker = TENTATIVE_MARK + sha256Hex(l.id + ':' + now + ':' + crypto.randomUUID()).slice(0, 40); // 消した予定の ID は Google で使い回せないので、毎回新しく
    const item = { kind: 'calendarCreate', marker, body: { ...body, id: marker }, wantMeet: false, audience: 'calendar', held: !live };
    items.push(item);
    rows.push({ op: 'put', lessonId: l.id, eventId: marker, hash, item });
  }
  const queued = await recordEffects(db, items, now);
  const effectOf = new Map(queued.map(q => [q.item, q.id]));
  const at = new Date(now).toISOString();
  for (const r of rows) {
    if (r.op === 'drop') await db.prepare('delete from tentativeEvents where lessonId = ?').bind(r.lessonId).run();
    else await db.prepare('insert into tentativeEvents (lessonId, eventId, hash, effectId, syncedAt) values (?, ?, ?, ?, ?) on conflict(lessonId) do update set eventId = excluded.eventId, hash = excluded.hash, effectId = excluded.effectId, syncedAt = excluded.syncedAt')
      .bind(r.lessonId, r.eventId, r.hash, effectOf.get(r.item) || 0, at).run();
  }
  const delivery = queued.length ? await deliverEffects(env, db, queued, fetcher, now) : null;
  return { mode, ...counts, sent: delivery ? delivery.sent : 0, failed: delivery ? delivery.failed + (delivery.unknown || 0) : 0, error: delivery?.error || '' };
}

// 今すぐ写す（教室管理者。毎晩を待たずに確かめるとき）
export const tentativeCalendarRoutes = {
  'admin/calendar/tentative-sync': async (c, b) => {
    await requireStaff(c, b, 'manager');
    return { result: await syncTentativeCalendar(c.env, c.db, c.now) };
  },
};
