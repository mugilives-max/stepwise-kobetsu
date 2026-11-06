// 生徒の概要の「今週の授業」。7 日分のカレンダーに授業を置き、合計と科目ごとのコマ数を上に出す（2026-11-05 本人「ぱっと見で分からない」）。
// 週は月の予定表と同じ日曜始まり。お休みと取り消しは数えない。
// ‹ › は予定表の頭に、週の日付を挟んで置く（2026-11-07 本人「一目見てこれがカレンダーの移動に効くんだってわかるのが大事」）。今週は生徒の画面の答えから、ほかの週は w.lessons（読んだ週の授業）から出す。
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8));
const ACTIVE = ['held', 'proposed', 'decided', 'done'];
const tentative = l => l.status === 'held' || l.status === 'proposed';

export function weekDates(today, off = 0) {
  const t = Date.parse(today + 'T00:00:00Z') + off * 7 * 864e5, sunday = t - new Date(t).getUTCDay() * 864e5;
  return WD.map((_, i) => new Date(sunday + i * 864e5).toISOString().slice(0, 10));
}
export function weekLessons(x, w = {}) {
  const days = weekDates(x.today, w.off), seen = new Set();
  return (w.off ? w.lessons || [] : [...x.past, ...x.upcoming]).filter(l => days.includes(l.date) && ACTIVE.includes(l.status) && !seen.has(l.id) && seen.add(l.id))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
const weekName = off => off === 0 ? '今週' : off === -1 ? '先週' : off === 1 ? '来週' : `${Math.abs(off)}週間${off < 0 ? '前' : '後'}`;
export function weekBox(esc, x, w = {}) {
  const off = w.off || 0, days = weekDates(x.today, off), list = weekLessons(x, w), href = `#student=${encodeURIComponent(x.student.id)}/schedule`;
  const bySubject = {}; for (const l of list) bySubject[l.subject] = (bySubject[l.subject] || 0) + 1;
  const open = list.filter(tentative).length;
  const chip = l => `<a class="wk-l${l.status === 'done' ? ' done' : tentative(l) ? ' tent' : ''}" href="${href}"><b>${esc(l.start)}</b>${esc(l.subject)}${l.kind && l.kind !== '通常' ? `<small>${esc(l.kind)}</small>` : ''}</a>`;
  const day = (d, i) => `<div class="wk-d${d === x.today ? ' today' : ''}${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}"><div class="wk-h"><span>${WD[i]}</span>${md(d)}</div>${list.filter(l => l.date === d).map(chip).join('')}</div>`;
  const next = off || list.some(l => l.date >= x.today && l.status !== 'done') ? null : x.upcoming.find(l => l.date > days[6]);
  const move = (n, mark, label) => `<button type="button" class="wk-go" data-action="wk-move" data-n="${n}" aria-label="${label}">${mark}</button>`;
  const bar = `<div class="wk-bar">${move(-1, '‹', '1週間前')}<div class="wk-range"><b>${md(days[0])}〜${md(days[6])}</b>${off ? '<button type="button" class="small-btn" data-action="wk-move" data-n="0">今週</button>' : ''}</div>${move(1, '›', '1週間後')}</div>`;
  const sum = w.error ? `<p class="notice error">${esc(w.error)}</p>` : off && !w.lessons ? '<p class="muted small">読み込んでいます…</p>'
    : `<span class="wk-n"><strong>${list.length}</strong>コマ</span>${Object.entries(bySubject).map(([s, n]) => `<span class="wk-s">${esc(s)} <b>${n}</b></span>`).join('')}${open ? `<span class="tag warn">調整中 ${open}</span>` : ''}`;
  return `<h2>${weekName(off)}の授業</h2><div class="sheet wk"><div class="wk-sum">${sum}</div><div class="wk-cal">${bar}<div class="wk-days">${days.map(day).join('')}</div></div>${next ? `<p class="small muted wk-next">次の授業 ${md(next.date)} ${esc(next.start)} ${esc(next.subject)}</p>` : ''}</div>`;
}
