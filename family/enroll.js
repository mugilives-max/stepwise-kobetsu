// 保護者の「入塾のお申込み」（#enroll。2026-10-18 本人決定。cf/v2/enrollment.mjs）。
// 1 つの画面で: 保護者さまの情報 → 生徒さんの情報の確認 → 受講条件書・受講規約 → 確認 → 「同意して入塾を申し込む」。
// 入力 → 確認 → 完了 の 3 画面（一般的な申込みの形）。同意者名は入れた保護者の氏名。申し込むとそのまま入塾。
import { gradeOptions, normGrade } from '/assets/v2/grade-options.js?v=20261019-grade';
let data = null, step = 'input', draft = null, agree = false, missing = [];
export function resetEnroll() { data = null; step = 'input'; draft = null; agree = false; missing = []; }
const jaMonth = m => m ? Number(m.slice(0, 4)) + '年' + Number(m.slice(5, 7)) + '月' : '';
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const MODE = { in_person: '教室', online: 'オンライン', both: '教室とオンライン' };
const KANA = /^[ぁ-ゖァ-ヺー・\s　]+$/;

export function needEnroll(ctx) {
  if (!data) { data = { loading: true }; ctx.call('family/enrollment', {}).then(r => { data = r.ok ? r : { offers: [], error: r.error.message }; ctx.render(); }); }
  return data.loading;
}
const open = () => (data && data.offers || []).filter(o => o.status === 'offered');
// 申込みでまとめて同意するもの（その間は、規約・受講条件書の別々の同意を出さない）
export function enrollCovers(ctx) {
  if (needEnroll(ctx)) return { terms: false, students: new Set() };
  const o = open(); return { terms: o.length > 0, students: new Set(o.map(x => x.studentId)) };
}
// ホームの「やること」の先頭に出す
export function enrollTodo(ctx) {
  if (needEnroll(ctx)) return null;
  const o = open(); if (!o.length) return null;
  return ['#enroll', 'file', '#c0392b', '入塾のお申込み', o.map(x => x.student.givenName + 'さん').join('・') + '・保護者さまの情報と受講規約・受講条件書をご確認ください', o.length];
}

function initDraft(o) {
  const g = data.guardian || {}, s = o.student;
  draft = { offerId: o.id, guardianFamilyName: g.familyName || '', guardianGivenName: g.givenName || '', guardianFamilyKana: g.familyKana || '', guardianGivenKana: g.givenKana || '', phone: g.phone || '', zip: g.zip || '', address: g.address || '',
    familyName: s.familyName || '', givenName: s.givenName || '', familyKana: s.familyKana || '', givenKana: s.givenKana || '', grade: normGrade(s.grade), school: s.school || '' };
}
const FIELDS = [['guardianFamilyName', '保護者さまの姓'], ['guardianGivenName', '保護者さまの名'], ['guardianFamilyKana', '保護者さまの姓のふりがな'], ['guardianGivenKana', '保護者さまの名のふりがな'], ['phone', '電話番号'], ['zip', '郵便番号'], ['address', '住所'],
  ['familyName', '生徒さんの姓'], ['givenName', '生徒さんの名'], ['familyKana', '生徒さんの姓のふりがな'], ['givenKana', '生徒さんの名のふりがな'], ['grade', '学年'], ['school', '学校']];
function check() {
  missing = FIELDS.filter(([k]) => !String(draft[k] || '').trim()).map(([k]) => k);
  for (const k of ['guardianFamilyKana', 'guardianGivenKana']) if (draft[k] && !KANA.test(draft[k])) missing.push(k);
  if ((draft.familyKana && !KANA.test(draft.familyKana)) || (draft.givenKana && !KANA.test(draft.givenKana))) missing.push('familyKana');
  if (draft.phone && (draft.phone.replace(/\D/g, '').length < 10 || draft.phone.replace(/\D/g, '').length > 11)) missing.push('phone');
  if (draft.zip && !/^\d{3}-?\d{4}$/.test(draft.zip.trim())) missing.push('zip');
  return !missing.length;
}

