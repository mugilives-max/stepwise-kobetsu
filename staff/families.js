// スタッフの画面: 家族と生徒（教室管理者）。家族を先に登録し、その下に生徒を登録する。
// ctx は app.js から渡す共通の道具（call / say / render / run / esc / busy / notice）。
// 一覧はすっきり、直す・足す・生徒ごとの操作は押すと下から出る画面で（famSheet = { mode, id }）。
import { sheet, rowButton, rowLink } from '/staff/ui.js?v=20261025-layout';
import { gradeOptions } from '/assets/v2/grade-options.js?v=20261029-efftabs';
import { subjectFields, readSubjects } from '/assets/v2/subject-options.js?v=20261026-subjects';
const STATUS = { invited: ['warn', '招待前・登録待ち'], active: ['', '利用中'], stopped: ['gray', '停止'] };
const STUDENT_STATUS = { enrolled: ['', '在籍'], paused: ['warn', '休会'], left: ['gray', '退会'] };
const MODE = { '': '未設定', in_person: '対面', online: 'オンライン' };
const COND_MODE = { in_person: '教室', online: 'オンライン', both: '教室とオンライン' };
const nextMonth = () => { const d = new Date(Date.now() + 9 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 7); };
const SP_STATUS = { proposed: ['warn', '承認待ち'], agreed: ['ok', '承認済み'] };
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const condStatus = cd => !cd || !cd.latest ? '<span class="tag gray">条件なし</span>' : cd.needs ? `<span class="tag warn">条件 第${cd.latest.no}版 同意待ち</span>` : `<span class="tag ok">条件 第${cd.latest.no}版 同意済み</span>`;
let list = null, detail = null, query = '', shown = null, famSheet = null, contractData = null;

export function resetFamilies() { list = null; detail = null; shown = null; famSheet = null; contractData = null; }

