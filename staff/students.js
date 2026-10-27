// スタッフの「生徒」（docs/UX_STRUCTURE.md 3）。#students（家族ごとの一覧）と #student=<id>/<タブ>（1人の生徒の画面）。
// タブ: 概要・予定・記録と宿題・成績・計画と請求・基本情報。講師は担当の生徒だけで、計画と請求・基本情報は出ない。
import { hwSubject } from '/assets/v2/learning-view.js?v=20261025-layout';
import { mdw, endOf, statusTag } from '/assets/v2/schedule-view.js?v=20261025-layout';
import { examCard, trendBox, examPager, seriesPick } from '/assets/v2/grades-view.js?v=20261026-p4';
import { ICON } from '/staff/ui.js?v=20261025-layout';
import { gradeOptions } from '/assets/v2/grade-options.js?v=20261025-layout';
import { subjectFields, readSubjects } from '/assets/v2/subject-options.js?v=20261026-subjects';

let list = null, query = '', hub = null, hubFor = '';
export function resetStudents() { list = null; hub = null; hubFor = ''; }
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const md = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8));
const TABS = [['summary', '概要'], ['schedule', '予定'], ['records', '記録と宿題'], ['grades', '成績'], ['money', '計画と請求', true], ['basic', '基本情報', true]];
const INV = { confirmed: ['お支払い待ち', 'warn'], reported: ['振込の連絡あり', 'warn'], paid: ['入金済み', 'ok'] };
const PLAN = { draft: ['下書き', 'gray'], proposed: ['承認待ち', 'warn'], approved: ['承認', 'ok'], declined: ['見送り', 'gray'] };

