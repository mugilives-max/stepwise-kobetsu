import { conditionDocHtml as priorDocHtml } from './condition-doc-r3.mjs';
// 受講条件書（通常指導）（規約 第2条）の書面。請求書のひな形（Kura/塾/書類のひな形）と同じ A4 の見た目で、印刷（Ctrl+P）すれば PDF になる。
// 条件をお知らせしたとき（案）と、保護者が同意したとき（確定）に、この HTML を R2 に置く（files 表 category=contract、refType=condition）。
// 保護者はいつでも保護者ページから開ける（写しの交付）。中身はこの関数が作り、文字は全部エスケープする。
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const jst = t => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600e3); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };
const jstMin = t => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600e3); return `${jst(t)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const ymd = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${Number(v.slice(0, 4))}年${Number(v.slice(5, 7))}月${Number(v.slice(8))}日` : jst(v);
const monthJa = m => m ? `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月` : '';
const yen = n => Number(n || 0).toLocaleString('ja-JP') + '円';
const MODES = { in_person: '教室指導', online: 'オンライン指導', both: '教室指導とオンライン指導' };

// cond: conditions の行。student: students の行。family: families の行。terms: 今の規約（version/title/url）。proposer: 提案したスタッフの名前
export function conditionDocHtml({ cond, student, family, terms, proposer, now }) {
  if (cond.templateVersion !== '20261014-r5') return priorDocHtml({ cond, student, family, terms, proposer, now });
  const final = cond.status === 'agreed';
  const name = `${student.familyName} ${student.givenName}`.trim();
  const termsV = cond.termsVersion || (terms && terms.version) || '';
  const rows = [
    ['対象生徒', `${esc(name)}${student.grade ? `（${esc(student.grade)}）` : ''}`],
    ['条件の適用期間', `${esc(monthJa(cond.fromMonth))}から、条件を変える合意があるまで`],
    ['指導科目', esc(cond.subjects || '受講合意書で月ごとに定める')],
    ['指導形態', esc(MODES[cond.deliveryMode] || cond.deliveryMode)],
    ['指導人数', esc(cond.groupSize)],
    ['授業時間・通常指導の基準単価', `1回 ${cond.minutes}分　<strong>${yen(cond.fee)}</strong>（税込）<br><span class="sub">通常指導の適用単価は、この通常指導の基準単価を上限とします（規約第7条）。授業時間が異なる場合は時間に比例して計算します。</span>`],
    ['特殊指導', '<span class="sub">目的・内容と範囲・通常指導との違い・準備・時間・税込特殊指導の基準単価を別途提示し、保護者の承認を得た場合に、その基準単価を上限とする適用単価を定めます（規約第6条）。</span>'],
    ['教材費等', '<span class="sub">塾が必要と判断して用意する教材は授業料に含みます。家庭の強い希望による別の指定教材は家庭で用意するか、塾による購入を委託する場合に限り、事前承諾を得て購入実費を教材手配代行費用として請求します（規約第8条）。</span>'],
    ['支払方法', '<span class="sub">原則として銀行振込です。特別な事情がある場合は、塾が個別に承認した方法によります。授業料等の振込手数料は保護者の負担です。請求は翌月3日に確定し、支払期限はその月の15日です（規約第20条）。</span>'],
    ['生徒本人からの連絡', cond.studentContact ? '認める<br><span class="sub">前日23時までの無料のお休みは、生徒本人からも連絡できます。キャンセル料金が生じる連絡は保護者にもお知らせします（規約第13条・第23条）。</span>' : '認めない<br><span class="sub">お休み等の連絡は保護者からお願いします（規約第13条・第23条）。</span>'],
    ['特記事項', cond.note ? esc(cond.note).replace(/\n/g, '<br>') : 'なし'],
    ['同意する受講規約の版', termsV ? `${esc(termsV)}${terms && terms.url ? `　<span class="sub">全文：${esc(terms.url)}</span>` : ''}` : '<span class="sub">版が決まり次第、保護者ページでお知らせします</span>'],
    ['写しの交付', '<span class="sub">この書面は保護者ページ（お支払い）からいつでも開けます。</span>'],
  ];
  const agreeBlock = final
    ? `<div class="sign ok"><strong>保護者の同意</strong>　${esc(cond.consenterName || '記録なし')} 様　${esc(jstMin(cond.agreedAt))}　（${esc(cond.agreedVia)}${cond.agreedBy && cond.agreedBy.startsWith('staff:') ? '・塾が記録' : ''}）${cond.agreedNote ? `　<span class="sub">${esc(cond.agreedNote)}</span>` : ''}</div>`
    : `<div class="sign"><strong>保護者の同意</strong>　まだ同意いただいていません。保護者ページで内容を確かめて同意してください。</div>`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=860"><meta name="robots" content="noindex">
<title>受講条件書（通常指導） 第${cond.no}版${final ? '' : '（案）'} ${esc(name)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef0f3; color: #1e2630; font-family: "Hiragino Sans", "Yu Gothic", "YuGothic", system-ui, sans-serif; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; padding: 10px 16px; background: #1e2630; color: #fff; font-size: 13px; }
  .bar button { font: inherit; padding: 6px 12px; border: 0; border-radius: 6px; background: #fff; color: #1e2630; cursor: pointer; margin-left: auto; }
  .sheet { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 16mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12); font-size: 12.5px; line-height: 1.6; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { margin: 0; font-size: 22px; letter-spacing: .03em; }
  .meta { text-align: right; line-height: 1.8; }
  .draft { display: inline-block; border: 2px solid #b8860b; color: #b8860b; padding: 1px 8px; border-radius: 4px; font-weight: bold; }
  .to { margin-top: 8mm; font-size: 16px; border-bottom: 1px solid #1e2630; display: inline-block; min-width: 85mm; padding-bottom: 1mm; }
  .lead { margin: 4mm 0 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 5mm; }
  th, td { border: 1px solid #b9c0c8; padding: 2mm 2.5mm; vertical-align: top; }
  th { background: #f3f5f7; font-weight: 600; text-align: left; width: 34%; overflow-wrap: anywhere; }
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
<div class="bar"><span>受講条件書（通常指導）（第${cond.no}版${final ? '' : '・案'}）。印刷（Ctrl+P）で PDF に保存できます。</span><button onclick="window.print()">印刷・PDF</button></div>
<div class="sheet">
  <div class="head"><h1>受講条件書（通常指導）</h1><div class="meta">第${cond.no}版${final ? '' : '　<span class="draft">案</span>'}<br>作成日 ${esc(jst(final ? cond.agreedAt : cond.proposedAt) || jst(now))}</div></div>
  <div class="to">${esc(family.name)}　様${family.guardianName ? `（保護者：${esc(family.guardianName)}）` : ''}</div>
  <p class="lead">ステップワイズ個別指導 受講規約（第2条）に基づき、${esc(name)}さんの指導について、家庭ごとの基本条件を次のとおり定めます。月ごとの授業内容・回数・料金は、対象月の受講合意書について双方が合意することで決めます。この書面だけで将来すべての月の授業料を了承したことにはならず、固定曜日・固定時刻の継続利用や将来の授業枠を保証するものではありません。</p>
  <table><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
  ${agreeBlock}
  <div class="juku"><strong>塾の記録</strong>　${cond.recordedAt ? '承認の記録日時 ' + esc(jstMin(cond.recordedAt)) + '　記録者 ' + esc(cond.recordedByName || '') + '<br>' : ''}提案日 ${esc(jstMin(cond.proposedAt))}　担当 ${esc(proposer || '')}　（条件 ID ${esc(cond.id)}）</div>
  <div class="issuer"><div class="name">ステップワイズ個別指導</div>代表　麦倉 優輔<br>埼玉県越谷市袋山1319-9<br>080-6259-3025　／　mugilives@gmail.com</div>
  <p class="foot">保護者は、生徒の受講に関する契約を締結する権限を有することを確認します。条件を変える場合は、新しい版をお知らせし、同意を得てから適用します。</p>
</div>
</body></html>`;
}
