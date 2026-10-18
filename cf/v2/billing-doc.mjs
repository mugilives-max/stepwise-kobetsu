import { invoiceDueText } from '../../assets/v2/invoice-due.js';
// 請求書と領収書の書面（Kura/塾/書類のひな形 と同じ A4 の HTML）。2026-10-12 本人「請求書と領収書も同じ仕組みで出せるように」。
// - 請求を確定したときに請求書、入金を記録したときに領収書を R2 に置く（files 表 category=invoice / receipt、refType=invoice、refId=請求の id）
// - 保護者は「お支払い」の請求の画面から、教室管理者は「請求」の画面から開く（files/link）。印刷（Ctrl+P）で PDF
// - 振込先と備考は settings（invoiceBank・invoiceNote）。教室管理者が「請求」の画面で決める。免税事業者なので登録番号と税額は書かない
import { fail, iso, audit } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { putGenerated } from './files.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const yen = n => Number(n || 0).toLocaleString('ja-JP');
const jst = t => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600e3); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };
const ymd = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? `${Number(v.slice(0, 4))}年${Number(v.slice(5, 7))}月${Number(v.slice(8))}日` : jst(v);
const md = d => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : '';
const monthJa = m => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;
const KIND = { lesson: '授業', cancelFee: 'キャンセル料', legacy: '' };

const STYLE = `
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef0f3; color: #1e2630; font-family: "Hiragino Sans", "Yu Gothic", "YuGothic", system-ui, sans-serif; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; padding: 10px 16px; background: #1e2630; color: #fff; font-size: 13px; }
  .bar button { font: inherit; padding: 6px 12px; border: 0; border-radius: 6px; background: #fff; color: #1e2630; cursor: pointer; margin-left: auto; }
  .sheet { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 16mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12); font-size: 12.5px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { margin: 0; font-size: 26px; letter-spacing: .5em; }
  .meta { text-align: right; line-height: 1.8; }
  .to { margin-top: 8mm; font-size: 17px; border-bottom: 1px solid #1e2630; display: inline-block; min-width: 85mm; padding-bottom: 1mm; }
  .grid { display: flex; justify-content: space-between; gap: 10mm; margin-top: 6mm; }
  .issuer { line-height: 1.7; text-align: left; flex: none; }
  .issuer > div { white-space: nowrap; } /* 住所や電話を行の途中で折り返さない */
  .issuer .name { font-size: 15px; font-weight: bold; }
  .total { margin-top: 6mm; display: flex; gap: 6mm; align-items: baseline; padding: 3mm 5mm; border: 2px solid #1e2630; width: 110mm; }
  .total .yen { font-size: 24px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 6mm; }
  th, td { border: 1px solid #b9c0c8; padding: 2mm 2.5mm; vertical-align: top; }
  th { background: #f3f5f7; font-weight: 600; text-align: left; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: bold; }
  .pay { margin-top: 6mm; border: 1px solid #b9c0c8; padding: 3mm 4mm; line-height: 1.9; }
  .pay h2, .memo h2 { margin: 0 0 1mm; font-size: 13px; }
  .memo { margin-top: 5mm; line-height: 1.7; }
  .stamp { display: inline-block; border: 2px solid #2e7d32; color: #2e7d32; padding: 2px 10px; border-radius: 4px; font-weight: bold; }
  @media print { body { background: #fff; } .bar { display: none !important; } .sheet { margin: 0; box-shadow: none; width: auto; min-height: auto; padding: 0; } }
`;
export const docPage = (title, bar, body) => page(title, bar, body); // 講師マニュアル（staff-rules.mjs）も同じ書面の枠
// 書面は A4 のまま。スマホでは表示幅を 860 に固定して、1 ページ全体を縮小して見せる（2026-10-18 本人「書類関係は A4 の PDF で上手く表示できれば十分」）
const page = (title, bar, body) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=860"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><div class="bar"><span>${esc(bar)}</span><button onclick="window.print()">印刷・PDF</button></div><div class="sheet">${body}</div></body></html>`;
export const DOC_ISSUER = () => issuer;
const issuer = `<div class="issuer"><div class="name">ステップワイズ個別指導</div><div>代表　麦倉 優輔</div><div>〒343-0002</div><div>埼玉県越谷市袋山1319-9</div><div>電話 080-6259-3025</div><div>mugilives@gmail.com</div></div>`;

