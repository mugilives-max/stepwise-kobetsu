// Personal information is registered by the employee; employment conditions stay owner-managed.
// 2026-10-17 本人の指摘: 氏名は本人に入力し直してもらう（招待時の氏名と違えば代表が確認して決める）。
// 勤務可能な曜日・時間は「勤務希望」として、初回登録では聞かない（代表が勤務条件を整えるときに本人と確認する）。
import { fail, newId, iso, sha256Hex } from './util.mjs';
import { requireStaff, requireOwner } from './staff.mjs';
const text=(v,max)=>{const s=String(v??'').trim();if(s.length>max)fail('tooLong','入力が長すぎます');return s;};
const need=(v,max,msg)=>{const s=text(v,max);if(!s)fail('badRegistration',msg);return s;};
export const TAX_SITUATIONS=['otherEmployer','noneElsewhere','unknown'];
export async function registrationState(c,id){
 return await c.db.prepare('select * from staffRegistrationState where staffId=?').bind(id).first()||{staffId:id,required:0,latestId:'',acceptedId:'',version:0};
}
const nameDiffers=(s,d)=>!!(d&&d.familyName)&&(d.familyName!==String(s.familyName||'')||d.givenName!==String(s.givenName||''));
export async function registrationDetail(c,id){
 const st=await registrationState(c,id),s=await c.db.prepare('select id,name,familyName,givenName from staff where id=?').bind(id).first()||{};
 const rows=(await c.db.prepare('select r.*,v.outcome,v.reason,v.reviewedAt,v.reviewerName from staffRegistrationRequests r left join staffRegistrationReviews v on v.requestId=r.id where r.staffId=? order by r.submittedAt desc,r.rowid desc').bind(id).all()).results;
 const requests=rows.map(r=>{const data=JSON.parse(r.data);return {...r,data,status:r.outcome||(r.id===st.latestId?'pending':'superseded'),submittedName:data.familyName?data.familyName+' '+data.givenName:'',nameDiffers:nameDiffers(s,data)};});
 const latest=requests.find(r=>r.id===st.latestId);
 return {...st,required:!!st.required,requests,pending:latest?.status==='pending',returned:latest?.status==='returned',accepted:!!st.acceptedId,staffName:s.name||''};
}
export async function requireRegistration(c,id){
 const r=await registrationDetail(c,id);
 if(r.required&&(!r.accepted||r.pending||r.returned))fail('needRegistration','先に本人情報の登録と代表の確認を済ませてください',409);
}
async function subject(c,id){
 const s=await c.db.prepare("select id,name,familyName,givenName,version from staff where id=? and contractType='employee'").bind(String(id||'')).first();
 if(!s)fail('notFound','講師が見つかりません',404);return s;
}
function expected(st,b){if(!Number.isSafeInteger(b.version)||b.version!==st.version)fail('conflict','登録状況が変わりました。読み直してください',409);}
export const staffRegistrationRoutes={
 'employment/registration/submit':async(c,b)=>{
  const me=await requireStaff(c,b);
  if(c.serviceStaff||me.contractType!=='employee'||b.staffId&&b.staffId!==me.id)fail('forbidden','本人だけが自分の情報を登録できます',403);
  const st=await registrationState(c,me.id);expected(st,b);
  if(b.confirm!==true)fail('needConfirm','入力した本人情報を確認してください');
  const d=b.data||{};
  const data={
   familyName:need(d.familyName,30,'姓を入力してください'),givenName:need(d.givenName,30,'名を入力してください'),
   address:need(d.address,500,'現住所を入力してください'),otherWork:need(d.otherWork,1500,'他の勤務先を入力してください（ない場合は「なし」）'),
   taxSituation:String(d.taxSituation||''),availability:text(d.availability,500) // 勤務希望は任意（初回登録では聞かない）
  };
  if(!TAX_SITUATIONS.includes(data.taxSituation))fail('badTax','扶養控除等申告書について、分かる範囲で選んでください');
  const json=JSON.stringify(data),id=newId('reg'),now=iso(c.now),contentHash=sha256Hex(json);
  const r=await c.db.batch([
   c.db.prepare('insert or ignore into staffRegistrationState(staffId) values(?)').bind(me.id),
   c.db.prepare('insert into staffRegistrationRequests(id,staffId,data,contentHash,submittedAt,submitterId,submitterName) select ?,?,?,?,?,?,? where exists(select 1 from staffRegistrationState where staffId=? and version=?)').bind(id,me.id,json,contentHash,now,me.id,me.name,me.id,st.version),
   c.db.prepare('update staffRegistrationState set latestId=?,version=version+1 where staffId=? and version=? and exists(select 1 from staffRegistrationRequests where id=?)').bind(id,me.id,st.version,id),
   c.db.prepare("insert into auditLog(at,actorKind,actorId,action,target,detail) select ?,'staff',?,'staffRegistrationSubmitted',?,'{}' where exists(select 1 from staffRegistrationRequests where id=?)").bind(now,me.id,id,id)
  ]);
  if(r[1].meta.changes!==1||r[2].meta.changes!==1)fail('conflict','登録状況が変わりました。読み直してください',409);
  return {registration:await registrationDetail(c,me.id)};
 },
 // 代表の確認。採用すると住所・他の勤務先（と、本人が書いていれば勤務希望）を雇用情報へ写す。
 // 本人が入力した氏名が招待時と違うときは、表示名に反映する（apply）か今のままにする（keep）かを代表が選ぶ。
 // 発行済みの契約書・同意・給与の記録は書き換えない（契約書は作ったときの氏名を固定して持つ）。
 'employment/registration/review':async(c,b)=>{
  const me=await requireOwner(c,b),s=await subject(c,b.staffId),st=await registrationState(c,s.id);expected(st,b);
  const r=await c.db.prepare('select * from staffRegistrationRequests where id=? and staffId=?').bind(String(b.requestId||''),s.id).first();
  if(!r||r.id!==st.latestId||r.contentHash!==b.hash||await c.db.prepare('select 1 from staffRegistrationReviews where requestId=?').bind(r.id).first())fail('conflict','最新の未確認の登録を確認してください',409);
  if(!['accepted','returned'].includes(b.outcome))fail('badReview','確認結果を選んでください');
  if(b.outcome==='accepted'&&b.confirm!==true)fail('needConfirm','本人が登録した内容を確認してください');
  const p=await c.db.prepare('select * from employmentProfiles where staffId=?').bind(s.id).first();
  if(!p||!Number.isSafeInteger(b.profileVersion)||b.profileVersion!==p.version)fail('conflict','勤務条件が更新されています。読み直してください',409);
  const submitted=JSON.parse(r.data),differs=nameDiffers(s,submitted);
  let nameDecision='';
  if(b.outcome==='accepted'&&differs){
   nameDecision=String(b.nameDecision||'');
   if(!['apply','keep'].includes(nameDecision))fail('needNameDecision','本人が入力した氏名が招待時の氏名と異なります。表示名に反映するか、今の表示名のままにするかを選んでください');
  }
  const prior=JSON.parse(p.data),data={...prior,address:submitted.address,otherWork:submitted.otherWork,...(submitted.availability?{availability:submitted.availability}:{})};
  const reason=b.outcome==='returned'?need(b.reason,500,'修正してほしい内容を入力してください'):'',now=iso(c.now),op=newId('regreview');
  const stmts=[
   c.db.prepare('insert into staffRegistrationReviews(requestId,operationId,outcome,reason,reviewedAt,reviewerId,reviewerName) select ?,?,?,?,?,?,? where exists(select 1 from staffRegistrationState where staffId=? and version=? and latestId=?) and exists(select 1 from employmentProfiles where staffId=? and version=?)').bind(r.id,op,b.outcome,reason,now,me.id,me.name,s.id,st.version,r.id,s.id,p.version),
   c.db.prepare("update employmentProfiles set data=?,updatedAt=?,version=version+1 where staffId=? and version=? and exists(select 1 from staffRegistrationReviews where operationId=? and outcome='accepted')").bind(JSON.stringify(data),now,s.id,p.version,op),
   c.db.prepare("update staffRegistrationState set acceptedId=case when ?='accepted' then ? else acceptedId end,version=version+1 where staffId=? and version=? and exists(select 1 from staffRegistrationReviews where operationId=?)").bind(b.outcome,r.id,s.id,st.version,op),
   c.db.prepare("insert into auditLog(at,actorKind,actorId,action,target,detail) select ?,'staff',?,'staffRegistrationReviewed',?,? where exists(select 1 from staffRegistrationReviews where operationId=?)").bind(now,me.id,r.id,JSON.stringify({outcome:b.outcome,nameDecision,submittedName:submitted.familyName?submitted.familyName+' '+submitted.givenName:'',previousName:s.name}),op)
  ];
  if(nameDecision==='apply')stmts.push(c.db.prepare("update staff set familyName=?,givenName=?,name=?,updatedAt=?,version=version+1 where id=? and version=? and exists(select 1 from staffRegistrationReviews where operationId=? and outcome='accepted')").bind(submitted.familyName,submitted.givenName,submitted.familyName+' '+submitted.givenName,now,s.id,s.version,op));
  const result=await c.db.batch(stmts);
  if(result[0].meta.changes!==1||result[2].meta.changes!==1||nameDecision==='apply'&&result[4].meta.changes!==1)fail('conflict','登録状況・勤務条件が変わりました。読み直してください',409);
  return {registration:await registrationDetail(c,s.id)};
 }
};
