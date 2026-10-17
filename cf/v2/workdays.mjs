import { fail, newId, iso, audit } from './util.mjs';
import { requireStaff, requireOwner } from './staff.mjs';
import { employee, dateOK, checkVersion } from './employment.mjs';
import { todayJst } from './schedule.mjs';
export const WORK_LABEL={lesson:'授業',prep:'準備・記録',other:'事務・見学・研修',meeting:'面談',break:'休憩'};
export const minute=s=>{if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(s))&&s!=='24:00')fail('badTime','時刻は00:00〜24:00で入力してください');return Number(s.slice(0,2))*60+Number(s.slice(3));};
const hm=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export function intervals(v) {
 if(!Array.isArray(v)||v.length>80)fail('badWork','時間の区間は80件以内にしてください');
 const out=v.map(x=>{
  const start=minute(x.start),end=minute(x.end),kind=String(x.kind),label=String(x.label||'').trim();
  if(!WORK_LABEL[kind]||end<=start||label.length>200)fail('badWork','仕事の種類・開始と終了・内容を確認してください');
  return {start:hm(start),end:hm(end),kind,label};
 }).sort((a,b)=>a.start.localeCompare(b.start));
 for(let i=1;i<out.length;i++)if(out[i].start<out[i-1].end)fail('overlap','時間が重なっています。同じ時間は一度だけ登録してください');
 return out;
}
export function workWarnings(list) {
 const work=list.filter(x=>x.kind!=='break'),minutes=work.reduce((n,x)=>n+minute(x.end)-minute(x.start),0);
 const first=work[0],last=work.at(-1);
 const rest=list.filter(x=>x.kind==='break'&&first&&x.start>=first.start&&x.end<=last.end).reduce((n,x)=>n+minute(x.end)-minute(x.start),0);
 const issues=[];
 if(minutes>480)issues.push('1日8時間を超える勤務：割増賃金を確認');
 if(minutes>360&&rest<(minutes>480?60:45))issues.push('勤務途中の休憩が不足：実際の勤務は残し、休憩と対応を確認');
 if(work.some(x=>x.start<'05:00'||x.end>'22:00'))issues.push('深夜の勤務：割増賃金を確認');
 return {minutes,rest,issues};
}
async function who(c,b) {const me=await requireStaff(c,b);const id=me.contractType==='owner'?String(b.staffId||''):me.id;if(me.contractType!=='owner'&&b.staffId&&b.staffId!==me.id)fail('forbidden','自分の勤務だけを確認できます',403);await employee(c,id);return {me,id};}
const view=r=>r?{...r,planned:JSON.parse(r.planned),actual:JSON.parse(r.actual)}:null;
export async function workSuggestion(c,staffId,date) {
 const ls=(await c.db.prepare("select start,minutes,subject from lessons where staffId=? and date=? and status in ('done','decided','proposed') order by start").bind(staffId,date).all()).results;
 const ms=(await c.db.prepare("select start,minutes from meetings where staffId=? and date=? and status<>'cancelled' order by start").bind(staffId,date).all()).results;
 const slots=Array(1440).fill(null);
 for(const l of ls)for(let n=minute(l.start);n<Math.min(1440,minute(l.start)+l.minutes);n++)slots[n]={kind:'lesson',label:'担当授業（予定から作成）'};
 for(const m of ms)for(let n=minute(m.start);n<Math.min(1440,minute(m.start)+m.minutes);n++)if(!slots[n])slots[n]={kind:'meeting',label:'面談（予定から作成）'};
 for(const l of ls)for(const [a,z] of [[minute(l.start)-5,minute(l.start)],[minute(l.start)+l.minutes,minute(l.start)+l.minutes+5]])for(let n=Math.max(0,a);n<Math.min(1440,z);n++)if(!slots[n])slots[n]={kind:'prep',label:'準備・記録'};
 const out=[];let from=0;
 for(let n=1;n<=1440;n++)if(JSON.stringify(slots[n])!==JSON.stringify(slots[from])||n===1440){if(slots[from])out.push({start:hm(from),end:hm(n),...slots[from]});from=n;}
 return out;
}
async function day(c,id,date){return c.db.prepare('select * from workDays where staffId=? and date=?').bind(id,date).first();}
async function unlocked(c,r,id,date) {
 if(r?.payrollId||await c.db.prepare("select 1 from payrollMonths where staffId=? and status<>'void' and month>=?").bind(id,date.slice(0,7)).first())fail('confirmed','この期間を含む給与が確定しています。給与の訂正手続きを先に行ってください',409);
}
async function save(c,old,id,date,values,me,reason) {
 const now=iso(c.now);
 if(old){
  const cols=Object.keys(values),r=await c.db.prepare('update workDays set '+cols.map(k=>k+'=?').join(',')+',reviewNote=?,confirmedBy=?,updatedAt=?,version=version+1 where id=? and version=?')
   .bind(...Object.values(values),reason,me.id,now,old.id,old.version).run();
  if(r.meta.changes!==1)fail('conflict','ほかの操作で変わりました。読み直してください',409);
 }else{
  const cols=Object.keys(values);
  await c.db.prepare('insert into workDays(id,staffId,date,'+cols.join(',')+',reviewNote,confirmedBy,createdAt,updatedAt) values('+Array(cols.length+7).fill('?').join(',')+')')
   .bind(newId('wd'),id,date,...Object.values(values),reason,me.id,now,now).run();
 }
 await audit(c,'workDaySave',id,{date,reason});return view(await day(c,id,date));
}
async function warnings(c,id,date,list) {
 const result=workWarnings(list),p=await c.db.prepare('select data from employmentProfiles where staffId=?').bind(id).first();
 if(p){const d=JSON.parse(p.data);if(date<d.startDate||date>d.endDate)result.issues.push('契約期間外の実績：働いた事実を残し、契約条件を確認');if(d.otherWork&&!/^なし[。\s]*$/.test(d.otherWork))result.issues.push('他の勤務先との時間通算・割増賃金を確認');}
 const js=new Date(date+'T00:00:00Z'),weekday=(js.getUTCDay()+6)%7;js.setUTCDate(js.getUTCDate()-weekday);const from=js.toISOString().slice(0,10);js.setUTCDate(js.getUTCDate()+6);const to=js.toISOString().slice(0,10);
 const rows=(await c.db.prepare('select date,actual from workDays where staffId=? and date between ? and ? and date<>?').bind(id,from,to,date).all()).results;
 const total=rows.reduce((n,r)=>n+workWarnings(JSON.parse(r.actual)).minutes,result.minutes);
 if(total>2400)result.issues.push('記録された週の勤務が40時間超：他の日の自動集計分も含め割増を確認');
 return result;
}
export const workRoutes={
 'work/list':async(c,b)=>{
  const {id}=await who(c,b),month=String(b.month||'');
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('badMonth','月を選んでください');
  return {days:(await c.db.prepare('select * from workDays where staffId=? and substr(date,1,7)=? order by date').bind(id,month).all()).results.map(view)};
 },
 'work/day':async(c,b)=>{
  const {id}=await who(c,b);if(!dateOK(b.date))fail('badDate','日付を選んでください');
  const r=await day(c,id,b.date),suggestion=await workSuggestion(c,id,b.date);
  const answers=r?(await c.db.prepare("select id,at,detail from auditLog where target=? and action='workCorrectionAnswered' order by id").bind(r.id).all()).results:[];
  const w=await warnings(c,id,b.date,r?JSON.parse(r.actual):suggestion);
  if(r?.submittedAt&&workWarnings(JSON.parse(r.actual)).minutes<workWarnings(JSON.parse(r.planned)).minutes)w.issues.push('予定より勤務が短い日：勤務取消の事情・休業手当の要否を確認');
  return {day:view(r),suggestion,warnings:w,answers,corrections:r?(await c.db.prepare("select id,at,detail from auditLog where target=? and action='workCorrectionRequested' order by id desc").bind(r.id).all()).results:[],history:r?(await c.db.prepare('select * from workDayRevisions where workDayId=? order by version desc').bind(r.id).all()).results:[]};
 },
 'work/plan':async(c,b)=>{
  const me=await requireOwner(c,b),s=await employee(c,b.staffId);if(!dateOK(b.date))fail('badDate','日付を選んでください');
  const old=await day(c,s.id,b.date);if(old)checkVersion(old,b);else if(Number(b.version)!==0)fail('conflict','読み直してください',409);
  const planned=intervals(b.intervals),reason=String(b.reason||'').trim();
  if(!reason||reason.length>500)fail('needReason','予定・変更の内容を500文字以内で記録してください');
  return {day:await save(c,old,s.id,b.date,{planned:JSON.stringify(planned),planVersion:(old?.planVersion||0)+1,planAgreedVersion:0,planAgreedAt:''},me,reason)};
 },
 'work/plan/agree':async(c,b)=>{
  const {me,id}=await who(c,b),r=await day(c,id,b.date);
  if(!r||!r.planVersion)fail('notFound','勤務予定がありません',404);checkVersion(r,b);
  if(me.contractType==='owner'||b.agree!==true)fail('needAgree','本人が自分の勤務予定を確認してください');
  return {day:await save(c,r,id,b.date,{planAgreedVersion:r.planVersion,planAgreedAt:iso(c.now)},me,'本人が勤務予定を確認')};
 },
 'work/submit':async(c,b)=>{
  const {me,id}=await who(c,b);
  if(!dateOK(b.date)||b.date>todayJst(c.now))fail('badDate','実績は今日以前の日付で記録してください');
  const old=await day(c,id,b.date);if(old)checkVersion(old,b);else if(Number(b.version)!==0)fail('conflict','読み直してください',409);await unlocked(c,old,id,b.date);
  const actual=intervals(b.intervals);
  if(actual.some(x=>Date.parse(b.date+'T'+x.end+':00+09:00')>c.now))fail('futureWork','まだ働いていない時間は実績にできません');
  const note=String(b.note||'').trim(),reason=String(b.reason||'').trim();
  if(!reason||reason.length>500||note.length>1500)fail('needReason','実績の内容・訂正理由を記録してください');
  if(!actual.length&&!note)fail('needNote','勤務がなかった場合も、取消等の事情を記録してください');
  return {day:await save(c,old,id,b.date,{actual:JSON.stringify(actual),status:'submitted',submittedAt:iso(c.now),confirmedAt:'',note},me,reason),warnings:await warnings(c,id,b.date,actual)};
 },
 'work/confirm':async(c,b)=>{
  const me=await requireOwner(c,b),s=await employee(c,b.staffId),r=await day(c,s.id,b.date);
  if(!r||r.status!=='submitted')fail('notSubmitted','実績を記録してから確認してください');checkVersion(r,b);await unlocked(c,r,s.id,r.date);
  const w=await warnings(c,s.id,r.date,JSON.parse(r.actual)),reason=String(b.reason||'').trim();
  if(b.reviewed!==true||!reason||reason.length>500)fail('needReview','実績と休憩・必要な賃金調整を確認し、確認内容を残してください');
  return {day:await save(c,r,s.id,r.date,{status:'confirmed',confirmedAt:iso(c.now)},me,reason),warnings:w};
 },
 'work/correction/respond':async(c,b)=>{
  await requireOwner(c,b);const s=await employee(c,b.staffId),r=await day(c,s.id,b.date);
  if(!r)fail('notFound','勤務記録がありません',404);checkVersion(r,b);
  const request=await c.db.prepare("select id from auditLog where id=? and target=? and action='workCorrectionRequested'").bind(Number(b.requestId),r.id).first();
  const message=String(b.message||'').trim();if(!request||!message||message.length>500)fail('needReply','対応した申出と対応結果を500文字以内で記録してください');
  await audit(c,'workCorrectionAnswered',r.id,{requestId:request.id,message,version:r.version});
  return {recorded:true};
 },
 'work/correction':async(c,b)=>{
  const {me,id}=await who(c,b),r=await day(c,id,b.date);
  if(!r)fail('notFound','勤務記録がありません',404);checkVersion(r,b);
  const reason=String(b.reason||'').trim();if(!reason||reason.length>500)fail('needReason','訂正してほしい内容を入力してください');
  // A paid/confirmed payroll never changes. The request is still preserved for follow-up.
  await audit(c,'workCorrectionRequested',r.id,{version:r.version,reason});
  return {recorded:true,requiresPayrollCorrection:!!r.payrollId};
 }
};
