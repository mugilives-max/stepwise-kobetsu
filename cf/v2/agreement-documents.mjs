import { fail, sha256Hex } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { requireFamily } from './family.mjs';
import { termsForVersion } from './terms.mjs';
import { lineView } from './billing.mjs';
import { agreementDocHtml, AGREEMENT_LAYOUT } from './agreement-doc-20261016.mjs';

// Exact archived versions only. Never fall back to the current row or current family.
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
  const documentId='AG-'+sha256Hex(AGREEMENT_LAYOUT+'|'+key).slice(0,20);
  return {documentId,layoutVersion:AGREEMENT_LAYOUT,html:agreementDocHtml({records,documentId})};
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
