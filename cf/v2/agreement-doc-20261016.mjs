// Frozen rendering of saved plan revisions. Future layout changes get a new module.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value = v => esc(v === null || v === undefined || v === '' ? '記録なし' : v);
const money = n => Number.isFinite(n) ? n.toLocaleString('ja-JP') + '円' : '算出できません';
const time = v => {
  if (!v) return '記録なし';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return esc(v) + '（時刻の記録なし）';
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? esc(d.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})) + '（日本時間）' : esc(v);
};
const count = l => l.status === 'declined' ? 0 : l.status === 'approved' ? l.approvedCount : l.count;
const numeric = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const amount = l => numeric(count(l)) && numeric(l.fee) ? Number(count(l)) * Number(l.fee) : NaN;
const state = s => ({draft:'下書き・未提示',proposed:'承認待ち',approved:'承認済み',declined:'見送り'}[s] || '状態の記録なし');
const parts = l => {
  let ps=l.parts; if(typeof ps==='string'){try{ps=JSON.parse(ps);}catch{return '<p>目的・教材の内訳を読み取れません。</p>';}}
  if(!Array.isArray(ps)||!ps.length)return '';
  const mismatch=l.status==='approved'&&Number(l.approvedCount)!==Number(l.count);
  return '<p class="small">提案時の目的・教材の内訳：'+ps.map(p=>esc(p.label)+' '+value(p.count)+'回').join('／')+
    (mismatch?'。承認回数は提案回数から変更されています。この内訳を承認後の配分として確定するものではありません。':'')+'</p>';
};
export const AGREEMENT_LAYOUT = '20261016-r9';
export function agreementDocHtml({records,documentId,sample=false}) {
  const first=records[0], l0=first.line, status=l0.status;
  const title=status==='approved'?'受講合意書の控え':status==='declined'?'受講合意書の記録（見送り）':'受講合意書（案）';
  const total=records.reduce((n,r)=>n+amount(r.line),0);
  const rows=records.map((r,i)=>{
    const l=r.line;
    return '<section class="lesson"><h3>'+String(i+1)+'. '+value(l.subject)+' <span>'+value(l.kind)+'</span></h3>'+
      '<table class="numbers"><thead><tr><th>対象期間</th><th>'+ (status==='approved'?'承認回数':'提案回数')+'</th><th>1回の時間</th><th>適用単価（税込）</th><th>予定額（税込）</th></tr></thead><tbody><tr>'+
      '<td>'+value(l.startDate)+'<br>〜 '+value(l.endDate)+'</td><td>'+value(count(l))+'回</td><td>'+value(l.minutes)+'分</td><td>'+money(numeric(l.fee)?Number(l.fee):NaN)+'</td><td>'+money(amount(l))+'</td></tr></tbody></table>'+
      '<p class="content"><b>具体的な授業内容</b><br>'+value(l.comment)+'</p>'+parts(l)+
      '<p class="small">基準単価の区分：'+(l.instructionType==='regular'?'通常':l.instructionType==='special'?'特別（対象指導名：'+value(l.kind)+'）':'記録なし')+
      '／参照する受講条件書 ID：'+value(l.conditionId)+(l.instructionType==='special'?'／特別単価合意書 ID：'+value(l.specialId):'')+'</p></section>';
  }).join('');
  const evidence=records.map((r,i)=>{
    const l=r.line, t=r.terms||{}, link=/^https:\/\/[^\s]+$/.test(t.url||'')?'<a href="'+esc(t.url)+'" rel="noopener noreferrer">この版の規約全文</a>':'全文リンクの記録なし';
    return '<section class="record"><h3>'+String(i+1)+'. '+value(l.subject)+' '+value(l.kind)+'</h3>'+
      '<dl><dt>行 ID・版</dt><dd>'+value(l.id)+'・第'+value(l.version)+'版</dd>'+
      '<dt>提案者・提案日時</dt><dd>'+value(l.proposedByName)+'／'+time(l.proposedAt)+'</dd>'+
      '<dt>保護者の意思表示</dt><dd>'+state(status)+(status==='approved'||status==='declined'?'／'+value(l.consenterName)+'／'+time(l.consentedAt||l.consentDate)+'／'+value(l.approvedVia):'（承認の記録はありません）')+'</dd>'+
      '<dt>入力の記録</dt><dd>'+value(l.recordedByName)+'／'+time(l.recordedAt)+'</dd>'+
      '<dt>保護者の確認状況</dt><dd>'+({confirmed:'記録内容を確認済み',inquiry:'問い合わせあり',pending:'記録内容の確認待ち'}[l.familyAck]||'確認の記録なし')+
      (l.familyAckAt?'／'+time(l.familyAckAt):'')+(l.familyAckNote?'<br>'+esc(l.familyAckNote):'')+'</dd>'+
      (l.approvalNote?'<dt>承認の記録メモ</dt><dd>'+esc(l.approvalNote)+'</dd>':'')+
      '<dt>参照する規約</dt><dd>'+value(l.termsVersion)+'／'+link+'</dd>'+
      '<dt>履歴の保存日時</dt><dd>'+time(r.capturedAt)+'</dd></dl></section>';
  }).join('');
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>'+esc(title)+' - '+esc(first.studentName)+'</title><style>'+
    '@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:"Noto Sans CJK JP","Yu Gothic",Meiryo,sans-serif;color:#172a35;font-size:10pt;line-height:1.6;margin:0;background:#edf2f4}main{max-width:190mm;margin:20px auto;padding:12mm;background:white}h1{font-size:22pt;margin:5mm 0 3mm;line-height:1.4}h2{font-size:14pt;border-bottom:2px solid #16817a;padding-bottom:2mm;margin:8mm 0 3mm}h3{font-size:11pt;margin:4mm 0 2mm;break-after:avoid}h3 span{font-size:10pt;font-weight:400}.brand{font-size:10pt;color:#26766d;letter-spacing:.08em}.status{font-weight:bold}.meta{display:flex;gap:8mm;flex-wrap:wrap;padding:3mm 0;border-bottom:1px solid #ccd8da}.lesson{margin:4mm 0}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:9pt}th,td{border:1px solid #cbd6d9;padding:2mm;text-align:left;overflow-wrap:anywhere}th{background:#edf5f4}th:first-child{width:29%}tr{break-inside:avoid}thead{display:table-header-group}.content{white-space:pre-wrap;overflow-wrap:anywhere;margin:3mm 0}.small{font-size:8.5pt;color:#475961;overflow-wrap:anywhere}.total{display:flex;justify-content:space-between;gap:5mm;background:#edf5f4;padding:3mm;margin-top:5mm;font-weight:bold;font-size:12pt;break-inside:avoid}.record{break-inside:avoid}dl{display:grid;grid-template-columns:35mm 1fr;margin:0;font-size:8.5pt}dt,dd{margin:0;padding:1.2mm 0;border-bottom:1px solid #e2e7e8;overflow-wrap:anywhere;white-space:pre-wrap}dt{font-weight:bold}a{color:#116b67}footer{border-top:1px solid #ccd8da;padding-top:3mm;margin-top:7mm;font-size:8pt;overflow-wrap:anywhere}.toolbar{padding:12px;text-align:center;background:#dfeae9}button{padding:9px 20px;font:inherit}.sample{border:2px solid #bf6d00;padding:3mm;font-weight:bold}.notes p{margin:2mm 0}.evidence{break-before:page}@media print{body{background:white}main{max-width:none;margin:0;padding:0}.toolbar{display:none}a{text-decoration:none}h1,h2{break-after:avoid}}@media(max-width:600px){main{margin:0;padding:16px}dl{grid-template-columns:30% 1fr}.numbers{font-size:8pt}}'+
    '</style></head><body><div class="toolbar"><button type="button" onclick="window.print()">印刷・PDF保存</button><div>印刷画面で「PDFに保存」を選べます。この操作では承認・通知は行いません。</div></div><main>'+
    (sample?'<div class="sample">見本・架空の記録です。実際の契約ではありません。</div>':'')+
    '<div class="brand">ステップワイズ個別指導</div><h1>'+title+'</h1><div class="meta"><div><b>対象生徒</b><br>'+value(first.studentName)+'</div><div><b>対象期間</b><br>'+value(l0.startDate)+' 〜 '+value(l0.endDate)+'</div><div class="status">'+state(status)+'</div></div>'+
    '<p class="small">書面番号：'+esc(documentId)+'／書類様式：'+AGREEMENT_LAYOUT+'</p>'+
    (status==='approved'?'<p>以下は、保存されている承認済みの内容です。承認者・日時・経路は次ページの各行の記録をご確認ください。</p>':'<p>この書面は承認済みの合意を示すものではありません。授業の実施には、具体的な内容について事前の承認が必要です。</p>')+
    '<h2>授業の内容と料金</h2>'+rows+'<div class="total"><span>予定総額（税込）</span><span>'+money(total)+'</span></div>'+
    '<div class="notes small"><p>予定総額は、上記の回数を実施した場合の金額であり、請求額の確定や授業の事前購入を示すものではありません。実際の授業料・キャンセル料金は、合意した条件と適用される受講規約に基づき精算します。</p><p>合意した回数は実施可能な上限です。全回数の受講義務、その回数分の受講保証、未実施分の繰越権を意味しません。具体的な日時は日程調整カレンダー等で別途調整します。</p></div>'+
    '<section class="evidence"><h2>提案・承認の記録と参照書類</h2><p class="small">選択した各行の版をまとめて表示しています。各行の承認日時は同一とは限りません。後の変更・追加分は含みません。「記録なし」は、当時の保存内容から確認できない項目です。入力日時と実際の承認日時は区別しています。</p>'+evidence+
    '<p class="small">参照書類は保存された ID・規約の版を表示しています。過去の書類には旧名称のものがあります。この書面の作成によって、当時の合意内容や適用規約を新しい版へ変更することはありません。</p></section>'+
    '<footer>ステップワイズ個別指導　代表者：麦倉優輔<br>埼玉県越谷市袋山1319-9　電話：080-6259-3025　メール：mugilives@gmail.com</footer></main></body></html>';
}
