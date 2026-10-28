import { automaticDeadline } from '/assets/v2/notice-view.js?v=20261027-principles';
import { safeFamilyTarget, targetParts, targetPurpose } from '/assets/v2/family-target.js?v=20261027-ease7';
import { openAgreementDocument } from '/assets/v2/agreement-document.js?v=20261027-r15';
import { enrollPage, enrollTodo, enrollCovers, enrollSubmit, enrollClick, enrollInput, enrollChange, resetEnroll } from '/family/enroll.js?v=20261028-r16b';
// 保護者の画面（作り直し v2）。入口は ホーム・予定・学習・お支払い（docs/UX_STRUCTURE.md 4）。子どもが2人以上なら上で切り替える。
// 一覧は白い枠に 1 件 1 行、操作（連絡・承認・振込の連絡・申請）は押すと下から出る画面で（assets/v2/portal-ui.js）。
// ログイン・招待・再設定、アカウント（右上）。切り替える前は「準備中」の案内を出す（health の cutover.live で決める）。
import { call, session, esc, liveState } from '/assets/v2/api.js';
import { gradesView, gradesClickShared, uploadFile, openFile } from '/assets/v2/grades-view.js?v=20261026-p4';
import { monthCalendar, gridStart, gridEnd, addDays } from '/assets/v2/calendar.js?v=20261027-dense2';
import { EVENT_KIND, endOf } from '/assets/v2/schedule-view.js?v=20261028-r16b';
import { contractArchive, termsCard, termsLine, conditionCard, conditionLine, specialCard, specialLine, lessonRows, dayRows, nextLessonHero, notOver, lessonSheet, homeworkRows, recordCards, planGroups, planApprovalCard, planAckCard, planHistory, inquirySheet, invoiceRows, invoiceSheet, feeRows, feeSheet, eventRows, eventSheet, wireSheets, keepSheet, ibox, picon, yen, md, monthLabel, daysText, given } from '/assets/v2/portal-ui.js?v=20261028-r17';

// スタッフのプレビュー（#preview=pv2.…）: 本物のログイン（sw2_family）には触れず、このタブだけで使う。書き込みはサーバーが断る
const PV_KEY = 'sw2_family_preview';
if (location.hash.startsWith('#preview=')) { try { sessionStorage.setItem(PV_KEY, decodeURIComponent(location.hash.slice(9))); } catch {} history.replaceState(null, '', location.pathname + '#home'); }
const previewToken = (() => { try { return sessionStorage.getItem(PV_KEY) || ''; } catch { return ''; } })();
const store = previewToken ? { get: () => previewToken, set: () => {} } : session('sw2_family');
// プレビューでは画面に帯を出さない（本物と同じ見え方を確かめるため。本人 2026-10-09）。見分けはタブの題名だけ。押しても変わらないことはサーバーが保証する
const previewBar = () => { if (previewToken && me && !document.title.startsWith('（プレビュー）')) document.title = `（プレビュー）${document.title}`; return ''; };
const app = document.getElementById('app'), nav = document.getElementById('nav');
let me = null, busy = false, notice = null, sched = null, learning = null, money = null, grades = null, inviteInfo = null;
let cal = null, calData = {}; // 月の予定表と、月ごとに読んだ予定（{ 'YYYY-MM': 応答 }）
let sheetState = null; // 下から出る画面: { kind: 'lesson', id, pick, note } | { kind: 'event' } | { kind: 'invoice', id } | { kind: 'fee', id, note } | { kind: 'inquiry', month, note }
const planCounts = {}; // 承認の画面で変えた回数 { [lineId]: n }
let contracts = null;
const consentNames = {};
let termsChecked = false; // 規約の「同意します」の印（描き直しても消えないように）
const condChecked = {}; // 個別受講条件書の「同意します」の印（条件の id ごと）
const specialChecked = {}; // 特別単価の「承認します」の印

// ログインしていないときに開いた画面（メール・LINE のリンク。例 #confirm）。ログインや再設定のあと、その画面へ戻す
const NEXT_KEY = 'sw2_family_next';
const PAGES = ['home', 'schedule', 'confirm', 'learning', 'money', 'account', 'events', 'grades', 'enroll', 'plan', 'agree', 'contracts'];
const decodeLink = v => {try{return decodeURIComponent(v);}catch{return '';}};
function route() {
  const h = location.hash;
  if (h.startsWith('#invite=')) return { page: 'invite', token: decodeLink(h.slice(8)) };
  if (h.startsWith('#reset=')) return { page: 'reset', token: decodeLink(h.slice(7)) };
  const target=safeFamilyTarget(h.slice(1));
  return { page: h==='#forgot' ? 'forgot' : targetParts(target).path, target };
}
const say = (m, k = '') => { notice = m ? { m, k } : null; };
const noticeHtml = () => notice ? `<p class="notice ${notice.k}" role="${notice.k === 'error' ? 'alert' : 'status'}">${esc(notice.m)}</p>` : '';
const dis = () => busy ? ' disabled' : '';
async function run(task) { if (busy) return; busy = true; render(); try { await task(); } finally { busy = false; render(); } }
// 切り替える前だけ出す案内（health の cutover.live で決める）
const prepText = '<p class="notice small">準備中です。今は <a href="/hogosha/">今までの保護者ページ</a> をお使いください。</p>';
const prep = () => { const s = liveState(render); return s.known && !s.live ? prepText : ''; };

