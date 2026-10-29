// スタッフの「生徒」（docs/UX_STRUCTURE.md 3）。#students（家族ごとの一覧）と #student=<id>/<タブ>（1人の生徒の画面）。
// タブ: 概要・予定・記録と宿題・成績・計画と請求・基本情報。講師は担当の生徒だけで、計画と請求・基本情報は出ない。
import { hwSubject } from '/assets/v2/learning-view.js?v=20261028-r16b';
import { mdw, endOf, statusTag } from '/assets/v2/schedule-view.js?v=20261028-r16b';
import { examCard, trendBox, examPager, seriesPick } from '/assets/v2/grades-view.js?v=20261026-p4';
import { ICON, sheet, rowButton } from '/staff/ui.js?v=20261025-layout';
import { gradeOptions } from '/assets/v2/grade-options.js?v=20261029-efftabs';
import { subjectFields, readSubjects } from '/assets/v2/subject-options.js?v=20261026-subjects';

let list = null, query = '', hub = null, hubFor = '';
let wd = null; // 退塾の手続きの画面（admin/withdrawal/show の答え）
let ctr = null; // 契約のタブ（students/contracts の答え。for = 生徒の id）
export function resetStudents() { list = null; hub = null; hubFor = ''; wd = null; ctr = null; }
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const md = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8));
const TABS = [['summary', '概要'], ['schedule', '予定'], ['records', '記録と宿題'], ['grades', '成績'], ['money', '計画と請求', true], ['contracts', '契約', true], ['basic', '基本情報', true]];
const INV = { confirmed: ['お支払い待ち', 'warn'], reported: ['振込の連絡あり', 'warn'], paid: ['入金済み', 'ok'] };
const PLAN = { draft: ['下書き', 'gray'], proposed: ['承認待ち', 'warn'], approved: ['承認', 'ok'], declined: ['見送り', 'gray'] };

