// 特別単価合意書の書面（2026-10-20。ご利用規約 r9 の名称「特別単価合意書」。2026-10-15 本人決定、2026-10-20 本人「名前を変更しないといけない」）。
// 受講条件書 r6 と同じく、読む人の目線で並べる: だれ宛て・だれから → 大事な条件（大きく）→ 内容 → そのほかの約束 → 保護者の承認。
// 中身（名称・目的・内容と範囲・理由・準備・時間と単価・期間・特記事項）は r5 と同じ。条文の番号・内部の番号は書面に出さない。
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const jst = t => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600e3); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };
const jstMin = t => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600e3); return `${jst(t)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const ymd = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? `${Number(v.slice(0, 4))}年${Number(v.slice(5, 7))}月${Number(v.slice(8))}日` : jst(v);
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const br = s => esc(s).replace(/\n/g, '<br>');

export function specialDocR9({ sp, student, family, terms }) {
  const final = sp.status === 'agreed';
  const name = `${student.familyName} ${student.givenName}`.trim();
  const guardian = family.guardianName || '';
  const to = guardian ? `${esc(guardian)} 様` : `${esc(name)}さんの保護者さま`;
  const termsTitle = (terms && terms.title) || 'ご利用規約';
  const termsUrl = terms && terms.url ? terms.url : '';
  const key = [
    ['指導の名称', `${esc(sp.title)}`],
    ['1回の授業', `${sp.minutes}分`],
    ['1回の授業料（上限）', `${yen(sp.fee)}<small>（税込）</small>`],
    ['対象期間', `${esc(ymd(sp.fromDate))} 〜 ${esc(ymd(sp.toDate))}`, ' class="wide3"'],
  ];
  const detail = [
    ['指導の目的', br(sp.purpose)],
    ['内容と範囲', br(sp.content)],
    ['特別単価にする理由', br(sp.reason)],
    ['必要な準備', sp.prep ? br(sp.prep) : 'なし'],
  ];
  if (sp.note) detail.push(['特記事項', br(sp.note)]);
  const promises = [
    ['授業料', `毎月の「受講合意書」で、回数と料金をお知らせします。この指導の1回の授業料は、上の金額までです。授業の時間が違うときは、時間に合わせて計算します。受講合意書では、授業の種類「${esc(sp.title)}」として示します。`],
    ['承認がないとき', '承認をいただくまで、この単価は使いません。'],
    ['変えるとき', '期間を延ばす・内容や単価を変えるときは、新しい版をお送りし、承認をいただいてから変えます。'],
    ['ほかの条件', 'お支払い・お休みの連絡・教材などは、受講条件書のとおりです。'],
  ];
  const consent = final
    ? `<div class="consent ok"><div class="ct">保護者の承認</div><div><strong>${esc(sp.consenterName || '')} 様</strong>（保護者）　${esc(jstMin(sp.agreedAt))}　${esc(sp.agreedVia || '')}${sp.agreedBy && sp.agreedBy.startsWith('staff:') ? '（書面・LINE などでいただいた承認を、塾が記録）' : ''}<br>生徒の受講について契約する権限を持つ保護者として、この特別単価を承認いただきました。</div></div>`
    : `<div class="consent"><div class="ct">保護者の承認</div><div>まだ承認いただいていません。保護者ページで内容をご確認のうえ、承認してください。承認がない場合、この単価は使いません。</div></div>`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=860"><meta name="robots" content="noindex">
<title>特別単価合意書 ${esc(sp.title)} 第${sp.no}版${final ? '' : '（案）'} ${esc(name)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef0f3; color: #1e2630; font-family: "Hiragino Sans", "Yu Gothic", "YuGothic", system-ui, sans-serif; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; padding: 10px 16px; background: #1e2630; color: #fff; font-size: 13px; }
  .bar button { font: inherit; padding: 6px 12px; border: 0; border-radius: 6px; background: #fff; color: #1e2630; cursor: pointer; margin-left: auto; }
  .sheet { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 16mm 18mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12); font-size: 13.5px; line-height: 1.75; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  h1 { margin: 0; font-size: 24px; letter-spacing: .04em; }
  .meta { text-align: right; font-size: 13px; line-height: 1.8; }
  .draft { display: inline-block; border: 2px solid #b8860b; color: #8a6200; padding: 0 8px; border-radius: 4px; font-weight: bold; margin-left: 6px; }
  .to { margin-top: 9mm; font-size: 17px; font-weight: 600; border-bottom: 1.5px solid #1e2630; display: inline-block; min-width: 90mm; padding-bottom: 1mm; }
  .lead { margin: 6mm 0 0; font-size: 14px; }
  .key { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #c7ccd2; margin-top: 5mm; border: 1.5px solid #1e2630; border-radius: 6px; overflow: hidden; }
  .key div { padding: 3.5mm 4mm; background: #fff; }
  .key div.wide3 { grid-column: span 3; }
  .key dt { font-size: 12px; font-weight: 600; }
  .key dd { margin: 1mm 0 0; font-size: 19px; font-weight: 700; line-height: 1.35; }
  .key dd small { font-size: 12px; font-weight: 600; }
  h2 { font-size: 15px; margin: 8mm 0 2mm; padding-bottom: 1.5mm; border-bottom: 1px solid #c7ccd2; }
  .rules { margin: 0; padding: 0; list-style: none; }
  .rules li { display: grid; grid-template-columns: 34mm 1fr; gap: 4mm; padding: 2.2mm 0; border-bottom: 1px solid #e3e6ea; }
  .rules b { font-weight: 700; }
  .terms { margin-top: 5mm; }
  .terms .url { overflow-wrap: anywhere; }
  .consent { display: grid; grid-template-columns: 34mm 1fr; gap: 4mm; margin-top: 7mm; border: 1.5px solid #1e2630; border-radius: 6px; padding: 4mm; }
  .consent.ok { border-color: #2e7d32; background: #f3faf3; }
  .consent .ct { font-weight: 700; }
  .issuer { margin-top: 9mm; text-align: right; font-size: 13px; line-height: 1.7; }
  .issuer .name { font-size: 15px; font-weight: 700; }
  @media print { body { background: #fff; } .bar { display: none !important; } .sheet { margin: 0; box-shadow: none; width: auto; min-height: auto; padding: 0; font-size: 11.5px; line-height: 1.55; } h1 { font-size: 21px; } .to { margin-top: 5mm; font-size: 15px; } .lead { margin-top: 4mm; font-size: 12.5px; } .key { margin-top: 4mm; } .key div { padding: 2.5mm 3.5mm; } .key dd { font-size: 17px; } h2 { margin-top: 5mm; font-size: 13.5px; } .rules li { padding: 1.4mm 0; } .consent { margin-top: 5mm; padding: 3mm; } .issuer { margin-top: 5mm; font-size: 11.5px; } }
</style></head>
<body>
<div class="bar"><span>特別単価合意書（${esc(sp.title)}・第${sp.no}版${final ? '' : '・案'}）。印刷（Ctrl+P）で PDF に保存できます。</span><button onclick="window.print()">印刷・PDF</button></div>
<div class="sheet">
  <div class="head"><h1>特別単価合意書</h1><div class="meta">第${sp.no}版${final ? '' : '<span class="draft">案</span>'}<br>提示日 ${esc(jst(sp.proposedAt))}${final ? `<br>承認日 ${esc(jst(sp.agreedAt))}` : ''}</div></div>
  <div class="to">${to}</div>
  <p class="lead"><strong>${esc(name)}さん</strong>（${esc(student.grade || '')}）の「${esc(sp.title)}」は、準備に特別な負担がかかるため、通常の基準単価とは別の単価（特別の基準単価）でお願いします。内容をご確認のうえ、承認をお願いします。</p>
  <dl class="key">${key.map(([k, v, a = '']) => `<div${a}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
  <h2>指導の内容</h2>
  <ul class="rules">${detail.map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join('')}</ul>
  <h2>そのほかの約束</h2>
  <ul class="rules">${promises.map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join('')}</ul>
  <p class="terms">この単価は「${esc(termsTitle)}」に基づきます。ここにないことは、規約のとおりです。${termsUrl ? `<br>規約の全文：<span class="url">${esc(termsUrl)}</span>` : ''}</p>
  ${consent}
  <div class="issuer"><div class="name">ステップワイズ個別指導</div>代表　麦倉 優輔<br>埼玉県越谷市袋山1319-9<br>080-6259-3025　／　mugilives@gmail.com</div>
</div>
</body></html>`;
}
