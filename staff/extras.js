// スタッフの画面: 設定の下の「受講規約」（#terms）と「送信の記録」（#effects）。教室管理者だけ。
// 受講規約: 今の版（版・名前・全文のリンク・適用日・説明）を決める。家族ごとの同意の状態と記録。
// 送信の記録: 送れなかったメール・カレンダー（失敗・止まっているもの）を送り直す・取り下げる。最近送ったものも見える。
import { sheet, ICON } from '/staff/ui.js?v=20261008-launch1';

let termsStep = '', termsFams = null, termsSite = null; // 受講規約: '' | 'publish'（公開の確認）| 'stop'（やめる確認）
let terms = null, effects = null, effOpen = 0, backups = null;
export function resetExtras() { termsStep = ''; termsFams = null; termsSite = null; terms = null; effects = null; effOpen = 0; backups = null; }
export function leaveExtras() { effOpen = 0; termsStep = ''; }
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;
const jst = t => t ? new Date(Date.parse(t) + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/') : '';

// ---- 書類のひな形（#docs）----
// 台帳に残す書面の一覧。いつ作られ、誰がどこから開けるか。「見本を開く」で架空の家族（見本家）で描いた書面を新しいタブに出す。
// 書類の一覧: 種類ごとにまとめ、1 行の説明だけ。行を押すと見本（架空の家族で作った書面）が開く
const DOC_GROUPS = [
  ['契約の書類', '#2f6fde', [
    ['terms', '受講規約', '保護者が最初に同意する、塾全体のきまり'],
    ['condition', '受講条件書（通常指導）', '生徒ごとの授業時間と料金。保護者の同意で確定します'],
    ['special', '受講条件書（特殊指導）', '通常とは別の料金で行う指導の内容と料金'],
    ['agreement', '受講合意書', '月ごとの授業の回数と料金。保護者の承認で確定します'],
  ]],
  ['講師の書類', '#7a5bd6', [
    ['employment', '雇用契約書', '講師と結ぶ契約書。働く条件と給与のきまり'],
    ['payslip', '給与明細', '毎月の給与を確定すると作られます'],
  ]],
  ['お金の書類', '#2e9b5f', [
    ['invoice', '請求書', '月の請求を確定すると作られます'],
    ['receipt', '領収書', '入金を記録すると作られます'],
  ]],
];
export function docsPage(ctx) {
  const { esc } = ctx;
  if (!terms) { terms = { loading: true }; ctx.call('admin/terms/get').then(r => { terms = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  const t = terms && terms.terms;
  const icon = color => `<span class="ibox" style="background:${color}">${svg('file')}</span>`;
  const row = (color, type, title, note) => {
    const body = `${icon(color)}<span class="v"><span class="lbl">${esc(title)}</span><small>${esc(note)}</small></span>`;
    if (type === 'terms') return t && t.url
      ? `<a class="todo-row doc-row" href="${esc(t.url)}" target="_blank" rel="noopener">${body}<span class="go">全文 ›</span></a>`
      : `<a class="todo-row doc-row" href="#terms">${body}<span class="go">版を決める ›</span></a>`;
    return `<button type="button" class="todo-row doc-row" data-action="doc-sample" data-type="${type}">${body}<span class="go">見本 ›</span></button>`;
  };
  let h = ctx.notice() + '<p class="small muted" style="margin:12px 0 4px">保護者・講師と交わす書類の見本です。押すと、架空の家族・講師で作った見本が開きます。</p>';
  for (const [name, color, docs] of DOC_GROUPS) h += `<div class="sec-title">${esc(name)}</div><div class="group">${docs.map(([type, title, note]) => row(color, type, title, note)).join('')}</div>`;
  return h + '<p class="small muted" style="margin-top:14px">見本は印刷（Ctrl+P）で PDF にできます。</p>';
}

// ---- 受講規約 ----
// 受講規約（設定 → 受講規約）。2026-10-18 本人「マジで何がどうなっているのか意味が分かりません」→ 作り直し:
// いま保護者に同意をお願いしている規約（なし／公開中・同意 n/N 家族）→ 公開できる規約（サイトの正式版。terms/versions.json）→ 家族ごとの同意。
// 公開は「この規約を公開する」→ 公開するとどうなるかの確認 → 公開する、の 2 段階。版の名前や URL を手で打たない
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
  const t = terms.terms, f = terms.families, latest = termsSite?.versions?.[0], n = f.total;
  const open = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
  // 公開の確認（別の画面）
  if (termsStep === 'publish' && latest) {
    return h + `<p style="margin-top:12px">次の規約を公開して、保護者に同意をお願いします。</p>
      <section class="reg-card"><div class="reg-card-head"><h2>${esc(latest.title)}</h2></div>${kv(esc, [['適用日', esc(jaDay(latest.from))], ['全文', open(latest.url, '全文を読む') + (latest.pdf ? '・' + open(latest.pdf, 'PDF') : '')]])}</section>
      <section class="reg-card"><div class="reg-card-head"><h2>公開するとどうなるか</h2></div><ul style="margin:8px 0 0;padding-left:1.2em;line-height:1.8">
        <li>${n} 家族の保護者ページに、規約の全文と「同意する」が出ます。</li>
        <li>同意するまで、その家族は新しい授業の計画を承認できません。</li>
        <li>書面や LINE でもらった同意は、家族の画面の「規約の同意を記録」で残せます。</li>
        <li>公開した規約の名前・全文・適用日・一言は、あとから変えられません。直すときは新しい版を公開します。</li></ul></section>
      <form class="reg-form" data-form="terms-publish">
        <fieldset class="reg-field"><legend>保護者への一言 <span class="opt">任意</span></legend><textarea name="note" rows="3" maxlength="500" placeholder="例：11月からの受講のきまりをまとめました。全文をお読みいただき、同意をお願いします。"></textarea><p class="reg-help">同意のお願いと一緒に、保護者ページに出ます。</p></fieldset>
        <label class="choice"><input type="checkbox" name="confirm" required><span>全文を読み、この規約で同意をお願いすることを確かめました</span></label>
        <div class="stack"><button class="primary wide"${ctx.dis()}>公開する</button><button type="button" class="wide" data-action="terms-back"${ctx.dis()}>やめて戻る</button></div></form>`;
  }
  // 同意のお願いをやめる確認（めったに使わない）
  if (termsStep === 'stop' && t.version) {
    return h + `<p style="margin-top:12px">保護者に規約の同意をお願いするのをやめます。</p>
      <section class="reg-card"><div class="reg-card-head"><h2>やめるとどうなるか</h2></div><ul style="margin:8px 0 0;padding-left:1.2em;line-height:1.8">
        <li>保護者ページから、同意のお願いが消えます。</li><li>同意していなくても、授業の計画を承認できるようになります。</li><li>これまでの同意の記録は残ります。</li></ul></section>
      <form class="reg-form" data-form="terms-stop"><label class="choice"><input type="checkbox" name="confirm" required><span>同意のお願いをやめます</span></label>
        <div class="stack"><button class="primary wide"${ctx.dis()}>やめる</button><button type="button" class="wide" data-action="terms-back"${ctx.dis()}>戻る</button></div></form>`;
  }
  // 1. いま保護者に同意をお願いしている規約
  if (t.version) {
    h += `<section class="reg-card" style="margin-top:12px"><div class="reg-card-head"><h2>保護者に同意をお願いしている規約</h2><span class="tag ok">公開中</span></div>
      ${kv(esc, [['規約', esc(t.title || t.version) + (t.url ? '<br>' + open(t.url, '全文を読む') : '')], ['適用日', esc(jaDay(t.from) || '—')], ['同意', `<strong>${f.agreed}</strong> / ${n} 家族`]])}</section>`;
  } else {
    h += `<section class="reg-card" style="margin-top:12px"><div class="reg-card-head"><h2>まだ規約を公開していません</h2></div>
      <p class="reg-help" style="margin:6px 0 0">いまは保護者ページに規約は出ておらず、同意をお願いしていません。下の規約を公開すると、同意をお願いできます。</p></section>`;
  }
  // 2. 公開できる規約（サイトの正式版）
  if (latest && latest.version !== t.version) {
    h += `<div class="sec-title">${t.version ? '新しい規約があります' : '公開できる規約'}</div>
      <section class="reg-card" style="margin-top:0"><div class="reg-card-head"><h2>${esc(latest.title)}</h2></div>
      ${kv(esc, [['適用日', esc(jaDay(latest.from))], ['内容', esc(latest.summary || '')], ['全文', open(latest.url, '全文を読む') + (latest.pdf ? '・' + open(latest.pdf, 'PDF') : '')]])}
      <button class="primary wide" style="margin-top:10px" data-action="terms-publish-start"${ctx.dis()}>この規約を公開する</button>
      <p class="reg-help" style="margin:6px 0 0">押しても、まだ公開されません。次の画面で、公開するとどうなるかを確かめてから公開します。</p></section>`;
  } else if (!latest) h += '<p class="small muted">サイトの規約の一覧を読み込めませんでした。画面を読み直してください。</p>';
  // 3. 家族ごとの同意
  if (t.version && termsFams) {
    const via = name => terms.history.find(x => x.familyName === name && x.version === t.version);
    h += '<div class="sec-title">家族ごとの同意</div>' + (termsFams.length ? '<div class="group">' + termsFams.map(fm => {
      const ok = fm.termsVersion === t.version, v = ok && via(fm.name);
      return `<a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="#family=${esc(fm.id)}"><span class="v"><span class="lbl">${esc(fm.name)}</span><small>${ok ? `同意済み・${esc(jaDay(fm.termsAcceptedAt))}${v ? '（' + esc(v.via) + '）' : ''}` : 'まだ同意していません'}</small></span><span class="go" aria-hidden="true">›</span></a>`;
    }).join('') + '</div><p class="small muted" style="margin:6px 2px 0">書面や LINE でもらった同意は、家族を開いて「規約の同意を記録」で残せます。</p>' : '<p class="small muted">家族がまだいません。</p>');
  }
  // 4. めったに使わないもの
  h += `<div class="group" style="margin-top:20px"><a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="https://www.stepwise-education.jp/terms/" target="_blank" rel="noopener"><span class="v"><span class="lbl">サイトの受講規約</span><small>サイトの受講規約のページを開きます</small></span><span class="go" aria-hidden="true">›</span></a></div>`;
  if (terms.history.length) h += `<details style="margin-top:12px"><summary>同意の記録（新しい${terms.history.length}件）</summary><div class="group">` + terms.history.map(x => `<div class="evrow"><span class="t"><small>${esc(jaDay(x.acceptedAt))}</small></span><span class="b"><span class="nm">${esc(x.familyName)}</span><small>${esc(x.version)}・${esc(x.via)}・同意者：${esc(x.consenterName || '記録なし')}${x.actorKind === 'staff' ? `（${esc(x.recordedByName || '教室')}が記録）` : ''}${x.note ? '・' + esc(x.note) : ''}</small></span><span></span></div>`).join('') + '</div></details>';
  if (t.version) h += `<details style="margin-top:12px"><summary>同意のお願いをやめる</summary><p class="small muted">保護者ページから同意のお願いを外します。ふつうは使いません。</p><button type="button" data-action="terms-stop-start"${ctx.dis()}>同意のお願いをやめる</button></details>`;
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
  h += `<p class="small muted">メールとカレンダーは Apps Script に頼んで送ります。未送信と確認できた失敗だけ、3回まで自動で再試行します。結果不明は自動で送り直しません。日程通知の失敗は、予定画面で再案内と回答期間の確認が必要です。${effects.dismissed ? `切り替え前・テスト用・取り下げで送らなかったもの ${effects.dismissed}件。` : ''}</p>`;
  h += `<p><button class="small-btn" data-action="eff-test"${ctx.dis()}>テスト送信（代表あてに 1 通）</button></p>`;
  h += backupHtml(ctx);
  const x = effOpen && [...effects.failed, ...effects.recent].find(e => e.id === effOpen);
  if (x) h += sheet(esc, x.subject || x.label, `<p class="small muted" style="margin-top:0">${esc(x.label)}${x.to ? '・' + esc(x.to) : ''}<br>作成 ${jst(x.createdAt)}${x.sentAt ? '・送信 ' + jst(x.sentAt) : ''}・試行 ${x.attempts}回</p>
    ${x.error ? `<p class="notice error small">${esc(x.error)}</p>` : ''}
    ${x.scheduleNotice && x.status !== 'sent' ? '<p class="notice">日程の自動確定を保留しています。<a href="#schedule">予定</a>から対象授業の「再案内・回答期間を確認」を開いてください。</p>' : !x.canRetry && x.status !== 'sent' ? '<p class="notice">送信先の受信状況を確認し、根拠を記録してください。自動再送は停止しています。</p><button data-action="eff-resolve-sent">送れたと確認</button><button data-action="eff-resolve-notSent">未送信と確認</button>' : x.status === 'sent' ? '<p class="small">送りました（既読を示すものではありません）。</p>' : `<div class="row"><button class="primary" data-action="eff-retry" data-id="${x.id}"${ctx.dis()}>送り直す</button><button data-action="eff-dismiss" data-id="${x.id}"${ctx.dis()}>取り下げる（送らない）</button></div>`}`, 'eff-close');
  return h;
}

// ---- 台帳の控え（毎日 0:10 に全表を R2 へ。90 日分） ----
function backupHtml(ctx) {
  const { esc } = ctx;
  if (!backups) { backups = { loading: true }; ctx.call('admin/backup/list').then(r => { backups = r.ok ? r : { error: r.error.message }; ctx.render(); }); }
  let h = '<div class="sec-title">台帳の控え</div>';
  if (backups.loading) return h + '<p class="muted small">読み込んでいます…</p>';
  if (backups.error) return h + `<p class="notice error small">${esc(backups.error)}</p>`;
  const l = backups.latest;
  h += '<div class="group"><div class="irow" style="cursor:default"><span class="b"><b>' + (l ? `最新 ${esc(l.date)}${backups.stale ? ' <span class="tag danger">古い</span>' : ''}` : '<span class="tag danger">まだありません</span>') + `</b><small>${l ? `${l.rows}行・${Math.round(l.size / 1024)}KB・` : ''}${backups.count}日分（${backups.keepDays}日まで残す）</small></span><button class="small-btn" data-action="bk-run"${ctx.dis()}>今すぐ取る</button></div></div>`;
  h += '<p class="small muted">毎日 0:10 に全表を Cloudflare R2 へ写します（30 日の巻き戻しとは別）。ドライブへの週次の写しは 11 月に。</p>';
  return h;
}

// ---- 操作 ----
export async function extrasSubmit(ctx, kind, el) {
  if (kind !== 'terms-publish' && kind !== 'terms-stop') return false;
  const v = Object.fromEntries(new FormData(el).entries());
  if (!v.confirm) { ctx.say('確かめたことに印を付けてください', 'error'); return true; }
  const latest = termsSite?.versions?.[0];
  if (kind === 'terms-publish' && !latest) { ctx.say('公開できる規約を読み込めませんでした。画面を読み直してください', 'error'); return true; }
  const body = kind === 'terms-publish' ? { version: latest.version, title: latest.title, url: latest.url, from: latest.from, note: String(v.note || '').trim() } : { version: '', title: '', url: '', from: '', note: '' };
  const r = await ctx.call('admin/terms/set', body);
  if (r.ok) { terms = null; termsStep = ''; scrollTo(0, 0); ctx.say(kind === 'terms-publish' ? '規約を公開しました。保護者ページに同意のお願いが出ています。' : '同意のお願いをやめました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}
export async function extrasClick(ctx, a, b) {
  let r;
  if (a === 'terms-publish-start') { termsStep = 'publish'; ctx.say(''); scrollTo(0, 0); return true; }
  if (a === 'terms-stop-start') { termsStep = 'stop'; ctx.say(''); scrollTo(0, 0); return true; }
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
