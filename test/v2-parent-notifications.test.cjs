'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createV2}=require('./helpers/v2-harness.cjs');
const {agreementFixture}=require('./helpers/agreement-fixture.cjs');
const {createD1,migrationFiles,tables,columns}=require('./helpers/d1-harness.cjs');
const response=payload=>({ok:true,status:200,json:async()=>payload});
const env={GAS_URL:'https://example.invalid/relay',SYNC_KEY:'synthetic-only'};
const mail=(s='sample')=>({kind:'mail',to:'test@example.invalid',subject:s,body:'synthetic'});
test('family targets allow only internal destinations, bounded identifiers and month values',async()=>{
 const {safeFamilyTarget,familyTarget,targetParts}=await import('../assets/v2/family-target.js');
 for(const x of ['https://evil.invalid','//evil.invalid','money/../../staff','reset=secret','money?student=../x','money?month=2026-99','money?refs=id.1.2','money?refs=secret'])assert.equal(safeFamilyTarget(x),'',x);
 const x=familyTarget('money',{kind:'plan',refs:'pl_1.3,pl_2.4'});
 assert.deepEqual(targetParts(x).refs,[{id:'pl_1',version:3},{id:'pl_2',version:4}]);
 assert.equal(safeFamilyTarget('confirm'),'confirm');
});
test('individual delivery results are matched by opaque ID, including partial failures',async()=>{
 const h=await createV2(),{recordEffects,deliverEffects}=await import('../cf/v2/effects.mjs');
 const qs=await recordEffects(h.db2,[mail('A'),mail('B')],h.clock);
 const r=await deliverEffects(env,h.db2,qs,async(_u,init)=>{const items=JSON.parse(init.body).items;return response({ok:true,results:[{id:items[1].deliveryId,status:'failed',error:'quota; not sent'},{id:items[0].deliveryId,status:'sent'}]});});
 assert.deepEqual([r.sent,r.failed,r.unknown],[1,1,0]);
 assert.deepEqual(h.rows('select status,deliveryState from effects').map(x=>[x.status,x.deliveryState]),[['sent','sent'],['failed','failed']]);
});
test('legacy partial success is unknown and timeout is not automatically resent',async()=>{
 const h=await createV2(),{recordEffects,deliverEffects}=await import('../cf/v2/effects.mjs');
 let n=0;const qs=await recordEffects(h.db2,[mail('A'),mail('B')],h.clock);
 let r=await deliverEffects(env,h.db2,qs,async()=>{n++;return response({ok:true,done:1,failed:[{kind:'mail',error:'failed'}]});});
 assert.equal(r.unknown,2);await deliverEffects(env,h.db2,qs,async()=>{n++;return response({});});assert.equal(n,1);
 const q=await recordEffects(h.db2,[mail('C')],h.clock);
 r=await deliverEffects(env,h.db2,q,async()=>{throw Error('timeout after dispatch');});
 assert.equal(r.unknown,1);
 await deliverEffects(env,h.db2,q,async()=>{throw Error('must not retry');});
});
test('old single mail failure is never stored as sent',async()=>{
 const h=await createV2(),{recordEffects,deliverEffects}=await import('../cf/v2/effects.mjs');
 const q=await recordEffects(h.db2,[mail()],h.clock);
 const r=await deliverEffects(env,h.db2,q,async()=>response({ok:true,done:0,failed:[{kind:'mail',error:'synthetic quota'}]}));
 assert.equal(r.sent,0);assert.equal(h.rows('select status from effects')[0].status,'failed');
});
test('concurrent attempts claim once; relay is called in batches of at most 50',async()=>{
 const h=await createV2(),{recordEffects,deliverEffects}=await import('../cf/v2/effects.mjs');
 const q=await recordEffects(h.db2,Array.from({length:51},(_,i)=>mail(String(i))),h.clock),seen=[];
 const fetcher=async(_u,init)=>{const items=JSON.parse(init.body).items;seen.push(items);return response({results:items.map(x=>({id:x.deliveryId,status:'sent'}))});};
 await Promise.all([deliverEffects(env,h.db2,q,fetcher),deliverEffects(env,h.db2,q,fetcher)]);
 assert.equal(seen.flat().length,51);assert.equal(new Set(seen.flat().map(x=>x.deliveryId)).size,51);assert.ok(seen.every(x=>x.length<=50));
});
test('missing or duplicate item receipts remain unknown',async()=>{
 const h=await createV2(),{recordEffects,deliverEffects}=await import('../cf/v2/effects.mjs');
 for(const duplicate of [false,true]) {
  const q=await recordEffects(h.db2,[mail()],h.clock);
  const r=await deliverEffects(env,h.db2,q,async(_u,i)=>{const id=JSON.parse(i.body).items[0].deliveryId;return response({results:duplicate?[{id,status:'sent'},{id,status:'sent'}]:[]});});
  assert.equal(r.unknown,1);
 }
});
test('failed schedule mail holds automatic confirmation until a new notice with a fresh response window',async()=>{
 const {h,auth,kid,parent}=await agreementFixture();
 await h.ok('schedule/lessons/create',{auth,studentId:kid.id,date:'2026-10-20',start:'17:00',minutes:60,subject:'数学',deliveryMode:'in_person',send:'ask'});
 const row=()=>h.rows('select * from lessons')[0];
 const {autoConfirm}=await import('../cf/v2/schedule.mjs'),{scheduleDelivery}=await import('../cf/v2/notice-policy.mjs');
 const n={notice:{type:'schedule',targets:[{id:row().id,askedAt:row().askedAt,noticeId:row().noticeId}]}};
 await scheduleDelivery(h.db2,n,'failed',new Date(h.clock).toISOString());
 await scheduleDelivery(h.db2,n,'sent',new Date(h.clock).toISOString());
 assert.equal(row().noticeState,'hold','retry success does not restore the old deadline');
 const c={db:h.db2,env:h.env,now:Date.parse('2026-10-06T00:10:00+09:00'),effects:[],actor:{kind:'system',id:'test'}};
 assert.equal((await autoConfirm(c)).confirmed,0);
 h.clock=Date.parse('2026-10-06T12:00:00+09:00');
 await h.ok('schedule/lessons/renotify',{auth,studentId:kid.id,lessonIds:[row().id],via:'LINE',note:'【テスト】10/6 12:00 に 10/9 締切を伝えた'});
 assert.equal(row().confirmBy,'2026-10-09');assert.equal(row().noticeState,'external');
 c.now=Date.parse('2026-10-10T00:10:00+09:00');assert.equal((await autoConfirm(c)).confirmed,1);
 assert.equal((await h.ok('family/schedule',{auth:parent})).lessons[0].status,'decided');
});
test('changed and used targets cannot be retried',async()=>{
 const {h,auth,fam,kid,parent,plan}=await agreementFixture(),{currentNotice}=await import('../cf/v2/notice-policy.mjs');
 const p=await plan();await h.ok('billing/plans/send',{auth,familyId:fam.id});
 const l=h.rows('select * from planLines where id=?',p.id)[0],item={notice:{type:'plan',targets:[{id:l.id,version:l.version}]}};
 assert.equal(await currentNotice(h.db2,item,h.clock),true);
 await h.ok('family/plans/decide',{auth:parent,id:l.id,version:l.version,approvedCount:4,consenterName:'【テスト】保護者'});
 assert.equal(await currentNotice(h.db2,item,h.clock),false);
});
test('password reset retains a validated task across browsers without exposing account existence',async()=>{
 const {h,fam}=await agreementFixture();
 const next='money?kind=plan&refs=pl_test.3';
 await h.ok('family/reset/request',{email:fam.email,returnTo:next});
 const token=h.linkFrom(h.mails().at(-1));
 const r=await h.ok('family/reset/confirm',{token,password:'changed synthetic password'});
 assert.equal(r.returnTo,next);
 assert.ok(h.rows("select tokenHash from authChallenges").every(x=>!x.tokenHash.includes(token)));
 const missing=await h.ok('family/reset/request',{email:'absent@example.invalid',returnTo:'https://evil.invalid'});
 const existing=await h.ok('family/reset/request',{email:fam.email});
 assert.equal(missing.message,existing.message);
});
test('migration preserves every existing column and row, including issued documents and consents',async()=>{
 const {h,auth,parent,kid,plan,approve}=await agreementFixture();
 await h.ok('admin/terms/set',{auth,version:'synthetic-previous',title:'旧規約',url:'https://example.invalid/old'});
 await h.ok('family/terms/accept',{auth:parent,version:'synthetic-previous',agree:true,consenterName:'【テスト】保護者'});
 const co=(await h.ok('admin/conditions/propose',{auth,studentId:kid.id,minutes:90,fee:4500,deliveryMode:'in_person',fromMonth:'2026-11'})).condition;
 await h.ok('family/conditions/agree',{auth:parent,id:co.id,agree:true,consenterName:'【テスト】保護者'});
 const sp=(await h.ok('admin/specials/propose',{auth,studentId:kid.id,title:'【テスト】問題解説',purpose:'専用問題の復習',content:'個別の問題解説',reason:'専用準備',prep:'事前に解く',minutes:90,fee:6000,fromDate:'2026-11-01',toDate:'2026-11-30'})).special;
 await h.ok('family/specials/agree',{auth:parent,id:sp.id,agree:true,consenterName:'【テスト】保護者'});
 await approve(await plan());
 const old=createD1({migrate:false});
 for(const m of migrationFiles('migrations-v2').filter(x=>!x.name.startsWith('0027_')))old._sqlite.exec(m.sql);
 old._sqlite.exec('pragma foreign_keys = off');
 for(const t of tables(old).sort((a,b)=>{const rank=x=>['families','students','staff'].includes(x)?['families','students','staff'].indexOf(x):-1;return (rank(a)<0?10:rank(a))-(rank(b)<0?10:rank(b));})){const cols=columns(old,t);for(const row of h.rows('select '+cols.map(x=>'"'+x+'"').join(',')+' from "'+t+'"'))old._sqlite.prepare('insert or replace into "'+t+'" ('+cols.map(x=>'"'+x+'"').join(',')+') values ('+cols.map(()=>'?').join(',')+')').run(...cols.map(x=>row[x]));}
 const snapshot=()=>Object.fromEntries(tables(old).map(t=>[t,old._sqlite.prepare('select '+kept[t].map(x=>'"'+x+'"').join(',')+' from "'+t+'" order by rowid').all()]));
 const kept=Object.fromEntries(tables(old).map(t=>[t,columns(old,t)])),before=snapshot();
 old._sqlite.exec(migrationFiles('migrations-v2').find(x=>x.name.startsWith('0027_')).sql);
 assert.deepEqual(snapshot(),before);assert.ok(before.termsConsents.length);assert.ok(before.planRevisions.length);assert.ok(before.conditions.length);assert.ok(before.specials.length);assert.ok(before.files.length);
});