function newPasswordForm(kind, label) {
  return `<form class="stack" data-form="${kind}"><label>新しいパスワード（12文字以上）<input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
    <label>もう一度<input type="password" name="confirm" autocomplete="new-password" minlength="12" maxlength="128" required></label><button class="primary"${dis()}>${label}</button></form>`;
}
const helpLinks = '<p class="small">リンクが使えないときは、LINE または <a href="mailto:mugilives@gmail.com">mugilives@gmail.com</a> へご連絡ください。</p><p><a href="#home">ログインへ</a> · <a href="#forgot">パスワードを再設定する</a></p>';
function savedTarget(){try{return safeFamilyTarget(sessionStorage.getItem(NEXT_KEY)||'');}catch{return '';}}
let appliedTarget='', openedTarget='';
function applyTarget() {
  const r=route(); if(!me || !r.target || appliedTarget===r.target)return;
  const t=targetParts(r.target);
  if(['schedule','confirm'].includes(t.path)) {
    if(need('sched'))return;
    kid=t.student && kids().some(x=>x.id===t.student) ? t.student : '';
    if(t.month){cal=monthCalendar({today:sched.today,onChange:()=>render()});cal.month=t.month;cal.sel=t.month+'-01';}
  }
  appliedTarget=r.target;
}
function loginPage() {
  const to = route().target || savedTarget();
  return `${prep()}<h1>保護者ページ</h1>${to ? `<p>${esc(targetPurpose(to))}ためにログインしてください。</p>` : ''}${noticeHtml()}<form class="stack" data-form="login"><label>メールアドレス<input type="email" name="email" autocomplete="username" required></label>
    <label>パスワード<input type="password" name="password" autocomplete="current-password" required></label><button class="primary"${dis()}>${busy ? 'ログインしています…' : 'ログイン'}</button></form><p><a href="#forgot">パスワードを忘れたとき</a></p>`;
}
function invitePage(token) {
  if (!inviteInfo || inviteInfo.token !== token) { inviteInfo = { token, loading: true }; call('family/invite/info', { token }).then(r => { inviteInfo = { token, ...(r.ok ? r : { error: r.error.message }) }; render(); }); }
  if (inviteInfo.loading) return '<p class="muted">確かめています…</p>';
  if (inviteInfo.error) return `<h1>保護者ページの登録</h1><p class="notice error">${esc(inviteInfo.error)}</p>${helpLinks}`;
  return `<h1>保護者ページの登録</h1><p>${esc(inviteInfo.name)}（${esc(inviteInfo.email)}）</p>${noticeHtml()}<input type="email" value="${esc(inviteInfo.email)}" autocomplete="username" hidden>${newPasswordForm('invite', '登録してはじめる')}`;
}
// ---- 入口（docs/UX_STRUCTURE.md 4）: ホーム・予定・学習・お支払い。スマホでは画面の下。アカウントは右上 ----
const ICON = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  learning: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/>',
  money: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
};
const TABS = [['home', 'ホーム'], ['schedule', '予定'], ['learning', '学習'], ['money', 'お支払い']];
const TITLE = { home: 'ホーム', schedule: '予定', confirm: '予定', learning: '学習', money: 'お支払い', account: 'アカウント', enroll: '入塾のお申込み', plan: '受講計画の承認', agree: '同意のお願い', contracts: '契約・同意の控え' };
// 前の URL（#events・#grades）も開けるように
const pageOf = p => p === 'events' ? 'schedule' : p === 'grades' ? 'learning' : p;

// 子どもの切り替え（2人以上のとき）。予定は「全員」も選べる。選んだ子どもはこのタブで覚える
const KID_KEY = 'sw2_family_kid';
let kid = (() => { try { return sessionStorage.getItem(KID_KEY) || ''; } catch { return ''; } })();
const kids = () => (sched && sched.students) || [];
const names = () => Object.fromEntries(kids().map(s => [s.id, s.name]));
function kidPicker(allowAll) {
  const ks = kids(); if (ks.length < 2) return '';
  if (!allowAll && !ks.some(s => s.id === kid)) kid = ks[0].id;
  const opts = (allowAll ? [['', '全員']] : []).concat(ks.map(s => [s.id, given(s.name)]));
  return '<div class="tabs2" role="tablist" aria-label="子ども">' + opts.map(([id, label]) => `<a href="javascript:void 0" role="tab" data-action="kid" data-id="${esc(id)}" class="${kid === id ? 'on' : ''}">${esc(label)}</a>`).join('') + '</div>';
}
const forKid = (rows, key = 'studentId') => !kid ? rows : rows.filter(x => x[key] === kid);
const multiKids = () => kids().length > 1;

// 読み込み（ホームは3つをいっしょに）
function need(...what) {
  const want = what.filter(w => !{ sched, learning, money, grades }[w]);
  for (const w of want) {
    if (w === 'sched') { sched = { loading: true }; call('family/schedule', {}, store.get()).then(r => { if (r.ok) sched = r; else if (r.error.code === 'needLogin') { store.set(''); me = null; } else { sched = { students: [], lessons: [], events: [], today: '' }; say(r.error.message, 'error'); } render(); }); }
    if (w === 'learning') { learning = { loading: true }; call('family/learning', {}, store.get()).then(r => { learning = r.ok ? r : { records: [], homework: [], students: [] }; if (!r.ok) say(r.error.message, 'error'); render(); }); }
    if (w === 'money') { money = { loading: true }; call('family/money', {}, store.get()).then(r => { money = r.ok ? r : { plans: [], fees: [], invoices: [] }; if (!r.ok) say(r.error.message, 'error'); render(); }); }
    if (w === 'grades') { grades = { loading: true }; call('family/grades', {}, store.get()).then(r => { grades = r.ok ? r : { students: [] }; if (!r.ok) say(r.error.message, 'error'); render(); }); }
  }
  return what.some(w => { const v = { sched, learning, money, grades }[w]; return !v || v.loading; });
}
const loading = '<p class="muted" style="margin-top:20px">読み込んでいます…</p>';
const upcoming = () => sched.lessons.filter(l => notOver(l, sched.today) && ['proposed', 'decided'].includes(l.status));
const secTitle = (t, extra = '') => `<div class="sec-title">${t}${extra}</div>`;