const tag = ([cls, label]) => `<span class="tag ${cls}">${label}</span>`;
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
// 契約者（保護者）の名前で出す。保護者の氏名がまだなければ登録の名前（例: 山田家）
export const contractorOf = f => f.guardianName || f.name || '';
// 一覧の丸（生徒の一覧と同じ色の決め方）
const AV = ['#2f6fde', '#2e9b5f', '#7b4fd6', '#d0533c', '#138a8a', '#c98a00', '#5b6672'];
const avColor = t => AV[[...String(t)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7) % AV.length];
const initial = name => (String(name).replace(/^[【\[（(「『\s]+/, '') || '?').slice(0, 1);
export const familiesBar = () => list ? { title: '契約者', sub: `${list.filter(f => f.status !== 'stopped').length}件`, right: '' } : { title: '契約者', sub: '', right: '' };
const match = (f, q) => !q || [f.name, f.guardianName, f.email, ...f.students.map(s => s.name + (s.familyKana || '') + (s.givenKana || ''))].join(' ').toLowerCase().includes(q.toLowerCase());

export function familiesPage(ctx) {
  const { esc } = ctx;
  if (!list) { load(ctx); return '<p class="muted" style="margin-top:20px">読み込んでいます…</p>'; }
  let h = ctx.notice();
  // メニューの「契約」（2026-11-03 本人「メニューに契約を追加…生徒画面みたいな感じで契約者を並べましょうか」）: 生徒の一覧と同じ形。1 行に契約者と、その下に生徒の名前
  h += `<div class="stu-tools"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input type="search" placeholder="名前・ふりがな・メールで探す" value="${esc(query)}" data-input="fam-query" aria-label="契約者を探す"></label><button type="button" class="small-btn primary" data-action="fam-sheet" data-mode="create"${ctx.dis()}>＋ 契約者を登録</button></div>`;
  const shownList = list.filter(f => match(f, query));
  if (shownList.length) h += '<div class="group stu-list">' + shownList.map(f => {
    const name = contractorOf(f), kids = f.students.filter(s => s.status !== 'left').map(s => s.name.split(/[\s　]/).pop()).join('・') || '生徒がいません';
    const tags = (f.status === 'active' ? '' : tag(STATUS[f.status] || ['gray', f.status])) + (f.testOnly ? '<span class="tag gray">テスト</span>' : '');
    return `<a class="srow" href="#family=${encodeURIComponent(f.id)}"><span class="av" style="background:${avColor(name)}" aria-hidden="true">${esc(initial(name))}</span>
      <span class="b"><strong>${esc(name)}</strong><small class="muted">${esc(kids)}</small>${tags}</span><span class="go">›</span></a>`;
  }).join('') + '</div>';
  else h += '<p class="muted small" style="margin-top:14px">見つかりませんでした。</p>';
  if (famSheet && famSheet.mode === 'create') h += sheet(esc, '契約者を登録', `<form class="stack" data-form="fam-create">${familyInputs(esc, {})}<button class="primary"${ctx.dis()}>登録する</button></form>`, 'fam-close');
  return h;
}

// 保護者の氏名は姓・名・ふりがなに分ける（2026-10-19 本人）。分ける前の家族は「姓 名」の空白で分けて最初の値にする
function guardianInputs(esc, f) {
  const split = v => { const m = /^(\S+)[\s　]+(.+)$/.exec(String(v || '').trim()); return m ? [m[1], m[2]] : [String(v || '').trim(), '']; };
  const [nf, ng] = f.guardianFamilyName || f.guardianGivenName ? [f.guardianFamilyName, f.guardianGivenName] : split(f.guardianName);
  const [kf, kg] = f.guardianFamilyKana || f.guardianGivenKana ? [f.guardianFamilyKana, f.guardianGivenKana] : split(f.guardianKana);
  return `<div class="row"><label style="flex:1 1 140px">保護者の姓<input name="guardianFamilyName" maxlength="30" value="${esc(nf || '')}"></label><label style="flex:1 1 140px">保護者の名<input name="guardianGivenName" maxlength="30" value="${esc(ng || '')}"></label></div>
    <div class="row"><label style="flex:1 1 140px">ふりがな（姓）<input name="guardianFamilyKana" maxlength="30" value="${esc(kf || '')}"></label><label style="flex:1 1 140px">ふりがな（名）<input name="guardianGivenKana" maxlength="30" value="${esc(kg || '')}"></label></div>`;
}
function familyInputs(esc, f) {
  return `<label>まとめの名前（教室だけが見る）<input name="name" maxlength="60" placeholder="例: 山田家" required value="${esc(f.name || '')}"></label>
    ${guardianInputs(esc, f)}
    <label>保護者のメールアドレス<input type="email" name="email" value="${esc(f.email || '')}"></label>
    <label>電話<input name="phone" maxlength="30" value="${esc(f.phone || '')}"></label>
    <label>メモ（教室だけが見る）<input name="note" maxlength="1000" value="${esc(f.note || '')}"></label>`;
}
function studentInputs(esc, s) {
  const opt = (map, v) => Object.entries(map).map(([k, x]) => `<option value="${k}"${k === v ? ' selected' : ''}>${Array.isArray(x) ? x[1] : x}</option>`).join('');
  return `<div class="row"><label style="flex:1">姓<input name="familyName" maxlength="40" value="${esc(s.familyName || '')}"></label><label style="flex:1">名<input name="givenName" maxlength="40" value="${esc(s.givenName || '')}"></label></div>
    <div class="row"><label style="flex:1">せい<input name="familyKana" maxlength="40" value="${esc(s.familyKana || '')}"></label><label style="flex:1">めい<input name="givenKana" maxlength="40" value="${esc(s.givenKana || '')}"></label></div>
    <div class="row"><label style="flex:1">学年<select name="grade">${gradeOptions(esc, s.grade)}</select></label><label style="flex:2">学校<input name="school" maxlength="60" value="${esc(s.school || '')}"></label></div>
    <label>受講科目（メモ）<input name="subjects" maxlength="100" value="${esc(s.subjects || '')}"></label>
    <div class="row"><label style="flex:1">授業料（90分・円）<input type="number" name="baseFee90" min="0" max="300000" step="10" value="${esc((Number(s.baseFee90 || 0) || Number(s.baseRate30 || 0) * 3))}"></label>
      <label style="flex:1">授業の形式（初期値）<select name="deliveryMode">${opt(MODE, s.deliveryMode || '')}</select></label></div>
    <div class="row"><label style="flex:1">在籍<select name="status">${opt(s.status === 'left' ? STUDENT_STATUS : { enrolled: STUDENT_STATUS.enrolled, paused: STUDENT_STATUS.paused }, s.status || 'enrolled')}</select></label><label style="flex:1">入塾日<input type="date" name="enrolledOn" value="${esc(s.enrolledOn || '')}"></label></div>
    <label>メモ（教室だけが見る）<input name="note" maxlength="1000" value="${esc(s.note || '')}"></label>`;
}

export const familyBar = () => detail && detail.name ? { title: contractorOf(detail), sub: '契約者', right: '' } : { title: '契約者', sub: '', right: '' };
// 契約者のページのタブ（2026-11-04 本人「各契約者のページの中にタブを作って、その中に『契約』を設置」）
const FAM_TABS = [['basic', '基本情報'], ['contracts', '契約']];
export function familyDetailPage(ctx, id, tab = 'basic', kind = '') {
  const { esc } = ctx;
  if (!detail || detail.id !== id) { loadDetail(ctx, id); return '<p class="muted" style="margin-top:24px">読み込んでいます…</p>'; }
  const f = detail;
  if (!FAM_TABS.some(t => t[0] === tab)) tab = 'basic';
  let h = `<p style="margin:12px 0 0">${tag(STATUS[f.status] || ['gray', f.status])}${f.testOnly ? '<span class="tag gray">テスト</span>' : ''}</p>${ctx.notice()}`;
  if (shown) h += `<div class="notice ok"><p>${esc(shown.text)}</p>${shown.url ? `<p class="copy">${esc(shown.url)}</p><button data-action="copy" data-text="${esc(shown.url)}">リンクをコピー</button>` : ''}</div>`;
  h += '<div class="tabs2" role="tablist">' + FAM_TABS.map(([k, label]) => `<a role="tab" href="#family=${encodeURIComponent(f.id)}${k === 'basic' ? '' : '/' + k}" class="${k === tab ? 'on' : ''}"${k === tab ? ' aria-selected="true"' : ''}>${label}</a>`).join('') + '</div>';
  if (tab === 'contracts') return h + contractsTab(ctx, f, kind) + familySheet(ctx, f);
  // 保護者の情報は生徒の基本情報と同じ罫線の表。操作はその行の中に置き、停止はページのいちばん下（2026-10-28 本人「ここがなんかごちゃごちゃしてます」）
  const row = (k, v) => v ? `<tr><th scope="row"><span>${k}</span></th><td>${v}</td></tr>` : '';
  const cell = (text, btns) => `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span style="flex:1 1 180px;min-width:0">${text}</span>${btns}</div>`;
  const invite = f.email && f.status !== 'stopped' && !f.hasPassword ? `<button class="small-btn" data-action="fam-invite"${ctx.dis()}>招待を送る</button>` : ''; // 登録済みの家族には出さない（パスワードを忘れたらログイン画面から。2026-11-04 本人）
  h += `<div class="sec-title">契約者</div><table class="grid-table"><tbody>${row('氏名', esc(f.guardianName || ''))}${row('メール', esc(f.email || ''))}${row('電話', esc(f.phone || ''))}${row('住所', esc(f.address || ''))}`
    + row('保護者ページ', cell(f.status === 'stopped' ? '止めています（メールも届きません）' : f.hasPassword ? '登録済み' : 'まだ登録していません', `<button class="small-btn" data-action="pv-open" data-kind="family" data-id="${esc(f.id)}">↗ プレビュー</button>${invite}`))
    + `${row('メモ', esc(f.note || ''))}</tbody></table><p style="margin-top:10px"><button data-action="fam-sheet" data-mode="family" data-id="${esc(f.id)}"${ctx.dis()}>契約者の情報を直す</button></p>`;
  h += `<div class="sec-title">契約している生徒 <span class="count gray">${f.students.length}</span></div><div class="group">` + f.students.map(s => rowButton(esc, 'fam-sheet', { mode: 'student', id: s.id }, `${esc(s.name)} ${tag(STUDENT_STATUS[s.status])}${s.testOnly ? '<span class="tag gray">テスト</span>' : ''}`,
    `${[s.grade, s.school, MODE[s.deliveryMode || '']].filter(Boolean).map(esc).join('・')}${s.grade || s.school || MODE[s.deliveryMode || ''] ? '・' : ''}${yen((Number(s.baseFee90 || 0) || Number(s.baseRate30 || 0) * 3))}（90分）・${condStatus(s.condition)}`)).join('') + '</div>';
  h += `<p style="margin-top:10px"><button data-action="fam-sheet" data-mode="add"${ctx.dis()}>＋ 兄弟を足す</button></p>`;
  h += `<p style="margin-top:28px">${f.status === 'stopped' ? `<button data-action="fam-status" data-status="${f.hasPassword ? 'active' : 'invited'}"${ctx.dis()}>保護者ページとメールを再開する</button>` : `<button class="danger" data-action="fam-status" data-status="stopped"${ctx.dis()}>保護者ページとメールを止める</button>`}</p>`;
  return h + familySheet(ctx, f);
}
// ---- 契約: 契約書の種類ごとの一覧。種類を選ぶと、同意した書面が新しい順に並ぶ（2026-11-04 本人「『個別指導条件書』を選択すると、過去に同意した個別指導条件書が表示される」） ----
const CONTRACT_KINDS = [['terms', '共通規約', '規'], ['conditions', '個別受講条件書', '条'], ['specials', '特別単価合意書', '特'], ['plans', '受講計画書', '計']];
const DOC_STATUS = { proposed: ['warn', '同意待ち'], agreed: ['ok', '同意済み'], approved: ['ok', '承認済み'], declined: ['gray', '見送り'], ended: ['gray', '終了'] };
const dayOf = v => String(v || '').slice(0, 10).replace(/-/g, '/');
const fileBtn = (esc, id) => id ? `<button class="small-btn" data-action="gr-open" data-id="${esc(id)}">開く</button>` : '';
const agreedLine = (at, name) => at ? `同意 ${dayOf(at)}${name ? `・${name}` : ''}` : '';
// 提案のまま置き換わった版は同意していないので並べない
function contractRows(esc, d) {
  const terms = (d.terms.history || []).map(r => ({ who: '共', title: `${r.title || '共通規約'}${r.version ? `（${r.version}）` : ''}`, note: [r.from ? `${dayOf(r.from)}から` : '', agreedLine(r.at, r.consenterName), r.via || ''], status: 'agreed',
    open: /^https:\/\//.test(r.url || '') ? `<a class="btn small-btn" href="${esc(r.url)}" target="_blank" rel="noopener">開く</a>` : '' }));
  const conditions = (d.conditions.items || []).flatMap(x => (x.history || []).map(c => ({ ...c, studentName: x.studentName }))).filter(c => c.status !== 'replaced')
    .map(c => ({ who: c.studentName, title: `${c.studentName}・第${c.no}版`, note: [`${c.fromMonth}から・${c.minutes}分 ${yen(c.fee)}`, c.subjects, agreedLine(c.agreedAt, c.consenterName)], status: c.status, open: fileBtn(esc, c.docFileId) }));
  const specials = [...(d.specials.items || []), ...(d.specials.past || [])].filter(c => c.status !== 'replaced')
    .map(c => ({ who: c.studentName, title: `${c.studentName}・${c.title}${c.no > 1 ? ` 第${c.no}版` : ''}`, note: [`${dayOf(c.fromDate)}〜${dayOf(c.toDate)}・${c.minutes}分 ${yen(c.fee)}`, agreedLine(c.agreedAt, c.consenterName)], status: c.status, open: fileBtn(esc, c.docFileId) }));
  // 計画の版は行ごとに残る。同じ行の同じ版は新しい記録だけ、書面と同じ「生徒・期間・状態」でまとめる
  const seen = new Set(), groups = new Map();
  for (const l of d.plans || []) {
    const k = l.id + ':' + l.version; if (seen.has(k)) continue; seen.add(k);
    const g = JSON.stringify([l.studentId, l.startDate, l.endDate, l.status]);
    if (!groups.has(g)) groups.set(g, []); groups.get(g).push(l);
  }
  const plans = [...groups.values()].map(ls => { const l = ls[0]; return { who: l.studentName, title: `${l.studentName}・${dayOf(l.startDate)}〜${dayOf(l.endDate)}`, note: [ls.map(x => `${x.subject} ${x.kind} ${x.approvedCount ?? x.count}回`).join('、')], status: l.status,
    open: `<button class="small-btn" data-action="agreement-doc" data-refs="${esc(JSON.stringify(ls.map(x => ({ id: x.id, version: x.version }))))}">開く</button>` }; });
  return { terms, conditions, specials, plans };
}
async function loadContracts(ctx, id) {
  contractData = { id, loading: true };
  const r = await ctx.call('admin/families/contracts', { id });
  contractData = r.ok ? { id, ...r } : { id, error: r.error.message };
  if (!r.ok) ctx.handleAuth(r);
  ctx.render();
}
function contractsTab(ctx, f, kind) {
  const { esc } = ctx;
  if (!contractData || contractData.id !== f.id) { loadContracts(ctx, f.id); return '<p class="muted" style="margin-top:24px">読み込んでいます…</p>'; }
  if (contractData.loading) return '<p class="muted" style="margin-top:24px">読み込んでいます…</p>';
  if (contractData.error) return `<p class="notice error">${esc(contractData.error)}</p>`;
  const rows = contractRows(esc, contractData), base = `#family=${encodeURIComponent(f.id)}/contracts`;
  const current = CONTRACT_KINDS.find(k => k[0] === kind);
  if (current) {
    const list = rows[current[0]];
    return `<div class="sec-title">${current[1]} <span class="count gray">${list.length}</span></div>` + (list.length ? '<div class="group stu-list">' + list.map(r => `<div class="srow"><span class="av" style="background:${avColor(r.who)}" aria-hidden="true">${esc(initial(r.who))}</span>
      <span class="b"><strong>${esc(r.title)}</strong>${r.note.filter(Boolean).map(n => `<small class="muted">${esc(n)}</small>`).join('')}${tag(DOC_STATUS[r.status] || ['gray', r.status])}</span>${r.open}</div>`).join('') + '</div>' : '<p class="muted small">まだありません。</p>');
  }
  const ct = detail.terms || { version: '' };
  const summary = k => {
    if (k === 'terms' && ct.version) return f.termsVersion === ct.version ? `最新の版に同意済み（${dayOf(f.termsAcceptedAt)}）` : `<span class="tag warn">最新の版に未同意</span>`;
    const n = rows[k].filter(r => ['agreed', 'approved', 'ended'].includes(r.status)).length, wait = rows[k].filter(r => r.status === 'proposed').length;
    return `同意 ${n}件${wait ? `・<span class="tag warn">同意待ち ${wait}件</span>` : ''}`;
  };
  return '<div class="group stu-list" style="margin-top:14px">' + CONTRACT_KINDS.map(([k, label, mark]) => `<a class="srow" href="${base}/${k}"><span class="av" style="background:${avColor(label)}" aria-hidden="true">${mark}</span>
    <span class="b"><strong>${label}</strong><small class="muted">${summary(k)}</small></span><span class="go">›</span></a>`).join('') + '</div>' + renewalSection(ctx, f);
}
// ---- 契約の更新（2026-10-29 本人「新しい規約と契約書類に以前から利用している顧客に承認してもらう…入塾手続きを転用」） ----
// 在籍している生徒ごとに個別受講条件書の案を作り、家族に 1 通で案内する。保護者は「契約の更新」の画面で情報を確かめて、生徒ごとに同意する
const renewalTargets = f => f.students.filter(s => !s.trial && s.status !== 'left');
const mdOf = t => t ? Number(t.slice(5, 7)) + '/' + Number(t.slice(8, 10)) : '';
function renewalSection(ctx, f, title = '<div class="sec-title">契約更新の手続き</div>') {
  const { esc } = ctx, list = renewalTargets(f);
  if (!(detail.terms && detail.terms.version) || !list.length) return '';
  const state = s => s.renewal && s.renewal.status === 'applied' ? `<span class="tag ok">同意済み</span> <span class="muted">${mdOf(s.renewal.appliedAt)}</span>`
    : s.renewal && s.renewal.status === 'offered' ? `<span class="tag warn">ご案内中</span> <span class="muted">${mdOf(s.renewal.offeredAt)}</span>`
    : s.condition && s.condition.agreed ? `<span class="muted">第${s.condition.agreed.no}版に同意済み</span>` : '<span class="tag gray">まだ</span>';
  const open = list.find(s => s.renewal && s.renewal.status === 'offered'), allDone = list.every(s => s.renewal && s.renewal.status === 'applied');
  return `${title}<table class="grid-table"><tbody>${list.map(s => `<tr><th scope="row"><span>${esc(s.name)}</span></th><td>${state(s)}</td></tr>`).join('')}</tbody></table>
    <div class="row" style="margin-top:10px">${allDone ? '' : `<button data-action="fam-sheet" data-mode="renewal"${ctx.dis()}>${open ? '条件を直して送り直す' : '契約更新の手続きを案内する'}</button>`}${open ? `<button data-action="renewal-resend" data-id="${esc(open.renewal.id)}"${ctx.dis()}>もう一度送る</button>` : ''}</div>`;
}
// 生徒の「契約」タブからも同じ欄と画面で案内する（2026-10-29 本人「このページから契約の更新の依頼が送れる…といいんじゃないかな」）。
// 案内は家族ごとに 1 通なので、兄弟も同じ表に並べる。送ったら done（契約のタブの読み直し）
let renewalDone = null;
export function renewalBox(ctx, familyId, done) {
  renewalDone = done;
  if (!detail || detail.id !== familyId) {
    if (!detail || !detail.loading || detail.id !== familyId) {
      detail = { id: familyId, loading: true };
      ctx.call('admin/families/get', { id: familyId }).then(r => { if (!detail || detail.id !== familyId) return; detail = r.ok ? { ...r.family, terms: r.terms } : null; if (!r.ok) ctx.handleAuth(r); ctx.render(); });
    }
    return '';
  }
  if (detail.loading) return '';
  return renewalSection(ctx, detail, '<h2>契約更新の手続き</h2>') + (famSheet && famSheet.mode === 'renewal' ? renewalSheet(ctx, detail) : '');
}
function renewalSheet(ctx, f) {
  const { esc } = ctx, list = renewalTargets(f);
  const one = (s, i) => {
    const base = (s.condition && s.condition.latest) || null, done = s.renewal && s.renewal.status === 'applied';
    const v = { minutes: base ? base.minutes : 90, fee: base ? base.fee : (Number(s.baseFee90 || 0) || Number(s.baseRate30 || 0) * 3), deliveryMode: base ? base.deliveryMode : (s.deliveryMode || 'in_person'), subjects: base ? base.subjects : (s.subjects || '') };
    return `<fieldset class="reg-field cond-box" data-renewal="${esc(s.id)}"><legend><label class="choice" style="display:inline-flex;gap:8px;font-weight:700"><input type="checkbox" name="pick_${i}" style="width:auto"${done ? '' : ' checked'}>${esc(s.name)}</label></legend>
      <div class="row"><label style="flex:1">1回の時間（分）<input type="number" name="minutes_${i}" min="15" max="300" step="5" value="${v.minutes}"></label><label style="flex:1">1回の授業料（税込・円）<input type="number" name="fee_${i}" min="0" max="100000" step="10" value="${v.fee}"></label>
      <label style="flex:1">実施形態<select name="mode_${i}">${Object.entries(COND_MODE).map(([k, l]) => `<option value="${k}"${k === v.deliveryMode ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="cond-sub">科目</div>${subjectFields(esc, v.subjects, 'subjects_' + i)}</fieldset>`;
  };
  return sheet(esc, '契約更新の手続きを案内する', `<form class="stack" data-form="renewal-offer">
    <label style="max-width:220px">適用開始月<input type="month" name="fromMonth" required value="${esc(nextMonth())}"></label>
    ${list.map(one).join('')}
    <button class="primary"${ctx.dis()}>印を付けた生徒の分を、保護者にメールで案内する</button></form>`, 'fam-close', { wide: true });
}

function familySheet(ctx, f) {
  const { esc } = ctx, m = famSheet && famSheet.mode;
  if (!m || m === 'create') return '';
  if (m === 'renewal') return renewalSheet(ctx, f);
  if (m === 'family') return sheet(esc, '契約者の情報を直す', `<form class="stack" data-form="fam-update">${familyInputs(esc, f)}<button class="primary"${ctx.dis()}>保存</button></form>`, 'fam-close');
  if (m === 'add') return sheet(esc, '兄弟を足す', `<form class="stack" data-form="stu-create">${studentInputs(esc, { status: 'enrolled' })}<button class="primary"${ctx.dis()}>兄弟を足す</button></form>`, 'fam-close');
  const s = f.students.find(x => x.id === famSheet.id); if (!s) return '';
  const cd = s.condition || { latest: null, agreed: null, needs: false }, base = cd.latest || null;
  if (m === 'cond') { // 条件を決めてお知らせ（新しい版）。前の版か生徒の登録から初期値
    const v = { minutes: base ? base.minutes : 90, fee: base ? base.fee : (Number(s.baseFee90 || 0) || Number(s.baseRate30 || 0) * 3), deliveryMode: base ? base.deliveryMode : (s.deliveryMode || 'in_person'), groupSize: base ? base.groupSize : '', studentContact: base ? base.studentContact : true, subjects: base ? base.subjects : (s.subjects || ''), note: base ? base.note : '', fromMonth: nextMonth() };
    return sheet(esc, s.name + ' の個別受講条件書' + (base ? `（第${base.no + 1}版）` : ''), `<p class="small muted" style="margin-top:0">お知らせすると保護者にメールが届き、同意まで、この契約者は新しい計画を承認できません。</p>
      <form class="stack" data-form="cond-propose" data-id="${esc(s.id)}">
      <div class="row"><label style="flex:1">基本の授業時間（分）<input type="number" name="minutes" min="15" max="300" step="5" required value="${v.minutes}"></label><label style="flex:1">1回の授業料（税込・円）<input type="number" name="fee" min="0" max="100000" step="10" required value="${v.fee}"></label></div>
      <div class="row"><label style="flex:1">実施形態<select name="deliveryMode">${Object.entries(COND_MODE).map(([k, l]) => `<option value="${k}"${k === v.deliveryMode ? ' selected' : ''}>${l}</option>`).join('')}</select></label><label style="flex:1">適用開始月<input type="month" name="fromMonth" required value="${esc(v.fromMonth)}"></label></div>
      <label>人数（空なら「講師1名につき生徒最大2名」）<input name="groupSize" maxlength="80" value="${esc(v.groupSize)}" placeholder="講師1名につき生徒最大2名"></label>
      <fieldset class="reg-field"><legend>科目</legend>${subjectFields(esc, v.subjects)}</fieldset>
      <label>特記事項（任意）<textarea name="note" maxlength="1000" rows="2">${esc(v.note)}</textarea></label>
      <div class="row"><button class="primary"${ctx.dis()}>保護者にお知らせする</button><button type="button" data-action="fam-sheet" data-mode="student" data-id="${esc(s.id)}">戻る</button></div></form>`, 'fam-close', { wide: true });
  }
  const sps = s.specials || { items: [], past: [] };
  if (m === 'special') { // 特別単価を提案する（replaceId があれば置き換え）
    const base = famSheet.replaceId ? sps.items.find(x => x.id === famSheet.replaceId) : null;
    const v = base || { title: '', content: '', reason: '', prep: '', minutes: cd.latest ? cd.latest.minutes : 90, fee: '', fromDate: today(), toDate: '', note: '' };
    return sheet(esc, `${s.name} の特別単価を提案${base ? `（「${esc(base.title)}」を置き換え）` : ''}`, `<form class="stack" data-form="special-propose" data-id="${esc(s.id)}" data-replace="${esc(famSheet.replaceId || '')}">
      <label>名称<input name="title" maxlength="20" placeholder="例: 英検準1級対策" required value="${esc(v.title)}"></label>
      <label>指導の目的<textarea name="purpose" maxlength="1000" rows="2" required>${esc(v.purpose || '')}</textarea></label>
      <label>指導の内容と範囲<textarea name="content" maxlength="1000" rows="3" required placeholder="例: 過去問の長文とライティングの添削。毎回、前回の答案を講師が採点して返す">${esc(v.content)}</textarea></label>
      <label>通常の授業との違い（なぜ特別単価にするか）<textarea name="reason" maxlength="1000" rows="3" required placeholder="例: 毎回の答案の添削と準備に1回2時間かかり、ほかの生徒には使えない">${esc(v.reason)}</textarea></label>
      <label>必要な準備（任意）<input name="prep" maxlength="1000" value="${esc(v.prep)}"></label>
      <div class="row"><label style="flex:1">1回の時間（分）<input type="number" name="minutes" min="15" max="300" step="5" required value="${v.minutes}"></label><label style="flex:1">特別単価（税込・円）<input type="number" name="fee" min="0" max="100000" step="10" required value="${v.fee}"></label></div>
      <div class="row"><label style="flex:1">期間（から）<input type="date" name="fromDate" required value="${esc(v.fromDate)}"></label><label style="flex:1">期間（まで）<input type="date" name="toDate" required value="${esc(v.toDate)}"></label></div>
      <label>特記事項（任意）<input name="note" maxlength="1000" value="${esc(v.note)}"></label>
      <div class="row"><button class="primary"${ctx.dis()}>保護者に提案する</button><button type="button" data-action="fam-sheet" data-mode="student" data-id="${esc(s.id)}">戻る</button></div></form>`, 'fam-close', { wide: true });
  }
  if (m === 'special-record') { const sp = sps.items.find(x => x.id === famSheet.specialId); if (!sp) return ''; return sheet(esc, `「${sp.title}」の承諾を記録`, `<p class="small muted" style="margin-top:0">${sp.minutes}分 ${yen(sp.fee)}・${esc(sp.fromDate)}〜${esc(sp.toDate)}</p>
    <form class="stack" data-form="special-record" data-id="${esc(sp.id)}"><div class="row"><label style="flex:1">承諾をもらった日時（日本時間）<input type="datetime-local" name="consentedAt" required></label><label style="flex:1">方法<input name="via" maxlength="40" required placeholder="LINE・書面 など"></label></div>
    <label>承認・同意した保護者の氏名<input name="consenterName" maxlength="100" required></label><label>メモ（任意）<input name="note" maxlength="300"></label><button class="primary"${ctx.dis()}>記録する</button></form>`, 'fam-close'); }
  if (m === 'cond-record' && cd.latest && cd.needs) return sheet(esc, s.name + ' の条件の承諾を記録', `<p class="small muted" style="margin-top:0">第${cd.latest.no}版・1回${cd.latest.minutes}分 ${yen(cd.latest.fee)}・${esc(cd.latest.deliveryLabel)}・${esc(cd.latest.fromMonth)}から</p>
    <form class="stack" data-form="cond-record" data-id="${esc(cd.latest.id)}"><div class="row"><label style="flex:1">承諾をもらった日時（日本時間）<input type="datetime-local" name="consentedAt" required></label><label style="flex:1">方法<input name="via" maxlength="40" required placeholder="LINE・書面 など"></label></div>
    <label>承認・同意した保護者の氏名<input name="consenterName" maxlength="100" required></label><label>メモ（任意）<input name="note" maxlength="300" placeholder="例: 母から LINE で「同意します」"></label><button class="primary"${ctx.dis()}>記録する</button></form>`, 'fam-close');
  if (m === 'edit') return sheet(esc, s.name + ' を直す', `<form class="stack" data-form="stu-update" data-id="${esc(s.id)}" data-version="${s.version}">${studentInputs(esc, s)}<div class="row"><button class="primary"${ctx.dis()}>保存</button><button type="button" data-action="fam-sheet" data-mode="student" data-id="${esc(s.id)}">やめる</button></div></form>`, 'fam-close');
  if (m === 'move') return sheet(esc, s.name + ' を別の契約者へ移す', `<form class="stack" data-form="stu-move" data-id="${esc(s.id)}" data-version="${s.version}"><label>移す先の契約者<select name="familyId">${(list || []).filter(x => x.id !== f.id).map(x => `<option value="${esc(x.id)}">${esc(contractorOf(x))}</option>`).join('')}</select></label><div class="row"><button class="primary"${ctx.dis()}>移す</button><button type="button" data-action="fam-sheet" data-mode="student" data-id="${esc(s.id)}">やめる</button></div></form>`, 'fam-close');
  return sheet(esc, s.name, `<p class="small muted" style="margin-top:0">${esc(s.grade || '学年なし')}・${esc(s.school || '学校なし')}・${MODE[s.deliveryMode || '']}・授業料（90分） ${yen((Number(s.baseFee90 || 0) || Number(s.baseRate30 || 0) * 3))}（90分）${s.note ? '<br>メモ: ' + esc(s.note) : ''}</p>
    <div class="sec-title" style="margin:4px 0 6px">個別受講条件書 ${condStatus(cd)}</div>
    ${cd.latest ? `<p class="small" style="margin:0 0 8px">第${cd.latest.no}版：1回${cd.latest.minutes}分 ${yen(cd.latest.fee)}・${esc(cd.latest.deliveryLabel)}・${cd.latest.studentContact ? '本人の連絡あり' : '本人の連絡なし'}・${esc(cd.latest.fromMonth)}から${cd.needs ? '' : `（${esc(cd.latest.agreedVia)}・${esc(String(cd.latest.agreedAt).slice(0, 10))}）`}${cd.needs && cd.agreed ? `<br><span class="muted">今は第${cd.agreed.no}版（1回${cd.agreed.minutes}分 ${yen(cd.agreed.fee)}）で合意中</span>` : ''}</p>` : ''}
    <div class="row" style="margin-bottom:12px">${cd.latest && cd.latest.docFileId ? `<button data-action="gr-open" data-id="${esc(cd.latest.docFileId)}">条件書を開く${cd.needs ? '（案）' : ''}</button>` : ''}${cd.needs && cd.agreed && cd.agreed.docFileId ? `<button data-action="gr-open" data-id="${esc(cd.agreed.docFileId)}">合意中の条件書（第${cd.agreed.no}版）</button>` : ''}<button data-action="fam-sheet" data-mode="cond" data-id="${esc(s.id)}"${ctx.dis()}>${cd.latest ? '新しい版を決めてお知らせ' : '条件を決めてお知らせ'}</button>${cd.needs ? `<button data-action="fam-sheet" data-mode="cond-record" data-id="${esc(s.id)}"${ctx.dis()}>承諾を記録</button>` : ''}</div>
    <div class="sec-title" style="margin:4px 0 6px">特別単価${sps.items.length ? ` <span class="count gray">${sps.items.length}</span>` : ''}</div>
    ${sps.items.length ? sps.items.map(x => `<p class="small" style="margin:0 0 6px">「${esc(x.title)}」 <span class="tag ${SP_STATUS[x.status][0]}">${SP_STATUS[x.status][1]}</span> ${x.minutes}分 ${yen(x.fee)}・${esc(x.fromDate)}〜${esc(x.toDate)}${x.status === 'agreed' ? `（${esc(x.agreedVia)}・${esc(String(x.agreedAt).slice(0, 10))}）` : ''}<br><span class="row" style="margin-top:4px">${x.docFileId ? `<button class="small-btn" data-action="gr-open" data-id="${esc(x.docFileId)}">条件書を開く</button>` : ''}${x.status === 'proposed' ? `<button class="small-btn" data-action="fam-special" data-mode="special-record" data-id="${esc(s.id)}" data-special="${esc(x.id)}"${ctx.dis()}>承諾を記録</button>` : ''}<button class="small-btn" data-action="fam-special" data-mode="special" data-id="${esc(s.id)}" data-special="${esc(x.id)}"${ctx.dis()}>置き換える</button><button class="small-btn" data-action="special-end" data-id="${esc(x.id)}"${ctx.dis()}>終える</button></span></p>`).join('') : ''}
    <div class="row" style="margin-bottom:12px"><button data-action="fam-special" data-mode="special" data-id="${esc(s.id)}"${ctx.dis()}>特別単価を提案</button></div>
    <div class="stack"><a class="btn" href="#student=${encodeURIComponent(s.id)}">生徒の画面を開く</a>
    <button data-action="fam-sheet" data-mode="edit" data-id="${esc(s.id)}"${ctx.dis()}>登録内容を直す</button>
    <button data-action="pv-open" data-kind="student" data-id="${esc(s.id)}">生徒ページを見る（プレビュー）</button>
    <button data-action="copy" data-text="${esc(s.link)}">専用リンクをコピー</button>
    <button data-action="stu-newlink" data-id="${esc(s.id)}" data-version="${s.version}"${ctx.dis()}>専用リンクを作り直す</button>
    <button data-action="fam-sheet" data-mode="move" data-id="${esc(s.id)}"${ctx.dis()}>別の契約者へ移す</button></div>`, 'fam-close');
}

async function load(ctx) {
  const r = await ctx.call('admin/families/list');
  if (!r.ok) { list = []; if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error'); } else list = r.families;
  ctx.render();
}
async function loadDetail(ctx, id) {
  detail = { id, loading: true }; contractData = null;
  const r = await ctx.call('admin/families/get', { id });
  if (!r.ok) { detail = null; if (!ctx.handleAuth(r)) { ctx.say(r.error.message, 'error'); location.hash = '#families'; } }
  else { detail = { ...r.family, terms: r.terms }; if (!list) load(ctx); }
  ctx.render();
}
const values = el => Object.fromEntries(new FormData(el).entries());
const studentBody = v => ({ ...v, baseFee90: Number(v.baseFee90 || 0) });

// 送信（フォーム）。扱ったら true
export async function familiesSubmit(ctx, kind, el) {
  const v = values(el);
  let r;
  if (kind === 'fam-create') {
    r = await ctx.call('admin/families/create', v);
    if (r.ok) { famSheet = null; list = null; location.hash = '#family=' + encodeURIComponent(r.family.id); ctx.say('契約者を登録しました', 'ok'); return true; }
  } else if (kind === 'fam-update') {
    r = await ctx.call('admin/families/update', { id: detail.id, version: detail.version, ...v });
    if (r.ok) { famSheet = null; detail = null; list = null; ctx.say('保存しました', 'ok'); return true; }
  } else if (kind === 'renewal-offer') {
    const students = renewalTargets(detail).map((s, i) => ({ s, i })).filter(({ i }) => el.querySelector(`[name="pick_${i}"]`).checked)
      .map(({ s, i }) => ({ studentId: s.id, minutes: Number(v['minutes_' + i]), fee: Number(v['fee_' + i]), deliveryMode: v['mode_' + i], subjects: readSubjects(el, 'subjects_' + i) }));
    if (!students.length) { ctx.say('案内する生徒に印を付けてください', 'error'); return true; }
    const names = students.map(x => detail.students.find(s => s.id === x.studentId).name + 'さん').join('・');
    if (!confirm(`${names}の共通規約と個別受講条件書（${Number(v.fromMonth.slice(5))}月から）を、${detail.email} にメールで案内しますか？`)) return true;
    r = await ctx.call('admin/renewal/offer', { familyId: detail.id, fromMonth: v.fromMonth, students });
    if (r.ok) { famSheet = null; detail = null; if (renewalDone) renewalDone(); ctx.say(r.mailed ? '契約更新の手続きを案内しました' : '案内を作りました。メールはまだ送られていません', r.mailed ? 'ok' : 'error'); return true; }
  } else if (kind === 'cond-propose') {
    if (!confirm(`${detail.email} に個別受講条件書のお知らせのメールを送りますか？`)) return true;
    r = await ctx.call('admin/conditions/propose', { studentId: el.dataset.id, minutes: Number(v.minutes), fee: Number(v.fee), deliveryMode: v.deliveryMode, groupSize: v.groupSize, subjects: readSubjects(el), note: v.note, fromMonth: v.fromMonth });
    if (r.ok) { famSheet = null; detail = null; list = null; ctx.say(`個別受講条件書（第${r.condition.no}版）を保護者にお知らせしました`, 'ok'); return true; }
  } else if (kind === 'special-propose') {
    if (!confirm(`${detail.email} に特別単価の提案のメールを送りますか？`)) return true;
    r = await ctx.call('admin/specials/propose', { studentId: el.dataset.id, replaceId: el.dataset.replace || undefined, title: v.title, purpose: v.purpose, content: v.content, reason: v.reason, prep: v.prep, minutes: Number(v.minutes), fee: Number(v.fee), fromDate: v.fromDate, toDate: v.toDate, note: v.note });
    if (r.ok) { famSheet = null; detail = null; list = null; ctx.say(`特別単価「${r.special.title}」を保護者に提案しました`, 'ok'); return true; }
  } else if (kind === 'special-record') {
    if (!confirm(`承諾を記録すると、${detail.email} に控えのメールが届きます。記録しますか？`)) return true;
    r = await ctx.call('admin/specials/record', { id: el.dataset.id, consentedAt: v.consentedAt + '+09:00', consenterName: v.consenterName, via: v.via, note: v.note });
    if (r.ok) { famSheet = null; detail = null; list = null; ctx.say('特別単価の承諾を記録しました', 'ok'); return true; }
  } else if (kind === 'cond-record') {
    if (!confirm(`承諾を記録すると、${detail.email} に控えのメールが届きます。記録しますか？`)) return true;
    r = await ctx.call('admin/conditions/record', { id: el.dataset.id, consentedAt: v.consentedAt + '+09:00', consenterName: v.consenterName, via: v.via, note: v.note });
    if (r.ok) { famSheet = null; detail = null; list = null; ctx.say('条件の承諾を記録しました', 'ok'); return true; }
  } else if (kind === 'stu-create') {
    r = await ctx.call('admin/students/create', { familyId: detail.id, ...studentBody(v) });
    if (r.ok) { famSheet = null; detail = null; list = null; ctx.say(r.student.name + ' さんを足しました', 'ok'); return true; }
  } else if (kind === 'stu-update') {
    r = await ctx.call('admin/students/update', { id: el.dataset.id, version: Number(el.dataset.version), ...studentBody(v) });
    if (r.ok) { famSheet = null; detail = null; list = null; ctx.say('保存しました', 'ok'); return true; }
  } else if (kind === 'stu-move') {
    r = await ctx.call('admin/students/move', { id: el.dataset.id, version: Number(el.dataset.version), familyId: v.familyId });
    if (r.ok) { famSheet = null; detail = null; list = null; ctx.say(r.student.name + ' さんを移しました', 'ok'); return true; }
  } else return false;
  if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}

// 押す（ボタン）。扱ったら true
export async function familiesClick(ctx, a, b) {
  let r;
  if (a === 'fam-sheet') { famSheet = { mode: b.dataset.mode, id: b.dataset.id || '' }; ctx.say(''); return true; }
  if (a === 'fam-close') { famSheet = null; return true; }
  if (a === 'renewal-resend') {
    if (!confirm(`${detail.email} に、契約更新の手続きの案内をもう一度送りますか？`)) return true;
    r = await ctx.call('admin/enrollment/resend', { offerId: b.dataset.id });
    if (r.ok) { detail = null; if (renewalDone) renewalDone(); ctx.say('案内をもう一度送りました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  if (a === 'fam-special') { famSheet = { mode: b.dataset.mode, id: b.dataset.id || '', specialId: b.dataset.special || '', replaceId: b.dataset.mode === 'special' ? (b.dataset.special || '') : '' }; ctx.say(''); return true; }
  if (a === 'special-end') {
    if (!confirm('この特別単価を終えますか？ 以後、この名称の種類で個別受講条件書の授業料を超える計画は作れなくなります。')) return true;
    r = await ctx.call('admin/specials/end', { id: b.dataset.id });
    if (r.ok) { famSheet = null; detail = null; ctx.say('特別単価を終えました', 'ok'); return true; }
    if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error'); return true;
  }
  if (a === 'fam-invite') {
    if (!confirm(`${detail.email} に保護者ページの招待メールを送りますか？`)) return true;
    r = await ctx.call('admin/families/invite', { id: detail.id });
    if (r.ok) { shown = { text: r.mailHeld ? '招待のリンクを作りました。切り替え前のため、メールは送っていません（7日有効・1回だけ）。' : '招待のメールを送りました。届かないときは、このリンクを LINE などで渡してください（7日有効・1回だけ）。', url: r.inviteUrl }; ctx.say(''); return true; }
  } else if (a === 'fam-status') {
    if (b.dataset.status === 'stopped' && !confirm('保護者ページとメールを止めますか？\n\n・保護者はログインできなくなり、開いている保護者ページもログアウトします\n・招待や登録のやり直しのリンクは使えなくなります\n・保護者へのお知らせのメールは届かなくなります\n・毎月3日の請求の自動確定をしません\n\n家族・生徒・授業・請求の記録は消えず、あとで再開できます。生徒の在籍と専用リンクはそのままです。')) return true;
    r = await ctx.call('admin/families/update', { id: detail.id, version: detail.version, status: b.dataset.status });
    if (r.ok) { detail = null; list = null; ctx.say(b.dataset.status === 'stopped' ? '保護者ページとメールを止めました' : '保護者ページとメールを再開しました', 'ok'); return true; }
  } else if (a === 'stu-newlink') {
    if (!confirm('専用リンクを作り直しますか？ 今のリンクはすぐに使えなくなります。生徒に新しいリンクを渡してください。')) return true;
    r = await ctx.call('admin/students/newLink', { id: b.dataset.id, version: Number(b.dataset.version) });
    if (r.ok) { famSheet = null; detail = null; shown = { text: r.student.name + ' さんの新しい専用リンクです。', url: r.student.link }; ctx.say(''); return true; }
  } else return false;
  if (r && !ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}
export function familiesInput(ctx, name, el) {
  if (name !== 'fam-query') return false;
  query = el.value; const pos = el.selectionStart; ctx.render();
  const again = document.querySelector('[data-input="fam-query"]'); if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  return true;
}
export function leaveFamilies() { shown = null; famSheet = null; }
