'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {employmentWorld}=require('./helpers/employment-fixture.cjs');
const account={bankName:'【テスト】銀行',bankCode:'0001',branchName:'【テスト】支店',branchCode:'002',accountType:'ordinary',accountNumber:'0123456',holderKana:'テスト コウシ'};
async function setup(){
 const w=await employmentWorld(),ta=await w.invite();
 const get=auth=>w.h.ok('employment/bank/get',{auth:auth||ta,staffId:w.staff.id});
 const submit=async(a=account,version)=>
 w.h.call('employment/bank/submit',{auth:ta,version:version??(await get()).version,consentVersion:(await get()).consentVersion,agree:true,account:a});
 const review=async(d,outcome='accepted',extra={})=>{const r=d.requests.find(r=>r.id===d.latestId);return w.h.call('employment/bank/review',{auth:w.auth,staffId:w.staff.id,version:d.version,requestId:r.id,hash:r.contentHash,outcome,confirm:true,reason:'【テスト】支店名を確認してください',...extra});};
 return {...w,ta,get,submit,review};
}
test('bank endpoints require owner or same employee; owners cannot supply employee consent',async()=>{
 const w=await setup(),{h,auth,ta,staff}=w;
 for(const route of ['get','submit','review'])assert.equal((await h.call('employment/bank/'+route,{})).ok,false);
 const manager=await h.staffWith(auth,['manager'],'manager-bank@example.invalid'),other=await h.staffWith(auth,['teacher'],'other-bank@example.invalid');
 for(const who of [manager,other])assert.equal((await h.call('employment/bank/get',{auth:who,staffId:staff.id})).error.code,'forbidden');
 assert.equal((await w.get(auth)).staff.id,staff.id);
 assert.equal((await h.call('employment/bank/submit',{auth,staffId:staff.id})).error.code,'forbidden');
 assert.equal((await h.call('employment/bank/get',{auth:ta,staffId:'some-other-id'})).error.code,'forbidden');
 assert.equal((await h.call('employment/bank/review',{auth:ta,staffId:staff.id})).error.code,'forbidden');
 assert.equal((await h.call('employment/bank/get',{serviceKey:'fake',staffId:staff.id})).error.code,'service');
 assert.equal((await h.call('employment/bank/get',{auth:'preview.fake',staffId:staff.id})).ok,false);
});
test('submission validates explicit consent and preserves leading zero and canonical account details',async()=>{
 const w=await setup(),{h,ta}=w,d=await w.get();
 const b={auth:ta,version:0,consentVersion:d.consentVersion,agree:true,account};
 assert.equal((await h.call('employment/bank/submit',{...b,agree:false})).error.code,'needAgree');
 assert.equal((await h.call('employment/bank/submit',{...b,consentVersion:'old'})).error.code,'needAgree');
 for(const patch of [{accountNumber:'123456'},{accountNumber:'12345678'},{bankCode:'123'},{branchCode:'23'},{accountType:'cash'},{holderKana:'漢字'},{bankName:''},{branchName:'x\nq'}])
  assert.equal((await w.submit({...account,...patch})).error.code,'badBank');
 const r=await w.submit({...account,accountNumber:'０１２３４５６',holderKana:'ﾃｽﾄ ｺｳｼ'});
 assert.equal(r.ok,true);assert.equal(r.requests[0].account.accountNumber,'0123456');assert.equal(r.requests[0].account.holderKana,'テスト コウシ');
 assert.equal(r.requests[0].consenterId,w.staff.id);assert.equal(r.requests[0].consenterName,w.staff.name);assert.equal(r.requests[0].submittedAt,new Date(h.clock).toISOString());
 assert.equal(r.acceptedId,'');assert.equal(r.requests[0].status,'pending');
 assert.equal((await w.submit(account,0)).error.code,'conflict');
 assert.equal(h.rows('select * from staffBankRequests').length,1);
});
test('review is bound to exact latest version and consent hash; corrections keep the adopted account',async()=>{
 const w=await setup();
 const first=await w.submit();
 assert.equal((await w.review(first,'accepted',{confirm:false})).error.code,'needConfirm');
 assert.equal((await w.review(first,'accepted',{hash:'wrong'})).error.code,'conflict');
 const accepted=await w.review(first);assert.equal(accepted.ok,true);assert.equal(accepted.acceptedId,first.latestId);
 assert.equal((await w.review(first)).error.code,'conflict');
 const second=await w.submit({...account,accountNumber:'0765432'});
 assert.equal(second.acceptedId,first.latestId);
 assert.equal((await w.review(second,'returned',{reason:''})).error.code,'badBank');
 const returned=await w.review(second,'returned');assert.equal(returned.acceptedId,first.latestId);assert.equal(returned.requests.find(r=>r.id===second.latestId).status,'returned');
 const third=await w.submit({...account,accountNumber:'0000001'});
 const fourth=await w.submit({...account,accountNumber:'0000002'});
 assert.equal((await w.review(third)).error.code,'conflict');
 assert.equal(fourth.requests.find(r=>r.id===third.latestId).status,'superseded');
 const done=await w.review(fourth);assert.equal(done.acceptedId,fourth.latestId);assert.equal(done.requests.length,4);
 assert.equal(done.requests.find(r=>r.id===first.latestId).status,'accepted');assert.equal(done.requests.find(r=>r.id===first.latestId).current,false);
 assert.throws(()=>w.h.db2._sqlite.prepare('update staffBankRequests set account=?').run('{}'),/immutable/);
 assert.throws(()=>w.h.db2._sqlite.prepare('delete from staffBankRequests').run(),/retain/);
 assert.throws(()=>w.h.db2._sqlite.prepare('update staffBankReviews set reason=?').run('changed'),/immutable/);
 assert.throws(()=>w.h.db2._sqlite.prepare('delete from staffBankReviews').run(),/retain/);
});
test('readiness retains legacy external checks but cannot use them to bypass a submitted bank request',async()=>{
 const w=await setup();
 assert.equal((await w.get()).requests.length,0);
 assert.equal((await w.get(w.auth)).acceptedId,'');
 assert.equal((await w.h.ok('employment/get',{auth:w.auth,staffId:w.staff.id})).checks.some(x=>/振込/.test(x)),false);
 const r=await w.submit();
 let e=await w.h.ok('employment/get',{auth:w.auth,staffId:w.staff.id});assert.equal(e.checks.some(x=>/振込/.test(x)),true);
 assert.equal(JSON.stringify(e).includes(account.accountNumber),false);
 assert.equal((await w.h.ok('employment/list',{auth:w.auth})).staff.find(x=>x.id===w.staff.id).bank.pending,true);
 await w.review(r);
 e=await w.h.ok('employment/get',{auth:w.auth,staffId:w.staff.id});
 assert.equal(e.checks.some(x=>/振込/.test(x)),false);assert.equal(e.profile.data.bankConsentChecked,true);
});
test('contract, agreement, salary and confirmed payroll records remain unchanged; no account data in audit or notifications',async()=>{
 const w=await setup(),{h,auth,ta,staff}=w;
 let c=await w.issue(await w.create());c=await w.pref(c,ta);c=await w.deliver(c);await w.agree(c,ta);
 await h.ok('payroll/rates/save',{auth,staffId:staff.id,startsOn:'2026-10',lessonHourly:2000,meetingHourly:null});
 h.clock=Date.parse('2026-10-17T15:00:00+09:00');
 let d=(await h.ok('work/submit',{auth:ta,date:'2026-10-17',version:0,intervals:[{start:'13:00',end:'14:00',kind:'other'}],reason:'【テスト】実績'})).day;
 await h.ok('work/confirm',{auth,staffId:staff.id,date:'2026-10-17',version:d.version,reviewed:true,reason:'【テスト】確認'});
 h.clock=Date.parse('2026-11-01T10:00:00+09:00');
 await h.ok('payroll/confirm',{auth,staffId:staff.id,month:'2026-10'});
 const tables=['employmentProfiles','employmentContracts','employmentEvents','staffRates','payrollMonths','payrollItems','payrollWorkDays','workDays','workDayRevisions','termsConsents','effects'];
 const before=Object.fromEntries(tables.map(t=>[t,h.rows('select * from '+t)])),mails=h.mails().length;
 await w.review(await w.submit());
 for(const t of tables)assert.deepEqual(h.rows('select * from '+t),before[t],t);
 assert.equal(h.mails().length,mails);
 const audit=h.rows("select * from auditLog where action like 'staffBank%'");assert.equal(audit.length,2);
 for(const a of audit){assert.equal(a.detail,'{}');assert.equal(JSON.stringify(a).includes(account.accountNumber),false);}
});
test('a state change after validation cannot leave an unconsented or partially adopted account',async()=>{
 const w=await setup(),{h}=w,original=h.db2.batch.bind(h.db2);
 await w.submit();
 let intercepted=false;
 h.db2.batch=async statements=>{
  if(!intercepted){intercepted=true;h.db2._sqlite.prepare('update staffBankState set version=version+1 where staffId=?').run(w.staff.id);}
  return original(statements);
 };
 const r=await w.submit({...account,accountNumber:'0765432'});
 assert.equal(r.error.code,'conflict');assert.equal(h.rows('select * from staffBankRequests').length,1);assert.equal(h.rows("select * from auditLog where action='staffBankSubmitted'").length,1);
 h.db2.batch=original;
 const latest=await w.get();intercepted=false;
 h.db2.batch=async statements=>{
  if(!intercepted){intercepted=true;h.db2._sqlite.prepare('update staffBankState set version=version+1 where staffId=?').run(w.staff.id);}
  return original(statements);
 };
 assert.equal((await w.review(latest)).error.code,'conflict');
 assert.equal(h.rows('select * from staffBankReviews').length,0);assert.equal((await w.get()).acceptedId,'');
});
