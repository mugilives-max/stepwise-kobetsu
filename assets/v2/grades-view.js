// 成績の見せ方（保護者・生徒・スタッフで共通）。推移のグラフ・試験ごとのカード・成績票を送る・開く。
// グラフは得点率（点数 ÷ 満点）と偏差値を別々に描く（1つのグラフに目盛りを2つ置かない）。
import { esc, API } from '/assets/v2/api.js';

const md = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8));
export const jst = t => new Date(Date.parse(t) + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); // 保存した時刻（UTC）を日本時間で
const n1 = v => v === null || v === undefined ? '' : String(Math.round(v * 10) / 10);
const ORDER = ['英語', '数学', '国語', '理科', '社会'];
function subjectsOf(exams) {
  const set = []; for (const e of exams) for (const s of e.scores) if (!set.includes(s.subject)) set.push(s.subject);
  return set.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
}
// 目盛り: 値の最小〜最大に少し余白を足して step の倍数に丸め、少なくとも minSteps 段は確保する（floor〜ceil の中で）。
// 偏差値を 30〜80 で固定すると、50 前後の数点の動きが読めない（本人 2026-10-11）
function fitTicks(values, step, pad, floor, ceil, minSteps) {
  if (!values.length) return [floor, ceil];
  let lo = Math.max(floor, Math.floor((Math.min(...values) - pad) / step) * step), hi = Math.min(ceil, Math.ceil((Math.max(...values) + pad) / step) * step);
  while (hi - lo < step * minSteps) { if (lo - step >= floor) lo -= step; else if (hi + step <= ceil) hi += step; else break; }
  const t = []; for (let v = lo; v <= hi + 1e-9; v += step) t.push(v);
  return t;
}
// 画面の中の選択（生徒ごと）: グラフの種類と科目、開いている試験。スタッフ・保護者・生徒の画面で共通。
// 1 画面に全科目の線を重ねず、科目の帯で切り替えて 1 本を大きく見せる（本人 2026-10-11「グラフが小さすぎて見えない。バーで表示科目を変えられるとか」）
const SEL = {};
export function gradeSel(studentId) { return SEL[studentId] || (SEL[studentId] = { series: '', subject: '合計', exam: '', past: false }); }
// 試験の階層: 何の試験か（定期テスト・北辰テスト・東部地区テスト・英検 …）→ その中の回。定期テストを先に、あとは新しい順
export const SERIES_FIRST = ['定期テスト', '北辰テスト', '東部地区テスト', '英検'];
export function seriesOf(exams) {
  const last = {}; for (const e of exams) if (!last[e.series] || last[e.series] < e.date) last[e.series] = e.date;
  return Object.keys(last).sort((a, b) => (SERIES_FIRST.indexOf(a) + 1 || 99) - (SERIES_FIRST.indexOf(b) + 1 || 99) || last[b].localeCompare(last[a]));
}
// 帯（何の試験か）と、選んだものの試験。1 種類だけでも帯は出す（階層が見えるように。本人 2026-10-11「成績でいきなり北辰になってる」）
export function seriesPick(exams, studentId) {
  const all = seriesOf(exams), sel = gradeSel(studentId);
  if (!all.includes(sel.series)) sel.series = all[0] || '';
  const list = exams.filter(e => e.series === sel.series);
  const bar = all.length ? `<div class="tabs2" role="tablist" aria-label="何の試験か">${all.map(x => `<a href="javascript:void 0" role="tab" data-action="gv-series" data-sid="${esc(studentId)}" data-s="${esc(x)}" class="${x === sel.series ? 'on' : ''}"${x === sel.series ? ' aria-selected="true"' : ''}>${esc(x)}</a>`).join('')}</div>` : '';
  return { bar, list, series: sel.series };
}
export function gradesClickShared(a, b) {
  if (a !== 'gv-subject' && a !== 'gv-series' && a !== 'gv-past') return false;
  const sel = gradeSel(b.dataset.sid);
  if (a === 'gv-subject') sel.subject = b.dataset.s;
  else if (a === 'gv-past') sel.past = !sel.past;
  else if (a === 'gv-series') { sel.series = b.dataset.s; sel.subject = '合計'; sel.past = false; }
  return true;
}
const chip = (action, sid, attrs, label, on) => `<button type="button" class="gchip${on ? ' on' : ''}" data-action="${action}" data-sid="${esc(sid)}" ${attrs}${on ? ' aria-pressed="true"' : ''}>${esc(label)}</button>`;

