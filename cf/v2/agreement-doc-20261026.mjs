// 受講合意書の書面（2026-10-26 本人「PDFを見ると全然だめですね。書式を他の書類に合わせましょうか」）。
// 個別受講条件書（condition-doc-r6.mjs）・特別単価合意書（special-doc-r9.mjs）と同じ形: 表題と案 → 宛名 → 授業の内容（左に大きなまとまり）→ 取り決め → 記録 → 保護者の承認 → 塾。
// この日より後に作った受講合意書の行（planLines.createdAt）だけこの様式。前からの行は、承認のあとも agreement-doc-20261016.mjs のまま（保存した書面の文字を変えない）。
import { keyTable, ruleTable, TABLE_CSS } from './doc-tables.mjs';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jstParts = t => { const d = new Date(Date.parse(t) + 9 * 3600e3); return Number.isFinite(d.getTime()) ? d : null; };
const day = t => { if (!t) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${Number(t.slice(0, 4))}年${Number(t.slice(5, 7))}月${Number(t.slice(8, 10))}日`; const d = jstParts(t); return d ? `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日` : ''; };
const minute = t => { const d = /^\d{4}-\d{2}-\d{2}$/.test(String(t || '')) ? null : jstParts(t); return d ? `${day(t)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` : day(t); };
const yen = n => Number.isFinite(n) ? n.toLocaleString('ja-JP') + '円' : '—';
const numeric = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const count = l => l.status === 'declined' ? 0 : l.status === 'approved' ? l.approvedCount : l.count;
const amount = l => numeric(count(l)) && numeric(l.fee) ? Number(count(l)) * Number(l.fee) : NaN;
const period = (a, b) => a && b ? `${day(a)} 〜 ${a.slice(0, 4) === b.slice(0, 4) ? day(b).replace(/^\d+年/, '') : day(b)}` : '—';
const partsText = l => { let ps = l.parts; if (typeof ps === 'string') { try { ps = JSON.parse(ps); } catch { return ''; } } return Array.isArray(ps) && ps.length ? ps.map(p => `${esc(p.label)} ${esc(p.count)}回`).join('／') : ''; };

export const AGREEMENT_LAYOUT_R13 = '20261026-r13';
export const NEW_LAYOUT_FROM = '2026-10-26T14:00:00.000Z';
// この様式で描くか: すべての行が、この日より後に作ったもの
export const usesLayoutR13 = records => records.length > 0 && records.every(r => String((r.line && r.line.createdAt) || '') >= NEW_LAYOUT_FROM);

export function agreementDocHtmlR13({ records, documentId, guardianName = '', sample = false }) {
  const first = records[0], l0 = first.line, status = l0.status, final = status === 'approved' || status === 'declined';
  const name = first.studentName || '';
  const consenter = final ? (l0.consenterName || '') : guardianName;
  const to = consenter ? `${esc(consenter)} 様` : `${esc(name)}さんの保護者さま`;
  const t = records.map(r => r.terms || {}).find(x => x.title) || {};
  const kiyaku = t.title || '共通規約';
  const total = records.reduce((n, r) => n + amount(r.line), 0);
  const badge = status === 'approved' ? '' : status === 'declined' ? '<span class="draft">見送り</span>' : '<span class="draft">案</span>';
  const groups = [['生徒', [['氏名', esc(name)], ['対象期間', esc(period(l0.startDate, l0.endDate))]]]];
  for (const r of records) {
    const l = r.line, ps = partsText(l), special = l.instructionType === 'special';
    groups.push([esc(l.subject || '—'), [
      ...(special || (l.kind && l.kind !== '通常') ? [['種類', esc(l.kind) + (special ? '<small class="note">特別単価合意書による単価</small>' : '')]] : []),
      [final ? '承認した回数' : '回数', `${esc(count(l))}回`],
      ['1回の授業', `${esc(l.minutes)}分`],
      ['1回の授業料', `${yen(numeric(l.fee) ? Number(l.fee) : NaN)}<small>（税込）</small>`],
      ['予定額', `${yen(amount(l))}<small>（税込）</small>`],
      ...(l.comment ? [['授業の内容', `<span class="txt">${esc(l.comment).replace(/\n/g, '<br>')}</span>`]] : []),
      ...(ps ? [['目的・教材ごと', `<span class="txt">${ps}</span>`]] : []),
    ]]);
  }
  if (records.length > 1) groups.push(['合計', [['予定総額', `${yen(total)}<small>（税込）</small>`]]]);
  const rules = [
    ['回数', '合意した回数は、実施できる上限です。すべての回数の受講や、実施しなかった分の繰り越しを約束するものではありません。'],
    ['予定額', '上の回数を実施した場合の金額です。請求は、実施した授業で計算します。'],
    ['日時', '授業の日時は、日程の確認で別に決めます。'],
    ['その他', `授業料の上限・お支払い・キャンセルなどは、個別受講条件書と「${esc(kiyaku)}」のとおりです。`],
  ];
  const record = records.map(r => {
    const l = r.line;
    return [esc(l.subject || '—'), [
      ['提案', [esc(l.proposedByName || ''), minute(l.proposedAt)].filter(Boolean).join('　') || '—'],
      ...(final ? [[status === 'approved' ? '承認' : '見送り', [esc(l.consenterName || ''), minute(l.consentedAt || l.consentDate), esc(l.approvedVia || '')].filter(Boolean).join('　') || '—']] : []),
      ...(final && l.recordedByName && l.recordedByName !== l.consenterName ? [['記録した人', [esc(l.recordedByName), minute(l.recordedAt)].filter(Boolean).join('　')]] : []),
      ...(l.approvalNote ? [['承認のメモ', esc(l.approvalNote).replace(/\n/g, '<br>')]] : []),
      ...(status === 'approved' && Number(l.approvedCount) !== Number(l.count) ? [['提案した回数', `${esc(l.count)}回（承認は${esc(l.approvedCount)}回）`]] : []),
    ]];
  });
  const consent = status === 'approved'
    ? `<div class="consent ok"><div class="ct">保護者の承認</div><div><strong>${esc(l0.consenterName || '')} 様</strong>（保護者）　${esc(minute(l0.consentedAt || l0.consentDate))}　${esc(l0.approvedVia || '')}<br>生徒の受講について契約する権限を持つ保護者として、この内容を承認いただきました。</div></div>`
    : status === 'declined'
      ? `<div class="consent"><div class="ct">保護者の意思表示</div><div><strong>${esc(l0.consenterName || '')} 様</strong>（保護者）　${esc(minute(l0.consentedAt || l0.consentDate))}　見送り</div></div>`
      : `<div class="consent"><div class="ct">保護者の承認</div><div>まだ承認いただいていません。保護者ページで内容をご確認のうえ、承認してください。承認のない授業は行いません。</div></div>`;
  const barLabel = `受講合意書${status === 'approved' ? '（控え）' : status === 'declined' ? '（見送り）' : '（案）'}`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=860"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(barLabel)} ${esc(name)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef0f3; color: #1e2630; font-family: "Hiragino Sans", "Yu Gothic", "YuGothic", "Noto Sans CJK JP", system-ui, sans-serif; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; padding: 10px 16px; background: #1e2630; color: #fff; font-size: 13px; }
  .bar button { font: inherit; padding: 6px 12px; border: 0; border-radius: 6px; background: #fff; color: #1e2630; cursor: pointer; margin-left: auto; }
  .sheet { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 16mm 18mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12); font-size: 13.5px; line-height: 1.75; }
  .sample { margin: 0 0 6mm; padding: 2mm 3mm; border: 1.5px dashed #b8860b; color: #8a6200; font-weight: 700; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  h1 { margin: 0; font-size: 24px; letter-spacing: .04em; }
  .meta { text-align: right; font-size: 13px; line-height: 1.8; }
  .draft { display: inline-block; border: 2px solid #b8860b; color: #8a6200; padding: 0 8px; border-radius: 4px; font-weight: bold; margin-left: 12px; font-size: 15px; letter-spacing: 0; vertical-align: 4px; }
  .to { margin-top: 9mm; font-size: 17px; font-weight: 600; border-bottom: 1.5px solid #1e2630; display: inline-block; min-width: 90mm; padding-bottom: 1mm; }
  .lead { margin: 6mm 0 0; font-size: 14px; }
  h2 { font-size: 15px; margin: 8mm 0 2mm; }
  .terms { margin-top: 5mm; }
  .terms .url { overflow-wrap: anywhere; }
  .consent { display: grid; grid-template-columns: 30mm 1fr; gap: 4mm; margin-top: 7mm; border: 1.5px solid #1e2630; border-radius: 6px; padding: 4mm; }
  .consent.ok { border-color: #2e7d32; background: #f3faf3; }
  .consent .ct { font-weight: 700; }
  .issuer { margin-top: 9mm; text-align: right; font-size: 13px; line-height: 1.7; }
  .issuer .name { font-size: 15px; font-weight: 700; }
  .docno { margin-top: 4mm; font-size: 11px; color: #5b6672; }
  @media print { body { background: #fff; } .bar { display: none !important; } .sheet { margin: 0; box-shadow: none; width: auto; min-height: auto; padding: 0; font-size: 11.5px; line-height: 1.55; } h1 { font-size: 21px; } .to { margin-top: 5mm; font-size: 15px; } .lead { margin-top: 4mm; font-size: 12.5px; } h2 { margin-top: 5mm; font-size: 13.5px; } .consent { margin-top: 5mm; padding: 3mm; } .issuer { margin-top: 5mm; font-size: 11.5px; } tr { break-inside: avoid; } }${TABLE_CSS}
  .key td small { font-weight: 500; }
  .key td .txt { font-weight: 400; } /* 文章は太字にしない */
</style></head>
<body>
<div class="bar"><span>${esc(barLabel)}。印刷（Ctrl+P）で PDF に保存できます。</span><button onclick="window.print()">印刷・PDF</button></div>
<div class="sheet">
  ${sample ? '<div class="sample">見本・架空の記録です。実際の契約ではありません。</div>' : ''}
  <div class="head"><h1>受講合意書${badge}</h1><div class="meta">${l0.proposedAt ? `提示日 ${esc(day(l0.proposedAt))}` : ''}${status === 'approved' ? `<br>承認日 ${esc(day(l0.consentedAt || l0.consentDate))}` : ''}</div></div>
  <div class="to">${to}</div>
  <p class="lead">${status === 'approved' ? '承認いただいた授業の内容と料金です。' : status === 'declined' ? '見送りとなった授業の内容と料金の記録です。' : '授業の内容と料金です。内容をご確認のうえ、承認をお願いします。'}</p>
  <h2>授業の内容</h2>
  ${keyTable(groups)}
  <h2>取り決め</h2>
  ${ruleTable(rules)}
  <p class="terms">この合意は、個別受講条件書と「${esc(kiyaku)}」に基づきます。${/^https:\/\/[^\s]+$/.test(t.url || '') ? `<br>規約の全文：<span class="url">${esc(t.url)}</span>` : ''}</p>
  <h2>記録</h2>
  ${keyTable(record)}
  ${consent}
  <div class="issuer"><div class="name">ステップワイズ個別指導</div>代表　麦倉 優輔<br>埼玉県越谷市袋山1319-9<br>080-6259-3025　／　mugilives@gmail.com</div>
  <p class="docno">書面番号 ${esc(documentId)}</p>
</div>
</body></html>`;
}
