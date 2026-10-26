// スタッフの画面: 設定の下の「ご利用規約」（#terms）と「送信の記録」（#effects）。教室管理者だけ。
// ご利用規約: 今の版（版・名前・全文のリンク・適用日・説明）を決める。家族ごとの同意の状態と記録。
// 送信の記録: 送れなかったメール・カレンダー（失敗・止まっているもの）を送り直す・取り下げる。最近送ったものも見える。
import { sheet, ICON } from '/staff/ui.js?v=20261025-layout';

let termsStep = '', termsFams = null, termsSite = null, termsPick = []; // ご利用規約: '' | 'decide'（使う規約を決める確認）| 'request'（同意をお願いする確認）。termsPick: お願いする家族
let terms = null, effects = null, effOpen = 0, backups = null;
export function resetExtras() { termsStep = ''; termsPick = []; termsFams = null; termsSite = null; terms = null; effects = null; effOpen = 0; backups = null; }
export function leaveExtras() { effOpen = 0; termsStep = ''; }
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;
const jst = t => t ? new Date(Date.parse(t) + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/') : '';

// ---- 書類のひな形（#docs）----
// 書類の一覧: 種類ごとにまとめ、名前だけ。行を押すと見本（架空の家族（見本家）で作った書面）が新しいタブに開く
const DOC_GROUPS = [
  ['契約の書類', '#2f6fde', [
    ['terms', 'ご利用規約'],
    ['condition', '受講条件書'],
    ['special', '特別単価合意書'],
    ['agreement', '受講合意書'],
  ]],
  ['講師の書類', '#7a5bd6', [
    ['employment', '雇用契約書'],
    ['payslip', '給与明細'],
    ['rules', '講師マニュアル'],
  ]],
  ['お金の書類', '#2e9b5f', [
    ['invoice', '請求書'],
    ['receipt', '領収書'],
  ]],
];
export function docsPage(ctx) {
  const { esc } = ctx;
  if (!terms) { terms = { loading: true }; ctx.call('admin/terms/get').then(r => { terms = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  const t = terms && terms.terms;
  const icon = color => `<span class="ibox" style="background:${color}">${svg('file')}</span>`;
  const row = (color, type, title) => {
    const body = `${icon(color)}<span class="v"><span class="lbl">${esc(title)}</span></span>`;
    if (type === 'terms') return t && t.url
      ? `<a class="todo-row doc-row" href="${esc(t.url)}" target="_blank" rel="noopener">${body}<span class="go">全文 ›</span></a>`
      : `<a class="todo-row doc-row" href="#terms">${body}<span class="go">版を決める ›</span></a>`;
    return `<button type="button" class="todo-row doc-row" data-action="doc-sample" data-type="${type}">${body}<span class="go">見本 ›</span></button>`;
  };
  let h = ctx.notice();
  for (const [name, color, docs] of DOC_GROUPS) h += `<div class="sec-title">${esc(name)}</div><div class="group">${docs.map(([type, title]) => row(color, type, title)).join('')}</div>`;
  return h;
}

// ---- ご利用規約 ----
// ご利用規約（設定 → ご利用規約）。2026-10-18 作り直し、2026-10-20 本人「決定するのと、同意をお願いするのが同時…気持ち悪い」→ 2 つに分けた:
// 1. 使う規約（サイトの正式版 terms/versions.json から「この規約に決める」→ 確認 → 決める）。決めただけでは今の家族に何も出ない
// 2. 保護者への同意のお願い（家族を選ぶ → 確認（一言・メール）→ お願いする）。家族ごとに 同意済み／お願い中／まだ。版の名前や URL を手で打たない
// 日付だけ（YYYY-MM-DD）はそのまま、日時（ISO）は日本の日付にする
const jaDay = v => { let d = String(v || ''); if (d.length > 10 && !Number.isNaN(Date.parse(d))) d = new Date(Date.parse(d) + 9 * 3600e3).toISOString(); return /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : ''; };
const kv = (esc, rows) => '<dl class="reg-rows">' + rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('') + '</dl>';
export function termsPage(ctx) {
  const { esc } = ctx;
  if (!terms) {
    terms = { loading: true };
    Promise.all([ctx.call('admin/terms/get'), ctx.call('admin/families/list'), fetch('/terms/versions.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)]).then(([r, fl, site]) => {
      terms = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r);
      termsFams = fl.ok ? fl.families.filter(f => !f.testOnly && f.status !== 'stopped') : null; termsSite = site; ctx.render();
    });
  }
  let h = ctx.notice();
  if (terms.loading) return h + '<p class="muted" style="margin-top:20px">読み込んでいます…</p>';
  if (terms.error) return h + `<p class="notice error">${esc(terms.error)}</p>`;
  const t = terms.terms, latest = termsSite?.versions?.[0];
  const open = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
  const asked = id => terms.requests.find(r => r.familyId === id);
  const state = fm => fm.termsVersion === t.version ? 'agreed' : asked(fm.id) ? 'asked' : 'not';
  // 規約を決める確認（別の画面）
  if (termsStep === 'decide' && latest) {
    const first = !t.version;
    return h + `<section class="reg-card" style="margin-top:12px"><div class="reg-card-head"><h2>${esc(latest.title)}</h2></div>${kv(esc, [['適用日', esc(jaDay(latest.from))], ['全文', open(latest.url, '全文を読む') + (latest.pdf ? '・' + open(latest.pdf, 'PDF') : '')]])}</section>
      <section class="reg-card"><div class="reg-card-head"><h2>${first ? '使い始める' : '切り替える'}とどうなるか</h2></div><ul style="margin:8px 0 0;padding-left:1.2em;line-height:1.8">
        <li>これから作る受講条件書・特別単価合意書は、この規約によります。</li>
        <li>新しく入塾する家族は、申込みのときにこの規約に同意します。</li>
        <li>今通っている家族には、まだ何も出ません。</li>
        <li>内容を変えるときは、新しい版を作って切り替えます。同意済みの家族には、新しい版にあらためて同意をお願いします（同意するまでは、前の版のままです）。</li></ul></section>
      <form class="reg-form" data-form="terms-decide">
        <div class="stack"><button class="primary wide"${ctx.dis()}>${first ? 'この版を使い始める' : 'この版に切り替える'}</button><button type="button" class="wide" data-action="terms-back"${ctx.dis()}>やめて戻る</button></div></form>`;
  }
  // 同意をお願いする確認（別の画面）
  if (termsStep === 'request' && t.version && termsFams) {
    const picked = termsFams.filter(fm => termsPick.includes(fm.id) && state(fm) === 'not');
    if (!picked.length) { termsStep = ''; return termsPage(ctx); }
    const noPage = picked.filter(fm => !fm.hasPassword);
    return h + `<p style="margin-top:12px">次の${picked.length}家族に、「${esc(t.title || t.version)}」への同意をお願いします。</p>
      <div class="group">${picked.map(fm => `<div class="evrow" style="grid-template-columns:minmax(0,1fr) auto"><span class="b"><span class="nm">${esc(fm.name)}</span>${fm.hasPassword ? '' : '<small>保護者ページに未登録</small>'}</span></div>`).join('')}</div>
      <section class="reg-card"><div class="reg-card-head"><h2>お願いするとどうなるか</h2></div><ul style="margin:8px 0 0;padding-left:1.2em;line-height:1.8">
        <li>選んだ家族の保護者ページに、規約の全文と「同意する」が出ます。</li>
        <li>同意するまで、その家族は次の受講合意書を承認できません（見送りはできます）。</li>
        ${noPage.length ? `<li>保護者ページに登録していない家族（${noPage.map(fm => esc(fm.name)).join('・')}）は、お願いを見られません。</li>` : ''}</ul></section>
      <form class="reg-form" data-form="terms-request">
        <fieldset class="reg-field"><legend>保護者への一言 <span class="opt">任意</span></legend><textarea name="note" rows="3" maxlength="500" placeholder="例：11月からの受講のきまりをまとめました。全文をお読みいただき、同意をお願いします。"></textarea></fieldset>
        <label class="choice"><input type="checkbox" name="mail" checked><span>メールでも知らせる（保護者ページに登録している家族だけ）</span></label>
        <div class="stack"><button class="primary wide"${ctx.dis()}>同意をお願いする</button><button type="button" class="wide" data-action="terms-back"${ctx.dis()}>やめて戻る</button></div></form>`;
  }
  // 1. 今の版
  if (t.version) {
    const reg = terms.catalogue.find(x => x.version === t.version);
    h += `<section class="reg-card" style="margin-top:12px"><div class="reg-card-head"><h2>今の版</h2><span class="tag ok">全員共通</span></div>
      ${kv(esc, [['規約', esc(t.title || t.version) + (t.url ? '<br>' + open(t.url, '全文を読む') : '')], ['適用日', esc(jaDay(t.from) || '—')], ...(reg && reg.registeredAt ? [['使い始めた日', esc(jaDay(reg.registeredAt))]] : [])])}</section>`;
  } else {
    h += `<section class="reg-card" style="margin-top:12px"><div class="reg-card-head"><h2>まだ使い始めていません</h2></div>
      <p class="reg-help" style="margin:6px 0 0">使い始めるまで入塾の案内を送れません。</p></section>`;
  }
  if (latest && latest.version !== t.version) {
    h += `<div class="sec-title">${t.version ? '新しい版があります' : '使い始められる版'}</div>
      <section class="reg-card" style="margin-top:0"><div class="reg-card-head"><h2>${esc(latest.title)}</h2></div>
      ${kv(esc, [['適用日', esc(jaDay(latest.from))], ['全文', open(latest.url, '全文を読む') + (latest.pdf ? '・' + open(latest.pdf, 'PDF') : '')]])}
      <button class="primary wide" style="margin-top:10px" data-action="terms-decide-start"${ctx.dis()}>${t.version ? 'この版に切り替える' : 'この版を使い始める'}</button></section>`;
  } else if (!latest) h += '<p class="small muted">サイトの規約の一覧を読み込めませんでした。画面を読み直してください。</p>';
  // 2. 保護者への同意のお願い
  if (t.version && termsFams) {
    const n = { agreed: 0, asked: 0, not: 0 }; termsFams.forEach(fm => n[state(fm)]++);
    h += `<div class="sec-title">この版への同意（家族ごと）</div>
      <p class="small muted" style="margin:0 2px 8px">同意済み ${n.agreed}・お願い中 ${n.asked}・まだお願いしていない ${n.not}（${termsFams.length}家族）</p>`;
    if (!termsFams.length) h += '<p class="small muted">家族がまだいません。</p>';
    else {
      const rowOf = fm => {
        const s = state(fm), r = asked(fm.id);
        const sub = s === 'agreed' ? esc(jaDay(fm.termsAcceptedAt)) : s === 'asked' ? `${esc(jaDay(r.requestedAt))}${r.mailed ? '・メールも送信' : ''}` : fm.hasPassword ? '' : '保護者ページに未登録';
        return s === 'not'
          ? `<label class="todo-row" style="grid-template-columns:auto minmax(0,1fr);cursor:pointer"><input type="checkbox" name="fam" value="${esc(fm.id)}"${termsPick.includes(fm.id) ? ' checked' : ''}><span class="v"><span class="lbl">${esc(fm.name)}</span>${sub ? `<small>${sub}</small>` : ''}</span></label>`
          : `<a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="#family=${esc(fm.id)}"><span class="v"><span class="lbl">${esc(fm.name)}</span><small>${s === 'agreed' ? '<span class="tag ok">同意済み</span> ' : '<span class="tag warn">お願い中</span> '}${sub}</small></span><span class="go" aria-hidden="true">›</span></a>`;
      };
      const order = { not: 0, asked: 1, agreed: 2 }, list = termsFams.slice().sort((a, b) => order[state(a)] - order[state(b)]);
      h += `<form data-form="terms-pick"><div class="group">${list.map(rowOf).join('')}</div>`;
      if (n.not) h += `<div class="stack" style="margin-top:10px"><button type="button" class="wide" data-action="terms-pick-all"${ctx.dis()}>まだの家族をすべて選ぶ</button><button class="primary wide"${ctx.dis()}>選んだ家族に同意をお願いする</button></div>`;
      h += '</form>';
    }
  }
  // 3. めったに使わないもの
  h += `<div class="group" style="margin-top:20px"><a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="https://www.stepwise-education.jp/terms/" target="_blank" rel="noopener"><span class="v"><span class="lbl">サイトのご利用規約</span></span><span class="go" aria-hidden="true">›</span></a></div>`;
  if (terms.history.length) h += `<details style="margin-top:12px"><summary>同意の記録（新しい${terms.history.length}件）</summary><div class="group">` + terms.history.map(x => `<div class="evrow"><span class="t"><small>${esc(jaDay(x.acceptedAt))}</small></span><span class="b"><span class="nm">${esc(x.familyName)}</span><small>${esc(x.version)}・${esc(x.via)}・同意者：${esc(x.consenterName || '記録なし')}${x.actorKind === 'staff' ? `（${esc(x.recordedByName || '教室')}が記録）` : ''}${x.note ? '・' + esc(x.note) : ''}</small></span><span></span></div>`).join('') + '</div></details>';
  const openReq = termsFams ? termsFams.filter(fm => state(fm) === 'asked') : [];
  if (openReq.length) h += `<details style="margin-top:12px"><summary>同意のお願いを取り下げる</summary><p class="small muted">お願いした記録は残ります。</p><div class="group">${openReq.map(fm => `<div class="evrow" style="grid-template-columns:minmax(0,1fr) auto"><span class="b"><span class="nm">${esc(fm.name)}</span></span><button type="button" class="small-btn" data-action="terms-withdraw" data-id="${esc(fm.id)}"${ctx.dis()}>取り下げる</button></div>`).join('')}</div></details>`;
  return h;
}

// ---- 送信の記録 ----
export function effectsPage(ctx) {
  const { esc } = ctx;
  if (!effects) { effects = { loading: true }; ctx.call('admin/effects/list').then(r => { effects = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  let h = ctx.notice();
  if (effects.loading) return h + '<p class="muted" style="margin-top:20px">読み込んでいます…</p>';
  if (effects.error) return h + `<p class="notice error">${esc(effects.error)}</p>`;
  const row = x => `<button type="button" class="irow" data-action="eff-open" data-id="${x.id}"><span class="b"><b>${esc(x.subject || x.label)}</b><small>${esc(x.label)}${x.to ? '・' + esc(x.to) : ''}・${jst(x.createdAt)}${['unknown','sending'].includes(x.deliveryState) ? '・<span class="tag warn">送信結果の確認が必要</span>' : x.status === 'failed' ? `・<span class="tag danger">送れなかった</span>` : x.status === 'pending' ? '・<span class="tag warn">止まっている</span>' : ''}</small></span><span class="go">›</span></button>`;
  h += `<div class="sec-title">送れなかったもの${effects.failed.length ? ` <span class="count">${effects.failed.length}</span>` : ''}${effects.failed.length ? `<button class="small-btn primary" style="margin-left:auto" data-action="eff-retry-all"${ctx.dis()}>全部送り直す</button>` : ''}</div>`;
  h += effects.failed.length ? '<div class="group">' + effects.failed.map(row).join('') + '</div>' : '<p class="muted small">ありません。</p>';
  h += '<div class="sec-title">最近送ったもの</div>' + (effects.recent.length ? '<div class="group">' + effects.recent.map(row).join('') + '</div>' : '<p class="muted small">直近 30 日に送ったものはありません。</p>');
  if (effects.dismissed) h += `<p class="small muted">送らなかったもの ${effects.dismissed}件（切り替え前・テスト用・取り下げ）</p>`;
  h += `<p><button class="small-btn" data-action="eff-test"${ctx.dis()}>テスト送信（代表あてに 1 通）</button></p>`;
  h += backupHtml(ctx);
  const x = effOpen && [...effects.failed, ...effects.recent].find(e => e.id === effOpen);
  if (x) h += sheet(esc, x.subject || x.label, `<p class="small muted" style="margin-top:0">${esc(x.label)}${x.to ? '・' + esc(x.to) : ''}<br>作成 ${jst(x.createdAt)}${x.sentAt ? '・送信 ' + jst(x.sentAt) : ''}・試行 ${x.attempts}回</p>
    ${x.error ? `<p class="notice error small">${esc(x.error)}</p>` : ''}
    ${x.scheduleNotice && x.status !== 'sent' ? '<p class="notice">日程の自動確定を保留しています。<a href="#schedule">予定</a>から対象授業の「再案内・回答期間を確認」を開いてください。</p>' : !x.canRetry && x.status !== 'sent' ? '<p class="notice">送信先の受信状況を確認し、根拠を記録してください。自動再送は停止しています。</p><button data-action="eff-resolve-sent">送れたと確認</button><button data-action="eff-resolve-notSent">未送信と確認</button>' : x.status === 'sent' ? '' : `<div class="row"><button class="primary" data-action="eff-retry" data-id="${x.id}"${ctx.dis()}>送り直す</button><button data-action="eff-dismiss" data-id="${x.id}"${ctx.dis()}>取り下げる（送らない）</button></div>`}`, 'eff-close');
  return h;
}

// ---- 台帳の控え（毎日 0:10 に全表を R2 へ。90 日分。30 日の巻き戻しとは別） ----
function backupHtml(ctx) {
  const { esc } = ctx;
  if (!backups) { backups = { loading: true }; ctx.call('admin/backup/list').then(r => { backups = r.ok ? r : { error: r.error.message }; ctx.render(); }); }
  let h = '<div class="sec-title">台帳の控え</div>';
  if (backups.loading) return h + '<p class="muted small">読み込んでいます…</p>';
  if (backups.error) return h + `<p class="notice error small">${esc(backups.error)}</p>`;
  const l = backups.latest;
  h += '<div class="group"><div class="irow" style="cursor:default"><span class="b"><b>' + (l ? `最新 ${esc(l.date)}${backups.stale ? ' <span class="tag danger">古い</span>' : ''}` : '<span class="tag danger">まだありません</span>') + `</b><small>${l ? `${l.rows}行・${Math.round(l.size / 1024)}KB・` : ''}${backups.count}日分（${backups.keepDays}日まで残す）</small></span><button class="small-btn" data-action="bk-run"${ctx.dis()}>今すぐ取る</button></div></div>`;
  return h;
}

// ---- 操作 ----
export async function extrasSubmit(ctx, kind, el) {
  if (!['terms-decide', 'terms-pick', 'terms-request'].includes(kind)) return false;
  const fd = new FormData(el), v = Object.fromEntries(fd.entries());
  if (kind === 'terms-pick') {
    termsPick = fd.getAll('fam').map(String);
    if (!termsPick.length) { ctx.say('同意をお願いする家族を選んでください', 'error'); return true; }
    termsStep = 'request'; ctx.say(''); scrollTo(0, 0); return true;
  }
  if (kind === 'terms-request') {
    const r = await ctx.call('admin/terms/request', { familyIds: termsPick, note: String(v.note || '').trim(), mail: !!v.mail });
    if (r.ok) { terms = null; termsStep = ''; termsPick = []; scrollTo(0, 0); ctx.say(`${r.requested}家族に同意をお願いしました${r.mailed ? `（メール ${r.mailed}通）` : ''}`, 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  const latest = termsSite?.versions?.[0];
  if (!latest) { ctx.say('サイトの規約の一覧を読み込めませんでした。画面を読み直してください', 'error'); return true; }
  const r = await ctx.call('admin/terms/set', { version: latest.version, title: latest.title, url: latest.url, from: latest.from, note: '' });
  if (r.ok) { terms = null; termsStep = ''; scrollTo(0, 0); ctx.say('この版を使い始めました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}
export async function extrasClick(ctx, a, b) {
  let r;
  if (a === 'terms-decide-start') { termsStep = 'decide'; ctx.say(''); scrollTo(0, 0); return true; }
  if (a === 'terms-pick-all') { termsPick = [...b.closest('form').querySelectorAll('input[name="fam"]')].map(x => x.value); ctx.say(''); return true; }
  if (a === 'terms-withdraw') {
    if (!confirm('この家族への同意のお願いを取り下げますか？')) return true;
    r = await ctx.call('admin/terms/request/withdraw', { familyId: b.dataset.id });
    if (r.ok) { terms = null; ctx.say('同意のお願いを取り下げました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  if (a === 'terms-back') { termsStep = ''; ctx.say(''); return true; }
  if (a.startsWith('eff-resolve-')) {
    const note=prompt('受信状況を確認した方法・日時・結果を記録してください');
    if(!note)return true;
    r=await ctx.call('admin/effects/resolve',{id:effOpen,result:a.slice('eff-resolve-'.length),note});
    if(r.ok){effects=null;effOpen=0;ctx.say('確認結果を記録しました。日程の再案内は予定画面から行ってください','ok');}
    else ctx.say(r.error.message,'error');
    return true;
  }
  if (a === 'eff-open') { effOpen = Number(b.dataset.id); ctx.say(''); return true; }
  if (a === 'eff-close') { effOpen = 0; return true; }
  if (a === 'eff-test') {
    r = await ctx.call('admin/effects/test');
    if (r.ok) { effects = null; ctx.say('代表あてに確認のメールを送りました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  if (a === 'bk-run') {
    r = await ctx.call('admin/backup/run');
    if (r.ok) { backups = null; ctx.say(`控えを取りました（${r.tables}表・${r.rows}行）`, 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
    return true;
  }
  if (a === 'eff-retry' || a === 'eff-retry-all') {
    const ids = a === 'eff-retry' ? [Number(b.dataset.id)] : effects.failed.filter(x=>x.canRetry).map(x => x.id);
    r = await ctx.call('admin/effects/retry', { ids });
    if (r.ok) { effects = null; effOpen = 0; ctx.say((r.failed||r.unknown) ? `${r.sent}件送信、${r.failed||0}件失敗、${r.unknown||0}件は結果不明です。${r.error}` : `${r.sent}件を送りました${r.dismissed ? '。変更・完了した対象は送信を取り下げました' : ''}`, (r.failed||r.unknown) ? 'error' : 'ok'); }
  } else if (a === 'eff-dismiss') {
    if (!confirm('この送信を取り下げますか？（送りません）')) return true;
    r = await ctx.call('admin/effects/dismiss', { ids: [Number(b.dataset.id)] });
    if (r.ok) { effects = null; effOpen = 0; ctx.say('取り下げました', 'ok'); }
  } else return false;
  if (r && !r.ok && !ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}
