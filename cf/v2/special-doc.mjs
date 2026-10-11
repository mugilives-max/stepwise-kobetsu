// 特殊指導承認書（規約 第5条）の書面。個別指導条件書と同じ A4 の見た目。提案したとき（案）と承認されたとき（確定）に R2 に置く。
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const jst = t => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600e3); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };
const jstMin = t => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600e3); return `${jst(t)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const ymd = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? `${Number(v.slice(0, 4))}年${Number(v.slice(5, 7))}月${Number(v.slice(8))}日` : jst(v);
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const br = s => esc(s).replace(/\n/g, '<br>');

export function specialDocHtml({ sp, student, family, terms, proposer, now }) {
  const final = sp.status === 'agreed';
  const name = `${student.familyName} ${student.givenName}`.trim();
  const termsV = sp.termsVersion || (terms && terms.version) || '';
  const rows = [
    ['対象生徒', `${esc(name)}${student.grade ? `（${esc(student.grade)}）` : ''}`],
    ['特殊指導の名称', `<strong>${esc(sp.title)}</strong><br><span class="sub">授業計画承認書では、授業の種類「${esc(sp.title)}」として示します。</span>`],
    ['指導の内容と範囲', br(sp.content)],
    ['通常指導との違い（特殊指導とする理由）', br(sp.reason) + '<br><span class="sub">規約第5条：(i) その生徒のために個別に長時間の授業準備が必要、(ii) その準備を他の生徒の指導に活用することが難しい、の両方に当たるか、いずれかの程度が大きい指導。</span>'],
    ['必要な準備', sp.prep ? br(sp.prep) : 'なし'],
    ['1回の時間と税込料金', `1回 ${sp.minutes}分　<strong>${yen(sp.fee)}</strong>（税込）<br><span class="sub">この料金は、個別指導条件書の基本単価とは別に、この承認によって定めます。授業時間が異なる場合は時間に比例して計算します。</span>`],
    ['対象期間', `${esc(ymd(sp.fromDate))} 〜 ${esc(ymd(sp.toDate))}<br><span class="sub">期間の中で、月ごとの回数は授業計画承認書で合意します。期間を延ばす・内容を変えるときは、新しい承認書をお送りします。</span>`],
    ['特記事項', sp.note ? br(sp.note) : 'なし'],
    ['同意する受講規約の版', termsV ? `${esc(termsV)}${terms && terms.url ? `　<span class="sub">全文：${esc(terms.url)}</span>` : ''}` : '<span class="sub">版が決まり次第、保護者ページでお知らせします</span>'],
    ['写しの交付', '<span class="sub">この書面は保護者ページ（お支払い）からいつでも開けます。</span>'],
  ];
  const agreeBlock = final
    ? `<div class="sign ok"><strong>保護者の承認</strong>　${esc(family.guardianName || family.name)} 様　${esc(ymd(sp.agreedAt))}　（${esc(sp.agreedVia)}${sp.agreedBy && sp.agreedBy.startsWith('staff:') ? '・塾が記録' : ''}）${sp.agreedNote ? `　<span class="sub">${esc(sp.agreedNote)}</span>` : ''}</div>`
    : `<div class="sign"><strong>保護者の承認</strong>　まだ承認いただいていません。保護者ページで内容を確かめて承認してください。承認がない場合、この料金は適用しません。</div>`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>特殊指導承認書 ${esc(sp.title)} 第${sp.no}版${final ? '' : '（案）'} ${esc(name)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef0f3; color: #1e2630; font-family: "Hiragino Sans", "Yu Gothic", "YuGothic", system-ui, sans-serif; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; padding: 10px 16px; background: #1e2630; color: #fff; font-size: 13px; }
  .bar button { font: inherit; padding: 6px 12px; border: 0; border-radius: 6px; background: #fff; color: #1e2630; cursor: pointer; margin-left: auto; }
  .sheet { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 16mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12); font-size: 12.5px; line-height: 1.6; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { margin: 0; font-size: 24px; letter-spacing: .3em; }
  .meta { text-align: right; line-height: 1.8; }
  .draft { display: inline-block; border: 2px solid #b8860b; color: #b8860b; padding: 1px 8px; border-radius: 4px; font-weight: bold; }
  .to { margin-top: 8mm; font-size: 16px; border-bottom: 1px solid #1e2630; display: inline-block; min-width: 85mm; padding-bottom: 1mm; }
  .lead { margin: 4mm 0 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 5mm; }
  th, td { border: 1px solid #b9c0c8; padding: 2mm 2.5mm; vertical-align: top; }
  th { background: #f3f5f7; font-weight: 600; text-align: left; width: 34%; }
  .sub { font-size: 11px; color: #556; }
  .sign { margin-top: 5mm; border: 1px solid #b9c0c8; padding: 3mm 4mm; }
  .sign.ok { border-color: #2e7d32; background: #f1f8f1; }
  .juku { margin-top: 3mm; border: 1px solid #b9c0c8; padding: 3mm 4mm; }
  .issuer { margin-top: 8mm; line-height: 1.7; text-align: right; font-size: 12px; }
  .issuer .name { font-size: 14px; font-weight: bold; }
  .foot { margin-top: 4mm; font-size: 11px; color: #556; }
  @media print { body { background: #fff; } .bar { display: none !important; } .sheet { margin: 0; box-shadow: none; width: auto; min-height: auto; padding: 0; } }
</style></head>
<body>
<div class="bar"><span>特殊指導承認書（${esc(sp.title)}・第${sp.no}版${final ? '' : '・案'}）。印刷（Ctrl+P）で PDF に保存できます。</span><button onclick="window.print()">印刷・PDF</button></div>
<div class="sheet">
  <div class="head"><h1>特殊指導承認書</h1><div class="meta">第${sp.no}版${final ? '' : '　<span class="draft">案</span>'}<br>作成日 ${esc(jst(final ? sp.agreedAt : sp.proposedAt) || jst(now))}</div></div>
  <div class="to">${esc(family.name)}　様${family.guardianName ? `（保護者：${esc(family.guardianName)}）` : ''}</div>
  <p class="lead">ステップワイズ個別指導 受講規約（第5条）に基づき、${esc(name)}さんについて、通常指導とは別に次の特殊指導を行い、その料金を適用することを提案します。内容と範囲、料金、期間をご確認のうえ、承認をお願いいたします。承認は、この承認書の範囲で特殊指導料金を適用することへの同意であり、月ごとの回数は別に授業計画承認書で合意します。</p>
  <table><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
  ${agreeBlock}
  <div class="juku"><strong>塾の記録</strong>　提案日 ${esc(jstMin(sp.proposedAt))}　担当 ${esc(proposer || '')}　（承認書 ID ${esc(sp.id)}）</div>
  <div class="issuer"><div class="name">ステップワイズ個別指導</div>代表　麦倉 優輔<br>埼玉県越谷市袋山1319-9<br>080-6259-3025　／　mugilives@gmail.com</div>
  <p class="foot">期間の途中でやめる場合は、実施した分だけを精算します。承認のない特殊指導料金は請求しません。</p>
</div>
</body></html>`;
}