function steps(i) {
  return '<ol class="steps s3" aria-label="お申込みの進み具合">' + ['アカウント', 'お申込み', '入塾'].map((t, k) => `<li class="${k < i ? 'done' : k === i ? 'now' : ''}"${k === i ? ' aria-current="step"' : ''}><span class="n">${k < i ? '✓' : k + 1}</span><span class="t">${t}</span></li>`).join('') + '</ol>';
}
function condRows(esc, o) {
  const c = o.condition || {};
  const row = (k, v) => v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '';
  return `<dl class="reg-rows">${row('開始', jaMonth(o.fromMonth) + 'から')}${row('基本の授業', `1回${c.minutes}分 ${yen(c.fee)}（税込）`)}${row('形式', MODE[c.deliveryMode] || '')}${row('科目', c.subjects || '')}${row('特記事項', c.note || '')}</dl>`;
}
function field(esc, key, label, opts = {}) {
  const bad = missing.includes(key);
  return `<label style="flex:1 1 140px;min-width:0"><span>${label}${opts.req === false ? ' <span class="opt">任意</span>' : ''}</span><input name="${key}" data-enroll="${key}" value="${esc(draft[key] || '')}" ${opts.type ? `type="${opts.type}"` : ''} ${opts.mode ? `inputmode="${opts.mode}"` : ''} ${opts.auto ? `autocomplete="${opts.auto}"` : ''} placeholder="${esc(opts.ph || '')}" maxlength="${opts.max || 60}"${bad ? ' aria-invalid="true"' : ''}></label>`;
}
// 受講条件書と受講規約（入力と確認の両方の画面に出す。同意の前に、いつでも全文を開ける）
function docCards(esc, o) {
  return `<section class="reg-card"><div class="reg-card-head"><h2>受講条件書</h2></div><p class="reg-help" style="margin-top:2px">授業の時間と、1回の授業料の上限（基準単価）です。毎月の回数と料金は、別に受講合意書でご確認いただきます。</p>${condRows(esc, o)}
      ${o.condition && o.condition.docFileId ? `<div class="row" style="margin-top:6px"><button type="button" class="small-btn" data-action="gr-open" data-id="${esc(o.condition.docFileId)}">受講条件書の全文を開く</button></div>` : ''}</section>
    <section class="reg-card"><div class="reg-card-head"><h2>受講規約</h2></div><p class="reg-help" style="margin-top:2px">授業・お休み・キャンセル・お支払いなどの決まりです。</p>
      <p style="margin:6px 0 0">${esc(data.terms.title || '受講規約')}</p>
      ${data.terms.url ? `<div class="row" style="margin-top:6px"><a class="small-btn" href="${esc(data.terms.url)}" target="_blank" rel="noopener">受講規約の全文を開く</a></div>` : ''}</section>`;
}
function inputPage(ctx, o) {
  const { esc } = ctx, bad = () => '';
  return `${steps(1)}<p>${esc(o.student.name)}さんの入塾のお手続きです。保護者さまの情報を入れ、受講条件書と受講規約をご確認ください。</p>${ctx.noticeHtml()}
  <form class="reg-form" data-form="enroll-input" novalidate>
    <fieldset class="reg-field"><legend>保護者さまの情報 <span class="req">必須</span></legend>
      <p class="reg-help">受講のご契約者（保護者さま）の情報です。教室からのご連絡と、書類の宛名に使います。</p>
      <div class="row">${field(esc, 'guardianFamilyName', '姓', { ph: '例：高橋', auto: 'family-name', max: 30 })}${field(esc, 'guardianGivenName', '名', { ph: '例：花子', auto: 'given-name', max: 30 })}</div>
      <div class="row">${field(esc, 'guardianFamilyKana', 'ふりがな（姓）', { ph: '例：たかはし', max: 30 })}${field(esc, 'guardianGivenKana', 'ふりがな（名）', { ph: '例：はなこ', max: 30 })}</div>
      ${field(esc, 'phone', '電話番号', { type: 'tel', mode: 'tel', auto: 'tel', ph: '例：090-1234-5678', max: 20 })}
      ${field(esc, 'zip', '郵便番号', { mode: 'numeric', auto: 'postal-code', ph: '例：343-0002', max: 8 })}${field(esc, 'address', '住所', { auto: 'street-address', ph: '例：越谷市袋山1-2-3', max: 200 })}
      <p class="reg-help">メールアドレス：${esc((data.guardian || {}).email || '')}（保護者ページのログインに使います）</p></fieldset>
    <fieldset class="reg-field${bad(['familyName', 'givenName', 'familyKana', 'givenKana', 'grade'])}"><legend>生徒さんの情報 <span class="req">必須</span></legend>
      <p class="reg-help">体験のときに伺った内容です。違うところがあれば直してください。</p>
      <div class="row">${field(esc, 'familyName', '姓', { max: 40 })}${field(esc, 'givenName', '名', { max: 40 })}</div>
      <div class="row">${field(esc, 'familyKana', 'ふりがな（姓）', { max: 40 })}${field(esc, 'givenKana', 'ふりがな（名）', { max: 40 })}</div>
      <div class="row"><label style="flex:1 1 140px;min-width:0"><span>学年</span><select name="grade" data-enroll="grade"${missing.includes('grade') ? ' aria-invalid="true"' : ''}>${gradeOptions(esc, draft.grade)}</select></label>${field(esc, 'school', '学校', { ph: '例：〇〇中学校' })}</div></fieldset>
    ${docCards(esc, o)}
    <div class="row"><button class="primary">入力内容を確認する</button></div></form>`;
}
function confirmPage(ctx, o) {
  const { esc } = ctx, d = draft;
  const row = (k, v) => v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '';
  const zip = d.zip.trim().replace(/^(\d{3})(\d{4})$/, '$1-$2');
  return `${steps(1)}<h1>入力内容の確認</h1><p>内容に間違いがなければ、受講規約と受講条件書に同意のうえ「同意して入塾を申し込む」を押してください。</p>${ctx.noticeHtml()}
    <section class="reg-card"><div class="reg-card-head"><h2>保護者さまの情報</h2></div><dl class="reg-rows">${row('氏名', d.guardianFamilyName + ' ' + d.guardianGivenName)}${row('ふりがな', d.guardianFamilyKana + ' ' + d.guardianGivenKana)}${row('電話番号', d.phone)}${row('住所', '〒' + zip + ' ' + d.address)}</dl></section>
    <section class="reg-card"><div class="reg-card-head"><h2>生徒さんの情報</h2></div><dl class="reg-rows">${row('氏名', d.familyName + ' ' + d.givenName)}${row('ふりがな', d.familyKana + ' ' + d.givenKana)}${row('学年', d.grade)}${row('学校', d.school)}</dl></section>
    ${docCards(esc, o)}
    <form class="reg-form" data-form="enroll-apply" novalidate>
      <label class="choice"><input type="checkbox" name="agree" data-enroll-agree${agree ? ' checked' : ''}><span>受講規約と受講条件書の内容を確認し、同意します<small>同意する方：${esc(d.guardianFamilyName + ' ' + d.guardianGivenName)}（保護者）</small></span></label>
      <div class="row"><button class="primary"${ctx.dis()}>同意して入塾を申し込む</button></div>
      <p class="small"><a href="javascript:void 0" data-action="enroll-back">入力画面に戻って直す</a></p></form>`;
}
function donePage(ctx, o) {
  const { esc } = ctx;
  return `${steps(3)}<h1>お申込みを受け付けました</h1><p class="notice ok">${esc(o.student.givenName)}さんの入塾のお申込みが完了しました。ありがとうございます。</p>
    <section class="flow"><h2>このあとの流れ</h2><ol>
      <li class="done"><div class="ft">入塾のお申込み</div><div class="fb">受講規約と受講条件書への同意も受け付けました。控えは「お支払い」の「過去の契約・同意の控え」から開けます。</div></li>
      <li class="now"><div class="ft">${esc(jaMonth(o.fromMonth))}の受講合意書</div><div class="fb">教室から、授業の科目・回数・料金をお知らせします。届いたら保護者ページで承認してください。</div></li>
      <li><div class="ft">授業の日程</div><div class="fb">日程の確認のお願いが届きます。都合の悪い日だけお知らせください。</div></li></ol></section>
    <p><a class="small-btn primary" href="#home">ホームへ</a></p>`;
}
export function enrollPage(ctx) {
  if (needEnroll(ctx)) return '<p class="muted" style="margin-top:20px">読み込んでいます…</p>';
  if (data.error) return `<p class="notice error">${ctx.esc(data.error)}</p>`;
  const o = open()[0];
  if (step === 'done' && draft) { const applied = data.offers.find(x => x.id === draft.offerId); if (applied) return donePage(ctx, applied); }
  if (!o) return `<h1>入塾のお申込み</h1><p class="muted">今、お申込みをお願いしているものはありません。</p><p><a href="#home">ホームへ</a></p>`;
  if (!draft || draft.offerId !== o.id) { initDraft(o); step = 'input'; agree = false; missing = []; }
  return step === 'confirm' ? confirmPage(ctx, o) : inputPage(ctx, o);
}
export function enrollInput(ev) {
  const k = ev.target.dataset && ev.target.dataset.enroll; if (k && draft) { draft[k] = ev.target.value; return true; }
  return false;
}
export function enrollChange(ev) { if (ev.target.dataset && 'enrollAgree' in ev.target.dataset) { agree = ev.target.checked; return true; } return false; }
// 送信: 入力 → 確認（サーバーへは送らない）、確認 → 申込み
export function enrollSubmit(ctx, kind) {
  if (kind === 'enroll-input') {
    if (!check()) { ctx.say('入っていない項目か、確かめていただきたい項目があります（赤い枠）', 'error'); ctx.render(); const el = document.querySelector('[aria-invalid="true"]'); if (el) el.focus(); return true; }
    step = 'confirm'; agree = false; ctx.say(''); ctx.render(); scrollTo(0, 0); return true;
  }
  if (kind !== 'enroll-apply') return false;
  if (!agree) { ctx.say('受講規約と受講条件書を確かめて「同意します」に印を付けてください', 'error'); ctx.render(); return true; }
  const o = open()[0]; if (!o) return true;
  const d = draft;
  ctx.run(async () => {
    const r = await ctx.call('family/enrollment/apply', { offerId: o.id, conditionId: o.conditionId, termsVersion: data.terms.version, agree: true,
      guardianFamilyName: d.guardianFamilyName.trim(), guardianGivenName: d.guardianGivenName.trim(), guardianFamilyKana: d.guardianFamilyKana.trim(), guardianGivenKana: d.guardianGivenKana.trim(), phone: d.phone.trim(), zip: d.zip.trim(), address: d.address.trim(),
      student: { familyName: d.familyName.trim(), givenName: d.givenName.trim(), familyKana: d.familyKana.trim(), givenKana: d.givenKana.trim(), grade: d.grade.trim(), school: d.school.trim() } });
    if (!r.ok) { if (['staleVersion', 'staleCondition', 'closed'].includes(r.error.code)) { data = null; step = 'input'; } return ctx.failed(r); }
    step = 'done'; data = null; ctx.applied(d.guardianFamilyName.trim() + ' ' + d.guardianGivenName.trim()); ctx.say(''); scrollTo(0, 0);
  });
  return true;
}
export function enrollClick(ctx, a) {
  if (a !== 'enroll-back') return false;
  step = 'input'; ctx.say(''); ctx.render(); return true;
}
