// スタッフの画面: 設定の下の「受講規約」（#terms）と「送信の記録」（#effects）。教室管理者だけ。
// 受講規約: 今の版（版・名前・全文のリンク・適用日・説明）を決める。家族ごとの同意の状態と記録。
// 送信の記録: 送れなかったメール・カレンダー（失敗・止まっているもの）を送り直す・取り下げる。最近送ったものも見える。
import { sheet, ICON } from '/staff/ui.js?v=20261008-launch1';

let termsDraft = null;
let terms = null, effects = null, effOpen = 0, backups = null;
export function resetExtras() { termsDraft = null; terms = null; effects = null; effOpen = 0; backups = null; }
export function leaveExtras() { effOpen = 0; }
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;
const jst = t => t ? new Date(Date.parse(t) + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/') : '';

// ---- 書類のひな形（#docs）----
// 台帳に残す書面の一覧。いつ作られ、誰がどこから開けるか。「見本を開く」で架空の家族（見本家）で描いた書面を新しいタブに出す。
const DOCS = [
  { type: 'terms', title: '受講規約', when: '塾が版を決めて公開する。保護者は初めて計画を承認する前に同意する', who: '誰でも（公開ページ）。同意の状態は 設定 → 受講規約', where: '設定 → 受講規約' },
  { type: 'condition', title: '基本指導条件書', when: '生徒ごとに条件を決めてお知らせしたとき（案）、保護者が同意したとき（確定）', who: '保護者はお支払い。塾は生徒の画面', where: '家族と生徒 → 生徒 → 基本指導条件' },
  { type: 'special', title: '特殊指導条件書', when: '特殊指導を提案したとき（案）、保護者が承認したとき（確定）', who: '保護者はお支払い。塾は生徒の画面', where: '家族と生徒 → 生徒 → 特殊指導' },
  { type: 'plan', title: '授業計画承認書', when: '計画を送ると保護者ページに出る（書面ではなく画面）。承認の記録は計画に残る', who: '保護者は授業計画。塾は授業計画の画面', where: '授業計画' },
  { type: 'invoice', title: '請求書', when: '月の請求を確定したとき', who: '保護者はお支払いの請求。塾は請求の画面', where: '請求 → 家族の月。振込先と備考は 設定 → 請求の下の「請求書の設定」' },
  { type: 'receipt', title: '領収書', when: '入金を記録したとき', who: '保護者はお支払いの請求。塾は請求の画面', where: '請求 → 家族の月 → 入金を記録' },
];
export function docsPage(ctx) {
  const { esc } = ctx;
  if (!terms) { terms = { loading: true }; ctx.call('admin/terms/get').then(r => { terms = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  const t = terms && terms.terms;
  let h = ctx.notice();
  h += '<p class="small muted" style="margin:12px 0 4px">保護者と交わす書面の一覧です。見本は架空の家族（見本家）で描いています。請求書の振込先と備考だけは今の設定のままです。</p>';
  for (const d of DOCS) {
    let act = '';
    if (d.type === 'terms') act = t && t.url ? `<a class="btn" href="${esc(t.url)}" target="_blank" rel="noopener">全文を開く${t.version ? `（${esc(t.version)}）` : ''}</a>` : '<span class="small muted">版がまだ決まっていません（設定 → 受講規約）</span>';
    else if (d.type === 'plan') act = '<a class="btn" href="#plans">授業計画を開く</a>';
    else act = `<button data-action="doc-sample" data-type="${d.type}">見本を開く</button>`;
    h += `<div class="pcard" style="margin-top:10px"><div class="pc-head"><strong>${esc(d.title)}</strong></div>
      <dl class="cond-dl"><dt>いつ</dt><dd>${esc(d.when)}</dd><dt>誰が開ける</dt><dd>${esc(d.who)}</dd><dt>どこから</dt><dd>${esc(d.where)}</dd></dl>
      <div class="row" style="margin-top:8px">${act}</div></div>`;
  }
  h += '<p class="small muted" style="margin-top:14px">見本は印刷（Ctrl+P）で PDF にできます。文面を変えたいときは、どの書類のどの行かを伝えてください。</p>';
  return h;
}

// ---- 受講規約 ----
export function termsPage(ctx) {
  const { esc } = ctx;
  if (!terms) { terms = { loading: true }; ctx.call('admin/terms/get').then(r => { terms = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  let h = ctx.notice();
  if (terms.loading) return h + '<p class="muted" style="margin-top:20px">読み込んでいます…</p>';
  if (terms.error) return h + `<p class="notice error">${esc(terms.error)}</p>`;
  const t = terms.terms, f = terms.families, d = termsDraft || t;
  h += `<div class="pcard" style="margin-top:12px"><div class="pc-head"><strong>${t.version ? esc(t.title || '受講規約') : '規約の版がまだありません'}</strong>${t.version ? `<span class="tag">${esc(t.version)}</span>` : ''}</div>
    ${t.version ? `<p class="small muted">${t.from ? '適用 ' + esc(t.from) + '・' : ''}同意 ${f.agreed} / ${f.total} 家族${t.url ? `・<a href="${esc(t.url)}" target="_blank" rel="noopener">全文を開く</a>` : '・全文のリンクなし'}</p>${t.note ? `<p class="small">${esc(t.note)}</p>` : ''}` : '<p class="small muted">版を決めると、保護者ページに規約が出て、同意してから計画を承認する形になります。版が空のあいだは、同意は求めません。</p>'}</div>`;
  h += '<p class="small muted">同意済みの記録と各版の全文リンクは保存されます。登録済みの版の内容を変える場合は、新しい版名にしてください。</p>';
  h += (terms.catalogue || []).map(x => `<p class="small"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.version)}</a>（${esc(x.version)}）<button data-action="terms-select" data-version="${esc(x.version)}">この版を入力欄に選ぶ</button></p>`).join('');
  h += `<div class="sec-title">今の版を決める</div><form class="stack group" style="padding:12px" data-form="terms-set">
    <div class="row"><label style="flex:1">版（例: 2026-11）<input name="version" maxlength="40" value="${esc(d.version)}" placeholder="空にすると同意を求めない"></label><label style="flex:1">適用日<input type="date" name="from" value="${esc(d.from)}"></label></div>
    <label>規約の名前<input name="title" maxlength="80" value="${esc(d.title)}" placeholder="例: 受講規約（2026年11月版）"></label>
    <label>全文のリンク（Drive の PDF など。https://）<input type="url" name="url" maxlength="500" value="${esc(d.url)}" placeholder="https://"></label>
    <label>保護者への一言（任意。何が変わったか）<input name="note" maxlength="500" value="${esc(d.note)}"></label>
    <p class="small muted" style="margin:0">版を変えると、すべての家族が「同意が要る」状態になり、同意するまで新しい計画を承認できません（見送りはできます）。</p>
    <button class="primary"${ctx.dis()}>この版にする</button></form>`;
  h += '<div class="sec-title">同意の記録</div>' + (terms.history.length ? '<div class="group">' + terms.history.map(x => `<div class="evrow"><span class="t"><small>${esc(x.acceptedAt)}</small></span><span class="b"><span class="nm">${esc(x.familyName)}</span><small>${esc(x.version)}・${esc(x.via)}<br>同意者：${esc(x.consenterName || '記録なし')}<br>記録日時：${esc(x.recordedAt || '記録なし')}・記録者：${esc(x.recordedByName || '記録なし')}${x.actorKind === 'staff' ? '（教室が記録）' : ''}${x.note ? '・' + esc(x.note) : ''}</small></span><span></span></div>`).join('') + '</div>' : '<p class="muted small">まだありません。書面や LINE でもらった同意は、家族の画面の「規約の同意を記録」で残せます。</p>');
  return h;
}

// ---- 送信の記録 ----
export function effectsPage(ctx) {
  const { esc } = ctx;
  if (!effects) { effects = { loading: true }; ctx.call('admin/effects/list').then(r => { effects = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  let h = ctx.notice();
  if (effects.loading) return h + '<p class="muted" style="margin-top:20px">読み込んでいます…</p>';
  if (effects.error) return h + `<p class="notice error">${esc(effects.error)}</p>`;
  const row = x => `<button type="button" class="irow" data-action="eff-open" data-id="${x.id}"><span class="b"><b>${esc(x.subject || x.label)}</b><small>${esc(x.label)}${x.to ? '・' + esc(x.to) : ''}・${jst(x.createdAt)}${x.status === 'failed' ? `・<span class="tag danger">送れなかった</span>` : x.status === 'pending' ? '・<span class="tag warn">止まっている</span>' : ''}</small></span><span class="go">›</span></button>`;
  h += `<div class="sec-title">送れなかったもの${effects.failed.length ? ` <span class="count">${effects.failed.length}</span>` : ''}${effects.failed.length ? `<button class="small-btn primary" style="margin-left:auto" data-action="eff-retry-all"${ctx.dis()}>全部送り直す</button>` : ''}</div>`;
  h += effects.failed.length ? '<div class="group">' + effects.failed.map(row).join('') + '</div>' : '<p class="muted small">ありません。</p>';
  h += '<div class="sec-title">最近送ったもの</div>' + (effects.recent.length ? '<div class="group">' + effects.recent.map(row).join('') + '</div>' : '<p class="muted small">直近 30 日に送ったものはありません。</p>');
  h += `<p class="small muted">メールとカレンダーは Apps Script に頼んで送ります。失敗したものは、毎日の定期実行で 3 回まで自動で送り直します。${effects.dismissed ? `切り替え前・テスト用・取り下げで送らなかったもの ${effects.dismissed}件。` : ''}</p>`;
  h += `<p><button class="small-btn" data-action="eff-test"${ctx.dis()}>テスト送信（代表あてに 1 通）</button></p>`;
  h += backupHtml(ctx);
  const x = effOpen && [...effects.failed, ...effects.recent].find(e => e.id === effOpen);
  if (x) h += sheet(esc, x.subject || x.label, `<p class="small muted" style="margin-top:0">${esc(x.label)}${x.to ? '・' + esc(x.to) : ''}<br>作成 ${jst(x.createdAt)}${x.sentAt ? '・送信 ' + jst(x.sentAt) : ''}・試行 ${x.attempts}回</p>
    ${x.error ? `<p class="notice error small">${esc(x.error)}</p>` : ''}
    ${x.status === 'sent' ? '<p class="small">送りました。</p>' : `<div class="row"><button class="primary" data-action="eff-retry" data-id="${x.id}"${ctx.dis()}>送り直す</button><button data-action="eff-dismiss" data-id="${x.id}"${ctx.dis()}>取り下げる（送らない）</button></div>`}`, 'eff-close');
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
  if (kind !== 'terms-set') return false;
  const v = Object.fromEntries(new FormData(el).entries());
  if (v.version && v.version !== ((terms && terms.terms && terms.terms.version) || '') && !confirm('規約の版を変えると、すべての家族に同意をお願いする形になります。よろしいですか？')) return true;
  const r = await ctx.call('admin/terms/set', { version: v.version, title: v.title, url: v.url, from: v.from, note: v.note });
  if (r.ok) { terms = null; termsDraft = null; ctx.say(v.version ? '規約の版を決めました' : '規約の同意を求めない形にしました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}
export async function extrasClick(ctx, a, b) {
  let r;
  if (a === 'terms-select') {
    const selected = (terms.catalogue || []).find(x => x.version === b.dataset.version);
    if (selected) {
      termsDraft = {version:selected.version,title:selected.title,url:selected.url,from:selected.fromDate,note:selected.note || ''};
    }
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
    const ids = a === 'eff-retry' ? [Number(b.dataset.id)] : effects.failed.map(x => x.id);
    r = await ctx.call('admin/effects/retry', { ids });
    if (r.ok) { effects = null; effOpen = 0; ctx.say(r.failed ? `${r.sent}件を送り、${r.failed}件は送れませんでした: ${r.error}` : `${r.sent}件を送りました`, r.failed ? 'error' : 'ok'); }
  } else if (a === 'eff-dismiss') {
    if (!confirm('この送信を取り下げますか？（送りません）')) return true;
    r = await ctx.call('admin/effects/dismiss', { ids: [Number(b.dataset.id)] });
    if (r.ok) { effects = null; effOpen = 0; ctx.say('取り下げました', 'ok'); }
  } else return false;
  if (r && !r.ok && !ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}