// 推移のグラフ（1 本を大きく）。渡された試験（同じ種類）で、模試は偏差値、定期テストは得点率。上の帯で科目を選ぶ。目盛りは値に合わせる
export function gradeCharts(exams, studentId = '') {
  const cur = exams.filter(e => e.scores.length).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (cur.length < 2) return '';
  const sel = gradeSel(studentId);
  const useDev = cur.some(e => e.kind === 'mock') && cur.some(e => e.scores.some(x => x.deviation !== null && x.deviation !== undefined) || (e.total.deviation !== null && e.total.deviation !== undefined));
  const find = (e, s) => e.scores.find(x => x.subject === s);
  const value = (e, s) => s === '合計' ? (useDev ? (e.total.deviation ?? null) : (e.total.score !== null && e.total.score !== undefined && e.total.max ? e.total.score / e.total.max * 100 : null))
    : (() => { const x = find(e, s); if (!x) return null; return useDev ? (x.deviation ?? null) : (x.score !== null && x.max ? x.score / x.max * 100 : null); })();
  const subjects = ['合計', ...subjectsOf(cur)].filter(s => cur.filter(e => value(e, s) !== null).length >= 2);
  if (!subjects.length) return '';
  if (!subjects.includes(sel.subject)) sel.subject = subjects[0];
  const pts = cur.map((e, i) => ({ i, v: value(e, sel.subject), e })).filter(p => p.v !== null);
  const allVals = subjects.flatMap(s => cur.map(e => value(e, s))).filter(v => v !== null); // 目盛りは科目を切り替えても同じ（見比べられるように）
  const ticks = useDev ? fitTicks(allVals, 5, 2, 20, 90, 3) : fitTicks(allVals, 10, 5, 0, 100, 3);
  const min = ticks[0], max = ticks[ticks.length - 1], n = cur.length, unit = useDev ? '' : '%';
  const W = 640, H = 250, L = 38, R = 20, T = 26, B = 44;
  const x = i => n === 1 ? W / 2 : L + i * (W - L - R) / (n - 1), y = v => T + (H - T - B) * (1 - (v - min) / (max - min));
  const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(v)}</text>`).join('');
  const short = s => { const t = String(s).replace(/テスト/g, '').replace(/[（(].*?[）)]/g, m => m.slice(1, -1)); return t.length > 7 ? t.slice(0, 7) + '…' : t; };
  const labels = cur.map((e, i) => `<text x="${x(i)}" y="${H - 26}" text-anchor="middle" font-size="11" fill="var(--ink)">${esc(short(e.name))}</text><text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(md(e.date))}</text>`).join('');
  const line = pts.length >= 2 ? `<polyline fill="none" stroke="var(--primary)" stroke-width="2.5" points="${pts.map(p => x(p.i) + ',' + y(p.v)).join(' ')}"/>` : '';
  const dots = pts.map(p => `<circle cx="${x(p.i)}" cy="${y(p.v)}" r="5" fill="var(--primary)" stroke="var(--white)" stroke-width="2"><title>${esc(p.e.name)}（${esc(md(p.e.date))}）: ${n1(p.v)}${unit}</title></circle><text x="${x(p.i)}" y="${y(p.v) - 10}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">${n1(p.v)}</text>`).join('');
  const last = pts[pts.length - 1], prev = pts[pts.length - 2], d = last && prev ? last.v - prev.v : null;
  const delta = d === null ? '' : Math.abs(d) < 0.05 ? '<span class="muted">前回と同じ</span>' : `<span class="${d > 0 ? 'up' : 'down'}">前回から ${d > 0 ? '▲' : '▼'} ${n1(Math.abs(d))}${unit}</span>`;
  let h = '<div class="gchart">';
  h += `<div class="gchips">${subjects.map(s => chip('gv-subject', studentId, `data-s="${esc(s)}"`, s, s === sel.subject)).join('')}</div>`;
  h += `<div class="gchart-head"><strong>${esc(sel.subject)}</strong><span class="small muted">${useDev ? '偏差値' : '得点率（%）'}の推移</span><span class="small" style="margin-left:auto">${delta}</span></div>`;
  h += `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(sel.subject)}の${useDev ? '偏差値' : '得点率'}の推移">${grid}${labels}${line}${dots}</svg></div>`;
  return h;
}

// 試験を 1 つずつ見る（‹ 北辰 3年3回 ›）。card(e) がその試験のカードを返す（本人 2026-10-11「カレンダーっぽく移動できるように」）

