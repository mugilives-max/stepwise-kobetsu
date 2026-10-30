// 保護者の「入塾のお申込み」（#enroll。2026-10-18 本人決定。cf/v2/enrollment.mjs）。
// 1 つの画面で: 保護者さまの情報 → 生徒さんの情報の確認 → 個別受講条件書・共通規約 → 確認 → 「同意して入塾を申し込む」。
// 入力 → 確認 → 完了 の 3 画面（一般的な申込みの形）。同意者名は入れた保護者の氏名。申し込むとそのまま入塾。
// 以前からの家族の「契約更新の手続き」（kind = renewal。2026-10-29 本人）も同じ画面。兄弟はまとめて 1 回で確かめて同意する
// （2026-10-30 本人「兄弟が複数人いるときに、２回同じ手順をやることに違和感」）。保護者の情報と共通規約は 1 回、生徒の情報と個別受講条件書は生徒ごと
import { GRADES, normGrade } from '/assets/v2/grade-options.js?v=20261029-efftabs';
let data = null, step = 'input', draft = null, agree = false, missing = [], opened = new Set(), doneIds = [];
export function resetEnroll() { data = null; step = 'input'; draft = null; agree = false; missing = []; opened = new Set(); doneIds = []; }
const jaMonth = m => m ? Number(m.slice(0, 4)) + '年' + Number(m.slice(5, 7)) + '月' : '';
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const MODE = { in_person: '教室', online: 'オンライン', both: '教室とオンライン' };
const KANA = /^[ぁ-ゖァ-ヺー・\s　]+$/;
// 学年は区分（小学生・中学生・高校生）を先に選んでから（2026-10-26 本人「学年の前に、小学生・中学生・高校生の区分を先に」）。送る値は今までどおり「中3」など
const STAGES = [['小学生', '小', 6], ['中学生', '中', 3], ['高校生', '高', 3], ['その他', '', 0]];
const stageOf = g => { const s = STAGES.find(([, p]) => p && g.startsWith(p) && GRADES.includes(g)); return s ? s[0] : g ? 'その他' : ''; };
const h = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function gradeChoices(stage, value) {
  const st = STAGES.find(s => s[0] === stage);
  const list = !st ? [] : st[1] ? Array.from({ length: st[2] }, (_, i) => [st[1] + (i + 1), (i + 1) + '年']) : [...(value && !GRADES.includes(value) ? [[value, value]] : []), ['既卒', '既卒'], ['その他', 'その他']];
  return `<option value=""${list.some(([v]) => v === value) ? '' : ' selected'}>選んでください</option>` + list.map(([v, t]) => `<option value="${h(v)}"${v === value ? ' selected' : ''}>${h(t)}</option>`).join('');
}

export function needEnroll(ctx) {
  if (!data) { data = { loading: true }; ctx.call('family/enrollment', {}).then(r => { data = r.ok ? r : { offers: [], error: r.error.message }; ctx.render(); }); }
  return data.loading;
}
const open = () => (data && data.offers || []).filter(o => o.status === 'offered');
const isRenewal = o => !!o && o.kind === 'renewal';
// 今回の手続きで扱う案内: 契約更新の手続きなら兄弟をまとめて、入塾のお申込みは 1 人ずつ
const batch = () => { const o = open(); return !o.length ? [] : isRenewal(o[0]) ? o.filter(isRenewal) : [o[0]]; };
const TITLE_RENEWAL = '契約更新の手続き';
// 上の帯とホームのやることの名前（2026-10-30 本人「まずは、「契約更新の手続き」ですね」）
export const enrollTitle = () => { const o = open(); return o.length && o.every(isRenewal) ? TITLE_RENEWAL : '入塾のお申込み'; };
// 申込みでまとめて同意するもの（その間は、規約・個別受講条件書の別々の同意を出さない）
export function enrollCovers(ctx) {
  if (needEnroll(ctx)) return { terms: false, students: new Set() };
  const o = open(); return { terms: o.length > 0, students: new Set(o.map(x => x.studentId)) };
}
// ホームの「やること」の先頭に出す
export function enrollTodo(ctx) {
  if (needEnroll(ctx)) return null;
  const o = open(); if (!o.length) return null;
  return ['#enroll', 'file', '#c0392b', enrollTitle(), o.map(x => x.student.givenName + 'さん').join('・'), o.length];
}

