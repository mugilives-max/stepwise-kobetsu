// 予定の月の表（/staff/ の予定）のマスに出す授業の行。開始時刻と名前だけ（2026-10-27 本人「まだあまり整理できていない」→「開始＋名前だけ」）。
// 同じ開始時刻は 1 行に「13:00 実祈・岡野」。終わりの時刻・科目は右（スマホは下）の一覧で。
// 色は授業ごとの段階。同じ時刻の授業がみな同じ段階なら行ごと、違えば名前ごとに色を付ける
// （2026-11-20: 前は行の色をその時刻のうち一番決まっていない段階にしていて、1:2 の片方が下書きだと、調整中のもう片方も下書きに見えた）。
export const RANK = { held: 0, proposed: 1, decided: 2, done: 3 };

// lessons: その日の授業。label(l): マスに出す名前。esc: HTML のエスケープ
export function startChips(lessons, label, esc) {
  const byStart = new Map();
  lessons.filter(l => l.status in RANK).sort((a, b) => a.start.localeCompare(b.start)).forEach(l => {
    const g = byStart.get(l.start) || [];
    g.push({ name: label(l), rank: RANK[l.status] });
    byStart.set(l.start, g);
  });
  return [...byStart].map(([start, g]) => {
    const same = g.every(x => x.rank === g[0].rank);
    const names = same ? esc(g.map(x => x.name).join('・')) : g.map(x => `<span class="r${x.rank}">${esc(x.name)}</span>`).join('・');
    return `<span class="nm t2 ${same ? 'r' + g[0].rank : 'mix'}"><small class="tm">${start}</small><b>${names}</b></span>`;
  });
}