test('delayed invoice requires an agreed date; void notice and original records remain visible only to its family',async()=>{
 const {h,auth,fam,kid,parent,plan,approve}=await agreementFixture();
 h.clock=Date.parse('2026-09-01T12:00:00+09:00');
 await approve(await plan({startDate:'2026-09-01',endDate:'2026-09-30'}),{consentedAt:'2026-09-01T11:00:00+09:00'});
 h.clock=Date.parse('2026-10-16T12:00:00+09:00');
 await h.ok('schedule/lessons/create',{auth,studentId:kid.id,date:'2026-09-10',start:'17:00',minutes:90,subject:'数学',deliveryMode:'in_person',done:true});
 assert.equal((await h.call('billing/confirm',{auth,familyId:fam.id,month:'2026-09',dueReviewed:true})).error.code,'needDueAgreement');
 const iv=(await h.ok('billing/confirm',{auth,familyId:fam.id,month:'2026-09',dueReviewed:true,dueDate:'2026-10-23',dueNote:'【テスト】10/16 LINEで保護者と合意'})).invoice;
 assert.equal(iv.dueDate,'2026-10-23');assert.match(h.mails().at(-1).body,/2026-10-23/);
 const before=h.rows('select * from invoiceItems where invoiceId=?',iv.id);
 const doc=(await h.ok('family/money',{auth:parent})).invoices[0].invoiceDocId;
 await h.ok('billing/void',{auth,id:iv.id,version:iv.version,reason:'【テスト】内訳の訂正'});
 assert.match(h.mails().at(-1).body,/お支払いは不要/);
 const money=await h.ok('family/money',{auth:parent}),cancelled=money.invoices.find(x=>x.id===iv.id);
 assert.equal(cancelled.status,'void');assert.equal(cancelled.invoiceDocId,doc);
 assert.deepEqual(h.rows('select * from invoiceItems where invoiceId=?',iv.id),before);
 const other=await agreementFixture();assert.equal((await h.call('family/money',{auth:other.parent})).error.code,'needLogin');
});
test('relay uses per-item receipts and prevents replay after an uncertain delivery',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const props=new Map([['WORKER_SYNC_KEY','x'.repeat(30)]]);let sent=0,fail=false;
 const context={PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props)})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},Date,JSON,
  ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})},
  Utilities:{sleep(){}},Session:{getEffectiveUser:()=>({getEmail:()=> 'test@example.invalid'})},
  Calendar:{},MailApp:{getRemainingDailyQuota:()=>10,sendEmail(){sent++;if(fail)throw Error('after dispatch unknown');}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../gas-effects/Code.gs'),'utf8'),context);
 const run=id=>context.doPost({postData:{contents:JSON.stringify({action:'effects',key:'x'.repeat(30),items:[{deliveryId:id,kind:'mail',to:'test@example.invalid',body:'synthetic'}]})}});
 assert.equal(run('first').results[0].status,'sent');assert.equal(run('first').results[0].status,'sent');assert.equal(sent,1);
 fail=true;assert.equal(run('second').results[0].status,'unknown');assert.equal(run('second').results[0].status,'unknown');assert.equal(sent,2);
});