// 請求書。inv: invoices の行、items: invoiceItems（studentName つき）、family、settings { bank, note }
export function invoiceDocHtml({ inv, items, family, settings }) {
  const num = `${inv.month}-${String(inv.id).slice(-4).toUpperCase()}`;
  const rows = items.map(i => `<tr><td>${esc(md(i.date))}</td><td>${esc(i.studentName)}</td><td>${esc(i.kind === 'cancelFee' ? 'キャンセル料' : i.subject)}${i.lessonKind && i.lessonKind !== '通常' ? `（${esc(i.lessonKind)}）` : ''}${i.label ? ` <span style="color:#556;font-size:11px">${esc(i.label)}</span>` : ''}</td><td class="num">${i.minutes ? i.minutes + '分' : ''}</td><td class="num">${yen(i.amount)}</td></tr>`).join('');
  const body = `
  <div class="head"><h1>請求書</h1><div class="meta">請求書番号 ${esc(num)}<br>発行日 ${esc(jst(inv.confirmedAt))}</div></div>
  <div class="to">${esc(family.name)}　様</div>
  <div class="grid"><div><p style="margin:4mm 0 0">下記のとおりご請求申し上げます。</p><p style="margin:1mm 0 0">対象：${esc(monthJa(inv.month))}分の授業料</p>
    <div class="total"><span>ご請求金額</span><span class="yen">¥${yen(inv.total)}－</span></div></div>${issuer}</div>
  <table><thead><tr><th style="width:14%">日付</th><th style="width:16%">生徒</th><th>内容</th><th class="num" style="width:12%">時間</th><th class="num" style="width:16%">金額（円）</th></tr></thead>
  <tbody>${rows}</tbody><tfoot><tr><td colspan="4" class="num">合計</td><td class="num">${yen(inv.total)}</td></tr></tfoot></table>
  <div class="pay"><h2>お支払いについて</h2>お支払期日：${esc(invoiceDueText(inv))}<br>お振込先：${settings.bank ? esc(settings.bank) : '別途ご案内します'}<br>振込手数料：恐れ入りますが、ご負担をお願いいたします。<br>お振込みのあと、保護者ページか LINE でお知らせください。</div>
  <div class="memo"><h2>備考</h2>${settings.note ? esc(settings.note).replace(/\n/g, '<br>') : 'キャンセル料は、受講規約に基づき、ご連絡の時刻に応じて計算しています。'}<br><span style="color:#556;font-size:11px">この請求書は保護者ページ（お支払い）からいつでも開けます。免税事業者のため、登録番号と税率ごとの消費税額は記載していません。</span></div>`;
  return page(`請求書 ${monthJa(inv.month)}分 ${family.name}`, `請求書（${monthJa(inv.month)}分）。印刷（Ctrl+P）で PDF に保存できます。`, body);
}

// 領収書。入金を記録したときに作る
export function receiptDocHtml({ inv, family }) {
  const num = `R-${inv.month}-${String(inv.id).slice(-4).toUpperCase()}`;
  const body = `
  <div class="head"><h1>領収書</h1><div class="meta">領収書番号 ${esc(num)}<br>発行日 ${esc(ymd(inv.paidOn))}</div></div>
  <div class="to">${esc(family.name)}　様</div>
  <div class="grid"><div><div class="total"><span>領収金額</span><span class="yen">¥${yen(inv.total)}－</span></div>
    <p style="margin:4mm 0 0">但し　${esc(monthJa(inv.month))}分の授業料として</p><p style="margin:1mm 0 0">上記のとおり正に領収いたしました。</p>
    <p style="margin:3mm 0 0"><span class="stamp">${esc(inv.paidMethod || '振込')}にて受領</span>　${esc(ymd(inv.paidOn))}</p></div>${issuer}</div>
  <div class="memo"><h2>備考</h2>この領収書は保護者ページ（お支払い）からいつでも開けます。銀行振込の場合、振込の控えも領収の証拠になります。免税事業者のため、登録番号と税率ごとの消費税額は記載していません。</div>`;
  return page(`領収書 ${monthJa(inv.month)}分 ${family.name}`, `領収書（${monthJa(inv.month)}分）。印刷（Ctrl+P）で PDF に保存できます。`, body);
}

