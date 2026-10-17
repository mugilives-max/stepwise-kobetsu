import { registrationState, registrationDetail, requireRegistration } from './staff-registration.mjs';
import { bankSummary } from './staff-bank.mjs';
import { fail, newId, normEmail, validEmail, iso, audit, sha256Hex } from './util.mjs';
import { requireStaff, requireOwner, staffView } from './staff.mjs';
import { issueChallenge } from './accounts.mjs';
import { employmentSnapshot, employmentDocument } from './employment-document.mjs';
export const dateOK = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d||'')) && Number.isFinite(Date.parse(d+'T00:00:00Z')) && new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const text=(v,max=500)=>{v=String(v||'').trim();if(v.length>max)fail('tooLong','入力が長すぎます');return v;};
export const checkVersion=(r,b)=>{if(Number(b.version)!==r.version)fail('conflict','内容が更新されています。読み直して確認してください',409);};
export async function employee(c,id) {
 const s=await c.db.prepare("select * from staff where id=? and contractType='employee'").bind(String(id||'')).first();
 if(!s)fail('notFound','講師が見つかりません',404);return s;
}
export function actualTime(c,v) {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(String(v||''))||!Number.isFinite(Date.parse(v))||Date.parse(v)>c.now)fail('badTime','実際の日時を、現在までの日時で入力してください');
 return new Date(v).toISOString();
}
const rowView=r=>({...r,snapshot:JSON.parse(r.snapshot)});
const profileView=r=>r?{...r,data:JSON.parse(r.data)}:null;
const contractRow=async(c,id)=>{const r=await c.db.prepare('select * from employmentContracts where id=?').bind(String(id||'')).first();if(!r)fail('notFound','契約書が見つかりません',404);return r;};
async function access(c,b,id) {const me=await requireStaff(c,b);if(me.contractType!=='owner'&&me.id!==id)fail('forbidden','自分の書類だけを確認できます',403);return me;}
async function change(c,r,me,action,values,at=iso(c.now),detail={}) {
 const cols=Object.keys(values),now=iso(c.now),next=r.version+1;
 const result=await c.db.batch([
  c.db.prepare('update employmentContracts set '+cols.map(k=>k+'=?').join(',')+', updatedAt=?, version=version+1 where id=? and version=?').bind(...Object.values(values),now,r.id,r.version),
  c.db.prepare('insert or ignore into employmentEvents(contractId,action,actualAt,recordedAt,actorId,actorName,detail,contractVersion) select ?,?,?,?,?,?,?,? where exists(select 1 from employmentContracts where id=? and version=?)')
   .bind(r.id,action,at,now,me.id,me.name,JSON.stringify(detail),next,r.id,next)
 ]);
 if(result[0].meta.changes!==1)fail('conflict','ほかの操作で更新されました。読み直してください',409);
 await audit(c,'employment'+action,r.id,{version:next});return rowView(await contractRow(c,r.id));
}
function profileData(b) {
 const p={};
 for(const k of ['address','startDate','endDate','workWindow','weeklyHours','availability','otherWork','taxDeclaration','dependents','taxCheckedOn','preparationNote','insuranceNote'])p[k]=text(b[k],k==='otherWork'?1500:500);
 if(p.dependents!==''&&(!/^\d$/.test(p.dependents)||Number(p.dependents)>7))fail('badDependents','扶養人数は0〜7人で確認してください');
 for(const k of ['conditionsChecked','bankConsentChecked','insuranceChecked'])p[k]=b[k]===true;
 if(p.startDate&&!dateOK(p.startDate)||p.endDate&&!dateOK(p.endDate)||p.taxCheckedOn&&!dateOK(p.taxCheckedOn)||p.startDate&&p.endDate&&p.endDate<p.startDate)fail('badDate','契約期間・確認日を確認してください');
 if(p.taxDeclaration&&!['submitted','notSubmitted'].includes(p.taxDeclaration))fail('badTax','申告書の確認状況を選んでください');
 return p;
}
async function readiness(c,s,p,contracts) {
 const checks=[];
 const reg=await registrationDetail(c,s.id);if(reg.required&&(!reg.accepted||reg.pending||reg.returned))checks.push(reg.pending?'本人情報を代表が確認':'本人情報の登録・提出');
 if(!validEmail(s.email))checks.push('招待先メールアドレスを登録');
 if(!p)checks.push('基本情報を登録');
 if(!contracts.some(r=>r.status==='agreed'))checks.push('契約の締結・交付');
 if(p) {
  const d=JSON.parse(p.data);
  if(!d.conditionsChecked)checks.push('未確定事項・勤務条件の確認');
  if(!d.taxDeclaration||!d.taxCheckedOn||(d.taxDeclaration==='submitted'&&d.dependents===''))checks.push('扶養控除等申告書の確認');
  if(d.taxDeclaration&&((d.taxDeclaration==='submitted'?'kou':'otsu')!==s.taxColumn||(d.taxDeclaration==='submitted'&&Number(d.dependents)!==s.dependents)))checks.push('申告書と給与の源泉区分・扶養人数の照合');
  const bank=await bankSummary(c,s.id);
  if(!bank.accepted&&(bank.submitted||!d.bankConsentChecked))checks.push(bank.pending?'提出された給与振込先を代表が確認':bank.returned?'給与振込先の修正・再提出':'振込先の受領・振込への同意確認');
 }
 const rates=(await c.db.prepare('select * from staffRates where staffId=? order by startsOn desc').bind(s.id).all()).results;
 const agreed=contracts.find(r=>r.status==='agreed');
 if(agreed) {
  const r=rates.find(r=>r.startsOn<=agreed.startDate),snap=JSON.parse(agreed.snapshot);
  if(!r||r.lessonHourly!==snap.lessonHourly)checks.push('契約と時給設定の照合');
 }
 const shifts=(await c.db.prepare('select id,date,planVersion,planAgreedVersion,planAgreedAt from workDays where staffId=? and planVersion>0 order by date').bind(s.id).all()).results;
 if(!shifts.some(d=>d.planAgreedVersion===d.planVersion&&d.planAgreedAt&&agreed&&d.date>=agreed.startDate&&d.date<=agreed.endDate))checks.push('初日の勤務予定を本人と確認');
 if(s.status!=='active')checks.push('本人のアカウント設定');
 return checks;
}
async function detail(c,id,me) {
 const s=await employee(c,id),p=await c.db.prepare('select * from employmentProfiles where staffId=?').bind(s.id).first();
 const contracts=(await c.db.prepare('select * from employmentContracts where staffId=? order by revision desc').bind(s.id).all()).results;
 const visible=me.contractType==='owner'?contracts:contracts.filter(r=>r.status!=='draft');
 const events=(await c.db.prepare('select e.* from employmentEvents e join employmentContracts x on x.id=e.contractId where x.staffId=? order by e.id').bind(s.id).all()).results.filter(e=>visible.some(r=>r.id===e.contractId));
 const mail=(await c.db.prepare("select id,status,deliveryState,error,sentAt,createdAt from effects where json_extract(payload,'$.notice.type')='challenge' and json_extract(payload,'$.to')=? order by id desc limit 1").bind(s.email).all()).results[0]||null;
 const days=(await c.db.prepare("select id,date,status,planVersion,planAgreedVersion,payrollId from workDays where staffId=? order by date desc limit 60").bind(s.id).all()).results;
 const requests=(await c.db.prepare("select a.id,w.date,a.at,a.detail from auditLog a join workDays w on w.id=a.target where w.staffId=? and a.action='workCorrectionRequested' and not exists(select 1 from auditLog z where z.target=w.id and z.action='workCorrectionAnswered' and json_extract(z.detail,'$.requestId')=a.id) order by a.id").bind(s.id).all()).results;
 return {registration:await registrationDetail(c,s.id),bank:await bankSummary(c,s.id),days,requests,staff:staffView(s),profile:profileView(p),contracts:visible.map(rowView),events,inviteDelivery:mail,checks:await readiness(c,s,p,contracts)};
}
export const employmentRoutes={
 'employment/list':async(c,b)=>{
  await requireOwner(c,b);
  const rows=(await c.db.prepare("select s.id,s.name,s.email,s.status,s.employmentAccess,p.invitedAt,p.version from staff s left join employmentProfiles p on p.staffId=s.id where s.contractType='employee' order by s.createdAt").all()).results;
  for(const s of rows){
   s.bank=await bankSummary(c,s.id);
   const reg=await registrationDetail(c,s.id);s.registration={required:reg.required,submitted:!!reg.latestId,pending:reg.pending,returned:reg.returned,accepted:reg.accepted};
   s.pendingWork=Number((await c.db.prepare("select count(*) n from workDays where staffId=? and status='submitted'").bind(s.id).first()).n);
   s.pendingCorrections=Number((await c.db.prepare("select count(*) n from auditLog a join workDays w on w.id=a.target where w.staffId=? and a.action='workCorrectionRequested' and not exists(select 1 from auditLog z where z.target=w.id and z.action='workCorrectionAnswered' and json_extract(z.detail,'$.requestId')=a.id)").bind(s.id).first()).n);
  }
  return {staff:rows};
 },
 'employment/get':async(c,b)=>{const me=await requireOwner(c,b);return detail(c,b.staffId,me);},
 'employment/mine':async(c,b)=>{const me=await requireStaff(c,b);if(me.contractType==='owner')return {owner:true};return detail(c,me.id,me);},
 'employment/save':async(c,b)=>{
  const me=await requireOwner(c,b),now=iso(c.now);let data=profileData(b.data||{});
  let s;
  if(b.staffId) {
   s=await employee(c,b.staffId);const old=await c.db.prepare('select * from employmentProfiles where staffId=?').bind(s.id).first();
   if(old) {
    const reg=await registrationState(c,s.id),prior=JSON.parse(old.data);
    if(reg.required){
     for(const k of ['address','availability','otherWork'])if(Object.hasOwn(b.data||{},k)&&data[k]!==String(prior[k]||''))fail('selfOnly','本人情報は本人が提出し、代表が確認する手順で更新してください',409);
     data=profileData({...prior,...b.data,address:prior.address,availability:prior.availability,otherWork:prior.otherWork});
    }
    checkVersion(old,b);const r=await c.db.prepare('update employmentProfiles set data=?,updatedAt=?,version=version+1 where staffId=? and version=?').bind(JSON.stringify(data),now,s.id,old.version).run();if(r.meta.changes!==1)fail('conflict','読み直してください',409);}
   else {if(Number(b.version)!==0)fail('conflict','読み直してください',409);await c.db.prepare('insert into employmentProfiles(staffId,data,createdAt,updatedAt) values(?,?,?,?)').bind(s.id,JSON.stringify(data),now,now).run();}
  } else {
   const familyName=text(b.familyName,30),givenName=text(b.givenName,30),email=normEmail(b.email);
   if(!familyName||!givenName)fail('badName','氏名を入力してください');
   if(email&&!validEmail(email))fail('badEmail','メールアドレスを確かめてください。未定の場合は空欄で保存できます');
   if(email&&await c.db.prepare('select 1 from staff where email=?').bind(email).first())fail('duplicate','このメールアドレスは登録済みです。既存の講師を開いてください',409);
   s={id:newId('st'),name:familyName+' '+givenName,email};
   await c.db.batch([
    c.db.prepare("insert into staff(id,name,familyName,givenName,email,roles,status,contractType,employmentAccess,testOnly,createdAt,updatedAt) values(?,?,?,?,?,'teacher','invited','employee',0,?,?,?)").bind(s.id,s.name,familyName,givenName,email,b.testOnly===true&&s.name.startsWith('【テスト】')?1:0,now,now),
    c.db.prepare('insert into employmentProfiles(staffId,data,createdAt,updatedAt) values(?,?,?,?)').bind(s.id,JSON.stringify(data),now,now),
    c.db.prepare('insert into staffRegistrationState(staffId,required) values(?,1)').bind(s.id)
   ]);
  }
  await audit(c,'employmentProfileSaved',s.id);return detail(c,s.id,me);
 },
 // Email is editable only before any invitation. Profile/contract/payroll records are untouched.
 'employment/email':async(c,b)=>{
  const me=await requireOwner(c,b),s=await employee(c,b.staffId),email=normEmail(b.email);
  checkVersion(s,b);
  if(email&&!validEmail(email))fail('badEmail','メールアドレスを確かめてください');
  if(s.status!=='invited'||await c.db.prepare("select 1 from authChallenges where subjectId=? and purpose='staffInvite'").bind(s.id).first())fail('alreadyInvited','招待済みのメールアドレスはこの画面では変更できません',409);
  if(email&&await c.db.prepare('select 1 from staff where email=? and id<>?').bind(email,s.id).first())fail('duplicate','このメールアドレスは登録済みです。既存の講師を確認してください',409);
  const r=await c.db.prepare("update staff set email=?,updatedAt=?,version=version+1 where id=? and version=? and status='invited' and not exists(select 1 from authChallenges where subjectId=staff.id and purpose='staffInvite') and not exists(select 1 from employmentProfiles where staffId=staff.id and invitedAt<>'')")
   .bind(email,iso(c.now),s.id,s.version).run();
  if(r.meta.changes!==1)fail('conflict','ほかの操作で更新されています。読み直して確認してください',409);
  await audit(c,'employmentEmailSaved',s.id);return detail(c,s.id,me);
 },
 'employment/invite':async(c,b)=>{
  const me=await requireOwner(c,b),s=await employee(c,b.staffId);
  if(s.status!=='invited')fail('notInvited','招待前・招待中の講師だけに送れます');
  if(!validEmail(s.email))fail('needEmail','本人のメールアドレスを登録してから招待してください');
  if(b.email!==undefined&&normEmail(b.email)!==s.email)fail('conflict','招待先が変わっています。読み直して確認してください',409);
  const p=await c.db.prepare('select * from employmentProfiles where staffId=?').bind(s.id).first();if(!p)fail('needProfile','先に雇用情報を登録してください');
  if(b.confirm!==true)fail('needConfirm','宛先を確認してから招待してください');
  const inviteUrl=await issueChallenge(c,'staff','staffInvite',s,{subject:'【ステップワイズ】雇用契約の確認・アカウント設定',body:url=>'入職の手続きを進めるアカウントをご用意しました。7日以内に、ご本人がリンクからパスワードを設定してください。\n\n'+url+'\n\n設定後は「雇用・勤務」の案内に沿って、住所・勤務可能時間などの本人情報を登録してください。代表が確認して勤務条件を整えたあと、契約書をご案内します。アカウントの設定だけでは契約への同意にはなりません。リンクを再送した場合、前のリンクは使えません。\n届かない・開けない場合は代表へご連絡ください。'});
  await c.db.prepare('update employmentProfiles set invitedAt=?,updatedAt=?,version=version+1 where staffId=?').bind(iso(c.now),iso(c.now),s.id).run();
  await audit(c,'employmentInvite',s.id);return {inviteUrl,...await detail(c,s.id,me)};
 },
 'employment/contract/create':async(c,b)=>{
  const me=await requireOwner(c,b),s=await employee(c,b.staffId),p=await c.db.prepare('select * from employmentProfiles where staffId=?').bind(s.id).first();
  if(!p)fail('needProfile','基本情報を保存してください');checkVersion(p,b);await requireRegistration(c,s.id);
  const d=JSON.parse(p.data);
  if(['address','startDate','endDate','workWindow','weeklyHours','availability','otherWork','taxDeclaration','taxCheckedOn'].some(k=>!d[k]))fail('incomplete','住所・契約期間・勤務条件・他の勤務先・申告書の確認を入力してください');
  if(!['paper','electronic'].includes(b.method))fail('badMethod','紙か電子を選んでください');
  const snap=JSON.stringify(employmentSnapshot(s,d)),id=newId('ec'),now=iso(c.now);
  const revision=Number((await c.db.prepare('select max(revision) n from employmentContracts where staffId=?').bind(s.id).first()).n||0)+1;
  await c.db.prepare("insert into employmentContracts(id,staffId,revision,status,method,snapshot,contentHash,startDate,endDate,createdAt,updatedAt) values(?,?,?,'draft',?,?,?,?,?,?,?)").bind(id,s.id,revision,b.method,snap,sha256Hex(snap),d.startDate,d.endDate,now,now).run();
  await audit(c,'employmentDraft',id);return {contract:rowView(await contractRow(c,id))};
 },
 'employment/contract/issue':async(c,b)=>{
  const me=await requireOwner(c,b),r=await contractRow(c,b.id);checkVersion(r,b);
  await requireRegistration(c,r.staffId);
  if(r.status!=='draft'||b.agree!==true||b.hash!==r.contentHash)fail('needReview','この版の全文を確認し、代表として合意する操作が必要です');
  const p=JSON.parse((await c.db.prepare('select data from employmentProfiles where staffId=?').bind(r.staffId).first()).data);
  if(!p.conditionsChecked)fail('incomplete','契約ひな形の確認事項と個別条件を確認してから発行してください');
  const pending=(await c.db.prepare("select * from employmentContracts where staffId=? and status='issued' and startDate<=? and endDate>=?").bind(r.staffId,r.endDate,r.startDate).all()).results;
  if(pending.length)fail('pendingVersion','対象期間が重なる未締結の版があります。先に取り下げてください',409);
  return {contract:await change(c,r,me,'代表の発行・合意',{status:'issued',issuedAt:iso(c.now),issuedBy:me.name})};
 },
 'employment/contract/withdraw':async(c,b)=>{
  const me=await requireOwner(c,b),r=await contractRow(c,b.id);checkVersion(r,b);
  if(!['draft','issued'].includes(r.status)||!text(b.reason))fail('closed','未締結の案だけを、理由を残して取り下げられます');
  return {contract:await change(c,r,me,'取り下げ',{status:'withdrawn'},iso(c.now),{reason:text(b.reason)})};
 },
 'employment/contract/preference':async(c,b)=>{
  const me=await requireStaff(c,b),r=await contractRow(c,b.id);checkVersion(r,b);
  if(r.staffId!==me.id)fail('forbidden','本人だけが選べます',403);
  if(r.method!=='electronic'||r.status!=='issued'||r.deliveredAt)fail('closed','電子交付前の書面だけで選べます',409);
  const recipient=normEmail(b.recipient);
  if(b.wish!==true||!validEmail(recipient))fail('needWish','電子交付を希望することと、受取先を確認してください。紙を希望する場合は代表へお知らせください');
  return {contract:await change(c,r,me,'電子交付を希望',{preferenceAt:iso(c.now),recipient})};
 },
 'employment/contract/delivery':async(c,b)=>{
  const me=await requireOwner(c,b),r=await contractRow(c,b.id);checkVersion(r,b);
  if(r.status!=='issued'||b.hash!==r.contentHash)fail('closed','発行したこの版の交付を記録してください',409);
  const at=actualTime(c,b.deliveredAt),note=text(b.note);
  if(at<r.issuedAt||!note||b.delivered!==true)fail('needDelivery','発行後に実際に交付した日時・方法・確認結果を入力してください');
  if(r.method==='electronic'&&(!r.preferenceAt||at<r.preferenceAt))fail('needWish','先に本人の電子交付の希望を確認してください');
  return {contract:await change(c,r,me,'交付を記録',{deliveredAt:at,deliveryNote:note},at,{method:r.method,recipient:r.recipient,note})};
 },
 'employment/contract/paper':async(c,b)=>{
  const me=await requireOwner(c,b),r=await contractRow(c,b.id);checkVersion(r,b);
  if(r.status!=='issued'||r.method!=='paper'||!r.deliveredAt||b.hash!==r.contentHash)fail('closed','紙の発行・交付を確認してから署名を記録してください',409);
  const at=actualTime(c,b.agreedAt),name=text(b.consenterName,100),ref=text(b.evidenceRef,500);
  if(at<r.issuedAt||!name||!ref||b.signed!==true)fail('needEvidence','双方の署名・実際の署名日時・講師氏名・署名済み控えの非公開保管先を確認してください');
  return {contract:await change(c,r,me,'紙の署名を記録',{status:'agreed',agreedAt:at,consenterName:name,evidenceRef:ref},at,{evidenceRef:ref,consenterName:name})};
 },
 'employment/contract/accept':async(c,b)=>{
  const me=await requireStaff(c,b),r=await contractRow(c,b.id);checkVersion(r,b);
  if(r.staffId!==me.id)fail('forbidden','本人だけが同意できます',403);
  if(r.status!=='issued'||r.method!=='electronic'||!r.deliveredAt||!r.preferenceAt||b.hash!==r.contentHash)fail('needDelivery','同じ版の交付が済んでから同意してください',409);
  const name=text(b.consenterName,100);
  if(b.agree!==true||b.received!==true||!name)fail('needAgree','交付された書面を受け取り保存できること、全文への同意、氏名を確認してください');
  return {contract:await change(c,r,me,'本人の電子同意',{status:'agreed',agreedAt:iso(c.now),consenterName:name})};
 },
 'employment/contract/document':async(c,b)=>{
  const r=await contractRow(c,b.id),me=await access(c,b,r.staffId);
  if(me.contractType!=='owner'&&r.status==='draft')fail('notFound','書面はまだ発行されていません',404);
  const events=(await c.db.prepare('select * from employmentEvents where contractId=? order by id').bind(r.id).all()).results;
  return {html:employmentDocument(r,events),contentHash:r.contentHash};
 },
 'employment/activate':async(c,b)=>{
  const me=await requireOwner(c,b),d=await detail(c,b.staffId,me);
  if(d.checks.length)fail('incomplete','次の確認が必要です：'+d.checks.join(' / '),409);
  await c.db.prepare('update staff set employmentAccess=1,updatedAt=?,version=version+1 where id=?').bind(iso(c.now),b.staffId).run();
  await audit(c,'employmentActivated',b.staffId);return detail(c,b.staffId,me);
 }
};