test('fresh attempt cannot be resolved using the age of its old queued record',async()=>{
 const {h,auth}=await agreementFixture(),{recordEffects,deliverEffects}=await import('../cf/v2/effects.mjs');
 const qs=await recordEffects(h.db2,[mail()],h.clock-86400e3);let unlock;
 const waiting=new Promise(r=>{unlock=r});
 const sending=deliverEffects(env,h.db2,qs,async(_u,i)=>{await waiting;return response({results:JSON.parse(i.body).items.map(x=>({id:x.deliveryId,status:'sent'}))});},h.clock);
 for(let n=0;n<30 && h.rows('select deliveryState from effects where id=?',qs[0].id)[0].deliveryState!=='sending';n++)await new Promise(r=>setTimeout(r,0));
 const r=await h.call('admin/effects/resolve',{auth,id:qs[0].id,result:'notSent',note:'【テスト】確認の記録'});
 assert.equal(r.error.code,'busy');unlock();await sending;
});

test('challenge retry checks current address and stopped account, and re-notice rejects stale displayed versions',async()=>{
 const {h,auth,fam,kid}=await agreementFixture(),{currentNotice,scheduleDelivery}=await import('../cf/v2/notice-policy.mjs');
 await h.ok('family/reset/request',{email:fam.email});
 const m=h.mails().at(-1);delete m.testOnly;delete m.held;
 assert.equal(await currentNotice(h.db2,m,h.clock),true);
 h.db2._sqlite.prepare('update families set email = ? where id = ?').run('changed@example.invalid',fam.id);
 assert.equal(await currentNotice(h.db2,m,h.clock),false);
 h.db2._sqlite.prepare('update families set email = ?, status = ? where id = ?').run(fam.email,'stopped',fam.id);
 assert.equal(await currentNotice(h.db2,m,h.clock),false);
 h.db2._sqlite.prepare("update families set status = 'active' where id = ?").run(fam.id);
 await h.ok('schedule/lessons/create',{auth,studentId:kid.id,date:'2026-10-20',start:'17:00',minutes:60,subject:'数学',deliveryMode:'in_person',send:'ask'});
 const row=()=>h.rows('select * from lessons')[0],before=row();
 const r=await h.call('schedule/lessons/renotify',{auth,studentId:kid.id,lessonIds:[before.id],refs:[{id:before.id,version:before.version-1}],via:'LINE',note:'【テスト】案内済み'});
 assert.equal(r.error.code,'conflict');assert.deepEqual(row(),before);
 await h.ok('schedule/lessons/renotify',{auth,studentId:kid.id,lessonIds:[before.id],refs:[{id:before.id,version:before.version}],via:'LINE',note:'【テスト】新しい期限を案内済み'});
 await scheduleDelivery(h.db2,{notice:{type:'schedule',targets:[{id:before.id,askedAt:before.askedAt,noticeId:before.noticeId}]}},'failed',new Date(h.clock).toISOString());
 assert.equal(row().noticeState,'external','same-millisecond old delivery cannot hold a newer notice');
});

test('notice deadline presentation suppresses implicit confirmation for held or short-window notices',async()=>{
 const {automaticDeadline}=await import('../assets/v2/notice-view.js');
 const l={confirmBy:'2026-10-05',noticeAt:'2026-10-02T03:00:00Z',noticeState:'sent'};
 assert.equal(automaticDeadline(l),'2026-10-05');
 for(const change of [{noticeState:'hold'},{noticeState:''},{noticeAt:''},{noticeAt:'bad'},{confirmBy:'2026-10-04'}])assert.equal(automaticDeadline({...l,...change}),'');
});