// ---------- 一覧 ----------
// 上の帯に「生徒」と人数。右の丸い「＋」で家族の登録・一覧へ。家族ごとに白い枠、行の頭に名字の1文字の丸、記録待ち・連絡は小さな印と数
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const PERSON = '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>', PLUS = '<path d="M12 5v14M5 12h14"/>', SEARCH = '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>';
const AV = ['#2f6fde', '#2e9b5f', '#7b4fd6', '#d0533c', '#138a8a', '#c98a00', '#5b6672'];
const avColor = t => AV[[...String(t)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7) % AV.length];
const initial = name => (String(name).replace(/^[【\[（(「『\s]+/, '') || '?').slice(0, 1); // 【テスト】などの括弧は飛ばす
export const studentsBar = () => list && list.families ? { title: '生徒', sub: `${list.families.reduce((n, f) => n + f.students.filter(s => s.status !== 'left').length, 0)}人`, right: list.manager ? `<a class="ibtn" href="#families" aria-label="家族を登録する・家族の一覧"><svg viewBox="0 0 24 24" aria-hidden="true">${PLUS}</svg></a>` : '' } : null;
export function studentsPage(ctx) {
  const { esc } = ctx;
  if (!list) { list = { loading: true }; ctx.call('students/list').then(r => { list = r.ok ? r : { families: [], error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  let h = ctx.notice();
  if (list.loading) return h + '<p class="muted" style="margin-top:20px">読み込んでいます…</p>';
  h += `<label class="search"><svg viewBox="0 0 24 24" aria-hidden="true">${SEARCH}</svg><input type="search" data-input="stu-query" value="${esc(query)}" placeholder="名前・ふりがなで探す" aria-label="生徒を探す"></label>`;
  // 体験生（まだ入塾していない人）を臨時で登録する。登録すると予定表で授業を入れられる（種類「体験」・無料）
  if (list.manager) h += `<details class="trial-new"><summary>＋ 体験生を登録</summary><form class="stack" data-form="trial-create">
    <div class="row"><label style="flex:1">名字<input name="familyName" maxlength="40" required placeholder="高橋"></label><label style="flex:1">名前<input name="givenName" maxlength="40" placeholder="香帆"></label><label style="flex:1">学年<select name="grade">${gradeOptions(esc, '')}</select></label></div>
    <label>学校<input name="school" maxlength="60" placeholder="〇〇中学校"></label>
    <label>メモ（紹介・志望など）<input name="note" maxlength="1000"></label>
    <div class="row"><button class="primary"${ctx.dis()}>登録する</button></div></form></details>`;
  const q = query.trim();
  const match = s => !q || s.name.includes(q) || s.kana.includes(q);
  let any = false;
  for (const f of list.families) {
    const ss = f.students.filter(match); if (!ss.length) continue; any = true;
    h += `<div class="fam-head"><span>${esc(f.name || '')}</span>${list.manager && f.id ? `<a class="mini-btn" href="#family=${encodeURIComponent(f.id)}" aria-label="${esc(f.name || '家族')}の連絡先・招待"><svg viewBox="0 0 24 24" aria-hidden="true">${PERSON}</svg></a>` : ''}</div>`;
    h += '<div class="group">' + ss.map(s => {
      const sub = [s.trial ? (s.offered ? '<span class="tag warn">入塾の申込み待ち</span>' : '<span class="tag warn">体験</span>') : '', esc(s.grade || ''), s.status === 'paused' ? '休会' : s.status === 'left' ? '退会' : '', s.testOnly ? 'テスト' : '', s.next ? '次 ' + md(s.next.slice(0, 10)) + ' ' + esc(s.next.slice(11)) : ''].filter(Boolean).join('・');
      const badges = (s.requests ? `<span class="pill red" title="連絡">${svg('mail')}${s.requests}</span>` : '') ; // 記録待ちの印は出さない（授業記録は努力義務。2026-10-27）
      return `<a class="srow${s.status === 'left' ? ' left' : ''}" href="#student=${encodeURIComponent(s.id)}"><span class="av" style="background:${avColor(s.name)}" aria-hidden="true">${esc(initial(s.name))}</span>
        <span class="b"><strong>${esc(s.name)}</strong><small class="muted">${sub}</small></span><span class="badges">${badges}</span><span class="go">›</span></a>`;
    }).join('') + '</div>';
  }
  if (!any) h += '<p class="muted small" style="margin-top:14px">見つかりませんでした。</p>';
  return h;
}
export function studentsInput(ctx, name, el) {
  if (name !== 'stu-query') return false;
  query = el.value; const pos = el.selectionStart; ctx.render();
  const again = document.querySelector('[data-input="stu-query"]'); if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  return true;
}

// ---------- 1人の生徒 ----------
export const studentHubBar = () => hub && hub.student ? { title: hub.student.name, sub: [hub.student.grade || '', hub.student.status === 'paused' ? '休会' : hub.student.status === 'left' ? '退会' : ''].filter(Boolean).join('・'), right: '' } : { title: '生徒', sub: '', right: '' };
export function studentPage(ctx, id, tab) {
  const { esc } = ctx;
  if (hubFor !== id) { hubFor = id; hub = null; ctx.call('students/hub', { studentId: id }).then(r => { if (hubFor !== id) return; hub = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  let h = '';
  if (!hub) return h + '<p class="muted">読み込んでいます…</p>';
  if (hub.error) return h + `<p class="notice error">${esc(hub.error)}</p>`;
  const s = hub.student, tabs = TABS.filter(t => !t[2] || hub.manager);
  if (!tabs.some(t => t[0] === tab)) tab = 'summary';
  h += ctx.notice();
  h += '<div class="tabs2" role="tablist">' + tabs.map(([k, label]) => `<a role="tab" href="#student=${encodeURIComponent(s.id)}/${k}" class="${k === tab ? 'on' : ''}"${k === tab ? ' aria-selected="true"' : ''}>${label}</a>`).join('') + '</div>';
  return h + ({ summary, schedule, records, grades, money, basic }[tab])(ctx, hub);
}

const lessonRow = (esc, l, href = '') => `<div class="lesson-row"><span class="t">${md(l.date)}<small>${l.start}・${l.minutes}分</small></span>
  <${href ? `a href="${href}"` : 'span'} class="b"><span>${esc(l.subject)}${l.kind && l.kind !== '通常' ? '<small>（' + esc(l.kind) + '）</small>' : ''}${l.deliveryMode === 'online' ? ' <small class="muted">オンライン</small>' : ''}</span>
  <span class="tags">${statusTag(l)}<small class="muted">${esc(l.staffName || '担当未定')}</small></span></${href ? 'a' : 'span'}><span class="act"></span></div>`;
const noteText = n => [n.nextFocus ? '次回: ' + n.nextFocus : '', n.understanding ? '理解度 ' + n.understanding : ''].filter(Boolean).join('・');

function summary(ctx, x) {
  const { esc } = ctx, sid = encodeURIComponent(x.student.id);
  let h = x.enrollment ? enrollCard(ctx, x) : '';
  if (x.student.trial) return h;
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
function money(ctx, x) {
  const { esc } = ctx;
  return '<h2>今月・来月の計画</h2>' + planList(esc, x.plans) + '<p class="small"><a href="#plans">計画の画面を開く</a></p>'
    + '<h2>家族の請求（最近6か月）</h2>' + (x.invoices.length ? '<div class="rows">' + x.invoices.map(v => `<div class="ev"><span class="t">${Number(v.month.slice(5))}月分</span><span class="b" style="color:var(--ink)">${yen(v.total)}</span><span><span class="tag ${(INV[v.status] || ['', 'gray'])[1]}">${(INV[v.status] || [v.status])[0]}</span></span></div>`).join('') + '</div>' : '<p class="muted small">まだ請求はありません。</p>')
    + '<p class="small"><a href="#billing">請求の画面を開く</a></p>';
}
function basic(ctx, x) {
  const { esc } = ctx, b = x.basic, s = x.student;
  const row = (k, v) => v ? `<div class="ev"><span class="t" style="font-weight:400">${k}</span><span class="b" style="color:var(--ink)">${esc(v)}</span><span></span></div>` : '';
  const trialBox = s.trial ? `<div class="notice" style="margin-top:12px"><strong>体験生</strong>（授業は無料）・<a href="#student=${encodeURIComponent(s.id)}/summary">入塾の手続き</a>
    <details style="margin-top:8px"><summary class="small">保護者ページを使わずに入塾にする</summary><div class="row" style="margin-top:8px"><button data-action="trial-enroll" data-id="${esc(s.id)}"${ctx.dis()}>入塾にする</button></div><p class="small muted" style="margin:6px 0 0">共通規約・個別受講条件書の同意は、家族の画面で別に記録してください。</p></details></div>` : '';
  return trialBox + `<h2>生徒</h2><div class="rows">${row('ふりがな', s.kana)}${row('学年', s.grade)}${row('学校', b.school)}${row('受講科目', b.subjects)}${row('入塾日', b.enrolledOn)}${row('授業の形式', s.deliveryMode === 'online' ? 'オンライン' : s.deliveryMode === 'in_person' ? '対面' : '')}${row('通常の基準単価', (Number(b.baseFee90 || 0) || Number(b.baseRate30 || 0) * 3) ? yen(Number(b.baseFee90 || 0) || Number(b.baseRate30 || 0) * 3) + '／90分' : '')}${row('個別受講条件書', b.condition && b.condition.latest ? `第${b.condition.latest.no}版 1回${b.condition.latest.minutes}分 ${yen(b.condition.latest.fee)}・${b.condition.latest.deliveryLabel}（${b.condition.needs ? '同意待ち' : '同意済み'}）` : '')}${row('メモ', b.note)}</div>
    <h2>家族</h2><div class="rows">${row('家族', b.familyName)}${row('保護者', b.guardianName)}${row('メール', b.email)}${row('電話', b.phone)}${row('保護者ページ', b.familyStatus === 'active' ? '登録済み' : b.familyStatus === 'stopped' ? '停止' : 'まだ')}</div>
    <h2>その人の目で見る</h2>
    <div class="row"><button data-action="pv-open" data-kind="student" data-id="${esc(s.id)}">生徒ページを見る</button><button data-action="pv-open" data-kind="family" data-id="${esc(b.familyId)}">保護者ページを見る</button></div>
    <p style="margin-top:12px"><a class="small-btn" href="#family=${encodeURIComponent(b.familyId)}">直す・招待・専用リンク（家族の画面）</a></p>`;
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
      <div class="row"><label style="flex:1">適用開始月<input type="month" name="fromMonth" value="${esc(from)}" required></label><label style="flex:1">1回の時間（分）<input type="number" name="minutes" value="${esc(minutes)}" min="15" max="300" step="5" required></label><label style="flex:1">1回の基準単価（円・税込）<input type="number" name="fee" value="${esc(fee)}" min="0" max="100000" step="10" required></label></div>
      <div class="cond-sub">実施形態</div>
      <div class="choices" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${Object.entries(MODE).map(([k, l]) => `<label class="choice"><input type="radio" name="deliveryMode" value="${k}"${mode === k ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <div class="cond-sub">科目</div>${subjectFields(esc, d ? d.subjects || '' : (cond && cond.subjects) || b.subjects || '')}</fieldset>
    ${ready ? '' : '<p class="notice error" style="margin:0">共通規約をまだ使い始めていません。先に <a href="#terms">設定 → 共通規約</a> で使い始めてください。</p>'}
    <div class="row"><button class="primary"${ready ? ctx.dis() : ' disabled'}>${again ? 'この条件で送り直す' : '入塾の案内を送る'}</button></div>
    <p class="small muted" style="margin:0">送ると保護者にメールが届きます。保護者が申し込むと、そのまま入塾になります。</p></form>`;
}
function enrollCard(ctx, x) {
  const { esc } = ctx, e = x.enrollment, o = e.offer, s = x.student, cond = (x.basic.condition && x.basic.condition.latest) || null;
  const row = (k, v) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
  const condTable = c => `<div class="cond-box cond-view"><h3 class="info-head">受講条件</h3><dl class="info-table">${row('適用期間', jaMonth(c.fromMonth) + 'から、条件変更日まで')}${row('1回', c.minutes + '分')}${row('基準単価', yen(c.fee) + '（税込）')}${row('実施形態', MODE[c.deliveryMode] || '')}${c.subjects ? row('科目', c.subjects) : ''}</dl></div>`;
  if (o && o.status === 'applied') {
    if (Date.parse(o.appliedAt) < Date.parse(x.today) - 30 * 86400e3) return '';
    const a = o.application || {};
    return `<section class="reg-card"><div class="reg-card-head"><h2>入塾しました</h2></div>${enrollSteps(4)}
      <dl class="info-table">${row('申込みの日', jaAt(o.appliedAt))}${row('保護者', (a.guardian && a.guardian.name) || o.consenterName)}${a.guardian ? row('電話', a.guardian.phone) + row('住所', a.guardian.address) : ''}${row('入塾日', a.enrolledOn || '')}${row('同意', '共通規約・個別受講条件書')}</dl>
      <div class="row" style="margin-top:8px"><a class="small-btn primary" href="#plans">${esc(jaMonth(o.fromMonth))}の計画を作る</a></div></section>`;
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

// ---------- 体験生 ----------
export async function studentsSubmit(ctx, kind, el) {
  if (kind === 'enroll-offer') {
    const v = { ...Object.fromEntries(new FormData(el).entries()), subjects: readSubjects(el) };
    offerDraft = { studentId: el.dataset.id, v };
    if (!v.email || !v.fromMonth || !v.minutes || v.fee === '' || !v.deliveryMode) { ctx.say('メールアドレス・適用開始月・1回の時間・基準単価・実施形態を入れてください', 'error'); return true; }
    if (!confirm(`${v.email} に入塾の案内を送りますか？`)) return true;
    const r = await ctx.call('admin/enrollment/offer', { studentId: el.dataset.id, email: v.email, fromMonth: v.fromMonth, minutes: Number(v.minutes), fee: Number(v.fee), deliveryMode: v.deliveryMode, subjects: v.subjects || '' }); // お休みの連絡を生徒本人からも受け付けるかは、保護者が申込みで決める
    if (r.ok) offerDraft = null;
    await enrollDone(ctx, r, '入塾の案内を送りました');
    return true;
  }
  if (kind !== 'trial-create') return false;
  const v = Object.fromEntries(new FormData(el).entries());
  const r = await ctx.call('admin/trials/create', { familyName: v.familyName, givenName: v.givenName, grade: v.grade, school: v.school, note: v.note });
  if (r.ok) { list = null; ctx.say(`${v.familyName}${v.givenName ? ' ' + v.givenName : ''}さんを体験生で登録しました`, 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}
export async function studentsClick(ctx, a, b) {
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