// ホーム: 次の授業（大きく）・やること・近い授業・テスト・新しい記録
function homePage() {
  if (need('sched', 'learning', 'money')) return loading;
  let h = `${prep()}${noticeHtml()}`;
  const next = upcoming().filter(l => l.status === 'decided'); // ホームは確定した授業だけ。確定前の授業は「やること」の日程の確認に（2026-10-27 本人「配置が違う」）
  h += nextLessonHero(next[0], { names: names(), today: sched.today });
  // やること（押すとその画面へ）。行の下は値（だれ・どの月・締め切り・金額）だけ
  const todo = [], { asks, acks } = planGroups(money.plans);
  const enroll = enrollTodo(ectx()), covers = enrollCovers(ectx()); if (enroll) todo.push(enroll); // 入塾のお申込み（いちばん上）。申込みで規約・条件書にもまとめて同意する
  if (money.terms && money.terms.needs && !covers.terms) todo.push(['#agree', 'file', '#c98a00', '共通規約への同意', '', 1]);
  const needConds = money.conditions ? money.conditions.items.filter(x => x.needs && !covers.students.has(x.studentId)) : [];
  if (needConds.length) todo.push(['#agree', 'file', '#c98a00', '個別受講条件書への同意', needConds.map(x => given(x.studentName) + 'さん').join('・'), needConds.length]);
  const needSpecials = money.specials ? money.specials.items.filter(x => x.status === 'proposed') : [];
  if (needSpecials.length) todo.push(['#agree', 'file', '#c98a00', '特別単価の承認', [...new Set(needSpecials.map(x => `${given(x.studentName)}さん`))].join('・'), needSpecials.length]);
  // 保護者が見るページ: 何の・誰のことかを言う（2026-10-27 本人「受講計画の承認」「授業日時の承認」「入金待ちのお支払い」「お子様の宿題」）。
  // 2行の薄い字にしない・金額は出さない。添える言葉は1行で「入金待ちのお支払い（9月）」のように（同日 本人）
  if (asks.length) todo.push(['#plan', 'plan', '#5b6672', '受講計画の承認', asks.map(([m]) => monthLabel(m)).join('・'), asks.length]);
  const asking = askingLessons(sched.lessons);
  const askBy = asking.map(automaticDeadline).filter(Boolean).sort()[0];
  if (asking.length) todo.push(['#confirm', 'calendar', '#e0a100', '授業日時の承認', askBy ? md(askBy) + 'まで' : '', asking.length]);
  const due = money.invoices.filter(v => v.status === 'confirmed');
  if (due.length) todo.push(['#money', 'yen', '#c0392b', '入金待ちのお支払い', due.map(v => monthLabel(v.month)).join('・'), due.length]);
  // 宿題は保護者が対応することではないので、ここに置かない（下の「授業記録」と並べる。2026-10-27 本人）。見出しは「対応が必要なこと」（同日 本人「やることっていうのが名前として微妙」）
  h += secTitle('対応が必要なこと');
  h += todo.length ? '<div class="group">' + todo.map(([href, ic, color, label, note, n]) => `<a class="todo-row" href="${href}">${ibox(ic, color, label)}<span class="v"><span class="lbl">${esc(label)}${note ? `（${esc(note)}）` : ''}</span></span><span class="cnt">${n}</span><span class="go">›</span></a>`).join('') + '</div>' : '<p class="muted small">対応が必要なことはありません。</p>';
  // そのあとの授業（最大 4 件）
  const more = next.slice(1, 5);
  if (more.length) h += secTitle('そのあとの授業', '<a class="more" href="#schedule">すべて見る ›</a>') + lessonRows(more, { names: names(), today: sched.today });
  const tests = sched.events.filter(e => e.kind === 'test' && e.dateTo >= sched.today).slice(0, 2);
  if (tests.length) h += secTitle('テスト') + eventRows(tests, { names: multiKids() ? names() : {}, today: sched.today });
  // 授業記録と宿題（2026-10-27 本人「新しい授業の記録ってのは要らない…宿題は…下の方に移動して、「授業記録」というのと並べて」）
  const hw = learning.homework.filter(w => w.status === 'open');
  h += `<div class="home-links"><a class="todo-row" href="#learning">${ibox('book', '#2f6fd6', '授業記録')}<span class="v"><span class="lbl">授業記録</span></span><span></span><span class="go">›</span></a>`
    + `<a class="todo-row" href="#learning">${ibox('homework', '#7b4fd6', 'お子様の宿題')}<span class="v"><span class="lbl">お子様の宿題</span></span><span class="cnt">${hw.length || ''}</span><span class="go">›</span></a></div>`;
  return h;
}
// 予定: 月の表（スタッフと同じ動き）。子どもを選べる。日を押すとその日の一覧、授業を押すと下から出る画面で「変更・お休みの連絡」。テスト・行事を知らせるは上の帯の右
// 表の上: 確認待ちは日程の確認へのリンク、調整中は色の印（オレンジ）と件数だけ
const RANK = { proposed: 1, decided: 2, done: 3 };
function needCal(month) {
  if (!calData[month]) { calData[month] = { loading: true }; call('family/schedule', { from: gridStart(month), to: gridEnd(month) }, store.get()).then(r => { calData[month] = r.ok ? r : { lessons: [], events: [], students: [], today: '' }; if (!r.ok) failed(r); render(); }); }
  return calData[month].loading;
}
// 月の表に出す短い名前: 名（同じ名の子がいれば姓名）
const shortName = id => { const s = kids().find(k => k.id === id); if (!s) return ''; const g = given(s.name); return kids().filter(k => given(k.name) === g).length > 1 ? s.name : g; };
function schedulePage() {
  if (need('sched')) return loading;
  if (!cal) cal = monthCalendar({ today: sched.today, onChange: () => render() });
  let h = `${kidPicker(true)}${cal.bar(esc, `<button class="ibtn" data-action="add-event" aria-label="テスト・行事を知らせる" title="テスト・行事を知らせる">${picon('plus')}</button>`)}${noticeHtml()}`;
  if (needCal(cal.month)) return h + loading;
  const t=targetParts(route().target||'');
  if(t.kind==='lesson' && t.refs.length && openedTarget!==route().target) {
    openedTarget=route().target;
    const found=calData[cal.month].lessons.find(l=>l.id===t.refs[0].id);
    if(found){cal.sel=found.date;sheetState={kind:'lesson',id:found.id,pick:'',note:''};}
    else h+='<p class="notice">この授業は変更・取り下げ済みか、この月にありません。</p>';
  }
  const d = calData[cal.month], multi = multiKids() && !kid, nm = names();
  const lessons = forKid(d.lessons).filter(l => l.status !== 'held'), events = forKid(d.events);
  const asking = askingLessons(lessons), adjusting = lessons.filter(l => l.status === 'proposed' && !l.asked && l.date >= d.today);
  // 承認待ち（この月に限らず）。選んで「承認する」
  const askAll = askingLessons(forKid(sched.lessons)), choosable = askAll.filter(l => !hasOpen(l)), picked = choosable.filter(l => askOn.has(l.id));
  if (askAll.length) {
    const months = [...new Set(askAll.map(l => l.date.slice(0, 7)))].sort().map(monthLabel).join('・'), allOn = choosable.length && picked.length === choosable.length;
    h += `<div class="ask-head notice small"><span>承認待ちの授業 ${askAll.length}件（${months}）。承認する授業を選んでください。</span>${choosable.length ? `<button type="button" class="small-btn" data-action="ask-all">${allOn ? '選択を外す' : 'すべて選ぶ'}</button>` : ''}</div>`;
    const pend = [...new Set(askAll.filter(l => l.planPending).map(l => l.date.slice(0, 7)))].sort();
    if (pend.length) h += `<p class="small" style="margin:4px 0">${pend.map(monthLabel).join('・')}の受講計画（科目・回数・料金）の承認もお願いします。<a href="#plan">受講計画を見る ›</a></p>`;
    const extra = askAll.filter(l => l.extraFee);
    if (extra.length) h += `<p class="small" style="margin:4px 0">受講計画の外の授業が${extra.length}回あります（${extra.map(l => esc(md(l.date)) + ' ' + esc(l.subject) + ' 1回 ' + yen(l.extraFee)).join('・')}）。承認すると、この授業料で受講します。</p>`;
  }
  if (adjusting.length) h += `<p style="margin:0 0 6px"><span class="tag warn">調整中 ${adjusting.length}件</span></p>`;
  const cell = date => {
    const ls = lessons.filter(l => l.date === date && l.status in RANK);
    const bars = events.filter(e => e.date <= date && date <= e.dateTo).map(e => `<span class="bar ${e.kind === 'unavailable' ? 'off' : e.kind}">${esc(e.title || EVENT_KIND[e.kind])}</span>`);
    // 授業ごとに時刻と科目（全員を出すときは科目の代わりに名。狭い表で切れないように）。2026-10-27 本人「時間帯もカレンダー上の表記で分かるようにしたい」
    const chips = ls.sort((a, b) => a.start.localeCompare(b.start)).map(l => { const on = askOn.has(l.id) && l.status === 'proposed'; return `<span class="nm t2 r${RANK[l.status]}${on ? ' on' : ''}"><small class="tm">${on ? '✓ ' : ''}${l.start}<span class="te">〜${endOf(l.start, l.minutes)}</span></small><b>${multi ? esc(shortName(l.studentId)) + `<span class="sj"> ${esc(l.subject)}</span>` : esc(l.subject)}</b></span>`; });
    return { lines: bars.concat(chips), count: ls.length };
  };
  const pick = { on: askOn, can: l => choosable.some(x => x.id === l.id) };
  const day = (date, first) => cal.dayHead(date, first) + dayRows(date, lessons, events, { names: multi ? nm : {}, canDelete: e => e.createdByKind === 'family', pick });
  h += cal.html(esc, { cell, day });
  if (picked.length) h += `<div class="ask-go"><button class="primary wide" data-action="ask-send"${dis()}>承認する（${picked.length}件）</button></div>`;
  return h;
}
// 確認待ち（今日以降・始まっていない・連絡を出していない）
// 承認の確認に、受講計画を超える授業と授業料を出す（2026-10-27 本人「受講計画を超える授業ですが承認しますか？って確認を入れればいい」）
const overText = list => { const x = list.filter(l => l && l.extraFee && l.overPlan); return x.length ? `

受講計画を超える授業があります（${x.map(l => md(l.date) + ' ' + l.subject + ' 1回 ' + yen(l.extraFee)).join('・')}）。この授業料で承認しますか？` : ''; };
function askingLessons(lessons) { return lessons.filter(l => l.status === 'proposed' && l.asked && Date.parse(l.date+'T'+l.start+':00+09:00') > Date.now()); }
const hasOpen = l => (l.requests || []).some(r => r.status === 'open');
// 授業日時の承認は予定の画面で（2026-10-27 本人「この画面と予定の画面は統一されるべき…他の予定との兼ね合いも見たいでしょうし。つまり、「授業日程の承認」→「予定」ページへと移る」）。
// #confirm（ホームの「授業日時の承認」・メール・LINE のリンク）は、承認待ちの最初の月の予定を開く
const askOn = new Set(); // 承認する授業（押して選んだもの。チェックが付く）。選ばなかった授業は承認待ちのまま
function confirmToSchedule() {
  if (need('sched')) return loading;
  const first = askingLessons(forKid(sched.lessons)).map(l => l.date).sort()[0];
  if (!cal) cal = monthCalendar({ today: sched.today, onChange: () => render() });
  const t = route().target || '', next = t.replace(/^confirm/, 'schedule') || 'schedule';
  if (first && !targetParts(t).month) { cal.month = first.slice(0, 7); cal.sel = first; }
  history.replaceState(null, '', '#' + next); appliedTarget = next; // 子ども・月の指定はそのまま（予定の画面で同じものを読み直さない）
  return schedulePage();
}
// 学習: 子どもを選んで「記録と宿題」「成績」
function learningPage(sub) {
  if (need('sched')) return loading;
  const tab = sub === 'grades' ? 'grades' : 'records';
  let h = `${kidPicker(false)}<div class="seg" style="margin-top:8px"><a href="#learning" class="${tab === 'records' ? 'on' : ''}">記録と宿題</a><a href="#learning/grades" class="${tab === 'grades' ? 'on' : ''}">成績</a></div>${noticeHtml()}`;
  if (tab === 'records') {
    if (need('learning')) return h + loading;
    const hw = forKid(learning.homework).filter(w => w.status !== 'confirmed');
    h += secTitle(`宿題${hw.length ? ` <span class="count">${hw.length}</span>` : ''}`) + homeworkRows(hw);
    h += secTitle('授業の記録') + recordCards(forKid(learning.records), learning.homework);
    return h;
  }
  if (need('grades')) return h + loading;
  const st = grades.students.find(s => s.id === kid) || grades.students[0];
  return h + (st ? gradesView(st, { who: 'family', dis: dis() }) : '<p class="muted">まだ成績はありません。</p>');
}
function moneySelection() {
  const t=targetParts(route().target||''), match=x=>t.refs.some(r=>r.id===x.id), exact=x=>t.refs.some(r=>r.id===x.id && r.version===(x.version ?? x.no));
  let header='', plans=money.plans, invoices=money.invoices.filter(x=>x.status!=='void'), fees=money.fees, conds=money.conditions?.items||[], specials=money.specials?.items||[];
  if(!t.kind || !t.refs.length)return {header,plans,invoices,fees,conds,specials};
  header=['invoice','fee'].includes(t.kind)?'<p class="notice"><a href="#money">すべての請求・料金を見る ›</a></p>':''; // 承認・同意は専用の画面（#plan・#agree）なので、お支払いへのリンクは出さない
  if(t.kind==='plan') {
    plans=money.plans.filter(match);
    const stale=plans.some(l=>l.status==='proposed'&&!exact(l)) || plans.length!==t.refs.length;
    if(stale)header+='<p class="notice">お知らせ後に内容が変わったか、取り下げられています。古い案からは承認できません。</p>';
    plans=plans.filter(l=>l.status!=='proposed'||exact(l));
    invoices=[];fees=[];
  } else if(t.kind==='invoice') {
    invoices=money.invoices.filter(match);plans=[];fees=[];
    if(invoices.length && openedTarget!==route().target){openedTarget=route().target;sheetState={kind:'invoice',id:invoices[0].id};}
    if(!invoices.length)header+='<p>この請求は表示できません。</p>';
  } else if(t.kind==='fee') {
    fees=money.fees.filter(match);plans=[];invoices=[];
    if(fees.length && openedTarget!==route().target){openedTarget=route().target;sheetState={kind:'fee',id:fees[0].id,note:''};}
    if(!fees.length)header+='<p>この料金は表示できません。</p>';
  } else if(t.kind==='condition') {
    const hit=conds.flatMap(x=>x.history||[]).find(match);
    if(!hit || hit.status!=='proposed' || !exact(hit)) {
      header+='<p class="notice">この条件書は同意済み、または更新・取り下げ済みです。</p>';
      conds=[];
    } else conds=conds.filter(x=>x.latest && match(x.latest));
    plans=[];invoices=[];fees=[];specials=[];
  } else if(t.kind==='special') {
    const hit=specials.find(match);
    if(!hit||hit.status!=='proposed'||!exact(hit))header+='<p class="notice">この提案は対応済み、または変更されています。</p>';
    specials=specials.filter(x=>match(x)&&(x.status!=='proposed'||exact(x)));
    plans=[];invoices=[];fees=[];
  }
  return {header,plans,invoices,fees,conds,specials};
}
// 2026-10-27 本人「受講計画書の承認は「お支払い」でするべきことではない」→「その形で作り直して」:
// 保護者が来る用事ごとに画面を分ける。承認（#plan）・同意（#agree）は「やること」とメールのリンクから、その 1 枚へ。
// お支払い（#money）は請求とキャンセル料だけ。過去の契約・同意の控え（#contracts）はアカウントから
const noneLeft = text => `<p class="muted" style="margin-top:16px">${text}</p><p><a href="#home">ホームへ</a></p>`;
// 受講計画書の承認（月ごとに 1 枚。先に共通規約・個別受講条件書への同意が要る）
function planPage() {
  if (need('money')) return loading;
  const multi = new Set(money.plans.map(l => l.studentId)).size > 1;
  const selected = moneySelection(), { asks } = planGroups(selected.plans);
  let h = noticeHtml() + selected.header;
  if (!asks.length) return h + noneLeft('承認をお願いしている受講計画書はありません。');
  const blocked = !!(money.terms && money.terms.needs) || (money.conditions?.items || []).some(x => x.needs);
  if (blocked) h += '<p class="notice">先に<a href="#agree">共通規約・個別受講条件書への同意</a>をお願いします。</p>';
  return h + asks.map(([m, ls]) => planApprovalCard(m, ls, { multi, counts: planCounts, consenterName: consentNames[m] || me.guardianName || '', dis: dis() || (blocked ? ' disabled' : '') })).join('');
}
// 同意のお願い（共通規約・個別受講条件書・特別単価合意書）
function agreePage() {
  if (need('money')) return loading;
  const selected = moneySelection(), covers = enrollCovers(ectx()), needTerms = !!(money.terms && money.terms.needs);
  const needConds = selected.conds.filter(x => x.needs && !covers.students.has(x.studentId)), needSpecials = selected.specials.filter(x => x.status === 'proposed');
  let h = noticeHtml() + selected.header;
  if (covers.terms) h += `<div class="group" style="margin:12px 0"><a class="todo-row" href="#enroll">${ibox('file', '#c0392b', '入塾のお申込み')}<span class="v"><span class="lbl">入塾のお申込み</span></span><span class="go">›</span></a></div>`;
  else if (needTerms) h += termsCard(money.terms, { busy, checked: termsChecked, consenterName: consentNames.terms || me.guardianName || '' });
  h += needConds.map(x => conditionCard(x, { busy, checked: !!condChecked[x.latest.id], consenterName: consentNames[x.latest.id] || me.guardianName || '' })).join('');
  h += needSpecials.map(x => specialCard(x, { busy, checked: !!specialChecked[x.id], consenterName: consentNames[x.id] || me.guardianName || '' })).join('');
  if (!covers.terms && !needTerms && !needConds.length && !needSpecials.length) h += noneLeft('同意をお願いしているものはありません。');
  return h;
}
// お支払い: 授業料の請求とキャンセル料だけ
function moneyPage() {
  if (need('money')) return loading;
  const multi = new Set(money.fees.map(f => f.studentId)).size > 1;
  const selected = moneySelection();
  let h = noticeHtml() + selected.header;
  h += secTitle('授業料') + invoiceRows(selected.invoices);
  if (selected.fees.length) h += secTitle('キャンセル料') + feeRows(selected.fees, { multi });
  return h;
}
// 契約・同意の控え（アカウントから）: 今の共通規約・個別受講条件書・特別単価合意書、決まった受講計画書、過去の控え
function contractsPage() {
  if (need('money')) return loading;
  const multi = new Set(money.plans.map(l => l.studentId)).size > 1, { others } = planGroups(money.plans);
  let h = noticeHtml();
  if (money.terms) h += termsLine(money.terms);
  if (money.conditions) h += conditionLine(money.conditions.items);
  if (money.specials) h += specialLine(money.specials.items);
  if (others.length) h += secTitle('受講計画書') + planHistory(others, { multi });
  return h + '<p><button data-action="contracts-open">前の版も見る</button></p>' + contractArchive(contracts);
}

