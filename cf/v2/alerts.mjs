// 授業のアラート（2026-11-14 本人「アラート機能が欲しい…今日の授業は、岡野さんに表示されていなかった（下書きのままだった）…
// そらくんの授業も、直前だったのに春貴君と重なってしまっている状態でした」）。先生（教室管理者）だけに出す。保護者・生徒には何も増やさない。
// 出す場所: 管理画面の「今日」のいちばん上（staff/home.js）と、MCP の get_pending_actions（home/today の alerts をそのまま返す）。
//   未公開: 今日〜UNPUBLISHED_DAYS 日後の授業が下書き（held）のまま。保護者・生徒に見えていない（2026-11-14 本人「２週間前には予定は公開しておきたい」で 3 日 → 14 日）。
//           生徒ごとに 1 件（下書きの一覧と同じまとまり。14 日だと日ごとでは十数件になるため）
//   重複:   これから（今日〜OVERLAP_DAYS 日後）の授業が同じ時間に重なり、同時には持てない
//     - 同一生徒: 同じ生徒の授業が重なる
//     - 3名以上: 同じ講師の授業が同時に 3 つ以上（同時の授業は 2 人まで。共通規約 r15 第4条）
//     - 対面・オンライン混在: 同じ講師の、対面の授業とオンラインの授業が重なる（1 対 2 は同じ形式どうしだけ）
//   同じ形式の 2 人の重なり（1 対 2）は正常として数えない（2026-11-07 本人「予定はできる限り 1:2」）。
// 保存のとき（schedule.mjs の checkConflicts）は同一生徒と 3 名以上を断るが、形式の違う重なりは通す。お休みの取り消し・移行などで後から重なることもあるので、ここで毎回見直す。
import { todayJst, addDays } from './schedule.mjs';

export const UNPUBLISHED_DAYS = 14;
export const OVERLAP_DAYS = 14;
const toMin = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
const endMs = l => Date.parse(l.date + 'T' + l.start + ':00+09:00') + Number(l.minutes || 0) * 60000;
const overlap = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.start) + Number(b.minutes) && toMin(b.start) < toMin(a.start) + Number(a.minutes);
const nameOf = s => [s.familyName, s.givenName].filter(Boolean).join(' ') || s.name || '';

// 重なりの判定（授業の配列 → 重複の組）。同じ日の授業を、同じ生徒か同じ講師で重なるものどうしでまとめ、まとまりごとに理由を付ける
export function findOverlaps(lessons) {
  const out = [];
  const byDate = new Map();
  for (const l of lessons) { const a = byDate.get(l.date) || []; a.push(l); byDate.set(l.date, a); }
  for (const [date, ls] of byDate) {
    ls.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    const parent = ls.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const reasons = ls.map(() => new Set());
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i], b = ls[j];
      if (!overlap(a, b)) continue;
      const sameStudent = a.studentId === b.studentId, sameStaff = !!a.staffId && a.staffId === b.staffId;
      if (!sameStudent && !sameStaff) continue;
      parent[find(i)] = find(j);
      if (sameStudent) reasons[i].add('同一生徒');
      if (sameStaff && !sameStudent && a.deliveryMode !== b.deliveryMode) reasons[i].add('対面・オンライン混在');
    }
    // 同じ講師が同時に 3 つ以上: ある授業の始まりの時刻に、同じ講師の授業がいくつ動いているか
    ls.forEach((x, i) => {
      if (!x.staffId) return;
      const t = toMin(x.start), live = ls.filter(o => o.staffId === x.staffId && toMin(o.start) <= t && t < toMin(o.start) + Number(o.minutes));
      if (live.length >= 3) reasons[i].add('3名以上');
    });
    const groups = new Map();
    ls.forEach((l, i) => { const g = groups.get(find(i)) || { lessons: [], reasons: new Set() }; g.lessons.push(l); reasons[i].forEach(r => g.reasons.add(r)); groups.set(find(i), g); });
    for (const g of groups.values()) if (g.lessons.length > 1 && g.reasons.size) out.push({ date, lessons: g.lessons, reasons: ['同一生徒', '3名以上', '対面・オンライン混在'].filter(r => g.reasons.has(r)) });
  }
  return out.sort((a, b) => (a.date + a.lessons[0].start).localeCompare(b.date + b.lessons[0].start));
}

// アラートの一覧（教室管理者用）。1 件ずつ { key, label, date, start, lessonIds, studentNames, detail, link }
export async function lessonAlerts(c) {
  const today = todayJst(c.now);
  const to = addDays(today, Math.max(UNPUBLISHED_DAYS, OVERLAP_DAYS));
  const rows = (await c.db.prepare("select id, studentId, staffId, date, start, minutes, subject, deliveryMode, status from lessons where status in ('held', 'proposed', 'decided') and date between ? and ? order by date, start").bind(today, to).all()).results
    .filter(l => endMs(l) > c.now); // 終わった授業は見ない（今日のうち、もう終わったもの）
  if (!rows.length) return [];
  const ids = [...new Set(rows.map(l => l.studentId))];
  const students = (await c.db.prepare(`select id, familyName, givenName from students where id in (${ids.map(() => '?').join(', ')})`).bind(...ids).all()).results;
  const name = Object.fromEntries(students.map(s => [s.id, nameOf(s)]));
  const alerts = [];
  // 未公開: 生徒ごとに 1 件。いちばん早い授業の日時を見出しに、2 件以上なら件数と期間を添える
  const held = new Map();
  for (const l of rows.filter(l => l.status === 'held' && l.date <= addDays(today, UNPUBLISHED_DAYS))) { const g = held.get(l.studentId) || []; g.push(l); held.set(l.studentId, g); }
  const md = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8));
  for (const ls of held.values()) alerts.push({ key: 'unpublished', label: '未公開', date: ls[0].date, start: ls[0].start, lessonIds: ls.map(l => l.id), studentNames: [name[ls[0].studentId] || ''],
    detail: ls.length === 1 ? (ls[0].subject || '授業') : `${ls.length}件（${md(ls[0].date)}${ls.at(-1).date !== ls[0].date ? '〜' + md(ls.at(-1).date) : ''}）`, link: '#schedule/todo' });
  // 重複: 下書き・調整中・確認待ち・確定のすべて（下書きどうしでも、公開する前に直す）
  for (const g of findOverlaps(rows.filter(l => l.date <= addDays(today, OVERLAP_DAYS)))) alerts.push({ key: 'overlap', label: '重複', date: g.date, start: g.lessons[0].start, lessonIds: g.lessons.map(l => l.id),
    studentNames: [...new Set(g.lessons.map(l => name[l.studentId] || ''))], detail: g.reasons.join('・'), link: '#schedule/day=' + g.date });
  return alerts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start) || a.key.localeCompare(b.key));
}
