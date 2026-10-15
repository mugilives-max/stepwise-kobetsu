'use strict';
const {createV2}=require('./v2-harness.cjs');
async function agreementFixture() {
 const h=await createV2(),auth=await h.owner();
 const fam=(await h.ok('admin/families/create',{auth,name:'【テスト】架空家',guardianName:'【テスト】架空 保護者',email:'agreement@example.invalid'})).family;
 const kid=(await h.ok('admin/students/create',{auth,familyId:fam.id,familyName:'【テスト】架空',givenName:'一郎',baseRate30:1500})).student;
 await h.ok('admin/families/invite',{auth,id:fam.id});
 const parent=(await h.ok('family/invite/accept',{token:h.linkFrom(h.mails().at(-1)),password:'synthetic password 1'})).auth;
 const row=id=>h.rows('select * from planLines where id=?',id)[0];
 const plan=async(extra={})=>(await h.ok('billing/plans/save',{auth,studentId:kid.id,subject:'数学',kind:'通常',startDate:'2026-11-01',endDate:'2026-11-30',count:4,minutes:90,fee:4500,comment:'二次関数の復習と定期テスト対策',parts:[{label:'復習',count:2},{label:'定期テスト対策',count:2}],...extra})).line;
 const approve=async(p,extra={})=>(await h.ok('billing/plans/consent',{auth,id:p.id,version:row(p.id).version,consenterName:'【テスト】架空 保護者',consentedAt:'2026-10-02T11:30:00+09:00',via:'LINE',...extra})).line;
 const refs=(...ps)=>ps.map(p=>({id:p.id,version:p.version}));
 return {h,auth,fam,kid,parent,row,plan,approve,refs};
}
module.exports={agreementFixture};
