// Dedicated owner/self-only records. Never include account details in generic profiles, audit logs or mail.
import { fail, newId, iso, sha256Hex } from './util.mjs';
import { requireStaff, requireOwner } from './staff.mjs';
export const BANK_CONSENT_VERSION='2026-10-17-v1';
export const BANK_CONSENT_TEXT='入力した口座が私本人の名義であることと、銀行・支店・預金種別・口座番号・名義が正しいことを確認し、この口座への給与振込に同意します。変更時は改めて提出し、代表の確認後に振込先が切り替わることを確認しました。';
const clean=(v,max)=>{const s=String(v??'').normalize('NFKC').trim();if(!s||s.length>max||/[\x00-\x1f\x7f]/.test(s))fail('badBank','入力内容と文字数を確認してください');return s;};
export function bankAccount(b){
 const bankName=clean(b.bankName,80),branchName=clean(b.branchName,80);
 const digits=(v,n,label,optional=false)=>{const s=String(v??'').normalize('NFKC').trim();if(optional&&!s)return '';if(!new RegExp('^\\d{'+n+'}$').test(s))fail('badBank',label+'を'+n+'桁の数字で入力してください');return s;};
 const bankCode=digits(b.bankCode,4,'金融機関コード',true),branchCode=digits(b.branchCode,3,'支店コード',true);
 if(!['ordinary','current'].includes(b.accountType))fail('badBank','預金種別を選んでください');
 const accountNumber=digits(b.accountNumber,7,'振込用の口座番号');
 const holderKana=clean(b.holderKana,100);
 if(!/^[ァ-ヶー・゙゚A-Z0-9 ()（）.\- ]+$/.test(holderKana))fail('badBank','口座名義はカナ（銀行に登録した表記）で入力してください');
 return {bankName,bankCode,branchName,branchCode,accountType:b.accountType,accountNumber,holderKana};
}
async function subject(c,id){
 const s=await c.db.prepare("select id,name from staff where id=? and contractType='employee'").bind(String(id||'')).first();
 if(!s)fail('notFound','講師が見つかりません',404);return s;
}
async function access(c,b,onlySelf=false){
 const me=await requireStaff(c,b);
 if(c.serviceStaff||onlySelf&&me.contractType!=='employee')fail('forbidden','講師本人だけが提出できます',403);
 const id=String(b.staffId||me.id);
 if((me.contractType!=='owner'||onlySelf)&&id!==me.id)fail('forbidden','本人の振込先だけを確認できます',403);
 if(me.contractType!=='owner'&&me.contractType!=='employee')fail('forbidden','本人または代表だけが確認できます',403);
 return {me,s:await subject(c,id)};
}
const state=async(c,id)=>await c.db.prepare('select * from staffBankState where staffId=?').bind(id).first()||{staffId:id,latestId:'',acceptedId:'',version:0};
export async function bankSummary(c,id){
 const st=await state(c,id),review=st.latestId?await c.db.prepare('select outcome from staffBankReviews where requestId=?').bind(st.latestId).first():null;
 return {submitted:!!st.latestId,accepted:!!st.acceptedId,pending:!!st.latestId&&!review,returned:review?.outcome==='returned'};
}
async function detail(c,s){
 const st=await state(c,s.id),requests=(await c.db.prepare('select r.*,v.outcome,v.reason,v.reviewedAt,v.reviewerName from staffBankRequests r left join staffBankReviews v on v.requestId=r.id where r.staffId=? order by r.submittedAt desc,r.rowid desc').bind(s.id).all()).results;
 const list=requests.map(r=>({...r,account:JSON.parse(r.account),current:r.id===st.acceptedId,status:r.outcome||(r.id===st.latestId?'pending':'superseded')}));
 return {staff:s,version:st.version,latestId:st.latestId,acceptedId:st.acceptedId,requests:list,consentVersion:BANK_CONSENT_VERSION,consentText:BANK_CONSENT_TEXT};
}
function expected(st,b){if(!Number.isSafeInteger(b.version)||b.version!==st.version)fail('conflict','振込先の状況が変わりました。読み直して確認してください',409);}
export const staffBankRoutes={
 'employment/bank/get':async(c,b)=>{const {s}=await access(c,b);return detail(c,s);},
 'employment/bank/submit':async(c,b)=>{
  const {me,s}=await access(c,b,true),st=await state(c,s.id);expected(st,b);
  if(b.agree!==true||b.consentVersion!==BANK_CONSENT_VERSION)fail('needAgree','本人名義・入力内容と振込への同意を確認してください');
  const account=JSON.stringify(bankAccount(b.account||{})),id=newId('bank'),now=iso(c.now),contentHash=sha256Hex(account+'\n'+BANK_CONSENT_VERSION+'\n'+BANK_CONSENT_TEXT);
  const result=await c.db.batch([
   c.db.prepare('insert or ignore into staffBankState(staffId) values(?)').bind(s.id),
   c.db.prepare('insert into staffBankRequests(id,staffId,account,contentHash,consentVersion,consentText,consenterId,consenterName,submittedAt) select ?,?,?,?,?,?,?,?,? where exists(select 1 from staffBankState where staffId=? and version=?)')
    .bind(id,s.id,account,contentHash,BANK_CONSENT_VERSION,BANK_CONSENT_TEXT,me.id,me.name,now,s.id,st.version),
   c.db.prepare('update staffBankState set latestId=?,version=version+1 where staffId=? and version=? and exists(select 1 from staffBankRequests where id=?)').bind(id,s.id,st.version,id),
   c.db.prepare("insert into auditLog(at,actorKind,actorId,action,target,detail) select ?,'staff',?,'staffBankSubmitted',?,'{}' where exists(select 1 from staffBankRequests where id=?)").bind(now,me.id,id,id)
  ]);
  if(result[1].meta.changes!==1||result[2].meta.changes!==1)fail('conflict','振込先の状況が変わりました。読み直して確認してください',409);
  return detail(c,s);
 },
 'employment/bank/review':async(c,b)=>{
  const me=await requireOwner(c,b),s=await subject(c,b.staffId),st=await state(c,s.id);expected(st,b);
  const r=await c.db.prepare('select * from staffBankRequests where id=? and staffId=?').bind(String(b.requestId||''),s.id).first();
  if(!r||r.id!==st.latestId||b.hash!==r.contentHash||await c.db.prepare('select 1 from staffBankReviews where requestId=?').bind(r.id).first())fail('conflict','最新の未確認の提出を確認してください',409);
  if(!['accepted','returned'].includes(b.outcome))fail('badReview','確認結果を選んでください');
  if(b.outcome==='accepted'&&b.confirm!==true)fail('needConfirm','口座の内容と本人の同意を確認してください');
  const reason=b.outcome==='returned'?clean(b.reason,200):'',now=iso(c.now),operationId=newId('br');
  const result=await c.db.batch([
   c.db.prepare('insert into staffBankReviews(requestId,operationId,outcome,reason,reviewedAt,reviewerId,reviewerName) select ?,?,?,?,?,?,? where exists(select 1 from staffBankState where staffId=? and version=? and latestId=?)')
    .bind(r.id,operationId,b.outcome,reason,now,me.id,me.name,s.id,st.version,r.id),
   c.db.prepare("update staffBankState set acceptedId=case when ?='accepted' then ? else acceptedId end,version=version+1 where staffId=? and version=? and latestId=? and exists(select 1 from staffBankReviews where operationId=?)")
    .bind(b.outcome,r.id,s.id,st.version,r.id,operationId),
   c.db.prepare("insert into auditLog(at,actorKind,actorId,action,target,detail) select ?,'staff',?, ?,?,'{}' where exists(select 1 from staffBankReviews where operationId=?)")
    .bind(now,me.id,b.outcome==='accepted'?'staffBankAccepted':'staffBankReturned',r.id,operationId)
  ]);
  if(result[0].meta.changes!==1||result[1].meta.changes!==1)fail('conflict','振込先の状況が変わりました。読み直して確認してください',409);
  return detail(c,s);
 }
};