function accountPage() {
  if (previewToken) return `<p class="muted">プレビューでは使えません。</p>`;
  need('sched');
  return `<p>${esc(me.name)}（${esc(me.email)}）</p>${noticeHtml()}<div class="group" style="margin:12px 0"><a class="todo-row" href="#contracts">${ibox('file', '#5b6672', '契約・同意の控え')}<span class="v"><span class="lbl">契約・同意の控え</span></span><span class="go">›</span></a></div>${kids().length ? `<h2>生徒さん本人からのお休みの連絡</h2><div class="choices">${kids().map(k => `<label class="choice"><input type="checkbox" data-contact="${esc(k.id)}"${k.studentContact ? ' checked' : ''}${dis()}><span>${esc(k.name)}さん本人から受け付ける</span></label>`).join('')}</div>` : ''}<h2>パスワードを変える</h2><form class="stack" data-form="password"><input type="email" value="${esc(me.email)}" autocomplete="username" hidden>
    <label>今のパスワード<input type="password" name="current" autocomplete="current-password" required></label><label>新しいパスワード（12文字以上）<input type="password" name="next" autocomplete="new-password" minlength="12" required></label>
    <label>もう一度<input type="password" name="confirm" autocomplete="new-password" minlength="12" required></label><button class="primary"${dis()}>変える</button></form><h2>ログアウト</h2><p><button data-action="logout"${dis()}>この端末からログアウト</button></p>`;
}
const findLesson = id => { for (const src of [sched].concat(Object.values(calData))) { const l = src && src.lessons && src.lessons.find(x => x.id === id); if (l) return l; } return null; };
// 下から出る画面
function sheetHtml() {
  const s = sheetState; if (!s || !me) return '';
  if (s.kind === 'lesson') { const l = findLesson(s.id); return l ? lessonSheet(l, s, { names: multiKids() ? names() : {}, canAgree: !previewToken, busy }) : ''; }
  if (s.kind === 'event') return eventSheet(kid ? kids().filter(x => x.id === kid) : kids());
  if (s.kind === 'invoice') { const v = money && money.invoices && money.invoices.find(x => x.id === s.id); return v ? invoiceSheet(v, { multi: multiKids(), busy }) : ''; }
  if (s.kind === 'fee') { const f = money && money.fees && money.fees.find(x => x.id === s.id); return f ? feeSheet(f, { busy, note: s.note }) : ''; }
  if (s.kind === 'inquiry') return inquirySheet(s.month, s.note, busy);
  return '';
}
// 上の帯に画面の名前（スマホでは「ステップワイズ」の代わりに）
function renderBar(page) {
  const bar = document.querySelector('.top .in'); if (!bar) return;
  bar.querySelectorAll('.bar-title').forEach(x => x.remove());
  const title = me ? TITLE[page] : '';
  if (title) bar.firstElementChild.insertAdjacentHTML('afterend', `<div class="bar-title"><strong>${esc(title)}</strong></div>`);
  document.body.classList.toggle('has-bar', !!title);
}
function render() {
  applyTarget();
  // メールのリンク（#money?kind=plan など）は、用事の画面で開く
  const r = route(), kind0 = targetParts(r.target || '').kind, page0 = pageOf(r.page.split('/')[0]), sub = r.page.split('/')[1];
  const page = page0 === 'money' && kind0 === 'plan' ? 'plan' : page0 === 'money' && ['condition', 'special'].includes(kind0) ? 'agree' : page0;
  const tabs = me && page !== 'enroll'; // 入塾のお申込みの間は手続きだけ
  nav.innerHTML = tabs ? TABS.map(([k, l]) => `<a href="#${k}" class="${page === k ? 'on' : ''}"${page === k ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg><span>${l}</span></a>`).join('') : '';
  document.body.classList.toggle('has-tabs', tabs);
  const acct = document.getElementById('acct'); if (acct) acct.hidden = !me;
  if (!me && r.page !== 'home' && PAGES.includes(r.page.split('/')[0])) { try { sessionStorage.setItem(NEXT_KEY, r.target || r.page); } catch {} } // ログインのあとで戻る
  let h;
  if (r.page === 'invite') h = invitePage(r.token);
  else if (r.page === 'reset') h = `<h1>新しいパスワード</h1>${noticeHtml()}${newPasswordForm('reset', 'パスワードを変える')}${helpLinks}`;
  else if (!me) h = r.page === 'forgot' ? `<h1>パスワードの再設定</h1>${noticeHtml()}<form class="stack" data-form="forgot"><label>メールアドレス<input type="email" name="email" required></label><button class="primary"${dis()}>再設定のメールを送る</button></form><p><a href="#">ログインに戻る</a></p>` : loginPage();
  else h = page === 'schedule' ? schedulePage() : page === 'confirm' ? confirmToSchedule() : page === 'learning' ? learningPage(sub || (r.page === 'grades' ? 'grades' : '')) : page === 'money' ? moneyPage() : page === 'plan' ? planPage() : page === 'agree' ? agreePage() : page === 'contracts' ? contractsPage() : page === 'account' ? accountPage() : page === 'enroll' ? enrollPage(ectx()) : homePage();
  app.className = !me ? 'narrow' : '';
  renderBar(me ? page : '');
  keepSheet(app, () => { app.innerHTML = previewBar() + h + sheetHtml(); });
  if (me && page === 'schedule' && cal) cal.afterRender(render);
  const box = app.querySelector('.bsheet');
  if (box && notice && notice.k === 'error') box.querySelector('.bsheet-body').insertAdjacentHTML('afterbegin', noticeHtml()); // 下から出る画面の中でも見えるように
}
function signedIn(r) {
  store.set(r.auth); me = r.me; resetEnroll(); sched = null; calData = {}; cal = null; learning = null; money = null; contracts = null; for (const k of Object.keys(consentNames)) delete consentNames[k]; grades = null; say('');
  let next = ''; try { next = sessionStorage.getItem(NEXT_KEY) || ''; sessionStorage.removeItem(NEXT_KEY); } catch {}
  location.hash = '#' + (safeFamilyTarget(r.returnTo) || safeFamilyTarget(next) || 'home');
}
const closeSheet = () => { sheetState = null; };
// 下から出る画面の入力は、描き直す前に読んでおく（描き直すと入力欄が作り直される）
function captureSheetInputs() {
  const s = sheetState; if (!s) return;
  const el = document.getElementById(s.kind === 'lesson' ? 'change-note' : s.kind === 'fee' ? 'relief-note' : s.kind === 'inquiry' ? 'inquiry-note' : '');
  if (el) s.note = el.value;
}
// 失敗したとき: ログインが切れていればログイン画面へ。それ以外は文を出す
// 入塾のお申込み（family/enroll.js）に渡す道具
function ectx() {
  return { esc, call: (route, body) => call(route, body, store.get()), render, run, say, dis, noticeHtml, failed: r => { failed(r); },
    applied: name => { me = { ...me, guardianName: name }; money = null; sched = null; contracts = null; } };
}
function failed(r) { if (r.error.code === 'needLogin' && me) { store.set(''); me = null; } say(r.error.message, 'error'); }

