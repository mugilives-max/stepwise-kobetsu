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
// 書類の一覧: 種類ごとにまとめ、1 行の説明だけ。行を押すと見本（架空の家族で作った書面）が開く
const DOC_GROUPS = [
  ['契約の書類', '#2f6fde', [
    ['terms', '受講規約', '保護者が最初に同意する、塾全体のきまり'],
    ['condition', '受講条件書（通常指導）', '生徒ごとの授業時間と料金。保護者の同意で確定します'],
    ['special', '受講条件書（特殊指導）', '通常とは別の料金で行う指導の内容と料金'],
    ['agreement', '受講合意書', '月ごとの授業の回数と料金。保護者の承認で確定します'],
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
  let h = ctx.notice() + '<p class="small muted" style="margin:12px 0 4px">保護者と交わす書類の見本です。押すと、架空の家族で作った見本が開きます。</p>';
  for (const [name, color, docs] of DOC_GROUPS) h += `<div class="sec-title">${esc(name)}</div><div class="group">${docs.map(([type, title, note]) => row(color, type, title, note)).join('')}</div>`;
  return h + '<p class="small muted" style="margin-top:14px">見本は印刷（Ctrl+P）で PDF にできます。</p>';
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
