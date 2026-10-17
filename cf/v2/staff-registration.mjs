// Personal information is submitted by the employee; employment conditions stay owner-managed.
import { fail, newId, iso, sha256Hex } from './util.mjs';
import { requireStaff, requireOwner } from './staff.mjs';
const clean=(v,max)=>{const s=String(v??'').trim();if(!s||s.length>max)fail('badRegistration','住所・勤務可能時間・他の勤務先を入力してください');return s;};
export async function registrationState(c,id){
 return await c.db.prepare('select * from staffRegistrationState where staffId=?').bind(id).first()||{staffId:id,required:0,latestId:'',acceptedId:'',version:0};
}
export async function registrationDetail(c,id){
 const st=await registrationState(c,id);
 const rows=(await c.db.prepare('select r.*,v.outcome,v.reason,v.reviewedAt,v.reviewerName from staffRegistrationRequests r left join staffRegistrationReviews v on v.requestId=r.id where r.staffId=? order by r.submittedAt desc,r.rowid desc').bind(id).all()).results;
 const requests=rows.map(r=>({...r,data:JSON.parse(r.data),status:r.outcome||(r.id===st.latestId?'pending':'superseded')}));
 const latest=requests.find(r=>r.id===st.latestId);
 return {...st,required:!!st.required,requests,pending:latest?.status==='pending',returned:latest?.status==='returned',accepted:!!st.acceptedId};
}
export async function requireRegistration(c,id){
 const r=await registrationDetail(c,id);
 if(r.required&&(!r.accepted||r.pending||r.returned))fail('needRegistration','先に本人情報の提出と代表の確認を済ませてください',409);
}
async function subject(c,id){
 const s=await c.db.prepare("select id,name from staff where id=? and contractType='employee'").bind(String(id||'')).first();
 if(!s)fail('notFound','講師が見つかりません',404);return s;
}
function expected(st,b){if(!Number.isSafeInteger(b.version)||b.version!==st.version)fail('conflict','提出状況が変わりました。読み直してください',409);}
export const staffRegistrationRoutes={
 'employment/registration/submit':async(c,b)=>{
  const me=await requireStaff(c,b);
  if(c.serviceStaff||me.contractType!=='employee'||b.staffId&&b.staffId!==me.id)fail('forbidden','本人だけが自分の情報を提出できます',403);
  const st=await registrationState(c,me.id);expected(st,b);
  if(b.confirm!==true)fail('needConfirm','氏名と入力した本人情報を確認してください');
  const d=b.data||{},data={address:clean(d.address,500),availability:clean(d.availability,500),otherWork:clean(d.otherWork,1500),taxSituation:String(d.taxSituation||'')};
  if(!['otherEmployer','noneElsewhere','unknown'].includes(data.taxSituation))fail('badTax','扶養控除等申告書について、分かる範囲で選んでください');
  const json=JSON.stringify(data),id=newId('reg'),now=iso(c.now),contentHash=sha256Hex(json);
  const r=await c.db.batch([
   c.db.prepare('insert or ignore into staffRegistrationState(staffId) values(?)').bind(me.id),
   c.db.prepare('insert into staffRegistrationRequests(id,staffId,data,contentHash,submittedAt,submitterId,submitterName) select ?,?,?,?,?,?,? where exists(select 1 from staffRegistrationState where staffId=? and version=?)').bind(id,me.id,json,contentHash,now,me.id,me.name,me.id,st.version),
   c.db.prepare('update staffRegistrationState set latestId=?,version=version+1 where staffId=? and version=? and exists(select 1 from staffRegistrationRequests where id=?)').bind(id,me.id,st.version,id),
   c.db.prepare("insert into auditLog(at,actorKind,actorId,action,target,detail) select ?,'staff',?,'staffRegistrationSubmitted',?,'{}' where exists(select 1 from staffRegistrationRequests where id=?)").bind(now,me.id,id,id)
  ]);
  if(r[1].meta.changes!==1||r[2].meta.changes!==1)fail('conflict','提出状況が変わりました。読み直してください',409);
  return {registration:await registrationDetail(c,me.id)};
 },
 'employment/registration/review':async(c,b)=>{
  const me=await requireOwner(c,b),s=await subject(c,b.staffId),st=await registrationState(c,s.id);expected(st,b);
  const r=await c.db.prepare('select * from staffRegistrationRequests where id=? and staffId=?').bind(String(b.requestId||''),s.id).first();
  if(!r||r.id!==st.latestId||r.contentHash!==b.hash||await c.db.prepare('select 1 from staffRegistrationReviews where requestId=?').bind(r.id).first())fail('conflict','最新の未確認の提出を確認してください',409);
  if(!['accepted','returned'].includes(b.outcome))fail('badReview','確認結果を選んでください');
  if(b.outcome==='accepted'&&b.confirm!==true)fail('needConfirm','本人が提出した内容を確認してください');
  const p=await c.db.prepare('select * from employmentProfiles where staffId=?').bind(s.id).first();
  if(!p||!Number.isSafeInteger(b.profileVersion)||b.profileVersion!==p.version)fail('conflict','勤務条件が更新されています。読み直してください',409);
  const submitted=JSON.parse(r.data),data={...JSON.parse(p.data),address:submitted.address,availability:submitted.availability,otherWork:submitted.otherWork};
  const reason=b.outcome==='returned'?clean(b.reason,500):'',now=iso(c.now),op=newId('regreview');
  const result=await c.db.batch([
   c.db.prepare('insert into staffRegistrationReviews(requestId,operationId,outcome,reason,reviewedAt,reviewerId,reviewerName) select ?,?,?,?,?,?,? where exists(select 1 from staffRegistrationState where staffId=? and version=? and latestId=?) and exists(select 1 from employmentProfiles where staffId=? and version=?)').bind(r.id,op,b.outcome,reason,now,me.id,me.name,s.id,st.version,r.id,s.id,p.version),
   c.db.prepare("update employmentProfiles set data=?,updatedAt=?,version=version+1 where staffId=? and version=? and exists(select 1 from staffRegistrationReviews where operationId=? and outcome='accepted')").bind(JSON.stringify(data),now,s.id,p.version,op),
   c.db.prepare("update staffRegistrationState set acceptedId=case when ?='accepted' then ? else acceptedId end,version=version+1 where staffId=? and version=? and exists(select 1 from staffRegistrationReviews where operationId=?)").bind(b.outcome,r.id,s.id,st.version,op),
   c.db.prepare("insert into auditLog(at,actorKind,actorId,action,target,detail) select ?,'staff',?,'staffRegistrationReviewed',?,'{}' where exists(select 1 from staffRegistrationReviews where operationId=?)").bind(now,me.id,r.id,op)
  ]);
  if(result[0].meta.changes!==1||result[2].meta.changes!==1)fail('conflict','提出状況・勤務条件が変わりました。読み直してください',409);
  return {registration:await registrationDetail(c,s.id)};
 }
};
