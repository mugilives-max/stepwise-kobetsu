'use strict';
const {createV2}=require('./v2-harness.cjs');
async function employmentWorld(){
 const h=await createV2(),auth=await h.owner();h.clock=Date.parse('2026-10-17T12:00:00+09:00');
 const data={address:'【テスト】住所',startDate:'2026-10-17',endDate:'2027-03-31',workWindow:'平日18:00〜22:00、土日8:00〜22:00。',weeklyHours:'週5〜6時間ほど。',hourly:'2000',employmentInsurance:'no',availability:'土曜15:00まで、日曜終日。金曜は勤務できない。',otherWork:'なし',taxDeclaration:'notSubmitted',taxCheckedOn:'2026-10-17',dependents:'',conditionsChecked:true,preparationNote:'【テスト】個別の条件を確認',bankConsentChecked:true,insuranceChecked:false};
 const made=await h.ok('employment/save',{auth,familyName:'【テスト】講師',givenName:'甲',email:'employment@example.invalid',testOnly:true,data}),staff=made.staff;
 // Model an employee registered before self-registration was introduced; new-flow tests use a fresh save.
 h.db2._sqlite.prepare('delete from staffRegistrationState where staffId=?').run(staff.id);
 const get=()=>h.ok('employment/get',{auth,staffId:staff.id});
 const invite=async()=>{
  await h.ok('employment/invite',{auth,staffId:staff.id,confirm:true});
  return (await h.ok('staff/invite/accept',{token:h.linkFrom(h.mails().at(-1)),password:'synthetic password 123'})).auth;
 };
 // 契約書の末尾に載る最初の1か月のシフト（契約の案を作る前に入れる）
 const firstShift=async()=>{if(!(await get()).days.some(x=>x.planVersion))await h.ok('work/plan',{auth,staffId:staff.id,date:'2026-10-20',version:0,intervals:[{start:'18:00',end:'19:30',kind:'lesson',label:'【テスト】最初の授業'}],reason:'【テスト】最初の1か月のシフト'});};
 const create=async(method='electronic')=>{await firstShift();return (await h.ok('employment/contract/create',{auth,staffId:staff.id,version:(await get()).profile.version,method})).contract;};
 const issue=async(r)=>(await h.ok('employment/contract/issue',{auth,id:r.id,version:r.version,hash:r.contentHash,agree:true})).contract;
 const contract=async id=>(await get()).contracts.find(r=>r.id===id);
 const tick=()=>{h.clock+=60000;return new Date(h.clock).toISOString();};
 const pref=async(r,ta)=>(await h.ok('employment/contract/preference',{auth:ta,id:r.id,version:r.version,wish:true,recipient:'employment@example.invalid'})).contract;
 const deliver=async(r)=>(await h.ok('employment/contract/delivery',{auth,id:r.id,version:r.version,hash:r.contentHash,deliveredAt:tick(),note:'【テスト】同じ版のPDFを本人指定先へ送付し受領を確認',delivered:true})).contract;
 const agree=async(r,ta)=>(await h.ok('employment/contract/accept',{auth:ta,id:r.id,version:r.version,hash:r.contentHash,consenterName:staff.name,agree:true,received:true})).contract;
return {h,auth,data,staff,get,invite,firstShift,create,issue,contract,tick,pref,deliver,agree};
}
module.exports={employmentWorld};