// 同意の前に開く全文（個別受講条件書・ご利用共通規約）。開くまで「同意します」に印を付けられない（2026-10-26 本人「実際に表示しないと同意できないように」）
// 規約が先（個別受講条件書は規約に基づく）。兄弟がいれば個別受講条件書は生徒ごと
const docsOf = list => [...(data.terms.url ? [['terms', '共通規約']] : []), ...list.filter(o => o.condition).map(o => ['cond:' + o.id, list.length > 1 ? `個別受講条件書（${o.student.givenName}さん）` : '個別受講条件書'])];
const unopened = list => docsOf(list).filter(([k]) => !opened.has(k)).map(([, t]) => t);
const SFIELDS = ['familyName', 'givenName', 'familyKana', 'givenKana', 'stage', 'grade', 'school'];
const sk = (k, i) => k + '_' + i; // 生徒の項目の名前（兄弟の i 人目）
function initDraft(list) {
  const g = data.guardian || {};
  draft = { offerIds: list.map(o => o.id), guardianFamilyName: g.familyName || '', guardianGivenName: g.givenName || '', guardianFamilyKana: g.familyKana || '', guardianGivenKana: g.givenKana || '', phone: g.phone || '', zip: g.zip || '', address: g.address || '' };
  list.forEach((o, i) => { const s = o.student, grade = normGrade(s.grade);
    Object.assign(draft, { [sk('familyName', i)]: s.familyName || '', [sk('givenName', i)]: s.givenName || '', [sk('familyKana', i)]: s.familyKana || '', [sk('givenKana', i)]: s.givenKana || '', [sk('grade', i)]: grade, [sk('school', i)]: s.school || '', [sk('stage', i)]: stageOf(grade) }); });
}
const GFIELDS = ['guardianFamilyName', 'guardianGivenName', 'guardianFamilyKana', 'guardianGivenKana', 'phone', 'zip', 'address'];
function check(list) {
  missing = [...GFIELDS, ...list.flatMap((_, i) => SFIELDS.map(k => sk(k, i)))].filter(k => !String(draft[k] || '').trim());
  for (const k of ['guardianFamilyKana', 'guardianGivenKana']) if (draft[k] && !KANA.test(draft[k])) missing.push(k);
  list.forEach((_, i) => { for (const k of ['familyKana', 'givenKana']) if (draft[sk(k, i)] && !KANA.test(draft[sk(k, i)])) missing.push(sk(k, i)); });
  if (draft.phone && (draft.phone.replace(/\D/g, '').length < 10 || draft.phone.replace(/\D/g, '').length > 11)) missing.push('phone');
  if (draft.zip && !/^\d{3}-?\d{4}$/.test(draft.zip.trim())) missing.push('zip');
  return !missing.length;
}