// ---------- 一覧 ----------
// 上の帯に「生徒」と人数。右の丸い「＋」で家族の登録・一覧へ。家族ごとに白い枠、行の頭に名字の1文字の丸、記録待ち・連絡は小さな印と数
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const SEARCH = '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>';
const AV = ['#2f6fde', '#2e9b5f', '#7b4fd6', '#d0533c', '#138a8a', '#c98a00', '#5b6672'];
const avColor = t => AV[[...String(t)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7) % AV.length];
const initial = name => (String(name).replace(/^[【\[（(「『\s]+/, '') || '?').slice(0, 1); // 【テスト】などの括弧は飛ばす
// 「＋ 生徒を追加」1つで、体験生の登録と家族の登録（2026-10-27 本人「上部のプラスボタンと、＋体験生を登録っていうのは役割がかぶっているので、まとめるべき」）
let addOpen = '';
export const studentsBar = () => list && list.families ? { title: '生徒', sub: `${list.families.reduce((n, f) => n + f.students.filter(s => s.status !== 'left').length, 0)}人`, right: '' } : null; // 追加はヘッダーではなく一覧の上（2026-10-27 本人「これはヘッダーに存在するべきではない」）
export function studentsPage(ctx) {
  const { esc } = ctx;
  if (!list) { list = { loading: true }; ctx.call('students/list').then(r => { list = r.ok ? r : { families: [], error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  let h = ctx.notice();
  if (list.loading) return h + '<p class="muted" style="margin-top:20px">読み込んでいます…</p>';
  h += `<div class="stu-tools"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true">${SEARCH}</svg><input type="search" data-input="stu-query" value="${esc(query)}" placeholder="名前・ふりがなで探す" aria-label="生徒を探す"></label>${list.manager ? `<button type="button" class="small-btn primary" data-action="stu-add">＋ 生徒を追加</button>` : ''}</div>`;
  const q = query.trim();
  const match = s => !q || s.name.includes(q) || s.kana.includes(q);
  // 1つの枠に全員（2026-10-27 本人「もっとまとめられないかな。家族ごとに隙間が多すぎる」「○○さんの家族っていうのは情報量が0」）。
  // 兄弟は並んだまま。家族の画面へは生徒の画面から。次の授業の日時は出さず、予定のない生徒だけ印（同日 本人「次回の授業日を表示する意味はない…未定の生徒も表示すると価値がある」）
  const shown = list.families.flatMap(f => f.students.filter(match));
  if (shown.length) h += '<div class="group stu-list">' + shown.map(s => {
    const sub = [esc(s.grade || ''), s.status === 'paused' ? '休会' : s.status === 'left' ? '退会' : '', s.testOnly ? 'テスト' : ''].filter(Boolean).join('・');
    const tags = (s.trial ? (s.offered ? '<span class="tag warn">入塾の申込み待ち</span>' : '<span class="tag warn">体験</span>') : '')
      + (s.leaveOn ? `<span class="tag warn">退塾予定 ${md(s.leaveOn)}</span>` : !s.next && !['paused', 'left'].includes(s.status) ? '<span class="tag gray">授業の予定なし</span>' : '');
    const badges = s.requests ? `<span class="pill red" title="連絡">${svg('mail')}${s.requests}</span>` : '';
    return `<a class="srow${s.status === 'left' ? ' left' : ''}" href="#student=${encodeURIComponent(s.id)}"><span class="av" style="background:${avColor(s.name)}" aria-hidden="true">${esc(initial(s.name))}</span>
      <span class="b"><strong>${esc(s.name)}</strong><small class="muted">${sub}</small>${tags}</span><span class="badges">${badges}</span><span class="go">›</span></a>`;
  }).join('') + '</div>';
  const any = shown.length > 0;
  if (!any) h += '<p class="muted small" style="margin-top:14px">見つかりませんでした。</p>';
  if (addOpen === 'menu') h += sheet(esc, '生徒を追加', `<div class="group">${rowButton(esc, 'stu-add-trial', {}, '体験生を登録', '')}${rowButton(esc, 'stu-add-family', {}, '家族を登録（入塾）', '')}</div>`, 'stu-add-close');
  if (addOpen === 'trial') h += sheet(esc, '体験生を登録', `<form class="stack" data-form="trial-create">
    <div class="row"><label style="flex:1">名字<input name="familyName" maxlength="40" required placeholder="高橋"></label><label style="flex:1">名前<input name="givenName" maxlength="40" placeholder="香帆"></label><label style="flex:1">学年<select name="grade">${gradeOptions(esc, '')}</select></label></div>
    <label>学校<input name="school" maxlength="60" placeholder="〇〇中学校"></label>
    <label>メモ（紹介・志望など）<input name="note" maxlength="1000"></label>
    <div class="row"><button class="primary"${ctx.dis()}>登録する</button></div></form>`, 'stu-add-close');
  return h;
}
export function studentsInput(ctx, name, el) {
  if (name === 'wd-last') { for (const i of el.form.querySelectorAll('input[name="keep"]:not(:disabled)')) i.checked = !!el.value && i.dataset.date <= el.value; return true; }
  if (name !== 'stu-query') return false;
  query = el.value; const pos = el.selectionStart; ctx.render();
  const again = document.querySelector('[data-input="stu-query"]'); if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  return true;
}

// ---------- 1人の生徒 ----------
export const studentHubBar = () => hub && hub.student ? { title: hub.student.name, sub: [hub.student.grade || '', hub.student.status === 'paused' ? '休会' : hub.student.status === 'left' ? '退会' : ''].filter(Boolean).join('・'), right: '' } : { title: '生徒', sub: '', right: '' };
export function studentPage(ctx, id, tab) {
  const { esc } = ctx;
  if (hubFor !== id) { hubFor = id; hub = null; ctr = null; ctx.call('students/hub', { studentId: id }).then(r => { if (hubFor !== id) return; hub = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  let h = '';
  if (!hub) return h + '<p class="muted">読み込んでいます…</p>';
  if (hub.error) return h + `<p class="notice error">${esc(hub.error)}</p>`;
  const s = hub.student, tabs = TABS.filter(t => !t[2] || hub.manager);
  if (!tabs.some(t => t[0] === tab)) tab = 'summary';
  h += ctx.notice();
  h += '<div class="tabs2" role="tablist">' + tabs.map(([k, label]) => `<a role="tab" href="#student=${encodeURIComponent(s.id)}/${k}" class="${k === tab ? 'on' : ''}"${k === tab ? ' aria-selected="true"' : ''}>${label}</a>`).join('') + '</div>';
  return h + ({ summary, schedule, records, grades, money, contracts, basic }[tab])(ctx, hub);
}

const lessonRow = (esc, l, href = '') => `<div class="lesson-row"><span class="t">${md(l.date)}<small>${l.start}・${l.minutes}分</small></span>
  <${href ? `a href="${href}"` : 'span'} class="b"><span>${esc(l.subject)}${l.kind && l.kind !== '通常' ? '<small>（' + esc(l.kind) + '）</small>' : ''}${l.deliveryMode === 'online' ? ' <small class="muted">オンライン</small>' : ''}</span>
  <span class="tags">${statusTag(l)}<small class="muted">${esc(l.staffName || '担当未定')}</small></span></${href ? 'a' : 'span'}><span class="act"></span></div>`;
const noteText = n => [n.nextFocus ? '次回: ' + n.nextFocus : '', n.understanding ? '理解度 ' + n.understanding : ''].filter(Boolean).join('・');

function summary(ctx, x) {
  const { esc } = ctx, sid = encodeURIComponent(x.student.id);
  let h = x.enrollment ? enrollCard(ctx, x) : '';
  if (x.student.trial) return h;
  if (x.student.leaveOn) h += `<div class="notice" style="margin-top:12px">退塾予定・最終受講日 ${md(x.student.leaveOn)}　<a href="#student=${sid}/basic">退塾の手続き</a></div>`;
  const todo = [];
  if (x.requests.length) todo.push(`<a class="todo" href="#schedule"><span class="b"><strong>連絡 ${x.requests.length}件</strong><small class="muted">${x.requests.map(r => md(r.date) + ' ' + esc(r.subject)).join('・')}</small></span><span class="go">›</span></a>`);
  // 記録待ちは「対応すること」に出さない（授業記録は努力義務。2026-10-27）
  if (x.grades.pendingTests.length) todo.push(`<a class="todo" href="#grades=${sid}"><span class="b"><strong>結果待ちのテスト</strong><small class="muted">${x.grades.pendingTests.map(t => esc(t.title)).join('・')}</small></span><span class="go">›</span></a>`);
  if (todo.length) h += `<h2>対応すること</h2><div class="rows">${todo.join('')}</div>`;
  h += '<h2>次の授業</h2>' + (x.upcoming.length ? '<div class="rows">' + x.upcoming.slice(0, 2).map(l => lessonRow(esc, l)).join('') + '</div>' : '<p class="muted small">ありません。</p>');
  const last = x.records.find(r => r.status === 'published') || x.records[0];
  h += '<h2>前回の記録</h2>' + (last ? `<div class="rows"><a class="todo" href="#record=${encodeURIComponent(last.lessonId)}"><span class="b"><strong>${md(last.date)} ${esc(last.subject)}：${esc(last.range || '（範囲なし）')}</strong><small class="muted">${esc(noteText(last.staffNotes) || last.comment.slice(0, 60))}</small></span><span class="go">›</span></a></div>` : '<p class="muted small">まだ記録はありません。</p>');
  if (x.handover.length) h += '<h2>引き継ぎメモ</h2><div class="rows">' + x.handover.slice(0, 3).map(n => `<div class="ev"><span class="t">${esc(n.createdAt.slice(5, 10).replace('-', '/'))}</span><span class="b" style="white-space:pre-wrap;color:var(--ink)">${esc(n.body)}<small class="muted"> ${esc(n.authorName)}</small></span><span></span></div>`).join('') + '</div>';
  h += '<h2>宿題</h2>' + homeworkList(esc, x.homework.slice(0, 5));
  const nt = x.grades.nextTest;
  h += '<h2>テスト</h2>' + (nt ? `<p>${esc(nt.title || 'テスト')} ${md(nt.date)}・あと <strong>${nt.days}日</strong></p>` : '<p class="muted small">ありません。</p>');
  if (x.plans) h += '<h2>今月・来月の計画</h2>' + planList(esc, x.plans);
  return h;
}
function homeworkList(esc, hw) {
  if (!hw.length) return '<p class="muted small">ありません。</p>';
  return '<div class="rows">' + hw.map(w => `<div class="ev"><span class="t">${esc(hwSubject(w) || '宿題')}</span><span class="b" style="color:var(--ink)">${esc([w.material, w.title].filter(Boolean).join(' '))}
    <small class="muted">${w.due ? md(w.due) + 'まで' : w.dueMode === 'date' ? md(w.dueDate) + 'まで' : w.dueMode === 'nextLesson' ? '次の' + esc(w.dueSubject || '授業') + 'まで' : ''}</small></span><span>${w.status === 'reported' ? '<span class="tag warn">できたと報告</span>' : ''}</span></div>`).join('') + '</div>';
}
function planList(esc, plans) {
  if (!plans.length) return '<p class="muted small">計画はありません。<a href="#plans">計画を作る</a></p>';
  return '<div class="rows">' + plans.map(p => `<div class="ev"><span class="t">${md(p.startDate)}〜</span><span class="b" style="color:var(--ink)">${esc(p.subject)}${p.kind !== '通常' ? '（' + esc(p.kind) + '）' : ''}${p.parentId ? ' <small class="muted">追加</small>' : ''}
    <small class="muted">${p.used} / ${p.cap}回・1回 ${p.minutes}分 ${yen(p.fee)}</small></span><span><span class="tag ${PLAN[p.status][1]}">${PLAN[p.status][0]}</span></span></div>`).join('') + '</div>';
}
function schedule(ctx, x) {
  const { esc } = ctx;
  return `<h2>これからの授業 <span class="count">${x.upcoming.length}</span></h2>` + (x.upcoming.length ? '<div class="rows">' + x.upcoming.map(l => lessonRow(esc, l)).join('') + '</div>' : '<p class="muted small">ありません。</p>')
    + (x.events.length ? '<h2>テスト・行事・授業ができない日</h2><div class="rows">' + x.events.map(e => `<div class="ev ${e.kind}"><span class="t">${md(e.date)}${e.dateTo !== e.date ? '〜' : ''}</span><span class="b">${esc(e.title || (e.kind === 'unavailable' ? '授業ができない日' : ''))}</span><span></span></div>`).join('') + '</div>' : '')
    + '<h2>これまでの授業</h2>' + (x.past.length ? '<div class="rows">' + x.past.map(l => lessonRow(esc, l, ['decided', 'done'].includes(l.status) ? '#record=' + encodeURIComponent(l.id) : '')).join('') + '</div>' : '<p class="muted small">まだありません。</p>')
    + '<p class="small" style="margin-top:12px"><a href="#schedule">月の予定表を開く</a></p>';
}
function records(ctx, x) {
  const { esc } = ctx;
  let h = '';
  if (x.pendingRecords.length) h += `<h2>記録を書ける授業</h2><div class="rows">` + x.pendingRecords.map(l => lessonRow(esc, l, '#record=' + encodeURIComponent(l.id))).join('') + '</div>';
  h += '<h2>宿題</h2>' + homeworkList(esc, x.homework);
  h += '<h2>記録</h2>' + (x.records.length ? '<div class="rows">' + x.records.map(r => `<a class="todo" href="#record=${encodeURIComponent(r.lessonId)}"><span class="b"><strong>${md(r.date)} ${esc(r.subject)}：${esc(r.range || '（範囲なし）')}</strong>
    <small class="muted">${r.status === 'draft' ? '下書き・' : ''}${esc(noteText(r.staffNotes) || r.comment.slice(0, 60))}</small></span><span class="go">›</span></a>`).join('') + '</div>' : '<p class="muted small">まだ記録はありません。</p>');
  return h;
}
function grades(ctx, x) {
  const sid = encodeURIComponent(x.student.id), g = x.grades;
  let h = `<p style="margin-top:12px"><a class="small-btn primary" href="#grades=${sid}">結果を入れる・直す</a></p>`;
  if (g.nextTest) h += `<p class="small">次のテスト: ${ctx.esc(g.nextTest.title || '')} ${md(g.nextTest.date)}（あと${g.nextTest.days}日）</p>`;
  if (!g.exams.length) return h + '<p class="muted small">まだ記録はありません。</p>';
  const pk = seriesPick(g.exams, x.student.id);
  return h + pk.bar + trendBox(pk.list, x.student.id) + examPager(pk.list, x.student.id, e => examCard(e, { sheets: (g.files || []).filter(f => f.examId === e.id && f.status !== 'dismissed') }));
}
// 授業の計画（月ごと）: 受講計画書ではなく授業そのもの（2026-10-27 本人「今度は授業の計画に焦点を当てる」「受講計画書にない授業が承認済みであるかどうかが不明なのが問題」）。
// 科目ごとの授業の数、合意待ち（保護者に承認をお願いする）、合意の記録がない授業（合意を記録）、授業料の見込み。受講計画書はあるときだけ1行で
let spMonth = '', spData = null, spKey = '';
const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + n, 1)); return t.toISOString().slice(0, 7); };
function lessonPlan(ctx, x) {
  const { esc } = ctx, sid = x.student.id;
  if (!spMonth) spMonth = x.today.slice(0, 7);
  const key = sid + '|' + spMonth;
  if (spKey !== key) { spKey = key; spData = null; ctx.call('students/plan', { studentId: sid, month: spMonth }).then(r => { if (spKey !== key) return; spData = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  let h = `<div class="sp-head"><button type="button" class="icon" data-action="sp-month" data-n="-1" aria-label="前の月">‹</button><strong>${Number(spMonth.slice(0, 4))}年${Number(spMonth.slice(5))}月</strong><button type="button" class="icon" data-action="sp-month" data-n="1" aria-label="次の月">›</button><span class="grow"></span><a class="small-btn primary" href="#schedule">＋ 授業を入れる</a></div>`;
  if (!spData) return h + '<p class="muted small">読み込んでいます…</p>';
  if (spData.error) return h + `<p class="notice error">${esc(spData.error)}</p>`;
  const d = spData, kindText = k => k && k !== '通常' ? `（${esc(k)}）` : '';
  h += d.subjects.length ? `<table class="sp-tbl"><thead><tr><th>科目</th><th>予定</th><th>実施済</th><th>実施予定</th><th>合意待ち</th><th class="sp-fee">1回</th></tr></thead><tbody>${d.subjects.map(g => `<tr><th>${esc(g.subject)}${kindText(g.kind)}</th><td>${g.total}回</td><td>${g.done || '-'}</td><td>${g.decided || '-'}</td><td>${g.waiting ? `<b class="warn-text">${g.waiting}</b>` : '-'}</td><td class="sp-fee">${g.minutes}分 ${yen(g.fee)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">この月の授業はまだありません。</p>';
  const row = l => `${esc(md(l.date))} ${esc(l.start)} ${esc(l.subject)}${kindText(l.kind)}`;
  if (d.waiting.length) {
    const ask = d.waiting.filter(l => !l.asked).map(l => l.id);
    h += `<div class="sp-block"><div class="sp-bh"><b>合意待ちの授業 ${d.waiting.length}件</b>${ask.length ? `<button type="button" class="small-btn primary" data-action="sp-ask" data-ids="${esc(ask.join(','))}"${ctx.dis()}>保護者に承認をお願いする（${ask.length}件）</button>` : '<span class="small muted">保護者の承認待ち</span>'}</div><ul>${d.waiting.map(l => `<li>${row(l)}<span class="muted small"> ${l.asked ? '承認待ち' : l.status === 'held' ? '下書き' : '調整中'}</span></li>`).join('')}</ul></div>`;
  }
  if (d.unrecorded.length) h += `<div class="sp-block warn"><div class="sp-bh"><b>合意の記録がない授業 ${d.unrecorded.length}件</b><span class="small">記録するまで請求に入りません</span></div><ul>${d.unrecorded.map(l => `<li>${row(l)}<span class="muted small"> ${l.status === 'done' ? '実施済' : '実施予定'}</span><button type="button" class="text-btn" data-action="sp-agree" data-id="${esc(l.id)}" data-version="${l.version}"${ctx.dis()}>合意を記録</button></li>`).join('')}</ul></div>`;
  // 授業料の総額: 実施済・実施予定（日時の決まった授業。2026-10-27 本人「確定」→「実施予定」「実施」→「実施済」）・カレンダーの見込み（合意待ちも）・計画（受講計画書）
  h += `<div class="sp-sum"><div><span>実施済・実施予定</span><b>${yen(d.fixedTotal)}</b></div><div><span>カレンダーの見込み</span><b>${yen(d.estimate)}</b></div><div><span>計画${d.planPending ? '（承認待ちを含む）' : ''}</span><b>${d.plans.length ? yen(d.planTotal) : '-'}</b></div></div>`;
  if (d.plans.length) h += `<p class="small muted sp-plans">受講計画書：${d.plans.map(p => `${esc(md(p.startDate))}〜${esc(md(p.endDate))} ${esc(p.subject)}${kindText(p.kind)} ${p.count}回（使用 ${p.used}回）${p.status === 'approved' ? '' : '・承認待ち'}`).join('／')} <a href="#plans">開く</a></p>`;
  return h;
}
function money(ctx, x) {
  const { esc } = ctx;
  return lessonPlan(ctx, x)
    + '<h2>家族の請求（最近6か月）</h2>' + (x.invoices.length ? '<div class="rows">' + x.invoices.map(v => `<div class="ev"><span class="t">${Number(v.month.slice(5))}月分</span><span class="b" style="color:var(--ink)">${yen(v.total)}</span><span><span class="tag ${(INV[v.status] || ['', 'gray'])[1]}">${(INV[v.status] || [v.status])[0]}</span></span></div>`).join('') + '</div>' : '<p class="muted small">まだ請求はありません。</p>')
    + '<p class="small"><a href="#billing">請求の画面を開く</a></p>';
}
function basic(ctx, x) {
  const { esc } = ctx, b = x.basic, s = x.student;
  // 項目名と中身を罫線の表で（2026-10-28 本人「ここ罫線に直して」。入塾のお申込みと同じ grid-table）
  const row = (k, v) => v ? `<tr><th scope="row"><span>${k}</span></th><td>${esc(v)}</td></tr>` : ''; // 項目名は span で 1 行のまま（スマホで 1 文字ずつ折れないように）
  // 生徒の専用リンク（生徒の情報のいちばん下。2026-10-28 本人）。作り直すと前のリンクはすぐ使えなくなる
  const linkRow = `<tr><th scope="row"><span>専用リンク</span></th><td><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span style="flex:1 1 220px;min-width:0;overflow-wrap:anywhere">${b.studentLink ? esc(b.studentLink) : 'まだありません'}</span>${b.studentLink ? `<button class="small-btn" data-action="copy" data-text="${esc(b.studentLink)}">コピー</button>` : ''}<button class="small-btn" data-action="hub-newlink" data-id="${esc(s.id)}" data-version="${b.studentVersion}" data-has="${b.studentLink ? 1 : ''}"${ctx.dis()}>${b.studentLink ? '作り直す' : '作る'}</button></div></td></tr>`;
  const trialBox = s.trial ? `<div class="notice" style="margin-top:12px"><strong>体験生</strong>（授業は無料）・<a href="#student=${encodeURIComponent(s.id)}/summary">入塾の手続き</a>
    <details style="margin-top:8px"><summary class="small">保護者ページを使わずに入塾にする</summary><div class="row" style="margin-top:8px"><button data-action="trial-enroll" data-id="${esc(s.id)}"${ctx.dis()}>入塾にする</button></div><p class="small muted" style="margin:6px 0 0">共通規約・個別受講条件書の同意は、家族の画面で別に記録してください。</p></details></div>` : '';
  // 契約者（保護者）の表。家族の名前の行は出さない（2026-10-29 本人「「家族」という行は要らなくて、契約者（保護者）ですね」）
  return trialBox + `<h2>生徒</h2><table class="grid-table"><tbody>${row('ふりがな', s.kana)}${row('学年', s.grade)}${row('学校', b.school)}${row('受講科目', b.subjects)}${row('入塾日', b.enrolledOn)}${row('授業の形式', s.deliveryMode === 'online' ? 'オンライン' : s.deliveryMode === 'in_person' ? '対面' : '')}${row('授業料（90分）', (Number(b.baseFee90 || 0) || Number(b.baseRate30 || 0) * 3) ? yen(Number(b.baseFee90 || 0) || Number(b.baseRate30 || 0) * 3) + '／90分' : '')}${row('個別受講条件書', b.condition && b.condition.latest ? `第${b.condition.latest.no}版 1回${b.condition.latest.minutes}分 ${yen(b.condition.latest.fee)}・${b.condition.latest.deliveryLabel}（${b.condition.needs ? '同意待ち' : '同意済み'}）` : '')}${row('メモ', b.note)}${linkRow}</tbody></table>
    <h2>契約者（保護者）</h2><table class="grid-table"><tbody>${row('氏名', b.guardianName)}${row('メール', b.email)}${row('電話', b.phone)}${row('保護者ページ', b.familyStatus === 'active' ? '登録済み' : b.familyStatus === 'stopped' ? '停止' : 'まだ')}</tbody></table>
    ${enrollRows(x, row)}
    <h2>その人の目で見る</h2>
    <div class="row"><button data-action="pv-open" data-kind="student" data-id="${esc(s.id)}">生徒ページを見る</button><button data-action="pv-open" data-kind="family" data-id="${esc(b.familyId)}">保護者ページを見る</button></div>
    <p style="margin-top:12px"><a class="small-btn" href="#family=${encodeURIComponent(b.familyId)}">直す・招待・専用リンク（家族の画面）</a></p>` + leaveBox(ctx, x);
}

// ---------- 入塾の手続き（2026-10-18 本人決定。cf/v2/enrollment.mjs） ----------
// 体験 → 入塾の案内（代表）→ 保護者の申込み（規約・個別受講条件書の同意つき）→ 入塾（自動）。概要の先頭に、今すること 1 つだけを出す
const ESTEPS = ['体験', '入塾の案内', '保護者の申込み', '入塾'];
let lastInvite = null; // 送った直後だけ出す招待のリンク（保存していないので、あとからは出せない）
let offerDraft = null; // 入塾の案内の書きかけ（「送りますか？」でキャンセルしたとき・送れなかったときに、入れた内容を残す）
const jaMonth = m => m ? Number(m.slice(0, 4)) + '年' + Number(m.slice(5, 7)) + '月' : '';
const jaAt = t => t ? Number(t.slice(5, 7)) + '月' + Number(t.slice(8, 10)) + '日' : '';
const MODE = { in_person: '教室', online: 'オンライン', both: '教室とオンライン' };
function enrollSteps(i) {
  return '<ol class="steps s4" aria-label="入塾の手続きの進み具合">' + ESTEPS.map((t, k) => `<li class="${k < i ? 'done' : k === i ? 'now' : ''}"${k === i ? ' aria-current="step"' : ''}><span class="n">${k < i ? '✓' : k + 1}</span><span class="t">${t}</span></li>`).join('') + '</ol>';
}
function offerForm(ctx, x, again) {
  const { esc } = ctx, e = x.enrollment, b = x.basic, s = x.student, cond = (b.condition && b.condition.latest) || null;
  const d = offerDraft && offerDraft.studentId === s.id ? offerDraft.v : null;
  const fee = d ? d.fee : cond ? cond.fee : (b.baseFee90 || 4500), minutes = d ? d.minutes : cond ? cond.minutes : 90, mode = d ? d.deliveryMode : cond ? cond.deliveryMode : (s.deliveryMode || 'in_person');
  const from = d ? d.fromMonth : cond && again ? cond.fromMonth : x.today.slice(0, 7); // 開始は今月（申し込んだ日に入塾。2026-10-26 本人「翌月からスタートだと間に合わない」）
  const ready = e.termsReady;
  return `<form class="reg-form" data-form="enroll-offer" data-id="${esc(s.id)}" novalidate>
    <fieldset class="reg-field"><legend>保護者のメールアドレス <span class="req">必須</span></legend>
      <input type="email" name="email" value="${esc(d && !e.familyActive ? d.email : e.email || '')}" ${e.familyActive ? 'readonly' : ''} autocomplete="off" placeholder="parent@example.com">
      ${e.familyActive ? '<p class="reg-help">登録済み（変えるときは家族の画面で）</p>' : ''}</fieldset>
    <fieldset class="reg-field cond-box"><legend>受講条件</legend>
      <div class="row"><label style="flex:1">適用開始月<input type="month" name="fromMonth" value="${esc(from)}" required></label><label style="flex:1">1回の時間（分）<input type="number" name="minutes" value="${esc(minutes)}" min="15" max="300" step="5" required></label><label style="flex:1">1回の授業料（円・税込）<input type="number" name="fee" value="${esc(fee)}" min="0" max="100000" step="10" required></label></div>
      <div class="cond-sub">実施形態</div>
      <div class="choices" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${Object.entries(MODE).map(([k, l]) => `<label class="choice"><input type="radio" name="deliveryMode" value="${k}"${mode === k ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <div class="cond-sub">科目</div>${subjectFields(esc, d ? d.subjects || '' : (cond && cond.subjects) || b.subjects || '')}</fieldset>
    ${ready ? '' : '<p class="notice error" style="margin:0">共通規約をまだ使い始めていません。先に <a href="#terms">設定 → 共通規約</a> で使い始めてください。</p>'}
    <div class="row"><button class="primary"${ready ? ctx.dis() : ' disabled'}>${again ? 'この条件で送り直す' : '入塾の案内を送る'}</button></div>
    <p class="small muted" style="margin:0">送ると保護者にメールが届きます。保護者が申し込むと、そのまま入塾になります。</p></form>`;
}
// 入塾のお申込み（基本情報）。保護者・電話・入塾日は上の表にあるので、申込みの日・住所・同意だけ
function enrollRows(x, row) {
  const o = x.enrollment && x.enrollment.offer;
  if (!o || o.status !== 'applied') return '';
  const a = o.application || {};
  return `<h2>入塾のお申込み</h2><table class="grid-table"><tbody>${row('申込みの日', jaAt(o.appliedAt))}${row('住所', a.guardian && a.guardian.address)}${row('同意', '共通規約・個別受講条件書')}</tbody></table>`;
}
function enrollCard(ctx, x) {
  const { esc } = ctx, e = x.enrollment, o = e.offer, s = x.student, cond = (x.basic.condition && x.basic.condition.latest) || null;
  const row = (k, v) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
  const condTable = c => `<div class="cond-box cond-view"><h3 class="info-head">受講条件</h3><dl class="info-table">${row('適用期間', jaMonth(c.fromMonth) + 'から、条件変更日まで')}${row('1回', c.minutes + '分')}${row('1回の授業料', yen(c.fee) + '（税込）')}${row('実施形態', MODE[c.deliveryMode] || '')}${c.subjects ? row('科目', c.subjects) : ''}</dl></div>`;
  // 入塾したあとは大きな枠を出さない（2026-10-29 本人「入塾手続きが完了したのにずっとこれが表示されている…ずっとこの画面を表示するわけにもいかない」）。
  // 7日間だけ1行で知らせ、お申込みの内容は基本情報に置く（enrollRows）
  if (o && o.status === 'applied') {
    if (Date.parse(o.appliedAt) < Date.parse(x.today) - 7 * 86400e3) return '';
    return `<div class="notice ok" style="margin-top:12px">${esc(jaAt(o.appliedAt))}に入塾しました　<a href="#student=${encodeURIComponent(s.id)}/basic">お申込みの内容</a></div>`;
  }
  if (!s.trial) return '';
  if (!o) return `<section class="reg-card"><div class="reg-card-head"><h2>入塾の手続き</h2></div>${enrollSteps(1)}${offerForm(ctx, x, false)}</section>`;
  const act = (k, v, btn) => `<div><dt>${k}</dt><dd class="act"><span>${v}</span>${btn}</dd></div>`;
  const copy = lastInvite && lastInvite.id === o.id && lastInvite.url ? act('招待のリンク', '7日間有効', `<button class="small-btn" data-action="copy" data-text="${esc(lastInvite.url)}">コピー</button>`) : '';
  // 2026-10-26 本人「案内した日のような重要な情報は端っこではなく整理して」「同じ見た目のボタンが 3 個並ぶと混乱する」:
  // ボタンはそれぞれ関係する行の中に。めったに使わず取り消せない「案内を取り消す」はいちばん下に離して
  return `<section class="reg-card"><div class="reg-card-head"><h2>保護者の申込みを待っています</h2></div>${enrollSteps(2)}
    <dl class="info-table">${row('案内した日', jaAt(o.offeredAt))}${act('送り先', esc(e.email || ''), `<button class="small-btn" data-action="enroll-resend" data-id="${esc(o.id)}" data-email="${esc(e.email || '')}"${ctx.dis()}>もう一度送る</button>`)}${copy}</dl>${cond ? condTable(cond) : ''}
    <details style="margin-top:12px"><summary class="small">条件を変えて送り直す</summary>${offerForm(ctx, x, true)}</details>
    <p class="danger-line"><button class="text-btn danger" data-action="enroll-withdraw" data-id="${esc(o.id)}"${ctx.dis()}>案内を取り消す</button></p></section>`;
}
async function enrollDone(ctx, r, okText) {
  if (!r.ok) { if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error'); return; }
  lastInvite = r.inviteUrl ? { id: r.enrollment.id, url: r.inviteUrl } : null;
  list = null; hub = null; hubFor = '';
  ctx.say(okText + (r.mailed === false ? '（メールはまだ送られていません。下の「招待のリンクをコピー」で保護者に渡してください）' : ''), r.mailed === false ? 'error' : 'ok');
}

// ---------- 契約（2026-10-29 本人「この生徒に関係する契約書をまとめて確認するためのタブ」） ----------
// 共通規約・個別受講条件書・特別単価合意書・受講計画書・入塾のお申込みを、版と同意（いつ・どの方法で・だれが）つきで並べる。書面は「開く」で別のタブに
const C_STATUS = { proposed: ['同意待ち', 'warn'], agreed: ['同意済み', 'ok'], replaced: ['前の版', 'gray'], ended: ['終了', 'gray'] };
const P_STATUS = { proposed: ['承認待ち', 'warn'], approved: ['承認', 'ok'], declined: ['見送り', 'gray'] };
const consentText = (at, via, who) => [at ? jaAt(at) : '', via, who].filter(Boolean).join('・');
function contracts(ctx, x) {
  const { esc } = ctx, id = x.student.id;
  if (!ctr || ctr.for !== id) {
    ctr = { for: id, loading: true };
    ctx.call('students/contracts', { studentId: id }).then(r => { if (!ctr || ctr.for !== id) return; ctr = r.ok ? { for: id, ...r } : { for: id, error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); });
  }
  if (ctr.loading) return '<p class="muted">読み込んでいます…</p>';
  if (ctr.error) return `<p class="notice error">${esc(ctr.error)}</p>`;
  const tag = ([t, k]) => `<span class="tag ${k}">${t}</span>`, open = fid => fid ? `<button class="small-btn" data-action="gr-open" data-id="${esc(fid)}">書面を開く</button>` : '';
  const row = (th, body, btn = '') => `<tr><th scope="row"><span>${th}</span></th><td><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span style="flex:1 1 220px;min-width:0">${body}</span>${btn}</div></td></tr>`;
  const table = rows => `<table class="grid-table"><tbody>${rows.join('')}</tbody></table>`;
  const t = ctr.terms, cur = t.current || {}, ag = t.agreed || {};
  let h = '<h2>共通規約</h2>' + table([
    row('今の版', esc(cur.version || '決めていません'), /^https:\/\//.test(cur.url || '') ? `<a class="small-btn" href="${esc(cur.url)}" target="_blank" rel="noopener">全文を開く</a>` : ''),
    row('同意', ag.version ? `${esc(ag.version)}　${tag(ag.version === cur.version ? ['同意済み', 'ok'] : ['前の版', 'gray'])}<small class="muted" style="display:block">${esc(consentText(ag.at, ag.via, ag.consenterName))}</small>` : tag(['まだ', 'warn'])),
  ]);
  h += '<h2>個別受講条件書</h2>' + (ctr.conditions.length ? table(ctr.conditions.map(cd => row(`第${cd.no}版`,
    `${esc(jaMonth(cd.fromMonth))}から・1回${cd.minutes}分 ${yen(cd.fee)}・${esc(cd.deliveryLabel)}　${tag(C_STATUS[cd.status] || [cd.status, 'gray'])}${cd.agreedAt ? `<small class="muted" style="display:block">同意 ${esc(consentText(cd.agreedAt, cd.agreedVia, cd.consenterName))}</small>` : ''}`, open(cd.docFileId)))) : '<p class="muted small">ありません。</p>');
  if (ctr.specials.length) h += '<h2>特別単価合意書</h2>' + table(ctr.specials.map(sp => row(esc(sp.title) + (sp.no > 1 ? ` 第${sp.no}版` : ''),
    `${md(sp.fromDate)}〜${md(sp.toDate)}・1回${sp.minutes}分 ${yen(sp.fee)}　${tag(C_STATUS[sp.status] || [sp.status, 'gray'])}${sp.agreedAt ? `<small class="muted" style="display:block">承認 ${esc(consentText(sp.agreedAt, sp.agreedVia, sp.consenterName))}</small>` : ''}`, open(sp.docFileId))));
  if (ctr.plans.length) h += '<h2>受講計画書</h2>' + table(ctr.plans.map(l => row(`${md(l.startDate)}〜`,
    `${esc(l.subject)}${l.kind && l.kind !== '通常' ? '（' + esc(l.kind) + '）' : ''}・${l.count}回・1回${l.minutes}分 ${yen(l.fee)}　${tag(P_STATUS[l.status] || [l.status, 'gray'])}${l.approvedAt ? `<small class="muted" style="display:block">${esc(consentText(l.approvedAt, l.approvedVia, ''))}</small>` : ''}`)));
  const o = ctr.enrollment && ctr.enrollment.offer;
  if (o && o.status === 'applied') h += '<h2>入塾のお申込み</h2>' + table([row('申込みの日', esc(jaAt(o.appliedAt))), row('同意', '共通規約・個別受講条件書')]);
  return h;
}

// ---------- 退塾の手続き（2026-10-28 本人。共通規約 第22条） ----------
// 最終受講日と、保護者から連絡を受けた日時を入れ、これからの授業を「受ける」「やめる」に分ける。やめた確定の授業は、前日23時までの連絡ならお休み、
// 過ぎていればふだんどおりキャンセル料。保護者にはメールで知らせる。在籍の「退会」は最終受講日のあとに代表が押す
const nowLocal = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16);
const STAGE = { draft: '下書き', adjusting: '調整中', asking: '確認待ち', decided: '確定' };
function leaveBox(ctx, x) {
  const { esc } = ctx, s = x.student;
  if (s.trial || s.status === 'left') return '';
  let h = '<h2>退塾</h2>';
  if (!s.leaveOn) h += `<p><button data-action="wd-open" data-id="${esc(s.id)}"${ctx.dis()}>退塾の手続き</button></p>`;
  else {
    const ready = x.today > s.leaveOn;
    h += `<p>最終受講日 <strong>${md(s.leaveOn)}</strong>${ready ? '' : '<span class="muted small">　この日のあとに退会にできます</span>'}</p>
      <div class="row"><button class="primary" data-action="wd-finish"${ready ? ctx.dis() : ' disabled'}>退会にする</button><button data-action="wd-undo"${ctx.dis()}>退塾の予定を取り消す</button></div>`;
  }
  if (wd && wd.student && wd.student.id === s.id) h += leaveSheet(ctx);
  return h;
}
function leaveSheet(ctx) {
  const { esc } = ctx, w = wd, last = w.today; // 最終受講日を選ぶと、その日までの授業に印が付く（studentsInput の wd-last）
  const rows = w.lessons.map(l => {
    const fixed = ['draft', 'adjusting'].includes(l.stage);
    return `<label style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line);font-weight:400"><input style="width:auto;margin-top:5px" type="checkbox" name="keep" value="${esc(l.id)}" data-date="${l.date}" data-stage="${l.stage}" data-free="${esc(l.freeBefore)}"${fixed ? ' disabled' : l.date <= last ? ' checked' : ''}>
      <span style="flex:1">${mdw(l.date)} ${l.start}〜${endOf(l.start, l.minutes)} ${esc(l.subject)}${l.kind && l.kind !== '通常' ? '（' + esc(l.kind) + '）' : ''}<small class="muted" style="display:block">${STAGE[l.stage] || ''}${fixed ? '・取り下げます' : ''}</small></span></label>`;
  }).join('');
  return sheet(esc, w.student.name + 'さんの退塾', `<form class="stack" data-form="wd-save" data-id="${esc(w.student.id)}" data-version="${w.student.version}">
    <div class="row"><label style="flex:1">最終受講日<input type="date" name="lastDay" value="${esc(last)}" data-input="wd-last" required></label><label style="flex:1">保護者から連絡を受けた日時<input type="datetime-local" name="receivedAt" value="${nowLocal()}" max="${nowLocal()}" required></label></div>
    <div><strong>これからの授業</strong>${w.lessons.length ? '<p class="small muted" style="margin:4px 0 0">受ける授業に印を付けます。印のない授業はやめます。</p>' + rows : '<p class="muted small">ありません。</p>'}</div>
    <button class="primary"${ctx.dis()}>手続きをして保護者に知らせる</button></form>`, 'wd-close');
}
async function leaveSave(ctx, el) {
  const v = Object.fromEntries(new FormData(el).entries()), keep = [...el.querySelectorAll('input[name="keep"]:checked')];
  const stop = [...el.querySelectorAll('input[name="keep"]:not(:checked)')], at = Date.parse(v.receivedAt + ':00+09:00');
  const late = stop.filter(i => i.dataset.stage === 'decided' && at > Date.parse(i.dataset.free)), after = keep.filter(i => i.dataset.date > v.lastDay);
  if (after.length) { ctx.say(`最終受講日より後の授業に印が付いています（${after.map(i => md(i.dataset.date)).join('・')}）`, 'error'); return; }
  const lines = [`最終受講日：${md(v.lastDay)}`, `受ける授業：${keep.length}件`, `やめる授業：${stop.length}件` + (late.length ? `（うち ${late.map(i => md(i.dataset.date)).join('・')} は前日23時を過ぎた連絡なので、キャンセル料がかかります）` : '')];
  if (!confirm(`退塾の手続きをして、保護者にメールで知らせますか？\n\n${lines.join('\n')}\n\n在籍は、最終受講日のあとに「退会にする」で退会にします。`)) return;
  const r = await ctx.call('admin/withdrawal/save', { studentId: el.dataset.id, version: Number(el.dataset.version), lastDay: v.lastDay, receivedAt: v.receivedAt, keep: keep.map(i => i.value) });
  if (!r.ok) { if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error'); return; }
  wd = null; hub = null; hubFor = ''; list = null;
  ctx.say(`退塾の手続きをしました。${r.stopped ? `${r.stopped}件の授業をやめ${r.feeTotal ? `（キャンセル料 ${yen(r.feeTotal)}）` : ''}、` : ''}${r.mailed ? '保護者にメールで知らせました' : '保護者ページを使っていないので、メールは送っていません。LINE などで知らせてください'}`, r.mailed ? 'ok' : 'error');
}
async function leaveClick(ctx, a, b) {
  if (a === 'wd-close') { wd = null; return true; }
  if (a === 'wd-open') {
    const r = await ctx.call('admin/withdrawal/show', { studentId: b.dataset.id });
    if (r.ok) wd = r; else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  if (a !== 'wd-finish' && a !== 'wd-undo') return false;
  const s = hub && hub.student; if (!s) return true;
  const w = await ctx.call('admin/withdrawal/show', { studentId: s.id }); if (!w.ok) { if (!ctx.handleAuth(w)) ctx.say(w.error.message, 'error'); return true; }
  if (a === 'wd-undo') {
    if (!confirm('退塾の予定を取り消しますか？ やめた授業は戻りません。必要なら予定表で入れ直してください。')) return true;
    const r = await ctx.call('admin/withdrawal/undo', { studentId: s.id, version: w.student.version });
    if (r.ok) { hub = null; hubFor = ''; list = null; ctx.say('退塾の予定を取り消しました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  if (!confirm(`${s.name}さんを退会にしますか？\n生徒の専用リンクは使えなくなり、保護者ページにもこの生徒は出なくなります。記録は残ります。`)) return true;
  const r = await ctx.call('admin/withdrawal/finish', { studentId: s.id, version: w.student.version });
  if (!r.ok) { if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error'); return true; }
  hub = null; hubFor = ''; list = null;
  ctx.say(r.siblings ? '退会にしました' : '退会にしました。兄弟がいないので、最後の請求の支払いが済んだら、家族の画面で「保護者ページとメールを止める」を押せます', 'ok');
  return true;
}

// ---------- 体験生 ----------
export async function studentsSubmit(ctx, kind, el) {
  if (kind === 'wd-save') { await leaveSave(ctx, el); return true; }
  if (kind === 'enroll-offer') {
    const v = { ...Object.fromEntries(new FormData(el).entries()), subjects: readSubjects(el) };
    offerDraft = { studentId: el.dataset.id, v };
    if (!v.email || !v.fromMonth || !v.minutes || v.fee === '' || !v.deliveryMode) { ctx.say('メールアドレス・適用開始月・1回の時間・授業料・実施形態を入れてください', 'error'); return true; }
    if (!confirm(`${v.email} に入塾の案内を送りますか？`)) return true;
    const r = await ctx.call('admin/enrollment/offer', { studentId: el.dataset.id, email: v.email, fromMonth: v.fromMonth, minutes: Number(v.minutes), fee: Number(v.fee), deliveryMode: v.deliveryMode, subjects: v.subjects || '' }); // お休みの連絡を生徒本人からも受け付けるかは、保護者が申込みで決める
    if (r.ok) offerDraft = null;
    await enrollDone(ctx, r, '入塾の案内を送りました');
    return true;
  }
  if (kind !== 'trial-create') return false;
  const v = Object.fromEntries(new FormData(el).entries());
  const r = await ctx.call('admin/trials/create', { familyName: v.familyName, givenName: v.givenName, grade: v.grade, school: v.school, note: v.note });
  if (r.ok) { list = null; addOpen = ''; ctx.say(`${v.familyName}${v.givenName ? ' ' + v.givenName : ''}さんを体験生で登録しました`, 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}
export async function studentsClick(ctx, a, b) {
  if (await leaveClick(ctx, a, b)) return true;
  if (a === 'hub-newlink') {
    if (b.dataset.has && !confirm('専用リンクを作り直しますか？ 今のリンクはすぐに使えなくなります。生徒に新しいリンクを渡してください。')) return true;
    const r = await ctx.call('admin/students/newLink', { id: b.dataset.id, version: Number(b.dataset.version) });
    if (r.ok) { hub = null; hubFor = ''; ctx.say(b.dataset.has ? '専用リンクを作り直しました。新しいリンクを生徒に渡してください' : '専用リンクを作りました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  if (a === 'sp-month') { spMonth = ymAdd(spMonth, Number(b.dataset.n)); return true; }
  if (a === 'sp-ask') {
    const ids = String(b.dataset.ids || '').split(',').filter(Boolean); if (!ids.length || !hub) return true;
    if (!confirm(`${ids.length}件の授業の承認を、保護者にメールでお願いしますか？`)) return true;
    let r = await ctx.call('schedule/lessons/ask', { studentId: hub.student.id, lessonIds: ids });
    if (!r.ok && r.error && r.error.needForce && confirm(r.error.message)) r = await ctx.call('schedule/lessons/ask', { studentId: hub.student.id, lessonIds: ids, force: true });
    if (r.ok) { spKey = ''; ctx.say(`${r.asked}件の承認をお願いしました`, 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  if (a === 'sp-agree') {
    const text = prompt('いつ・どの方法で・だれと合意したか（例: LINE 10/20 お母さんと合意）'); if (!text) return true;
    const r = await ctx.call('schedule/lessons/agreement', { id: b.dataset.id, version: Number(b.dataset.version), agreement: text });
    if (r.ok) { spKey = ''; ctx.say('合意を記録しました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  if (a === 'stu-add') { addOpen = 'menu'; return true; }
  if (a === 'stu-add-trial') { addOpen = 'trial'; return true; }
  if (a === 'stu-add-close') { addOpen = ''; return true; }
  if (a === 'stu-add-family') { addOpen = ''; location.hash = '#families'; return true; }
  if (a === 'enroll-resend') { if (!confirm(`${b.dataset.email || '保護者'} に入塾の案内をもう一度送りますか？`)) return true; await enrollDone(ctx, await ctx.call('admin/enrollment/resend', { offerId: b.dataset.id }), '案内をもう一度送りました'); return true; }
  if (a === 'enroll-withdraw') {
    if (!confirm('入塾の案内を取り消しますか？（保護者のリンクと個別受講条件書の案は使えなくなります）')) return true;
    const r = await ctx.call('admin/enrollment/withdraw', { offerId: b.dataset.id });
    if (r.ok) { lastInvite = null; list = null; hub = null; hubFor = ''; ctx.say('案内を取り消しました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  if (a !== 'trial-enroll') return false;
  if (!confirm('この生徒を入塾にしますか？（入塾日は今日。体験の授業はそのまま無料で残ります）')) return true;
  const r = await ctx.call('admin/trials/enroll', { studentId: b.dataset.id });
  if (r.ok) { list = null; hub = null; hubFor = ''; ctx.say('入塾にしました。家族の画面でメールを入れて招待してください', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}
