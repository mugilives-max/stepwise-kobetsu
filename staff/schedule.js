import { automaticDeadline } from '/assets/v2/notice-view.js?v=20261025-layout';
// スタッフの画面: 予定（3段目）。月の予定表・選んだ日の授業・連絡への対応・授業を作る・休み・面談。
// 授業の入れ方は2通り（2026-10-27 本人「大雑把に言えば２通りでいい…スムーズであるというのが何よりも大事」）:
//   ① LINE・対面で合意した → 「確定」で入れる  ② 塾から日程を送る → 保護者が保護者ページで「承認する」（締め切り・自動確定なし）
// 前からの下書き・調整中は「対応すること」から進められる
// 教室管理者はすべて、講師は自分の担当の授業と自分の休みだけ。
import { STATUS, REQUEST, EVENT_KIND, mdw, endOf, statusTag, requestTags, stageLabel } from '/assets/v2/schedule-view.js?v=20261027-ease';
import { nowLocal } from '/assets/v2/cancel-rate.js?v=20261025-layout';

let month = null, data = null, sel = null, sheet = null, families = null, loadedFor = '';
// スマホ（ライフベアの形）: はじめは月全体。日付を押すと、その週が一番上まで滑り上がり、下から一覧が出る（2週分）。同じ日をもう一度押すか取っ手で月全体に戻る
let calOpen = true, wasOpen = true, calH = null, calTop = null, shownSel = '';
const phone = () => matchMedia('(max-width: 719px)').matches;
// 新しい決まりの取消料（規約案 第4〜7条）の授業か。授業の日が cancelRuleFrom 以降
const rateRule = l => !!(data && data.cancelRuleFrom && l.date >= data.cancelRuleFrom);
// sheet: 下から出る画面。{ kind: 'lesson', id, edit, cancel, tardy, decide } / { kind: 'create' } / { kind: 'off' } / { kind: 'meeting' } / { kind: 'todo' } / { kind: 'line', title, text }（LINE に貼る文）
const ymOf = d => d.slice(0, 7);
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + n, 1)); return t.toISOString().slice(0, 7); };
const gridStart = ym => { const first = new Date(ym + '-01T00:00:00Z'); return new Date(first - first.getUTCDay() * 86400e3).toISOString().slice(0, 10); };
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
export function resetSchedule() { data = null; loadedFor = ''; sheet = null; cache = {}; }
// 「対応すること」で印を外した授業（下書き・調整中）。既定は全部入れる
const unpicked = new Set();
export function schedulePick(id, on) { if (on) unpicked.delete(id); else unpicked.add(id); }
// 下書き（今日以降は全部。古い応答なら表示中の月の分）と、調整中（今日以降は全部）
const heldLessons = () => data.heldAll || data.lessons.filter(l => l.status === 'held');
const adjustingLessons = () => data.adjustingAll || data.lessons.filter(l => l.status === 'proposed' && !l.asked && l.date >= data.today);
const soon = l => l.date <= addDays(data.today, 5); // 5 日以内（調整中のままなら確認をお願いするか、合意を記録して確定）
// 月ごとに読んだ予定をとっておく（スワイプで月を変えたとき、すぐ出せるように。前後の月は先に読んでおく）。予定を変えたら捨てる
let cache = {}, swipeAt = 0, slideIn = '';
// 月の表では、授業ごとに時刻と名前を、段階の色で出す
const RANK = { held: 0, proposed: 1, decided: 2, done: 3 };

function prefetchNear(ctx) {
  for (const m of [addMonths(month, -1), addMonths(month, 1)]) {
    if (cache[m]) continue;
    const from = gridStart(m); ctx.call('schedule/staff/range', { from, to: addDays(from, 41) }).then(r => { if (r.ok && !cache[m]) cache[m] = r; });
  }
}
async function load(ctx) {
  const from = gridStart(month), to = addDays(from, 41);
  loadedFor = month;
  const r = await ctx.call('schedule/staff/range', { from, to });
  if (!r.ok) { if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error'); const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); data = { lessons: [], openRequests: [], events: [], unavailability: [], meetings: [], students: [], staff: [], kinds: ['通常'], today: t, error: true }; if (!sel) sel = t; } // 読めなくても画面は出す（エラーを見せる）
  else { data = r; cache[month] = r; if (!sel) sel = r.today; prefetchNear(ctx); }
  ctx.render();
}

// 月の表に出す短い名前: 姓。同じ姓の生徒がいれば名
function shortNames() {
  const fam = {}; data.students.forEach(s => { const f = s.name.split(' ')[0]; fam[f] = (fam[f] || 0) + 1; });
  return Object.fromEntries(data.students.map(s => { const [f, g] = s.name.split(' '); return [s.id, fam[f] > 1 && g ? g : f]; }));
}

export function schedulePage(ctx, me) {
  const { esc } = ctx, manager = me.roles.includes('manager');
  if (!month) month = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  if ((!data || loadedFor !== month) && cache[month]) { data = cache[month]; loadedFor = month; prefetchNear(ctx); } // 先に読んであった月はすぐ出す
  if (!data || loadedFor !== month) { if (loadedFor !== month) load(ctx); return '<p class="muted" style="margin-top:20px">読み込んでいます…</p>'; }
  const nameOf = Object.fromEntries(data.students.map(s => [s.id, s.name])), staffOf = Object.fromEntries(data.staff.map(s => [s.id, s.name])), short = shortNames();
  const held = {}; heldLessons().forEach(l => { held[l.studentId] = (held[l.studentId] || 0) + 1; });
  const adjusting = {}; adjustingLessons().forEach(l => { adjusting[l.studentId] = (adjusting[l.studentId] || 0) + 1; });
  const todo = manager ? data.openRequests.length + new Set(Object.keys(held).concat(Object.keys(adjusting))).size : 0;
  // 上の帯: 月の切り替え・今日・対応すること・作る
  let h = `<div class="sch-bar"><button class="icon" data-action="sch-month" data-n="-1" aria-label="前の月">‹</button><strong class="sch-month">${Number(month.slice(0, 4))}年${Number(month.slice(5))}月</strong><button class="icon" data-action="sch-month" data-n="1" aria-label="次の月">›</button>
    <button class="small-btn" data-action="sch-today">今日</button><span style="flex:1"></span>
    ${todo ? `<button class="small-btn warn" data-action="sch-sheet" data-k="todo">対応すること ${todo}</button>` : ''}
    <button class="small-btn primary" data-action="sch-sheet" data-k="${manager ? 'create' : 'off'}">＋ ${manager ? '授業' : '休み'}</button></div>`;
  if (!data.live) h += '<p class="small muted" style="margin:2px 0 6px">切り替え前：Google カレンダーへの登録と保護者へのメールはしません。</p>';
  h += ctx.notice();
  h += '<div class="sch">';
  // 月の表
  h += `<div class="cal-win">`;
  h += '<div class="month2">' + ['日', '月', '火', '水', '木', '金', '土'].map((w, i) => `<div class="wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`).join('');
  const start = gridStart(month);
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i === 35 && ymOf(d) !== month) break; // 6週目がまるごと次の月なら描かない
    const ls = data.lessons.filter(l => l.date === d && l.status in RANK);
    const bars = groupEvents(data.events.filter(e => e.date <= d && d <= e.dateTo && e.kind !== 'unavailable')).map(g => `<span class="bar ${g.kind}">${esc(g.title || 'テスト')}${g.items.length > 1 ? `<small>×${g.items.length}</small>` : ''}</span>`)
      .concat(data.unavailability.filter(o => o.date === d).map(o => `<span class="bar off">${o.staffId ? '休み' : '休校'}</span>`))
      .concat(data.meetings.filter(m => m.date === d).map(m => `<span class="bar meeting">面談${m.withLabel ? ' ' + esc(String(m.withLabel).split(/[\s　]/)[0]) : ''}</span>`));
    // 授業ごとに時刻と名前（「×2」でまとめない。2026-10-27 本人「その根本の原因は「×N」でまとめてしまう表記ですね」）
    const chips = ls.slice().sort((a, b) => a.start.localeCompare(b.start)).map(l => `<span class="nm t2 r${RANK[l.status]}"><small class="tm">${l.start}</small><b>${esc(short[l.studentId] || '')}</b></span>`);
    const lines = bars.concat(chips), shown = lines.slice(0, 4), more = lines.length - shown.length;
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    h += `<button class="cell${ymOf(d) !== month ? ' out' : ''}${d === sel ? ' sel' + (shownSel && shownSel !== sel ? ' enter' : '') : ''}${d === data.today ? ' today' : ''}" data-action="sch-day" data-date="${d}" aria-label="${mdw(d)} 授業${ls.length}件">`
      + `<span class="num${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}">${Number(d.slice(8))}</span>${shown.join('')}${more > 0 ? `<span class="more">+${more}</span>` : ''}</button>`;
  }
  h += '</div></div>';
  if (!calOpen || !phone()) h += `<div class="cal-handle" role="separator" aria-label="押すか下へ引くと月全体に戻る"><span></span></div>`; // 取っ手: 下へ引くか、押すと閉じる（月全体へ）
  const changed = shownSel && shownSel !== sel; shownSel = sel;
  const showDay = !calOpen || !phone(), leaving = calOpen && !wasOpen && phone();
  if (showDay || leaving) h += `<div class="sch-day${changed && showDay && !wasOpen ? ' enter' : ''}${leaving ? ' leaving' : ''}">${dayPanel(ctx, me, manager, nameOf, staffOf)}</div>`;
  h += '</div>';
  animCal(ctx);
  if (sheet) h += sheetHtml(ctx, me, manager, nameOf, staffOf, held, adjusting);
  return h;
}