const has = (rows, k) => rows.some(s => s[k] !== null && s[k] !== undefined);
// 試験をまたいだ一覧（行: 試験・新しい回が上、列: 科目と合計）。模試は偏差値、定期テストは点数で、種類ごとに別の表。
// 回は増えるが科目は増えないので、回を行にして横幅を一定にする（2026-11-02 本人「科目と回数が列と行逆になるべき」）。科目ごとの推移は下のグラフ。
// 回ごとの箱は置かない（同日「試験ごとは全く不要…各回の pdf を開くことができる位で十分」）。成績票は回の日付の横から開く。
// opts.sheets(e) はその回の成績票、opts.edit はスタッフ（回の名前を押すと直す画面）
const sheetLinks = fs => fs.map(f => ` <button type="button" class="linkish" data-action="gr-open" data-id="${esc(f.id)}">${f.mime === 'application/pdf' ? 'PDF' : '写真'}</button>`).join('');
function oneSummary(list, useDev, caption, opts = {}) {
  if (!list.length) return '';
  const subjects = subjectsOf(list);
  const val = (e, s) => { const x = e.scores.find(r => r.subject === s); return x ? n1(useDev ? x.deviation : x.score) : ''; };
  const tot = e => n1(useDev ? e.total.deviation : e.total.score), hasTot = list.some(e => tot(e));
  const agg = s => /教科$/.test(s) ? ' class="agg"' : ''; // 3教科・5教科は合計の側に寄せて区切る
  const name = e => opts.edit ? `<button type="button" class="linkish nm" data-action="gr-edit" data-id="${esc(e.id)}">${esc(e.name)}</button>` : `<span class="nm">${esc(e.name)}</span>`;
  const rows = list.slice().reverse().map(e => `<tr><th>${name(e)}<small>${esc(md(e.date))}${sheetLinks(opts.sheets ? opts.sheets(e) : [])}</small></th>${subjects.map(s => `<td${agg(s)}>${val(e, s)}</td>`).join('')}${hasTot ? `<td class="tot">${tot(e)}</td>` : ''}</tr>`).join('');
  return `<figure class="gsum"><figcaption class="small muted">${caption}</figcaption><div class="gwrap"><table class="gtable gsum-t"><thead><tr><th></th>${subjects.map(s => `<th${agg(s)}>${esc(s)}</th>`).join('')}${hasTot ? '<th class="tot">合計</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div></figure>`;
}
// 最新の回を大きく見せる。模試は偏差値、定期テストは点数。▲▼ は前回との差（満点が違う回とは比べない）
const num = v => v === null || v === undefined || v === '' ? null : Number(v);
function gtile(label, cur, prev, useDev) {
  const v = num(useDev ? cur.deviation : cur.score);
  if (v === null) return '';
  const pv = prev ? num(useDev ? prev.deviation : prev.score) : null;
  const d = pv !== null && (useDev || num(prev.max) === num(cur.max)) ? Math.round((v - pv) * 10) / 10 : null;
  const delta = d === null ? '' : `<span class="d${d > 0 ? ' up' : d < 0 ? ' down' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : '±'}${n1(Math.abs(d))}</span>`;
  const score = num(cur.score) !== null && !cur.fromSubjects ? `${n1(cur.score)}${num(cur.max) !== null ? '/' + n1(cur.max) : ''}点` : '';
  const rank = num(cur.rank) !== null ? `${n1(cur.rank)}位${num(cur.rankOf) !== null ? '/' + n1(cur.rankOf) : ''}` : '';
  const note = useDev ? [score, rank] : [num(cur.max) !== null ? `満点 ${n1(cur.max)}` : '', num(cur.average) !== null ? `平均 ${n1(cur.average)}` : '', rank];
  return `<div class="gtile"><span class="lb">${esc(label)}</span><span class="v">${n1(v)}</span>${delta}${note.filter(Boolean).map(t => `<small>${esc(t)}</small>`).join('')}</div>`;
}
function latestCard(list, useDev, opts = {}) {
  const e = list[list.length - 1], p = list[list.length - 2] || null;
  const old = s => p && p.scores.find(r => r.subject === s);
  const row = s => gtile(s, e.scores.find(r => r.subject === s), old(s), useDev);
  const names = subjectsOf([e]), isAgg = s => /教科$/.test(s);
  const main = gtile('合計', e.total, p && p.total, useDev) + names.filter(isAgg).map(row).join('');
  const name = opts.edit ? `<button type="button" class="linkish nm" data-action="gr-edit" data-id="${esc(e.id)}">${esc(e.name)}</button>` : `<span class="nm">${esc(e.name)}</span>`;
  return `<div class="glatest"><div class="glatest-head">${name}<small>${esc(md(e.date))}${sheetLinks(opts.sheets ? opts.sheets(e) : [])}</small>${p ? `<small class="vs">前回 ${esc(p.name)} との差</small>` : ''}</div>${main ? `<div class="gtiles main">${main}</div>` : ''}<div class="gtiles">${names.filter(s => !isAgg(s)).map(row).join('')}</div></div>`;
}
// 成績の箱: ふだんは最新の回だけ。過去の一覧とグラフは開いたときに出す（2026-11-05 本人「常時は最新の結果がしっかりと分かるように、必要に応じて過去の結果も」）。
// right は見出しの右に置くもの（スタッフの「＋ 結果を入れる」）。opts は oneSummary へ
export function trendBox(exams, studentId, right = '', opts = {}) {
  const list = scored(exams);
  if (!list.length) return '';
  const past = gradeSel(studentId).past, n = list.length - 1;
  const more = n ? `<button type="button" class="gpast" data-action="gv-past" data-sid="${esc(studentId)}" aria-expanded="${past}"><span>過去の結果</span><small>${n}回</small><span class="ch" aria-hidden="true">${past ? '▲' : '▼'}</span></button>${past ? summaryTable(exams, opts) + gradeCharts(exams, studentId) : ''}` : '';
  return `<div class="sec-title">最新の結果${right ? `<span style="margin-left:auto">${right}</span>` : ''}</div><div class="sheet gtrend">${latestCard(list, usesDeviation(list), opts)}${more}</div>`;
}
const scored = exams => exams.filter(e => e.scores.length).slice().sort((a, b) => a.date.localeCompare(b.date));
const usesDeviation = list => list.some(e => e.kind === 'mock') && list.some(e => e.scores.some(s => s.deviation !== null && s.deviation !== undefined));
export function summaryTable(exams, opts = {}) {
  const list = scored(exams);
  if (!list.length) return '';
  const useDev = usesDeviation(list);
  return oneSummary(list, useDev, `${esc(list[0].series)}の${useDev ? '偏差値' : '点数'}`, opts);
}
const STATUS = { new: ['確かめ待ち', 'warn'], imported: ['取り込み済み', 'ok'], dismissed: ['確認済み', 'gray'] };
export function fileList(files, action) {
  if (!files.length) return '';
  return '<div class="list">' + files.map(f => `<div><div>${esc(f.name)} <span class="tag ${(STATUS[f.status] || ['', 'gray'])[1]}">${(STATUS[f.status] || [f.status])[0]}</span><div class="small muted">${esc(jst(f.createdAt).slice(0, 10))}${f.note ? '・' + esc(f.note) : ''}</div></div><div><button data-action="${action}" data-id="${esc(f.id)}">開く</button></div></div>`).join('') + '</div>';
}
export const uploadForm = (dis, extra = '') => `<form class="stack" data-form="gr-upload">${extra}<label>成績票の写真か PDF<input type="file" name="file" accept="image/*,application/pdf" required></label>
  <label>一言（任意）<input name="note" maxlength="200" placeholder="例: 2学期中間テストの個票"></label><button class="primary"${dis}>送る</button></form>`;

