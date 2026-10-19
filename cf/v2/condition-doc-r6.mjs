// 受講条件書の書面・r6（2026-10-19 本人「分量が多いし、パッと見て何が重要なのか分からない。細かい文章も意識して読まないと入ってこない。文字の色も薄い」）。
// 条件・料金・約束の中身は r5 と同じ。読む人の目線で、だれ宛て・だれが出したか → 授業の条件（大きく）→ そのほかの約束（短い文）→ 同意、の順に並べ直した。
// 条文の番号は本文から外し、「受講規約（版）に基づきます」とまとめて示す。内部の番号（条件 ID）や担当者は出さない。
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const jst = t => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600e3); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };
const jstMin = t => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600e3); return `${jst(t)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const monthJa = m => m ? `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月` : '';
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const MODES = { in_person: '教室', online: 'オンライン', both: '教室とオンライン' };

export function conditionDocR6({ cond, student, family, terms }) {
  const final = cond.status === 'agreed';
  const name = `${student.familyName} ${student.givenName}`.trim();
  const guardian = family.guardianName || '';
  const to = guardian ? `${esc(guardian)} 様` : `${esc(name)}さんの保護者さま`;
  const termsTitle = (terms && terms.title) || '受講規約';
  const termsUrl = terms && terms.url ? terms.url : '';
  const key = [
    ['1回の授業', `${cond.minutes}分`],
    ['1回の授業料（上限）', `${yen(cond.fee)}<small>（税込）</small>`],
    ['開始', `${esc(monthJa(cond.fromMonth))}から`],
    ['科目', esc(cond.subjects || '毎月の受講合意書で決めます')],
    ['形式', `${esc(MODES[cond.deliveryMode] || cond.deliveryMode)}${cond.groupSize ? `<small class="note">${esc(cond.groupSize)}</small>` : ''}`, ' class="wide"'],
  ];
  const promises = [
    ['授業料', `毎月の「受講合意書」で、科目・回数と料金をお知らせします。1回の授業料は、上の金額までです。授業の時間が違うときは、時間に合わせて計算します。`],
    ['お支払い', '毎月3日に前の月の分の請求をお知らせします。その月の15日までに、銀行振込でお支払いください（振込手数料はご負担ください）。'],
    ['お休みの連絡', cond.studentContact ? '授業の前日23時までなら無料でお休みできます。生徒さん本人からも連絡できます（キャンセル料がかかるときは、保護者さまにもお知らせします）。' : '授業の前日23時までなら無料でお休みできます。連絡は保護者さまからお願いします。'],
    ['教材', '塾が用意する教材は授業料に含みます。ご希望で別の教材を用意するときは、先にご相談のうえ、実費をいただきます。'],
    ['特別単価', '準備に特別な負担がかかる指導は、内容と単価を「特別単価合意書」で別にご説明し、承認をいただいたときだけ、その単価で行います。'],
    ['条件を変えるとき', '新しい版をお送りし、同意をいただいてから変えます。'],
  ];
  if (cond.note) promises.push(['特記事項', esc(cond.note).replace(/\n/g, '<br>')]);
  const consent = final
    ? `<div class="consent ok"><div class="ct">保護者の同意</div><div><strong>${esc(cond.consenterName || '')} 様</strong>（保護者）　${esc(jstMin(cond.agreedAt))}　${esc(cond.agreedVia || '')}${cond.agreedBy && cond.agreedBy.startsWith('staff:') ? '（書面・LINE などでいただいた同意を、塾が記録）' : ''}<br>生徒の受講について契約する権限を持つ保護者として、この条件と受講規約に同意いただきました。</div></div>`
    : `<div class="consent"><div class="ct">保護者の同意</div><div>まだ同意いただいていません。保護者ページで内容をご確認のうえ、同意してください。</div></div>`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=860"><meta name="robots" content="noindex">
<title>受講条件書 第${cond.no}版${final ? '' : '（案）'} ${esc(name)}</title>
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
  .from { margin-top: 2mm; font-size: 13px; }
  .lead { margin: 6mm 0 0; font-size: 14px; }
  .key { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #c7ccd2; margin-top: 5mm; border: 1.5px solid #1e2630; border-radius: 6px; overflow: hidden; }
  .key div { padding: 3.5mm 4mm; background: #fff; }
  .key div.wide { grid-column: span 2; }
  .key dd .note { display: block; font-size: 12.5px; font-weight: 500; margin-top: 1mm; }
  .key dt { font-size: 12px; font-weight: 600; }
  .key dd { margin: 1mm 0 0; font-size: 19px; font-weight: 700; line-height: 1.35; }
  .key dd small { font-size: 12px; font-weight: 600; }
  h2 { font-size: 15px; margin: 8mm 0 2mm; padding-bottom: 1.5mm; border-bottom: 1px solid #c7ccd2; }
  .rules { margin: 0; padding: 0; list-style: none; }
  .rules li { display: grid; grid-template-columns: 30mm 1fr; gap: 4mm; padding: 2.2mm 0; border-bottom: 1px solid #e3e6ea; }
  .rules b { font-weight: 700; }
  .terms { margin-top: 5mm; }
  .terms .url { overflow-wrap: anywhere; }
  .consent { display: grid; grid-template-columns: 30mm 1fr; gap: 4mm; margin-top: 7mm; border: 1.5px solid #1e2630; border-radius: 6px; padding: 4mm; }
  .consent.ok { border-color: #2e7d32; background: #f3faf3; }
  .consent .ct { font-weight: 700; }
  .issuer { margin-top: 9mm; text-align: right; font-size: 13px; line-height: 1.7; }
  .issuer .name { font-size: 15px; font-weight: 700; }
  @media print { body { background: #fff; } .bar { display: none !important; } .sheet { margin: 0; box-shadow: none; width: auto; min-height: auto; padding: 0; font-size: 11.5px; line-height: 1.55; } h1 { font-size: 21px; } .to { margin-top: 5mm; font-size: 15px; } .lead { margin-top: 4mm; font-size: 12.5px; } .key { margin-top: 4mm; } .key div { padding: 2.5mm 3.5mm; } .key dd { font-size: 17px; } h2 { margin-top: 5mm; font-size: 13.5px; } .rules li { padding: 1.4mm 0; } .consent { margin-top: 5mm; padding: 3mm; } .issuer { margin-top: 5mm; font-size: 11.5px; } }
</style></head>
<body>
<div class="bar"><span>受講条件書（第${cond.no}版${final ? '' : '・案'}）。印刷（Ctrl+P）で PDF に保存できます。</span><button onclick="window.print()">印刷・PDF</button></div>
<div class="sheet">
  <div class="head"><h1>受講条件書</h1><div class="meta">第${cond.no}版${final ? '' : '<span class="draft">案</span>'}<br>提示日 ${esc(jst(cond.proposedAt))}${final ? `<br>同意日 ${esc(jst(cond.agreedAt))}` : ''}</div></div>
  <div class="to">${to}</div>
  <div class="from">ステップワイズ個別指導（代表 麦倉 優輔）より</div>
  <p class="lead"><strong>${esc(name)}さん</strong>（${esc(student.grade || '')}）の授業の基本となる条件です。毎月の授業の回数と料金は、別に「受講合意書」でお知らせし、そのつど同意をいただきます。</p>
  <dl class="key">${key.map(([k, v, a = '']) => `<div${a}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
  <h2>そのほかの約束</h2>
  <ul class="rules">${promises.map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join('')}</ul>
  <p class="terms">この条件は「${esc(termsTitle)}」に基づきます。ここにないことは、規約のとおりです。${termsUrl ? `<br>規約の全文：<span class="url">${esc(termsUrl)}</span>` : ''}</p>
  ${consent}
  <div class="issuer"><div class="name">ステップワイズ個別指導</div>代表　麦倉 優輔<br>埼玉県越谷市袋山1319-9<br>080-6259-3025　／　mugilives@gmail.com</div>
</div>
</body></html>`;
}