function steps(i, renewal) {
  return '<ol class="steps s3" aria-label="お申込みの進み具合">' + (renewal ? ['ご確認', '同意', '完了'] : ['アカウント', 'お申込み', '入塾']).map((t, k) => `<li class="${k < i ? 'done' : k === i ? 'now' : ''}"${k === i ? ' aria-current="step"' : ''}><span class="n">${k < i ? '✓' : k + 1}</span><span class="t">${t}</span></li>`).join('') + '</ol>';
}
function condRows(esc, o) {
  const c = o.condition || {};
  return gridTable(esc, [['適用期間', jaMonth(o.fromMonth) + 'から、条件変更日まで'], ['1回の|授業料', `1回${c.minutes}分 ${yen(c.fee)}（税込）`], ['実施形態', MODE[c.deliveryMode] || ''], ['科目', c.subjects || ''], ['特記事項', c.note || '']]);
}
const gridTable = (esc, rows) => `<table class="grid-table"><tbody>${rows.filter(([, v]) => v).map(([k, v]) => `<tr><th scope="row">${k.split('|').map(w => `<span>${w}</span>`).join('')}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
// 入力済みの項目（メールアドレス。変えるのはアカウントの画面から）
function fixed(esc, label, value) {
  return `<label style="flex:1 1 140px;min-width:0"><span>${label}</span><input value="${esc(value || '')}" readonly></label>`;
}
function field(esc, key, label, opts = {}) {
  const bad = missing.includes(key);
  return `<label style="flex:1 1 140px;min-width:0"><span>${label}${opts.req === false ? ' <span class="opt">任意</span>' : ''}</span><input name="${key}" data-enroll="${key}" value="${esc(draft[key] || '')}" ${opts.type ? `type="${opts.type}"` : ''} ${opts.mode ? `inputmode="${opts.mode}"` : ''} ${opts.auto ? `autocomplete="${opts.auto}"` : ''} placeholder="${esc(opts.ph || '')}" maxlength="${opts.max || 60}"${bad ? ' aria-invalid="true"' : ''}></label>`;
}
// 個別受講条件書（生徒ごと）と共通規約（1 回）。入力と確認の両方の画面に出す。説明文は置かず、条件の表と全文のボタンだけ
// ご利用共通規約の適用日は出さない（新しく入塾する方には申込みの日から適用。ご利用共通規約 r11 第28条第4項。2026-10-26 本人「これじゃ10月の授業できない」→ 新規は契約日から）
function termsCard(esc) {
  return `<section class="reg-card"><div class="reg-card-head"><h2>共通規約</h2></div>
      ${data.terms.url ? `<div class="row" style="margin-top:6px"><a class="small-btn" href="${esc(data.terms.url)}" target="_blank" rel="noopener" data-action="enroll-terms">共通規約の全文を開く</a></div>` : ''}</section>`;
}
function condCard(esc, o, withButton, many) {
  return `<section class="reg-card"><div class="reg-card-head"><h2>${many ? esc(o.student.givenName) + 'さんの' : ''}個別受講条件書の主な条件</h2></div>${condRows(esc, o)}
      ${withButton && o.condition ? `<div class="row" style="margin-top:6px"><button type="button" class="small-btn" data-action="enroll-cond" data-id="${esc(o.id)}">個別受講条件書の全文を開く</button></div>` : ''}</section>`;
}
// 同意の欄: 開く全文をチェック欄のすぐ上に並べ、開いたものに ✓（2026-10-26 本人「何故チェックできないのか理解できない…チェックボックスの近くに」）
function agreeDocs(esc, list) {
  const btn = (k, t) => k.startsWith('cond:')
    ? `<button type="button" class="small-btn" data-action="enroll-cond" data-id="${esc(k.slice(5))}" aria-label="${esc(t)}の全文を開く">全文を開く</button>`
    : `<a class="small-btn" href="${esc(data.terms.url)}" target="_blank" rel="noopener" data-action="enroll-terms" aria-label="${t}の全文を開く">全文を開く</a>`;
  return `<ul class="agree-docs">${docsOf(list).map(([k, t]) => `<li${opened.has(k) ? ' class="done"' : ''}><span class="mk" aria-hidden="true">${opened.has(k) ? '✓' : ''}</span><span class="t">${esc(t)}</span>${btn(k, t)}</li>`).join('')}</ul>`;
}
function studentFields(esc, o, i, many) {
  const st = sk('stage', i), gr = sk('grade', i);
  return `<fieldset class="reg-field cond-box"><legend>生徒さんの情報${many ? `（${esc(o.student.givenName)}さん）` : ''} <span class="req">必須</span></legend>
      <div class="row">${field(esc, sk('familyName', i), '姓', { max: 40 })}${field(esc, sk('givenName', i), '名', { max: 40 })}</div>
      <div class="row">${field(esc, sk('familyKana', i), 'ふりがな（姓）', { max: 40 })}${field(esc, sk('givenKana', i), 'ふりがな（名）', { max: 40 })}</div>
      <div class="row"><label style="flex:1 1 140px;min-width:0"><span>区分</span><select name="${st}" data-enroll="${st}"${missing.includes(st) ? ' aria-invalid="true"' : ''}><option value="">選んでください</option>${STAGES.map(([s]) => `<option${s === draft[st] ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
        <label style="flex:1 1 140px;min-width:0"><span>学年</span><select name="${gr}" data-enroll="${gr}"${missing.includes(gr) ? ' aria-invalid="true"' : ''}${draft[st] ? '' : ' disabled'}>${gradeChoices(draft[st], draft[gr])}</select></label></div>
      ${field(esc, sk('school', i), '学校', { ph: '例：〇〇中学校' })}</fieldset>`;
}
function inputPage(ctx, list) {
  const { esc } = ctx, renewal = isRenewal(list[0]), many = list.length > 1;
  return `${steps(renewal ? 0 : 1, renewal)}<h1>${renewal ? TITLE_RENEWAL : '入塾のお申込み'}</h1>${renewal ? `<p class="muted" style="margin-top:-4px">${list.map(o => esc(o.student.givenName) + 'さん').join('・')}</p>` : ''}${ctx.noticeHtml()}
  <form class="reg-form" data-form="enroll-input" novalidate>
    <fieldset class="reg-field cond-box"><legend>保護者さまの情報 <span class="req">必須</span></legend>
      <div class="row">${field(esc, 'guardianFamilyName', '姓', { ph: '例：山田', auto: 'family-name', max: 30 })}${field(esc, 'guardianGivenName', '名', { ph: '例：花子', auto: 'given-name', max: 30 })}</div>
      <div class="row">${field(esc, 'guardianFamilyKana', 'ふりがな（姓）', { ph: '例：やまだ', max: 30 })}${field(esc, 'guardianGivenKana', 'ふりがな（名）', { ph: '例：はなこ', max: 30 })}</div>
      <div class="cond-sub">連絡先</div>
      ${fixed(esc, '保護者メールアドレス', data.guardian && data.guardian.email)}
      ${field(esc, 'phone', '保護者電話番号', { type: 'tel', mode: 'tel', auto: 'tel', ph: '例：090-1234-5678', max: 20 })}
      ${field(esc, 'zip', '郵便番号', { mode: 'numeric', auto: 'postal-code', ph: '例：343-0002', max: 8 })}${field(esc, 'address', '住所', { auto: 'street-address', ph: '例：埼玉県越谷市〇〇町1-2-3', max: 200 })}</fieldset>
    ${list.map((o, i) => studentFields(esc, o, i, many) + condCard(esc, o, true, many)).join('')}
    ${termsCard(esc)}
    <div class="row"><button class="primary">入力内容を確認する</button></div></form>`;
}
function confirmPage(ctx, list) {
  const { esc } = ctx, d = draft, renewal = isRenewal(list[0]), many = list.length > 1;
  const left = unopened(list); if (left.length) agree = false;
  const zip = d.zip.trim().replace(/^(\d{3})(\d{4})$/, '$1-$2');
  return `${steps(1, renewal)}<h1>入力内容の確認</h1>${ctx.noticeHtml()}
    <section class="reg-card"><div class="reg-card-head"><h2>保護者さまの情報</h2></div>${gridTable(esc, [['氏名', d.guardianFamilyName + ' ' + d.guardianGivenName], ['ふりがな', d.guardianFamilyKana + ' ' + d.guardianGivenKana], ['保護者|メールアドレス', data.guardian && data.guardian.email], ['保護者|電話番号', d.phone], ['住所', '〒' + zip + '\n' + d.address]])}</section>
    ${list.map((o, i) => `<section class="reg-card"><div class="reg-card-head"><h2>生徒さんの情報${many ? `（${esc(o.student.givenName)}さん）` : ''}</h2></div>${gridTable(esc, [['氏名', d[sk('familyName', i)] + ' ' + d[sk('givenName', i)]], ['ふりがな', d[sk('familyKana', i)] + ' ' + d[sk('givenKana', i)]], ['学年', d[sk('grade', i)]], ['学校', d[sk('school', i)]]])}</section>
    ${condCard(esc, o, false, many)}`).join('')}
    <form class="reg-form" data-form="enroll-apply" novalidate>
      <section class="reg-card agree-card">${agreeDocs(esc, list)}
      <label class="choice"><input type="checkbox" name="agree" data-enroll-agree${agree ? ' checked' : ''}${left.length ? ' disabled' : ''}><span>共通規約と個別受講条件書の内容を確認し、同意します<small>同意する方：${esc(d.guardianFamilyName + ' ' + d.guardianGivenName)}（保護者）</small></span></label></section>
      <div class="row"><button class="primary"${ctx.dis()}>${renewal ? '同意する' : '同意して入塾を申し込む'}</button></div>
      <p class="small"><a href="javascript:void 0" data-action="enroll-back">入力画面に戻って直す</a></p></form>`;
}
function donePage(ctx, list) {
  const { esc } = ctx, next = open()[0], o = list[0];
  if (isRenewal(o)) return `${steps(3, true)}<h1>同意を受け付けました</h1>
    <section class="flow"><ol><li class="done"><div class="ft">${list.map(x => esc(x.student.givenName) + 'さん').join('・')}の共通規約と個別受講条件書</div><div class="fb">控えはメニューの「契約」にあります。</div></li>
      <li class="now"><div class="ft">${esc(jaMonth(o.fromMonth))}からの授業</div><div class="fb">新しい個別受講条件書の内容で行います。</div></li></ol></section>
    <p>${next ? `<button class="primary" data-action="enroll-next">続けて${esc(next.student.givenName)}さんの手続きへ</button>` : '<a class="small-btn primary" href="#home">ホームへ</a>'}</p>`;
  return `${steps(3, false)}<h1>お申込みを受け付けました</h1>
    <section class="flow"><h2>このあとの流れ</h2><ol>
      <li class="done"><div class="ft">入塾のお申込み</div><div class="fb">控えはメニューの「契約」にあります。</div></li>
      <li class="now"><div class="ft">${esc(jaMonth(o.fromMonth))}からの授業の日程</div><div class="fb">LINE などで日程を相談します。決まった授業の日時と授業料は、保護者ページで確かめられます。</div></li></ol></section>
    <p><a class="small-btn primary" href="#home">ホームへ</a></p>`;
}
export function enrollPage(ctx) {
  if (needEnroll(ctx)) return '<p class="muted" style="margin-top:20px">読み込んでいます…</p>';
  if (data.error) return `<p class="notice error">${ctx.esc(data.error)}</p>`;
  if (step === 'done' && doneIds.length) { const applied = doneIds.map(id => data.offers.find(x => x.id === id)).filter(Boolean); if (applied.length) return donePage(ctx, applied); }
  const list = batch();
  if (!list.length) return `<h1>${enrollTitle()}</h1><p class="muted">お願いしているものはありません。</p><p><a href="#home">ホームへ</a></p>`;
  if (!draft || draft.offerIds.join() !== list.map(o => o.id).join()) { initDraft(list); step = 'input'; agree = false; missing = []; opened = new Set(); }
  return step === 'confirm' ? confirmPage(ctx, list) : inputPage(ctx, list);
}
export function enrollInput(ev) {
  const k = ev.target.dataset && ev.target.dataset.enroll; if (!k || !draft) return false;
  draft[k] = ev.target.value;
  const m = /^stage_(\d+)$/.exec(k);
  if (m) { // 区分を変えたら学年を選び直す
    const gr = sk('grade', m[1]);
    if (stageOf(draft[gr]) !== draft[k]) draft[gr] = '';
    const g = document.querySelector(`[data-enroll="${gr}"]`); if (g) { g.innerHTML = gradeChoices(draft[k], draft[gr]); g.disabled = !draft[k]; }
  }
  return true;
}
export function enrollChange(ev) { if (ev.target.dataset && 'enrollAgree' in ev.target.dataset) { agree = ev.target.checked; return true; } return false; }
const studentOf = (d, i) => ({ familyName: d[sk('familyName', i)].trim(), givenName: d[sk('givenName', i)].trim(), familyKana: d[sk('familyKana', i)].trim(), givenKana: d[sk('givenKana', i)].trim(), grade: d[sk('grade', i)].trim(), school: d[sk('school', i)].trim() });
// 送信: 入力 → 確認（サーバーへは送らない）、確認 → 申込み（契約更新の手続きは兄弟をまとめて 1 回）
export function enrollSubmit(ctx, kind) {
  const list = batch();
  if (kind === 'enroll-input') {
    if (!check(list)) { ctx.say('入っていない項目か、確かめていただきたい項目があります（赤い枠）', 'error'); ctx.render(); const el = document.querySelector('[aria-invalid="true"]'); if (el) el.focus(); return true; }
    step = 'confirm'; agree = false; ctx.say(''); ctx.render(); scrollTo(0, 0); return true;
  }
  if (kind !== 'enroll-apply') return false;
  if (!list.length) return true;
  if (unopened(list).length) { ctx.say(`${unopened(list).join('と')}の全文を開いて確かめてください`, 'error'); ctx.render(); return true; }
  if (!agree) { ctx.say('共通規約と個別受講条件書を確かめて「同意します」に印を付けてください', 'error'); ctx.render(); return true; }
  const d = draft, guardian = { guardianFamilyName: d.guardianFamilyName.trim(), guardianGivenName: d.guardianGivenName.trim(), guardianFamilyKana: d.guardianFamilyKana.trim(), guardianGivenKana: d.guardianGivenKana.trim(), phone: d.phone.trim(), zip: d.zip.trim(), address: d.address.trim() };
  ctx.run(async () => {
    const r = isRenewal(list[0])
      ? await ctx.call('family/enrollment/apply-all', { termsVersion: data.terms.version, agree: true, ...guardian, items: list.map((o, i) => ({ offerId: o.id, conditionId: o.conditionId, student: studentOf(d, i) })) })
      : await ctx.call('family/enrollment/apply', { offerId: list[0].id, conditionId: list[0].conditionId, termsVersion: data.terms.version, agree: true, ...guardian, student: studentOf(d, 0) });
    if (!r.ok) { if (['staleVersion', 'staleCondition', 'closed'].includes(r.error.code)) { data = null; draft = null; step = 'input'; } return ctx.failed(r); }
    doneIds = list.map(o => o.id); step = 'done'; data = null; ctx.applied(guardian.guardianFamilyName + ' ' + guardian.guardianGivenName); ctx.say(''); scrollTo(0, 0);
  });
  return true;
}
function openCondDoc(ctx, offerId) {
  const list = batch(), i = list.findIndex(o => o.id === offerId); if (i < 0) return;
  const win = window.open('', '_blank');
  if (!win) { ctx.say('書面のタブを開けませんでした。ポップアップを許可して、もう一度お試しください。', 'error'); ctx.render(); return; }
  win.opener = null; win.document.title = '個別受講条件書'; win.document.body.textContent = '書面を読み込んでいます…';
  const d = draft;
  ctx.call('family/enrollment/document', { offerId, guardianFamilyName: d.guardianFamilyName, guardianGivenName: d.guardianGivenName, familyName: d[sk('familyName', i)], givenName: d[sk('givenName', i)], grade: d[sk('grade', i)] }).then(r => {
    if (!r.ok) throw new Error(r.error.message);
    if (win.closed) return;
    const url = URL.createObjectURL(new Blob([r.html], { type: 'text/html' })); win.location.replace(url); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }).catch(e => { if (!win.closed) win.close(); ctx.say(e.message || '通信できませんでした。もう一度お試しください。', 'error'); ctx.render(); });
}
export function enrollClick(ctx, a, b) {
  // 全文を開いたしるし。個別受講条件書は入れた氏名を宛名にして作る。共通規約は公開している全文
  if (a === 'enroll-cond') { opened.add('cond:' + b.dataset.id); openCondDoc(ctx, b.dataset.id); if (step === 'confirm') ctx.render(); return true; }
  if (a === 'enroll-terms') { opened.add('terms'); window.open(b.href, '_blank', 'noopener'); if (step === 'confirm') ctx.render(); return true; }
  if (a === 'enroll-next') { draft = null; doneIds = []; step = 'input'; ctx.say(''); ctx.render(); scrollTo(0, 0); return true; }
  if (a !== 'enroll-back') return false;
  step = 'input'; ctx.say(''); ctx.render(); return true;
}