app.addEventListener('submit', ev => {
  ev.preventDefault();
  const el = ev.target, kind = el.dataset.form, v = Object.fromEntries(new FormData(el).entries());
  if (enrollSubmit(ectx(), kind)) return;
  if ((kind === 'invite' || kind === 'reset') && v.password !== v.confirm) { say('2つのパスワードが一致しません', 'error'); return render(); }
  if (kind === 'password' && v.next !== v.confirm) { say('2つのパスワードが一致しません', 'error'); return render(); }
  run(async () => {
    let r;
    if (kind === 'login') { r = await call('family/login', v); if (r.ok) return signedIn(r); }
    else if (kind === 'forgot') { r = await call('family/reset/request', {...v,returnTo:savedTarget()}); if (r.ok) return say(r.message, 'ok'); }
    else if (kind === 'invite') { r = await call('family/invite/accept', { token: route().token, password: v.password }); if (r.ok) return signedIn(r); }
    else if (kind === 'reset') { r = await call('family/reset/confirm', { token: route().token, password: v.password }); if (r.ok) return signedIn(r); }
    else if (kind === 'password') { r = await call('family/password', { current: v.current, next: v.next }, store.get()); if (r.ok) { el.reset(); return say('パスワードを変えました', 'ok'); } }
    else if (kind === 'gr-upload') {
      const file = el.querySelector('input[type=file]').files[0]; if (!file) return;
      r = await uploadFile(file, v.note || '', meta => call('family/grades/upload', { ...meta, studentId: v.studentId }, store.get()));
      if (r.ok) { grades = null; return say('成績票を送りました', 'ok'); }
      if (r.error && !r.error.code) r.error.code = 'client';
    } else if (kind === 'plan-approve') {
      // 月の計画をまとめて承認する（行ごとの回数は画面で選んだ値）。途中で失敗したら、そこまでの承認は済んでいる
      const refs=JSON.parse(el.dataset.refs || '[]');
      const lines=refs.map(ref=>money.plans.find(l=>l.id===ref.id && l.version===ref.version)).filter(Boolean);
      if(lines.length!==refs.length){money=null;return say('表示後に内容が変わりました。もう一度ご確認ください','error');}
      if (!lines?.length) return;
      const zero = lines.filter(l => (planCounts[l.id] === undefined ? l.count : planCounts[l.id]) === 0);
      if (zero.length && !confirm(`${zero.map(l => l.subject).join('・')}を見送りにします。よろしいですか？`)) return;
      let okCount = 0;
      for (const l of lines) {
        const n = planCounts[l.id] === undefined ? l.count : planCounts[l.id];
        r = await call('family/plans/decide', { id: l.id, version: l.version, approvedCount: n, consenterName: v.consenterName }, store.get());
        if (!r.ok) break; okCount++; delete planCounts[l.id];
      }
      money = null;
      if (r.ok) return say(`${monthLabel(el.dataset.month)}の受講計画書を承認しました`, 'ok');
      if (okCount) return say(`${okCount}件は承認できましたが、途中で止まりました: ${r.error.message}`, 'error');
    } else if (kind === 'event') { r = await call('family/events/add', v, store.get()); if (r.ok) { sched = null; calData = {}; closeSheet(); return say('先生に知らせました', 'ok'); } }
    if (!r) return;
    failed(r);
  });
});
app.addEventListener('input', ev => { if (enrollInput(ev)) return; if (ev.target.dataset?.consenter) consentNames[ev.target.dataset.consenter] = ev.target.value; });
app.addEventListener('change', ev => { if (enrollChange(ev)) return; if (ev.target.dataset && ev.target.dataset.contact) { const id = ev.target.dataset.contact, allow = ev.target.checked; run(async () => { const r = await call('family/students/contact', { studentId: id, allow }, store.get()); if (!r.ok) return failed(r); const k = kids().find(x => x.id === id); if (k) k.studentContact = allow; say(allow ? '生徒さん本人からも受け付けます' : '保護者からの連絡だけにしました', 'ok'); }); return; } if (ev.target.id === 'terms-agree') { termsChecked = ev.target.checked; return; } if (ev.target.dataset && ev.target.dataset.condAgree) { condChecked[ev.target.dataset.condAgree] = ev.target.checked; return; } if (ev.target.dataset && ev.target.dataset.specialAgree) { specialChecked[ev.target.dataset.specialAgree] = ev.target.checked; return; } const id = ev.target.dataset && ev.target.dataset.planCount; if (id) { planCounts[id] = Number(ev.target.value); render(); } });
app.addEventListener('click', ev => {
  const b = ev.target.closest('[data-action]'); if (!b) return;
  const a = b.dataset.action;
  if (cal && cal.click(a, b)) return render();
  if (gradesClickShared(a, b)) return render();
  if (enrollClick(ectx(), a, b)) { ev.preventDefault(); return; }
  if (a === 'kid') { kid = b.dataset.id; try { sessionStorage.setItem(KID_KEY, kid); } catch {} ev.preventDefault(); return render(); }
  if (a === 'lesson') { sheetState = { kind: 'lesson', id: b.dataset.id, pick: '', note: '' }; return render(); }
  if (a === 'ask-pick') { const id = b.dataset.id; if (askOn.has(id)) askOn.delete(id); else askOn.add(id); return render(); }
  if (a === 'ask-all') {
    const ls = askingLessons(forKid(sched.lessons)).filter(l => !hasOpen(l)), all = ls.every(l => askOn.has(l.id));
    ls.forEach(l => all ? askOn.delete(l.id) : askOn.add(l.id));
    if (!all && ls.length && cal && !ls.some(l => l.date.slice(0, 7) === cal.month)) { cal.month = ls[0].date.slice(0, 7); cal.sel = ls[0].date; } // 選んだ授業の月を出す
    return render();
  }
  if (a === 'pick') { captureSheetInputs(); sheetState.pick = b.dataset.c; return render(); }
  if (a === 'close-sheet') { closeSheet(); return render(); }
  if (a === 'add-event') { sheetState = { kind: 'event' }; return render(); }
  if (a === 'invoice') { sheetState = { kind: 'invoice', id: b.dataset.id }; return render(); }
  if (a === 'fee') { sheetState = { kind: 'fee', id: b.dataset.id, note: '' }; return render(); }
  if (a === 'plan-inquiry') { sheetState = { kind: 'inquiry', month: b.dataset.month, refs:JSON.parse(b.dataset.refs||'[]'), note: '' }; return render(); }
  if (a === 'agreement-doc') { openAgreementDocument(() => call('family/plans/document', { refs: JSON.parse(b.dataset.refs) }, store.get()), message => { say(message, 'error'); render(); }); return; }
  if (a === 'gr-open') { const win = window.open('', '_blank'); run(async () => { const r = await openFile(() => call('files/link', { id: b.dataset.id }, store.get()), win); if (!r.ok) say(r.error.message, 'error'); }); return; }
  captureSheetInputs();
  run(async () => {
    let r;
    if (a === 'ask-send') {
      const all = askingLessons(forKid(sched.lessons)).filter(l => !hasOpen(l)), ok = all.filter(l => askOn.has(l.id)), off = all.filter(l => !askOn.has(l.id));
      if (!ok.length) return;
      if (!confirm(`${ok.length}件をこの日時で承認します（予約になります。前日23時まではお休みにできます）。` + (off.length ? `
選ばなかった${off.length}件は、承認待ちのまま残ります。` : '') + overText(ok))) return;
      r = await call('family/lessons/agree', { lessons: ok.map(l => ({ id: l.id, version: l.version })) }, store.get());
      if (r.ok) { askOn.clear(); closeSheet(); sched = null; calData = {}; return say(`${r.decided}件を承認しました。ありがとうございます`, 'ok'); }
    } else if (a === 'agree' || a === 'agree-all') {
      // 画面で見ている確認待ち（id と版）をそのまま送る。見ていたものと違えば、サーバーは何も確定しない
      const list = a === 'agree' ? [{id:b.dataset.id,version:Number(b.dataset.version)}] : JSON.parse(b.dataset.refs || '[]');
      if (!list.length) return;
      if (!confirm(`${list.length === 1 ? 'この授業' : list.length + '件の授業'}をこの日時で承認しますか？（予約になります。前日23時まではお休みにできます）` + overText(list.map(x => ((sched && sched.lessons) || []).find(l => l.id === x.id))))) return;
      r = await call('family/lessons/agree', { lessons: list.map(l => ({ id: l.id, version: l.version })) }, store.get());
      if (r.ok) { closeSheet(); sched = null; calData = {}; return say(`${r.decided}件を承認しました。ありがとうございます`, 'ok'); }
    } else if (a === 'send-change') {
      const s = sheetState; if (!s || s.kind !== 'lesson' || !s.pick) return;
      r = await call('family/lessons/request', { lessonId: s.id, kind: s.pick, note: (s.note || '').trim() }, store.get());
      if (r.ok) { closeSheet(); sched = null; calData = {}; return say({ move: '日時の変更をお願いしました', rest: 'お休みにしました', late: '先生に連絡しました', cancel: 'キャンセルの連絡を受け付けました' + (r.fee ? `（キャンセル料 ${yen(r.fee.amount)}）` : '') }[r.request ? r.request.kind : 'move'], 'ok'); }
    } else if (a === 'withdraw') { if (!confirm('この連絡を取り下げますか？')) return; r = await call('family/lessons/withdraw', { requestId: b.dataset.id }, store.get()); if (r.ok) { closeSheet(); sched = null; calData = {}; return say('連絡を取り下げました', 'ok'); } }
    else if (a === 'hw-done' || a === 'hw-undo') { r = await call('family/homework/report', { id: b.dataset.id, undo: a === 'hw-undo' }, store.get()); if (r.ok) { learning = null; return say(a === 'hw-done' ? 'できたと先生に知らせました' : '取り消しました', 'ok'); } }
    else if (a === 'plan-ack-month') {
      const lines=JSON.parse(b.dataset.refs||'[]'); let completed=0;
      for (const l of (lines || [])) { r = await call('family/plans/ack', { id: l.id, version: l.version, ack: 'confirmed' }, store.get()); if (!r.ok) break; completed++; }
      money = null; if (r && r.ok) return say('確認しました', 'ok');
      if(completed)return say(completed+'件は確認できました。残りは再確認してください：'+r.error.message,'error');
    } else if (a === 'send-inquiry') {
      const s = sheetState; const note = (s.note || '').trim(); if (!note) return say('内容を書いてください', 'error');
      const lines=s.refs||[]; let completed=0;
      for (const l of (lines || [])) { r = await call('family/plans/ack', { id: l.id, version: l.version, ack: 'inquiry', note }, store.get()); if (!r.ok) break; completed++; }
      money = null; if (r && r.ok) { closeSheet(); return say('先生に伝えました', 'ok'); }
      if(completed){closeSheet();return say(completed+'件は伝えました。残りは再確認してください：'+r.error.message,'error');}
    } else if (a === 'contracts-open') {
      contracts = { loading: true }; render();
      const result = await call('family/contracts', {}, store.get());
      contracts = result.ok ? result : { error: result.error.message };
    } else if (a === 'special-agree') { const id = b.dataset.id; if (!specialChecked[id]) return say('内容を確かめて「承認します」に印を付けてください', 'error'); if (!(consentNames[id] || me.guardianName || '').trim()) return say('承認する保護者の氏名を入れてください', 'error'); r = await call('family/specials/agree', { id, agree: true, consenterName: consentNames[id] || me.guardianName }, store.get()); if (r.ok) { money = contracts = null; delete specialChecked[id]; return say('特別単価を承認いただきました。ありがとうございます', 'ok'); }
    } else if (a === 'cond-agree') { const id = b.dataset.id; if (!condChecked[id]) return say('内容を確かめて「同意します」に印を付けてください', 'error'); if (!(consentNames[id] || me.guardianName || '').trim()) return say('同意する保護者の氏名を入れてください', 'error'); r = await call('family/conditions/agree', { id, agree: true, consenterName: consentNames[id] || me.guardianName }, store.get()); if (r.ok) { money = contracts = null; delete condChecked[id]; return say('個別受講条件書に同意いただきました。ありがとうございます', 'ok'); }
    } else if (a === 'terms-accept') { if (!termsChecked) return say('全文を読んで「同意します」に印を付けてください', 'error'); if (!(consentNames.terms || me.guardianName || '').trim()) return say('同意する保護者の氏名を入れてください', 'error'); r = await call('family/terms/accept', { version: b.dataset.version, agree: true, consenterName: consentNames.terms || me.guardianName }, store.get()); if (r.ok) { money = contracts = null; termsChecked = false; return say('共通規約に同意いただきました。ありがとうございます', 'ok'); } }
    else if (a === 'inv-report') { if (!confirm('振り込んだことを先生に知らせますか？')) return; r = await call('family/invoices/report', { id: b.dataset.id, version: Number(b.dataset.version) }, store.get()); if (r.ok) { closeSheet(); money = null; return say('振込のご連絡を受け付けました。ありがとうございます', 'ok'); } }
    else if (a === 'send-relief') { const s = sheetState; const reason = (s.note || '').trim(); if (!reason) return say('事情を書いてください', 'error'); r = await call('family/fees/relief', { id: b.dataset.id, version: Number(b.dataset.version), reason }, store.get()); if (r.ok) { closeSheet(); money = null; return say('申請を受け付けました', 'ok'); } }
    else if (a === 'del-event') { r = await call('family/events/delete', { id: b.dataset.id }, store.get()); if (r.ok) { sched = null; calData = {}; return say('消しました', 'ok'); } }
    else if (a === 'logout') { await call('family/logout', {}, store.get()); store.set(''); me = null; money = contracts = null; for (const k of Object.keys(consentNames)) delete consentNames[k]; resetEnroll(); location.hash = ''; return say('ログアウトしました', 'ok'); }
    if (r) failed(r);
  });
});
wireSheets(app);
// 画面の移り変わり: ふわっと入れ替える（対応しているブラウザだけ。「視差効果を減らす」では付けない）
// 画面に戻ってきたとき: ホームなら描き直す（開いたまま授業が終わったとき、次の授業に移すため）。入力中・下から出る画面を開いているときはそのまま
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || !sched || sched.error || route().page !== 'home' || document.querySelector('.bsheet, .panel.open') || app.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return; render(); });
window.addEventListener('hashchange', () => {
  if(route().page==='money' || targetParts(route().target||'').refs.length){ money=null; contracts=null; }
  say(''); closeSheet(); appliedTarget='';openedTarget='';
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return render();
  document.documentElement.dataset.nav = 'tab';
  document.startViewTransition(() => render()).finished.finally(() => { delete document.documentElement.dataset.nav; });
});
(async function boot() {
  const auth = store.get();
  if (auth) { const r = await call('family/me', {}, auth); if (r.ok) me = r.me; else if (r.error.code === 'needLogin') { store.set(''); if (previewToken) say('プレビューの期限が切れました。管理画面から開き直してください', 'error'); } }
  render();
})();