// スマホ: カレンダーの窓の高さと位置を、前の形から新しい形へ 0.38秒で動かす（最初は速く、最後はゆっくり）。一覧は下から出入りする
let animPending = false;
function animCal(ctx) {
  setTimeout(() => { bindDrag(ctx); bindSwipe(ctx); }, 0); // 描くたびに、取っ手と月の表に指の動きを付ける（動きの途中でも）
  if (animPending) return; animPending = true; // 続けて描き直しても、最後に描いた画面で1回だけ動かす
  requestAnimationFrame(() => {
    animPending = false;
    const win = document.querySelector('.cal-win'); if (!win) return;
    if (!phone()) { win.style.maxHeight = ''; wasOpen = calOpen; return; }
    const wd = win.querySelector('.wd'), cell = win.querySelector('.cell.sel') || win.querySelector('.cell.today') || win.querySelector('.cell');
    const wdH = wd ? wd.offsetHeight : 0, rowH = cell ? cell.offsetHeight : 74, full = win.scrollHeight;
    const toH = calOpen ? full : wdH + 2 * rowH, toTop = calOpen ? 0 : Math.max(0, (cell ? cell.offsetTop : 0) - wdH);
    const fromH = calH === null ? toH : calH, fromTop = calTop === null ? toTop : calTop;
    const day = document.querySelector('.sch-day'), opening = !calOpen && wasOpen;
    calH = toH; calTop = toTop; wasOpen = calOpen;
    const done = () => { win.style.maxHeight = calOpen ? 'none' : toH + 'px'; win.scrollTop = toTop; };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || (Math.abs(fromH - toH) < 2 && Math.abs(fromTop - toTop) < 2)) { done(); if (day && day.classList.contains('leaving')) day.remove(); return; }
    const ms = 380, ease = q => 1 - Math.pow(1 - q, 3), t0 = performance.now();
    win.style.maxHeight = fromH + 'px'; win.scrollTop = fromTop;
    const step = now => { const q = Math.min(1, (now - t0) / ms), e = ease(q); win.style.maxHeight = fromH + (toH - fromH) * e + 'px'; win.scrollTop = fromTop + (toTop - fromTop) * e; if (q < 1) requestAnimationFrame(step); else done(); };
    requestAnimationFrame(step);
    if (day && opening) day.animate([{ transform: 'translateY(60vh)', opacity: .6 }, { transform: 'none', opacity: 1 }], { duration: ms, easing: 'cubic-bezier(.32, .72, 0, 1)' });
    if (day && day.classList.contains('leaving')) day.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(60vh)', opacity: 0 }], { duration: 300, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).onfinish = () => day.remove();
    win.addEventListener('scroll', () => { if (!calOpen) calTop = win.scrollTop; }, { passive: true });
  });
}
// 月の表を左右にスワイプ: 指に付いて動き、2割以上か素早く払えば次（左へ）・前（右へ）の月へ滑って替わる。足りなければ戻る
const EASE = 'cubic-bezier(.32, .72, 0, 1)';
function bindSwipe(ctx) {
  const win = document.querySelector('.cal-win'), grid = win && win.querySelector('.month2'); if (!grid) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (slideIn && !still) grid.animate([{ transform: `translateX(${slideIn === 'next' ? 60 : -60}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: EASE });
  slideIn = '';
  let x0 = null, y0 = 0, dx = 0, horiz = null, lastX = 0, lastT = 0, v = 0;
  win.onpointerdown = e => { if (e.pointerType === 'mouse') return; x0 = lastX = e.clientX; y0 = e.clientY; dx = 0; v = 0; horiz = null; lastT = e.timeStamp; };
  win.onpointermove = e => {
    if (x0 === null) return;
    const ddx = e.clientX - x0, ddy = e.clientY - y0;
    if (horiz === null && Math.abs(ddx) + Math.abs(ddy) > 10) horiz = Math.abs(ddx) > Math.abs(ddy) * 1.2;
    if (!horiz) return;
    dx = ddx; v = (e.clientX - lastX) / Math.max(1, e.timeStamp - lastT); lastX = e.clientX; lastT = e.timeStamp;
    grid.style.transform = `translateX(${dx}px)`; grid.style.opacity = String(1 - Math.min(.5, Math.abs(dx) / win.offsetWidth * .7));
  };
  const end = () => {
    if (x0 === null) return; x0 = null; if (!horiz) return; swipeAt = Date.now();
    const W = win.offsetWidth, go = Math.abs(dx) > W * .2 || (Math.abs(v) > .4 && Math.abs(dx) > 24), dir = dx < 0 ? 'next' : 'prev';
    const a = grid.animate([{ transform: `translateX(${dx}px)`, opacity: Number(grid.style.opacity || 1) }, go ? { transform: `translateX(${dx < 0 ? -W : W}px)`, opacity: 0 } : { transform: 'none', opacity: 1 }],
      { duration: still ? 1 : go ? 200 : 240, easing: go ? 'cubic-bezier(.4, 0, 1, 1)' : EASE, fill: 'forwards' });
    let finished = false; // 動きが止まっても（画面が描かれていないときなど）、少し待てば必ず月を替える
    const fin = () => {
      if (finished) return; finished = true;
      if (!go) { grid.style.transform = ''; grid.style.opacity = ''; a.cancel(); return; }
      month = addMonths(month, dir === 'next' ? 1 : -1); sel = month + '-01'; sheet = null;
      calOpen = true; wasOpen = true; calH = null; calTop = null; slideIn = dir; ctx.render();
    };
    a.onfinish = fin; setTimeout(fin, (still ? 1 : go ? 200 : 240) + 150);
  };
  win.onpointerup = end; win.onpointercancel = end;
}
// 取っ手を下へ引く: 引いた分だけカレンダーが広がり、一覧は薄くなる。約70px 以上か、素早く払ったら閉じて月全体へ。足りなければ元へ戻る
function bindDrag(ctx) {
  const hd = document.querySelector('.cal-handle'), win = document.querySelector('.cal-win'), day = document.querySelector('.sch-day');
  if (!hd || !win || !day || calOpen || !phone()) return;
  let y0 = null, dy = 0, lastY = 0, lastT = 0, v = 0, twoH = 0, full = 0, top0 = 0;
  const apply = d => { const q = Math.min(1, d / Math.max(1, full - twoH)); win.style.maxHeight = twoH + (full - twoH) * q + 'px'; win.scrollTop = top0 * (1 - q); day.style.opacity = String(1 - q * 0.7); };
  hd.onpointerdown = e => { y0 = lastY = e.clientY; lastT = e.timeStamp; dy = 0; v = 0; twoH = win.offsetHeight; full = win.scrollHeight; top0 = win.scrollTop; try { hd.setPointerCapture(e.pointerId); } catch {} hd.classList.add('grab'); };
  hd.onpointermove = e => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); v = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT); lastY = e.clientY; lastT = e.timeStamp; apply(dy); };
  const end = e => {
    if (y0 === null) return; y0 = null; hd.classList.remove('grab');
    const close = dy > 70 || (v > 0.5 && dy > 16) || (dy < 6 && e && e.type === 'pointerup'), // 押しただけでも月全体へ（2026-10-27 本人「タップするだけで下にバーが下がるように」）
      fromD = dy, toD = close ? Math.max(1, full - twoH) : 0, ms = close ? 260 : 220, t0 = performance.now(), ease = q => 1 - Math.pow(1 - q, 3);
    const step = now => {
      const q = Math.min(1, (now - t0) / ms); apply(fromD + (toD - fromD) * ease(q));
      if (q < 1) return requestAnimationFrame(step);
      if (close) { calOpen = true; wasOpen = true; calH = full; calTop = 0; ctx.render(); } else { day.style.opacity = ''; }
    };
    requestAnimationFrame(step);
  };
  hd.onpointerup = end; hd.onpointercancel = end;
}
// 選んだ日の一覧と、そのあとの6日（1行ずつ。押すと下から詳しい画面）
function dayPanel(ctx, me, manager, nameOf, staffOf) {
  const last = addDays(gridStart(month), 41);
  let h = oneDay(ctx, me, manager, nameOf, staffOf, sel, true);
  for (let i = 1; i <= 6; i++) { const d = addDays(sel, i); if (d > last) break; h += oneDay(ctx, me, manager, nameOf, staffOf, d, false); }
  return h;
}
function oneDay(ctx, me, manager, nameOf, staffOf, d, first) {
  const { esc } = ctx;
  const ls = data.lessons.filter(l => l.date === d).sort((a, b) => a.start.localeCompare(b.start)), offs = data.unavailability.filter(o => o.date === d), evs = groupEvents(data.events.filter(e => e.date <= d && d <= e.dateTo)), mts = data.meetings.filter(m => m.date === d);
  let h = first ? `<div class="day-title"><strong>${mdw(d)}</strong><span style="flex:1"></span>${manager ? `<button class="small-btn" data-action="sch-sheet" data-k="create">${d < data.today ? '＋ 実施した授業を登録' : '＋ この日に授業'}</button>` : ''}</div>`
    : `<button class="day-band" data-action="sch-day" data-date="${d}">${mdw(d)}</button>`;
  if (!ls.length && !offs.length && !evs.length && !mts.length) return h + `<p class="muted small"${first ? '' : ' style="margin:4px 2px 8px"'}>予定はありません。</p>`;
  h += '<div class="rows">';
  evs.forEach(g => { h += `<div class="ev ${g.kind}"><span class="t">${g.start ? g.start + '〜' : '終日'}</span><span class="b">${EVENT_KIND[g.kind]}：${esc(g.items.map(e => e.studentName).filter(Boolean).join('・'))} ${esc(g.title)}</span>${manager ? `<button class="x" data-action="sch-ev-del" data-ids="${esc(g.items.map(e => e.id).join(','))}" data-n="${g.items.length}" aria-label="消す"${ctx.dis()}>×</button>` : ''}</div>`; });
  offs.forEach(o => { h += `<div class="ev off"><span class="t">${o.start ? o.start + '〜' + o.end : '終日'}</span><span class="b">休み：${esc(o.staffId ? staffOf[o.staffId] || '' : '教室全体')} ${esc(o.note)}</span>${manager || o.staffId === me.id ? `<button class="x" data-action="sch-off-del" data-id="${esc(o.id)}" aria-label="消す"${ctx.dis()}>×</button>` : ''}</div>`; });
  mts.forEach(m => { h += `<div class="ev meeting"><span class="t">${m.start}〜${endOf(m.start, m.minutes)}</span><span class="b">面談：${esc(m.withLabel || m.withName || '')}${m.title && m.title !== '面談' ? ' ' + esc(m.title) : ''}${m.deliveryMode === 'online' ? '（オンライン）' : ''}</span><button class="x" data-action="sch-mt-cancel" data-id="${esc(m.id)}" aria-label="取りやめる"${ctx.dis()}>×</button></div>`; });
  ls.forEach(l => {
    h += `<button class="lesson s-${l.status}" data-action="sch-open" data-id="${esc(l.id)}"><span class="t">${l.start}<small>〜${endOf(l.start, l.minutes)}</small></span>`
      + `<span class="b"><span><strong>${esc(nameOf[l.studentId] || '')}</strong> ${esc(l.subject)}${l.kind !== '通常' ? '<small>（' + esc(l.kind) + '）</small>' : ''}${l.deliveryMode === 'online' ? ' <small class="muted">オンライン</small>' : ''}</span>`
      + `<span class="tags">${statusTag(l)}${requestTags(l)}<small class="muted">${esc(staffOf[l.staffId] || '担当未定')}</small></span></span><span class="go">›</span></button>`;
  });
  return h + '</div>';
}

// 下から出る画面（パソコンでは真ん中に出る）
function sheetHtml(ctx, me, manager, nameOf, staffOf, held, adjusting) {
  const { esc } = ctx;
  let title = '', body = '';
  if (sheet.kind === 'lesson') {
    const l = lessonById(sheet.id); if (!l) { sheet = null; return ''; }
    const past = l.date <= data.today, mine = manager || l.staffId === me.id;
    title = `${mdw(l.date)} ${l.start}〜${endOf(l.start, l.minutes)}`;
    body = `<div class="stack" style="margin:0"><div><strong style="font-size:17px">${esc(nameOf[l.studentId] || '')}</strong> ${esc(l.subject)}${l.kind !== '通常' ? '（' + esc(l.kind) + '）' : ''}</div>
      <div>${statusTag(l)}${requestTags(l)}${l.lateStart ? '<span class="tag gray">当日の時間変更</span>' : ''}${l.lostMinutes ? `<span class="tag warn">遅刻 ${l.lostMinutes}分</span>` : ''}</div>
      <div class="small muted">担当 ${esc(staffOf[l.staffId] || '未定')}・${l.deliveryMode === 'online' ? 'オンライン' : '対面'}${l.meetUrl ? `・<a href="${esc(l.meetUrl)}" target="_blank" rel="noopener">Meet を開く</a>` : ''}${l.note ? '<br>メモ：' + esc(l.note) : ''}${['decided', 'done'].includes(l.status) && l.agreement ? '<br>確定のもと：' + esc(l.agreement) : ''}</div>`;
    if (sheet.edit) body += editForm(ctx, l);
    else if (sheet.decide) body += decideForm(ctx, l);
    else if (sheet.cancel) body += cancelForm(ctx, l);
    else if (sheet.tardy) body += tardyForm(ctx, l);
    else {
      const main = [], sub = [], danger = [];
      const future = l.date >= data.today;
      if (manager && future && l.status === 'held') main.push(`<button data-action="sch-show-one" data-id="${esc(l.id)}"${ctx.dis()}>調整中として見せる</button>`);
      if(manager && future && l.status==='proposed' && l.asked && l.confirmBy && (!['sent','external'].includes(l.noticeState) || !automaticDeadline(l))) main.push('<p class="notice">自動確定を保留中（通知の確認待ち）</p><button data-action="sch-renotify" data-id="'+esc(l.id)+'">再案内・回答期間を確認</button>');
      if (manager && future && (l.status === 'held' || (l.status === 'proposed' && !l.asked))) main.push(`<button data-action="sch-ask-one" data-id="${esc(l.id)}"${ctx.dis()}>保護者に承認をお願いする</button>`);
      if (manager && ['held', 'proposed'].includes(l.status)) main.push(`<button class="primary" data-action="sch-decide" data-id="${esc(l.id)}"${ctx.dis()}>確定する</button>`);
      if (l.status === 'decided' && past && mine) main.push(`<button class="primary" data-action="sch-done" data-id="${esc(l.id)}"${ctx.dis()}>実施済みにする</button>`);
      if (['decided', 'done'].includes(l.status) && past && mine) main.push(`<a class="btn" href="#record=${encodeURIComponent(l.id)}">記録を書く</a>`);
      if (manager && ['held', 'proposed', 'decided'].includes(l.status)) sub.push(`<button data-action="sch-edit" data-id="${esc(l.id)}"${ctx.dis()}>日時・内容を直す</button>`);
      if (manager && l.status === 'proposed') sub.push(`<button data-action="sch-unsend" data-id="${esc(l.id)}"${ctx.dis()}>下書きに戻す</button>`);
      if (manager && (['proposed', 'decided'].includes(l.status) || (l.status === 'done' && !l.locked))) sub.push(`<button data-action="sch-rest" data-id="${esc(l.id)}"${ctx.dis()}>お休みにする</button>`);
      if (['decided', 'done'].includes(l.status) && mine && rateRule(l) && Date.now() >= Date.parse(l.date + 'T' + l.start + ':00+09:00')) sub.push(`<button data-action="sch-tardy" data-id="${esc(l.id)}"${ctx.dis()}>${l.lostMinutes ? '遅刻を直す' : '遅刻を記録'}</button>`);
      if (manager && (l.status === 'decided' || (l.status === 'done' && !l.locked))) danger.push(`<button class="danger" data-action="sch-cancel" data-id="${esc(l.id)}"${ctx.dis()}>キャンセルにする</button>`);
      if (manager && l.status !== 'done') danger.push(`<button class="danger" data-action="sch-delete" data-id="${esc(l.id)}"${ctx.dis()}>削除（入力ミス）</button>`);
      body += (main.length ? `<div class="row">${main.join('')}</div>` : '') + (sub.length ? `<div class="row">${sub.join('')}</div>` : '')
        + (danger.length ? `<details class="small"><summary class="muted">そのほかの操作</summary><div class="row" style="margin-top:8px">${danger.join('')}</div></details>` : '');
    }
    body += '</div>';
  } else if (sheet.kind === 'create') { title = '授業を作る'; body = createForm(ctx, me); }
  else if (sheet.kind === 'off') { title = '休みを登録'; body = offForm(ctx, me, manager); }
  else if (sheet.kind === 'meeting') { title = '面談を登録'; body = meetingForm(ctx); }
  else if (sheet.kind === 'todo') {
    title = '対応すること';
    body = (data.openRequests.length ? `<h2 style="margin-top:0">生徒・保護者からの連絡（${data.openRequests.length}件）</h2><div class="list">` + data.openRequests.map(r => `<div><div><span class="tag ${r.kind === 'cancel' ? 'danger' : 'warn'}">${REQUEST[r.kind]}</span> <strong>${esc(r.studentName)}</strong> ${mdw(r.date)} ${r.start} ${esc(r.subject)}
      <div class="small">${esc(r.note || '')}<span class="muted">（${r.fromKind === 'family' ? '保護者' : r.fromKind === 'student' ? '生徒' : 'スタッフ'}・${esc(r.receivedAt.slice(5, 16).replace('T', ' '))}）</span></div>
      ${r.kind === 'cancel' ? `<div class="small muted">${rateRule(r) ? 'キャンセル料は連絡の時刻で計算済み（請求）' : 'キャンセル料は請求で決める'}</div>` : ''}</div>
      <div class="row"><button data-action="sch-goto" data-date="${r.date}" data-id="${esc(r.lessonId || '')}">授業を開く</button><button data-action="sch-resolve" data-id="${esc(r.id)}"${ctx.dis()}>済みにする</button></div></div>`).join('') + '</div>' : '')
      + (Object.keys(held).length ? `<h2>下書き</h2>` + Object.keys(held).map(sid => stageGroup(ctx, sid, nameOf, 'held')).join('') : '')
      + (Object.keys(adjusting).length ? `<h2>調整中</h2>` + Object.keys(adjusting).map(sid => stageGroup(ctx, sid, nameOf, 'adjusting')).join('') : '');
  } else if (sheet.kind === 'line') {
    title = sheet.title || 'LINE に貼る文';
    body = `<p class="small" style="margin:0 0 6px">保護者にメールを送りました。LINE に貼る文：</p>
      <textarea class="line-copy" readonly>${esc(sheet.text)}</textarea><div class="row" style="margin-top:8px"><button class="primary" data-action="sch-copy">コピーする</button><button data-action="sch-close">閉じる</button></div>`;
  }
  const tabs = (manager && ['create', 'off', 'meeting'].includes(sheet.kind)) ? `<div class="seg">${[['create', '授業'], ['off', '休み'], ['meeting', '面談']].map(([k, lb]) => `<button class="${sheet.kind === k ? 'on' : ''}" data-action="sch-sheet" data-k="${k}">${lb}</button>`).join('')}</div>` : '';
  return `<div class="overlay" data-action="sch-close"></div><section class="bsheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div><div class="bsheet-head"><strong>${esc(title)}</strong><button class="icon" data-action="sch-close" aria-label="閉じる">×</button></div>${tabs}<div class="bsheet-body">${body}</div></section>`;
}

// 下書き・調整中（生徒ごと）。授業ごとに印を付けて、印のある授業だけを進める
function stageGroup(ctx, sid, nameOf, stage) {
  const { esc } = ctx, mine = (stage === 'held' ? heldLessons() : adjustingLessons()).filter(l => l.studentId === sid), picked = mine.filter(l => !unpicked.has(l.id));
  const trial = !!(data.students.find(x => x.id === sid) || {}).trial;
  const rows = mine.map(l => `<label class="small" style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" data-hpick="${esc(l.id)}"${unpicked.has(l.id) ? '' : ' checked'} style="width:auto">
    <span>${mdw(l.date)} ${l.start}〜${endOf(l.start, l.minutes)} ${esc(l.subject)}${l.kind && l.kind !== '通常' ? ` <span class="tag gray">${esc(l.kind)}</span>` : ''}${/^MCP で保存/.test(l.note || '') ? ' <span class="tag">AI が保存</span>' : ''}${soon(l) ? ' <span class="tag warn">5日以内</span>' : ''}</span></label>`).join('');
  const n = picked.length, dis = n ? ctx.dis() : ' disabled';
  const buttons = trial ? `<button class="primary" data-action="sch-ask" data-sid="${esc(sid)}" data-stage="${stage}"${dis}>選んだ ${n}件を確定にする</button>`
    : (stage === 'held' ? `<button data-action="sch-show" data-sid="${esc(sid)}"${dis}>選んだ ${n}件を調整中として見せる</button>` : '')
      + `<button class="primary" data-action="sch-ask" data-sid="${esc(sid)}" data-stage="${stage}"${dis}>選んだ ${n}件の承認をお願いする</button>`;
  return `<div class="held-group" style="margin:8px 0;padding:10px 12px;border:1px solid var(--line);border-radius:10px"><div style="display:flex;align-items:center;gap:8px"><strong>${esc(nameOf[sid] || '')}</strong>${trial ? ' <span class="tag gray">体験</span>' : ''}</div>${rows}
    <div class="row" style="margin-top:6px">${buttons}</div></div>`;
}
// 確定する: 合意の記録（LINE・電話・面談で合意したとき。規約 r9 第14条1項）
function decideForm(ctx, l) {
  return `<form class="stack" data-form="sch-decide" data-id="${ctx.esc(l.id)}" data-version="${l.version}" style="margin:8px 0 0">
    <label>合意の記録<input name="agreement" maxlength="200" placeholder="例: LINE 10/16 お母さんと合意"></label>
    <p class="small muted" style="margin:0">カレンダーに入ります。保護者へのメールは送りません。</p>
    <div class="row"><button class="primary"${ctx.dis()}>確定する</button><button type="button" data-action="sch-edit-cancel">やめる</button></div></form>`;
}

const minutesOptions = v => [30, 45, 60, 90, 120, 150, 180, 210, 240, 270, 300, 360, 390, 420, 480].map(m => `<option value="${m}"${m === Number(v) ? ' selected' : ''}>${m >= 120 ? `${m}分（${Math.floor(m / 60)}時間${m % 60 ? m % 60 + '分' : ''}）` : m + '分'}</option>`).join('');
const staffOptions = (ctx, v) => '<option value="">未定</option>' + data.staff.filter(s => s.teacher).map(s => `<option value="${ctx.esc(s.id)}"${s.id === v ? ' selected' : ''}>${ctx.esc(s.name)}</option>`).join('');
const kindOptions = (ctx, v) => [...new Set([...data.kinds, ...(v ? [v] : [])])].map(k => `<option${k === v ? ' selected' : ''}>${ctx.esc(k)}</option>`).join('');
function createForm(ctx, me) {
  const { esc } = ctx, past = !!sel && sel < data.today;
  return `<form class="stack" data-form="sch-create" style="margin:0">
    <label>生徒<select name="studentId" required>${data.students.map(s => `<option value="${esc(s.id)}"${s.trial ? ' data-trial="1"' : ''}>${esc(s.name)}${s.trial ? '（体験）' : ''}</option>`).join('')}</select></label>
    <p class="small muted trial-hint">体験は無料。そのまま確定（お知らせなし）</p>
    <div class="row"><label style="flex:1">日付<input type="date" name="date" value="${sel || ''}" required></label><label style="flex:1">開始<input type="time" name="start" value="17:00" step="300" required></label><label style="flex:1">長さ<select name="minutes">${minutesOptions(90)}</select></label></div>
    <div class="row"><label style="flex:1">科目<input name="subject" maxlength="30" required placeholder="数学"></label><label style="flex:1">種類<select name="kind">${kindOptions(ctx, '通常')}</select></label>
      <label style="flex:1">形式<select name="deliveryMode"><option value="in_person">対面</option><option value="online">オンライン</option></select></label></div>
    <div class="row"><label style="flex:1">担当<select name="staffId">${staffOptions(ctx, me.id)}</select></label><label style="flex:1">くり返し<select name="repeat">${[1, 2, 3, 4, 5, 8, 12].map(n => `<option value="${n}">${n === 1 ? 'この日だけ' : '毎週×' + n + '回'}</option>`).join('')}</select></label></div>
    ${past ? '<input type="hidden" name="send" value="done"><p class="small muted">実施済みとして登録します。</p>'
      : '<div class="send-seg" role="radiogroup" aria-label="入れ方"><label><input type="radio" name="send" value="decide" checked> 確定で入れる<small>LINE・対面で合意した</small></label><label><input type="radio" name="send" value="ask"> 保護者に承認をお願いする<small>メールで日程を送る</small></label></div>'}
    <div class="row"><button class="primary"${ctx.dis()}>作る</button></div></form>`;
}
function editForm(ctx, l) {
  const after = Date.now() > Date.parse(l.date + 'T23:00:00+09:00') - 86400e3;
  return `<form class="stack" data-form="sch-update" data-id="${ctx.esc(l.id)}" data-version="${l.version}" style="margin:8px 0 0">
    <div class="row"><label style="flex:1">日付<input type="date" name="date" value="${l.date}"></label><label style="flex:1">開始<input type="time" name="start" value="${l.start}" step="300"></label><label style="flex:1">長さ<select name="minutes">${minutesOptions(l.minutes)}</select></label></div>
    <div class="row"><label style="flex:1">科目<input name="subject" maxlength="30" value="${ctx.esc(l.subject)}"></label><label style="flex:1">種類<select name="kind">${kindOptions(ctx, l.kind)}</select></label>
      <label style="flex:1">形式<select name="deliveryMode"><option value="in_person"${l.deliveryMode === 'in_person' ? ' selected' : ''}>対面</option><option value="online"${l.deliveryMode === 'online' ? ' selected' : ''}>オンライン</option></select></label></div>
    <label>担当<select name="staffId">${staffOptions(ctx, l.staffId)}</select></label>
    <label>メモ（スタッフだけ）<input name="note" maxlength="1000" value="${ctx.esc(l.note || '')}"></label>
    ${l.status === 'proposed' && l.asked ? '<p class="small muted" style="margin:0">日時を変えると調整中に戻ります（締め切りを外す・メールなし）。</p>' : l.status === 'proposed' ? '<p class="small muted" style="margin:0">日時を変えても保護者へのメールは出ません。</p>' : l.status === 'decided' ? '<p class="small muted" style="margin:0">日時を変えると保護者にお知らせが届きます。</p>' : ''}
    ${l.status === 'decided' && after ? (rateRule(l)
      ? `<label class="checks"><label><input type="checkbox" name="lateStart"> 生徒の申し出で開始を遅らせる（遅らせた分の取消料がかかります）</label></label>
        <label>申し出を受けた時刻（空なら連絡の時刻か今）<input type="datetime-local" name="receivedAt"></label>`
      : '<label class="checks"><label><input type="checkbox" name="lateStart"> 当日の開始時刻の変更として記録する（料金は変えない）</label></label>') : ''}
    <div class="row"><button class="primary"${ctx.dis()}>保存</button><button type="button" data-action="sch-edit-cancel">やめる</button></div></form>`;
}
// キャンセル（新しい決まり）: 連絡を受けた時刻で取消料が決まる。LINE などで受けた時刻を入れる
function cancelForm(ctx, l) {
  return `<form class="stack" data-form="sch-cancel" data-id="${ctx.esc(l.id)}" data-version="${l.version}" style="margin:8px 0 0">
    <p class="small" style="margin:0">キャンセル料は連絡を受けた時刻で決まります（前日23時〜開始3時間前は25%、開始時刻で100%まで上がる）。前日23時までの連絡は「お休みにする」。</p>
    <label>連絡を受けた時刻<input type="datetime-local" name="receivedAt" value="${nowLocal()}"></label>
    <label class="checks"><label><input type="checkbox" name="noNotice"> 連絡がなかった（無断欠席。100%）</label></label>
    <div class="row"><button class="danger"${ctx.dis()}>キャンセルにする</button><button type="button" data-action="sch-edit-cancel">やめる</button></div></form>`;
}
// 遅刻（新しい決まり）: 予定の時刻に終わる。遅れた分は授業料に入れず、遅れるという連絡を受けた時刻の率で取消料
function tardyForm(ctx, l) {
  return `<form class="stack" data-form="sch-tardy" data-id="${ctx.esc(l.id)}" data-version="${l.version}" style="margin:8px 0 0">
    <p class="small" style="margin:0">終わりは予定どおり ${endOf(l.start, l.minutes)}。遅れた分は授業料でなく取消料になります（0分で取り消し）。</p>
    <label>遅れた分数<input type="number" name="lateMinutes" min="0" max="${l.minutes - 1}" step="1" value="${l.lostMinutes || ''}" required inputmode="numeric"></label>
    <label>遅れるという連絡を受けた時刻（なければ空）<input type="datetime-local" name="receivedAt"></label>
    <div class="row"><button class="primary"${ctx.dis()}>記録する</button><button type="button" data-action="sch-edit-cancel">やめる</button></div></form>`;
}
function offForm(ctx, me, manager) {
  return `<form class="stack" data-form="sch-off" style="margin:0">${manager ? `<label>だれの休み<select name="staffId"><option value="">教室全体</option>${data.staff.map(s => `<option value="${ctx.esc(s.id)}"${s.id === me.id ? ' selected' : ''}>${ctx.esc(s.name)}</option>`).join('')}</select></label>` : ''}
    <div class="row"><label style="flex:1">日付<input type="date" name="date" value="${sel || ''}" required></label><label style="flex:1">開始（終日なら空）<input type="time" name="start"></label><label style="flex:1">終了<input type="time" name="end"></label></div>
    <label>メモ（生徒には見せない）<input name="note" maxlength="100"></label><div class="row"><button class="primary"${ctx.dis()}>登録する</button></div></form>`;
}
function meetingForm(ctx) {
  if (!families) { ctx.call('admin/families/list').then(r => { families = r.ok ? r.families : []; ctx.render(); }); return '<p class="muted">読み込んでいます…</p>'; }
  return `<form class="stack" data-form="sch-meeting" style="margin:0"><label>相手<select name="familyId">${families.map(f => `<option value="${ctx.esc(f.id)}">${ctx.esc(f.name)}</option>`).join('')}<option value="">登録していない人（問い合わせ・体験前）</option></select></label>
    <label class="mt-with">名前<input name="withName" maxlength="60" placeholder="例: 高橋さん（体験前の面談）"></label>
    <div class="row"><label style="flex:1">日付<input type="date" name="date" value="${sel || ''}" required></label><label style="flex:1">開始<input type="time" name="start" value="19:00" step="300" required></label><label style="flex:1">長さ<select name="minutes">${[15, 20, 30, 45, 60].map(m => `<option value="${m}"${m === 30 ? ' selected' : ''}>${m}分</option>`).join('')}</select></label></div>
    <div class="row"><label style="flex:1">形式<select name="deliveryMode"><option value="in_person">対面</option><option value="online">オンライン（Meet）</option></select></label><label style="flex:2">題名<input name="title" value="面談" maxlength="60"></label></div>
    <div class="row"><button class="primary"${ctx.dis()}>登録する</button></div></form>`;
}

const yen = n => Number(n).toLocaleString('ja-JP') + '円';
const lessonById = id => (data && data.lessons ? data.lessons.find(l => l.id === id) : null); // ほかの画面のボタン（data-id つき）でも落ちないように
const values = el => Object.fromEntries(new FormData(el).entries());
async function after(ctx, r, okMessage) {
  if (r.ok) { data = null; loadedFor = ''; cache = {}; if (sheet && sheet.kind === 'lesson') sheet = null; if (okMessage) ctx.say(okMessage, 'ok'); return true; }
  if (r.error && r.error.needForce && confirm(r.error.message)) return 'force';
  if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}

const askNote = () => '（保護者が承認すると確定します）';
// 段階を進める: show 調整中として見せる（メールなし）/ ask 確認をお願いする（メール 1 通・LINE に貼る文を出す）。体験生は確定にする
async function stageMove(ctx, how, sid, ids, rest) {
  const st = data.students.find(x => x.id === sid) || {}, trial = !!st.trial;
  const ask = trial ? `${st.name || ''}さんの体験の授業 ${ids.length}件を確定にして、Google カレンダーに入れますか？（メールは送りません）`
    : how === 'show' ? `${st.name || ''}さんの授業 ${ids.length}件を調整中として、保護者・生徒のページに出しますか？（メールは送りません）`
    : `${st.name || ''}さんの授業 ${ids.length}件の承認を、保護者にメールでお願いしますか？`;
  if (!confirm(ask + (rest ? `\n印を外した ${rest}件はそのまま残ります。` : ''))) return true;
  let r = await ctx.call(how === 'show' ? 'schedule/lessons/show' : 'schedule/lessons/ask', { studentId: sid, lessonIds: ids });
  if (!r.ok && r.error && r.error.needForce && confirm(r.error.message)) r = await ctx.call('schedule/lessons/ask', { studentId: sid, lessonIds: ids, force: true });
  if (r.ok) ids.forEach(x => unpicked.delete(x));
  await after(ctx, r, r.ok ? (r.trial ? `${r.sent}件を確定にしました` : how === 'show' ? `${r.shown}件を調整中として見せました（メールなし）` : `${r.asked}件の承認をお願いしました${askNote(r)}`) + (r.left ? `（下書き ${r.left}件は残っています）` : '') : '');
  if (r.ok && r.lineText) sheet = { kind: 'line', title: '承認をお願いしました', text: r.lineText };
  return true;
}

export async function scheduleSubmit(ctx, kind, el) {
  const v = values(el);
  if (kind === 'sch-create') {
    const body = { studentId: v.studentId, date: v.date, start: v.start, minutes: Number(v.minutes), subject: v.subject, kind: v.kind, deliveryMode: v.deliveryMode, staffId: v.staffId, repeat: v.send === 'done' ? 1 : Number(v.repeat), send: v.send || 'hold', hold: v.send === 'hold', done: v.send === 'done' };
    if (v.send === 'ask' && !confirm('保護者に日程の承認のお願いをメールで送ります。よろしいですか？')) return true;
    let r = await ctx.call('schedule/lessons/create', body);
    if ((await after(ctx, r, '')) === 'force') r = await ctx.call('schedule/lessons/create', { ...body, force: true });
    if (r.ok) {
      sheet = r.lineText ? { kind: 'line', title: '承認をお願いしました', text: r.lineText } : null; cache = {}; sel = v.date;
      ctx.say(r.trial ? `体験の授業を${r.created}件、確定で入れました` : r.done ? `${r.created}件を実施済みで登録しました` : r.decided ? `${r.created}件を確定しました${r.extra ? `（受講計画合意書に ${r.extra}回追加）` : ''}` : r.held ? `${r.created}件を下書きで作りました` : r.shown ? `${r.created}件を調整中として見せました（メールなし）` : `${r.created}件の承認をお願いしました${askNote(r)}`, 'ok'); data = null; loadedFor = '';
    }
    return true;
  }
  if (kind === 'sch-update') {
    const body = { id: el.dataset.id, version: Number(el.dataset.version), date: v.date, start: v.start, minutes: Number(v.minutes), subject: v.subject, kind: v.kind, deliveryMode: v.deliveryMode, staffId: v.staffId, note: v.note, lateStart: v.lateStart === 'on', receivedAt: v.receivedAt || '' };
    let r = await ctx.call('schedule/lessons/update', body);
    const saved = x => x.ok && x.fee ? `保存しました（開始を遅らせた分の取消料 ${yen(x.fee.amount)}）` : x.ok && x.backToAdjusting ? '保存しました（調整中に戻しました）' : '保存しました';
    if ((await after(ctx, r, saved(r))) === 'force') { r = await ctx.call('schedule/lessons/update', { ...body, force: true }); await after(ctx, r, saved(r)); }
    if (r.ok) { sel = v.date; sheet = null; }
    return true;
  }
  if (kind === 'sch-decide') {
    const r = await ctx.call('schedule/lessons/decide', { id: el.dataset.id, version: Number(el.dataset.version), agreement: v.agreement || '' });
    await after(ctx, r, '確定しました');
    return true;
  }
  if (kind === 'sch-cancel') {
    const r = await ctx.call('schedule/lessons/cancel', { id: el.dataset.id, version: Number(el.dataset.version), receivedAt: v.receivedAt || '', noNotice: v.noNotice === 'on' });
    await after(ctx, r, r.ok && r.fee ? `キャンセルにしました（キャンセル料 ${yen(r.fee.amount)}）` : 'キャンセルにしました');
    return true;
  }
  if (kind === 'sch-tardy') {
    const r = await ctx.call('schedule/lessons/tardy', { id: el.dataset.id, version: Number(el.dataset.version), lateMinutes: Number(v.lateMinutes || 0), receivedAt: v.receivedAt || '' });
    await after(ctx, r, r.ok ? (r.fee ? `遅刻を記録しました（取消料 ${yen(r.fee.amount)}）` : '遅刻の記録を取り消しました') : '');
    return true;
  }
  if (kind === 'sch-off') { const r = await ctx.call('schedule/unavailability/add', v); await after(ctx, r, '休みを登録しました'); if (r.ok) sheet = null; return true; }
  if (kind === 'sch-meeting') { const r = await ctx.call('schedule/meetings/create', { ...v, minutes: Number(v.minutes) }); await after(ctx, r, '面談を登録しました'); if (r.ok) sheet = null; return true; }
  return false;
}

export async function scheduleClick(ctx, a, b) {
  const id = b.dataset.id, l = id ? lessonById(id) : null;
  if (a === 'sch-month') { month = addMonths(month, Number(b.dataset.n)); sel = month + '-01'; data = null; sheet = null; slideIn = Number(b.dataset.n) > 0 ? 'next' : 'prev'; calOpen = true; wasOpen = true; calH = calTop = null; return true; } // 矢印でもスワイプと同じく滑って替わる
  if (a === 'sch-today') { const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); sel = t; if (ymOf(t) !== month) { month = ymOf(t); data = null; } return true; }
  if (a === 'sch-day') {
    if (Date.now() - swipeAt < 400) return true; // スワイプした指を離したときの押し
    const d = b.dataset.date;
    if (b.classList.contains('day-band')) { sel = d; window.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
    if (phone() && calOpen) { sel = d; calOpen = false; } // 月全体から日を押した: その週を上へ、一覧を下から
    else if (phone() && d === sel) calOpen = true; // 選んでいる日をもう一度: 月全体に戻る
    else sel = d;
    return true;
  }
  if (a === 'sch-goto') { sel = b.dataset.date; sheet = b.dataset.id ? { kind: 'lesson', id: b.dataset.id } : null; if (ymOf(sel) !== month) { month = ymOf(sel); data = null; } return true; }
  if (a === 'sch-sheet') { sheet = { kind: b.dataset.k }; return true; }
  if (a === 'sch-open') { sheet = { kind: 'lesson', id }; return true; }
  if (a === 'sch-close') { sheet = null; return true; }
  if (a === 'sch-edit') { sheet = { kind: 'lesson', id, edit: true }; return true; }
  if (a === 'sch-tardy') { sheet = { kind: 'lesson', id, tardy: true }; return true; }
  if (a === 'sch-cancel' && l && rateRule(l)) { sheet = { kind: 'lesson', id, cancel: true }; return true; } // 新しい決まり: 連絡を受けた時刻を入れる画面
  if (a === 'sch-edit-cancel') { sheet = sheet && sheet.id ? { kind: 'lesson', id: sheet.id } : null; return true; }
  if (a === 'sch-decide' && l) {
    if (!confirm('LINE・対面などで保護者と合意した日時として確定しますか？')) return true;
    let r = await ctx.call('schedule/lessons/decide', { id: l.id, version: l.version, withExtras: true });
    if (!r.ok && r.error && r.error.needForce && confirm(r.error.message)) r = await ctx.call('schedule/lessons/decide', { id: l.id, version: l.version, withExtras: true, force: true });
    await after(ctx, r, '確定しました'); return true;
  }
  if (a === 'sch-copy') { const t = document.querySelector('.line-copy'); try { await navigator.clipboard.writeText(t.value); ctx.say('コピーしました', 'ok'); } catch { t.select(); ctx.say('選んだ文をコピーしてください', ''); } return true; }
  if (a === 'sch-unsend' && l) {
    if (!confirm('この授業を下書きに戻しますか？ 保護者・生徒のページから消えます（メールは送りません）。')) return true;
    await after(ctx, await ctx.call('schedule/lessons/unsend', { id: l.id, version: l.version }), '下書きに戻しました'); return true;
  }
  if(a==='sch-renotify'&&l) {
    const via=prompt('案内方法を入力してください：email / LINE / 電話 / 対面','email');
    if(!via)return true;
    let note='';
    if(via!=='email') {
      const preview=await ctx.call('schedule/lessons/renotify',{studentId:l.studentId,lessonIds:[l.id],via,preview:true});
      if(!preview.ok){ctx.say(preview.error.message,'error');return true;}
      note=prompt(preview.lineText+'\n\n上の内容と回答期限を実際に案内してから、その日時・方法を記録してください。');
    }
    if(via!=='email'&&!note)return true;
    const r=await ctx.call('schedule/lessons/renotify',{studentId:l.studentId,lessonIds:[l.id],refs:[{id:l.id,version:l.version}],via,note});
    if(r.ok){data=null;cache={};sheet={kind:'line',title:'再案内の内容・回答期限',text:r.lineText};ctx.say('回答期限を更新しました。案内内容を確認してください','ok');}
    else ctx.say(r.error.message,'error');
    return true;
  }
  if ((a === 'sch-show-one' || a === 'sch-ask-one') && l) return stageMove(ctx, a === 'sch-show-one' ? 'show' : 'ask', l.studentId, [l.id], 0);
  const simple = { 'sch-done': ['schedule/lessons/done', '実施済みにしました'], 'sch-rest': ['schedule/lessons/rest', 'お休みにしました'], 'sch-cancel': ['schedule/lessons/cancel', 'キャンセルにしました'], 'sch-delete': ['schedule/lessons/delete', '削除しました'] };
  if (simple[a] && l) {
    if (a === 'sch-delete' && !confirm('この授業を削除しますか？ 入力ミスのときだけ使ってください（記録は残りません）。お休み・キャンセルは別のボタンです。')) return true;
    if (a === 'sch-cancel' && !confirm('この授業をキャンセル（キャンセル料の対象）にしますか？ 前日23時までの連絡なら「お休みにする」を使ってください。')) return true;
    await after(ctx, await ctx.call(simple[a][0], { id: l.id, version: l.version }), simple[a][1]); return true;
  }
  if (a === 'sch-resolve') { await after(ctx, await ctx.call('schedule/requests/resolve', { id }), '済みにしました'); return true; }
  if (a === 'sch-show' || a === 'sch-ask') {
    const sid = b.dataset.sid, stage = a === 'sch-show' ? 'held' : b.dataset.stage;
    const mine = (stage === 'adjusting' ? adjustingLessons() : heldLessons()).filter(l => l.studentId === sid), ids = mine.filter(l => !unpicked.has(l.id)).map(l => l.id);
    if (!ids.length) return true;
    return stageMove(ctx, a === 'sch-show' ? 'show' : 'ask', sid, ids, mine.length - ids.length);
  }
  if (a === 'sch-off-del') { await after(ctx, await ctx.call('schedule/unavailability/delete', { id }), '休みを消しました'); return true; }
  if (a === 'sch-ev-del') {
    const ids = String(b.dataset.ids || id || '').split(',').filter(Boolean), n = Number(b.dataset.n || ids.length);
    if (!confirm(n > 1 ? `${n} 人分の共有予定をまとめて消しますか？` : 'この共有予定を消しますか？')) return true;
    let last = { ok: true }; for (const x of ids) { last = await ctx.call('schedule/events/delete', { id: x }); if (!last.ok) break; }
    await after(ctx, last, n > 1 ? `${n} 人分を消しました` : '消しました'); return true;
  }
  if (a === 'sch-mt-cancel') { if (!confirm('この面談を取りやめますか？')) return true; await after(ctx, await ctx.call('schedule/meetings/cancel', { id }), '面談を取りやめました'); return true; }
  return false;
}

// 同じ種類・題名・期間・時刻の共有予定（たとえば中 3 全員の北辰テスト）を 1 つにまとめる。items に各生徒の分
function groupEvents(events) {
  const by = new Map();
  for (const e of events) {
    const k = [e.kind, e.title || '', e.date, e.dateTo, e.start || '', e.end || ''].join('|');
    if (!by.has(k)) by.set(k, { kind: e.kind, title: e.title, date: e.date, dateTo: e.dateTo, start: e.start, end: e.end, items: [] });
    by.get(k).items.push(e);
  }
  return [...by.values()];
}