export async function billingSettings(db) {
  const rows = (await db.prepare("select key, value from settings where key in ('invoiceBank', 'invoiceNote')").all()).results;
  const v = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { bank: v.invoiceBank || '', note: v.invoiceNote || '' };
}
// 書面の id（最新）。kind: invoice / receipt
export async function billingDocIds(db, invoiceId) {
  const rows = (await db.prepare("select id, category from files where refType = 'invoice' and refId = ? and status = 'ready' order by createdAt desc").bind(invoiceId).all()).results;
  return { invoiceDocId: (rows.find(r => r.category === 'invoice') || {}).id || '', receiptDocId: (rows.find(r => r.category === 'receipt') || {}).id || '' };
}
async function familyAndItems(c, inv) {
  const family = await c.db.prepare('select * from families where id = ?').bind(inv.familyId).first();
  const names = Object.fromEntries((await c.db.prepare('select * from students where familyId = ?').bind(inv.familyId).all()).results.map(s => [s.id, `${s.familyName} ${s.givenName}`.trim()]));
  const items = (await c.db.prepare('select * from invoiceItems where invoiceId = ? order by sortOrder').bind(inv.id).all()).results.map(i => ({ ...i, studentName: names[i.studentId] || '' }));
  return { family, items };
}
export async function storeInvoiceDoc(c, invoiceId) {
  const inv = await c.db.prepare('select * from invoices where id = ?').bind(invoiceId).first();
  const { family, items } = await familyAndItems(c, inv);
  const html = invoiceDocHtml({ inv, items, family, settings: { ...(await billingSettings(c.db)), ...(inv.dueDate ? {bank:inv.bankSnapshot||''} : {}) } });
  return putGenerated(c, { category: 'invoice', familyId: family.id, refType: 'invoice', refId: inv.id, name: `請求書_${inv.month}_${family.name}.html`, mime: 'text/html; charset=utf-8', bytes: new TextEncoder().encode(html), note: `${inv.month} 分` });
}
export async function storeReceiptDoc(c, invoiceId) {
  const inv = await c.db.prepare('select * from invoices where id = ?').bind(invoiceId).first();
  const { family } = await familyAndItems(c, inv);
  const html = receiptDocHtml({ inv, family });
  return putGenerated(c, { category: 'receipt', familyId: family.id, refType: 'invoice', refId: inv.id, name: `領収書_${inv.month}_${family.name}.html`, mime: 'text/html; charset=utf-8', bytes: new TextEncoder().encode(html), note: `${inv.month} 分・${inv.paidOn}` });
}

export const billingDocRoutes = {
  'admin/billing/settings': async (c, b) => { await requireStaff(c, b, 'manager'); return { settings: await billingSettings(c.db) }; },
  // 振込先と備考（請求書に載せる文）。口座の情報はここ（本番の台帳）にだけ置く
  'admin/billing/settings/set': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const bank = String(b.bank || '').trim(), note = String(b.note || '').trim();
    if (bank.length > 300 || note.length > 500) fail('tooLong', '振込先は300文字、備考は500文字以内にしてください');
    const now = iso(c.now);
    await c.db.batch([['invoiceBank', bank], ['invoiceNote', note]].map(([k, v]) => c.db.prepare('insert into settings (key, value, updatedAt) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updatedAt = excluded.updatedAt').bind(k, v, now)));
    await audit(c, 'billingSettings', '', { by: me.id, bank: bank ? 'set' : '', note: note ? 'set' : '' });
    return { settings: await billingSettings(c.db) };
  },
  // 書面を作り直す（振込先を直したあとなど）。確定済みの請求だけ
  'admin/billing/docs/rebuild': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const inv = await c.db.prepare('select * from invoices where id = ?').bind(String(b.id || '')).first();
    if (!inv || inv.status === 'void') fail('notFound', '請求が見つかりません', 404);
    await storeInvoiceDoc(c, inv.id);
    if (inv.status === 'paid') await storeReceiptDoc(c, inv.id);
    await audit(c, 'billingDocRebuild', inv.id);
    return { docs: await billingDocIds(c.db, inv.id) };
  },
};
