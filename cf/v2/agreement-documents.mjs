import { fail, sha256Hex } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { requireFamily } from './family.mjs';
import { termsForVersion } from './terms.mjs';
import { lineView } from './billing.mjs';
import { agreementDocHtml, agreementLayout } from './agreement-doc-20261016.mjs';
import { agreementDocHtmlR13, usesLayoutR13, AGREEMENT_LAYOUT_R13, AGREEMENT_LAYOUT_R15, NAME_R15_TERMS, NAME_R16_TERMS, usesNameR15 } from './agreement-doc-20261026.mjs';

// Exact archived versions only. Never fall back to the current row or current family.
export async function planDocument(c,b,familyId=null) { return document(c,b,familyId); } // 承認の控えのメールに付ける書面（billing.mjs）
async function document(c,b,familyId=null) {
  if(!Array.isArray(b.refs)||!b.refs.length||b.refs.length>60) fail('badRefs','書面にする行を1〜60件選んでください');
  const seen=new Set(), records=[];
  for(const ref of b.refs) {
    if(!ref||typeof ref.id!=='string'||ref.id.length>100||!Number.isSafeInteger(ref.version)||ref.version<1||seen.has(ref.id)) fail('badRefs','同じ行の複数の版を一緒には出力できません');
    seen.add(ref.id);
    const row=await c.db.prepare('select * from planRevisions where planId=? and rowVersion=?').bind(ref.id,ref.version).first();
    if(!row||(familyId&&(row.familyId!==familyId||row.status==='draft'))) fail('notFound','この版の書面は開けません',404);
    const line=JSON.parse(row.snapshot);
    if(line.id!==ref.id||line.version!==ref.version||line.status!==row.status) fail('badSnapshot','保存内容を確認できません');
    records.push({line,studentName:row.studentName,studentId:row.studentId,familyId:row.familyId,capturedAt:row.capturedAt});
  }
  const a=records[0];
  if(records.some(r=>r.studentId!==a.studentId||r.familyId!==a.familyId||r.studentName!==a.studentName||r.line.startDate!==a.line.startDate||r.line.endDate!==a.line.endDate||r.line.status!==a.line.status)) fail('mixedDocument','生徒・対象期間・承認状態が同じ行ごとに書面を開いてください');
  records.sort((a,b)=>a.line.id.localeCompare(b.line.id,'en'));
  for(const r of records) r.terms=await termsForVersion(c.db,r.line.termsVersion);
  const key=records.map(r=>r.line.id+':'+r.line.version).join('|');
  // 2026-10-26 より後に作った行は、個別受講条件書と同じ書式（agreement-doc-20261026.mjs）。宛名は、承認の前は今の保護者の氏名、承認・見送りのあとは意思表示した保護者
  if(usesLayoutR13(records)){
    // 共通規約 r15 を使う規約に決めた（termsVersions に登録した）あとに作った行は「受講計画書」。前からの行は名前を変えない
    const adopted=await c.db.prepare('select min(registeredAt) registeredAt from termsVersions where version in (?,?)').bind(NAME_R15_TERMS,NAME_R16_TERMS).first();
    const r15=usesNameR15(records,adopted&&adopted.registeredAt);
    const layout=r15?AGREEMENT_LAYOUT_R15:AGREEMENT_LAYOUT_R13, documentId='AG-'+sha256Hex(layout+'|'+key).slice(0,20);
    const fam=await c.db.prepare('select guardianName from families where id=?').bind(a.familyId).first();
    return {documentId,layoutVersion:layout,html:agreementDocHtmlR13({records,documentId,guardianName:(fam&&fam.guardianName)||'',r15})};
  }
  const layout=agreementLayout(records), documentId='AG-'+sha256Hex(layout+'|'+key).slice(0,20);
  return {documentId,layoutVersion:layout,html:agreementDocHtml({records,documentId})};
}
export const agreementDocumentRoutes={
  'billing/plans/document':async(c,b)=>{await requireStaff(c,b,'manager');return document(c,b);},
  'family/plans/document':async(c,b)=>{const me=await requireFamily(c,b);return document(c,b,me.id);},
  'billing/plans/history':async(c,b)=>{
    await requireStaff(c,b,'manager');
    if(typeof b.studentId!=='string'||b.studentId.length>100)fail('badStudent','生徒を選んでください');
    const rows=(await c.db.prepare('select * from planRevisions where studentId=? order by id desc').bind(b.studentId).all()).results;
    return {plans:rows.map(r=>lineView(JSON.parse(r.snapshot),{studentName:r.studentName,capturedAt:r.capturedAt}))};
  },
};