// 保護者・生徒の画面: 次のテスト・最新の結果（過去は開いて見る）・成績票
export function gradesView(st, { who, dis = '' }) {
  let h = '';
  if (st.nextTest) h += `<p class="notice">${esc(st.nextTest.title || 'テスト')}まで あと <strong>${st.nextTest.days}日</strong>（${esc(md(st.nextTest.date))}）</p>`;
  if (!st.exams.length) h += '<p class="muted">まだ成績の記録はありません。</p>';
  const pk = seriesPick(st.exams, st.id);
  h += pk.bar + trendBox(pk.list, st.id, '', { sheets: e => st.files.filter(f => f.examId === e.id && f.status !== 'dismissed') });
  h += `<h2>成績票を送る</h2>${uploadForm(dis, who === 'family' ? `<input type="hidden" name="studentId" value="${esc(st.id)}">` : '')}`;
  if (st.files.length) h += `<h3>送った成績票</h3>${fileList(st.files, 'gr-open')}`;
  return h;
}

// ---- 送る・開く ----
// 写真は長い辺 2000px の JPEG に縮める（読めないときはそのまま）。PDF はそのまま
async function shrink(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file), scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
// 送る: start(meta) で送る鍵をもらい（領域の操作。route と認証は呼ぶ側で付ける）、中身をそのまま送る。
// 中身は種類を付けずに送る（ブラウザの事前確認を起こさないため。種類はサーバーが中身から確かめる）
export async function uploadFile(rawFile, note, start) {
  const file = await shrink(rawFile);
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: { message: 'ファイルは20MBまでにしてください' } };
  const mime = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  const r = await start({ name: file.name, mime, size: file.size, note });
  if (!r.ok) return r;
  try {
    const res = await fetch(API + r.uploadUrl, { method: 'POST', body: new Blob([file]) });
    return await res.json().catch(() => ({ ok: false, error: { message: '送れませんでした。もう一度お試しください' } }));
  } catch { return { ok: false, error: { message: '通信できませんでした。電波の良いところでもう一度お試しください' } }; }
}
// 開く: link() で開く鍵（5分）をもらい、先に開いておいた新しいタブ（win）に出す。タブが開けなければこの画面で開く
export async function openFile(link, win) {
  const r = await link();
  if (!r.ok) { if (win) win.close(); return r; }
  if (win && !win.closed) win.location.href = API + r.url; else location.href = API + r.url;
  return { ok: true };
}
