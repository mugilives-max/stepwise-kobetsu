// 講師のきまり（#rules）。中身は Worker（cf/v2/staff-rules.mjs）が持つ。
// 講師: 全文を読んで「読みました」。代表: 全文と、今の版を読んだ講師の一覧
let data = null;
export function resetRules() { data = null; }
// 日付だけ（YYYY-MM-DD）はそのまま、日時（ISO）は日本の日付にする
const jaDay = v => { let d = String(v || ''); if (d.length > 10 && !Number.isNaN(Date.parse(d))) d = new Date(Date.parse(d) + 9 * 3600e3).toISOString(); return /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : ''; };
export function rulesPage(ctx, me) {
  const { esc } = ctx;
  if (!data) { data = { loading: true }; ctx.call('employment/rules/get').then(r => { data = r.ok ? r : { error: r.error.message }; if (!r.ok) ctx.handleAuth(r); ctx.render(); }); }
  let h = ctx.notice();
  if (data.loading) return h + '<p class="muted" style="margin-top:20px">読み込んでいます…</p>';
  if (data.error) return h + `<p class="notice error">${esc(data.error)}</p>`;
  const r = data.rules, owner = me.contractType === 'owner';
  h += `<section class="reg-card" style="margin-top:12px"><div class="reg-card-head"><h2>${esc(r.title)}</h2>${!owner && data.readAt ? '<span class="tag ok">読みました</span>' : ''}</div><p class="reg-help" style="margin:6px 0 0">${esc(r.intro)}</p></section>`;
  h += r.sections.map(([title, items], i) => `<section class="reg-card"><div class="reg-card-head"><h2>${i + 1}. ${esc(title)}</h2></div><ol style="margin:8px 0 0;padding-left:1.4em;line-height:1.8">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ol></section>`).join('');
  if (owner) {
    h += '<div class="sec-title">読んだ講師</div>' + (data.readers.length ? '<div class="group">' + data.readers.map(x => `<a class="todo-row" style="grid-template-columns:minmax(0,1fr) auto" href="#employment=${esc(x.id)}"><span class="v"><span class="lbl">${esc(x.name)}</span><small>${x.readAt ? '読みました・' + esc(jaDay(x.readAt)) : 'まだ読んでいません'}</small></span><span class="go" aria-hidden="true">›</span></a>`).join('') + '</div>' : '<p class="small muted">講師がまだいません。</p>');
    h += '<p class="small muted" style="margin:8px 2px 0">中身を変えるときは版を上げます。版が変わると、講師はもう一度読みます。</p>';
  } else if (data.readAt) {
    h += `<p class="small muted" style="margin:12px 2px 0">${esc(jaDay(data.readAt))}に読みました。</p>`;
  } else {
    h += `<form class="reg-form" data-form="rules-read"><label class="choice"><input type="checkbox" name="confirm" required><span>講師のきまりを読み、このとおりに仕事をします</span></label><button class="primary wide"${ctx.dis()}>読みました</button></form>`;
  }
  return h;
}
export async function rulesSubmit(ctx, kind, el) {
  if (kind !== 'rules-read') return false;
  if (!el.elements.namedItem('confirm').checked) { ctx.say('確かめる印を付けてください', 'error'); return true; }
  const r = await ctx.call('employment/rules/read', { hash: data && data.hash, confirm: true });
  if (r.ok) { data = null; ctx.say('読んだことを記録しました', 'ok'); } else if (!ctx.handleAuth(r)) ctx.say(r.error.message, 'error');
  return true;
}
