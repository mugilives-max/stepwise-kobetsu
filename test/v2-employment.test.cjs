'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {employmentWorld}=require('./helpers/employment-fixture.cjs');

test('draft registration sends nothing; owner only management and restricted account cannot read student data',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w;
 assert.equal(h.mails().length,0);
 assert.equal(staff.employmentAccess,false);
 assert.equal((await h.ok('payroll/rates/list',{auth})).staff.some(x=>x.id===staff.id),true,'rates available before account acceptance');
 const ta=await w.invite();
 assert.equal((await h.ok('staff/me',{auth:ta})).me.employmentAccess,false);
 assert.equal((await h.call('employment/list',{auth:ta})).error.code,'forbidden');
 assert.equal((await h.call('schedule/week',{auth:ta})).ok,false);
 assert.equal((await h.call('admin/students/list',{auth:ta})).ok,false);
 const manager=await h.staffWith(auth,['manager'],'manager@example.invalid');
 assert.equal((await h.call('employment/get',{auth:manager,staffId:staff.id})).error.code,'forbidden');
 assert.equal((await h.call('payroll/rates/list',{auth:manager})).error.code,'forbidden');
 assert.equal((await h.call('admin/staff/invite',{auth,familyName:'【テスト】',givenName:'偽代表',email:'x@example.invalid',roles:['sysadmin'],contractType:'owner'})).error.code,'forbidden');
 assert.equal((await h.call('employment/activate',{auth,staffId:staff.id})).error.code,'incomplete');
});

test('electronic agreement requires exact version, own preference, actual delivery and explicit acceptance',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,ta=await w.invite();
 let r=await w.create();
 assert.equal((await h.call('employment/contract/document',{auth:ta,id:r.id})).error.code,'notFound');
 r=await w.issue(r);
 assert.equal((await h.call('employment/contract/accept',{auth:ta,id:r.id,version:r.version,hash:r.contentHash,agree:true,received:true,consenterName:staff.name})).error.code,'needDelivery');
 assert.equal((await h.call('employment/contract/preference',{auth,id:r.id,version:r.version,wish:true,recipient:'owner@example.invalid'})).error.code,'forbidden');
 r=await w.pref(r,ta);r=await w.deliver(r);
 assert.equal((await h.call('employment/contract/accept',{auth:ta,id:r.id,version:r.version,hash:'wrong',agree:true,received:true,consenterName:staff.name})).error.code,'needDelivery');
 assert.equal((await h.call('employment/contract/accept',{auth:ta,id:r.id,version:r.version,hash:r.contentHash,agree:true,received:false,consenterName:staff.name})).error.code,'needAgree');
 const old=r; r=await w.agree(r,ta);
 assert.equal(r.status,'agreed');
 assert.equal((await h.call('employment/contract/accept',{auth:ta,id:old.id,version:old.version,hash:old.contentHash,agree:true,received:true,consenterName:staff.name})).error.code,'conflict');
 const ev=h.rows('select * from employmentEvents where contractId=?',r.id);
 assert.equal(ev.length,4);assert.equal(ev.at(-1).actorId,staff.id);
 const doc=await h.ok('employment/contract/document',{auth:ta,id:r.id});assert.match(doc.html,/本人の電子同意/);assert.match(doc.html,/2,000円/);
 assert.match(doc.html,/1\. 期間の定めあり：2026年10月17日から2027年3月31日まで。/,'契約期間は日本語の日付で書く');assert.match(doc.html,/対象期間 2026年10月17日〜2027年3月31日/);assert.doesNotMatch(doc.html,/2026-10-17から|2027-03-31まで/);
 const wrong=await h.staffWith(auth,['teacher'],'other-view@example.invalid');
 assert.equal((await h.call('employment/contract/document',{auth:wrong,id:r.id})).error.code,'forbidden');
 assert.equal((await h.call('employment/contract/withdraw',{auth,id:r.id,version:r.version,reason:'削除'})).error.code,'closed');
});

test('paper signatures are recorded separately from electronic consent; revisions retain fixed old text',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w;
 let r=await w.issue(await w.create('paper'));r=await w.deliver(r);
 const fixed=JSON.stringify(r.snapshot),at=w.tick();
 r=(await h.ok('employment/contract/paper',{auth,id:r.id,version:r.version,hash:r.contentHash,agreedAt:at,consenterName:staff.name,evidenceRef:'非公開の署名済み書面保管場所',signed:true})).contract;
 assert.equal(r.status,'agreed');assert.equal(h.rows('select action from employmentEvents where contractId=? order by id desc',r.id)[0].action,'紙の署名を記録');
 const current=await w.get();
 await h.ok('employment/save',{auth,staffId:staff.id,version:current.profile.version,data:{...w.data,address:'【テスト】更新後の住所'}});
 const next=await w.create('paper');
 assert.equal(next.revision,2);assert.notEqual(next.contentHash,r.contentHash);
 assert.equal(JSON.stringify((await w.contract(r.id)).snapshot),fixed);
 assert.throws(()=>h.db2._sqlite.prepare('update employmentContracts set snapshot=? where id=?').run('{}',r.id),/immutable/);
 assert.throws(()=>h.db2._sqlite.prepare('delete from employmentContracts where id=?').run(r.id),/retain/);
});

test('draft and stale contracts cannot acquire consent; undelivered and future timestamps stay unconfirmed',async()=>{
 const w=await employmentWorld(),{h,auth}=w,ta=await w.invite();
 let r=await w.issue(await w.create());r=await w.pref(r,ta);
 assert.equal((await h.call('employment/contract/delivery',{auth,id:r.id,version:r.version,hash:r.contentHash,deliveredAt:'2028-01-01T00:00:00Z',note:'未来',delivered:true})).error.code,'badTime');
 assert.equal((await h.call('employment/contract/delivery',{auth,id:r.id,version:r.version,hash:r.contentHash,deliveredAt:new Date(h.clock).toISOString(),note:'画面に置いただけ',delivered:false})).error.code,'needDelivery');
 const v2=await w.create();
 assert.equal((await h.call('employment/contract/issue',{auth,id:v2.id,version:v2.version,hash:v2.contentHash,agree:true})).error.code,'pendingVersion');
 await h.ok('employment/contract/withdraw',{auth,id:r.id,version:r.version,reason:'【テスト】改版'});
 assert.equal((await h.call('employment/contract/preference',{auth:ta,id:r.id,version:r.version,wish:true,recipient:'employment@example.invalid'})).error.code,'conflict');
});

test('work plans require employee confirmation; changes clear it; actual work survives missing contract or disabled access',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,ta=await w.invite(),date='2026-10-17';
 const intervals=[{start:'13:00',end:'14:00',kind:'other',label:'【テスト】授業見学'}];
 let d=(await h.ok('work/plan',{auth,staffId:staff.id,date,version:0,intervals,reason:'初日の勤務'})).day;
 d=(await h.ok('work/plan/agree',{auth:ta,staffId:staff.id,date,version:d.version,agree:true})).day;
 assert.equal(d.planAgreedVersion,d.planVersion);
 d=(await h.ok('work/plan',{auth,staffId:staff.id,date,version:d.version,intervals,reason:'見学内容を再確認'})).day;
 assert.equal(d.planAgreedVersion,0);
 assert.equal((await h.call('work/submit',{auth:ta,date,version:d.version,intervals,reason:'未来の実績'})).error.code,'futureWork');
 h.clock=Date.parse('2026-10-17T15:00:00+09:00');
 d=(await h.ok('work/submit',{auth:ta,date,version:d.version,intervals,reason:'見学しました'})).day;
 assert.equal(d.status,'submitted');
 assert.equal((await h.call('work/confirm',{auth:ta,date,version:d.version,reviewed:true,reason:'自己承認'})).error.code,'forbidden');
 d=(await h.ok('work/confirm',{auth,staffId:staff.id,date,version:d.version,reviewed:true,reason:'実際の時間と業務を確認'})).day;
 assert.equal(d.status,'confirmed');
 const history=(await h.ok('work/day',{auth:ta,date})).history;assert.equal(history.length,5);
 assert.equal((await h.call('work/day',{auth:ta,staffId:'another',date})).error.code,'forbidden');
});

test('actual work replaces daily auto time without double pay and keeps old payroll immutable',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,ta=await w.invite(),date='2026-10-17';
 await h.ok('payroll/rates/save',{auth,staffId:staff.id,startsOn:'2026-10',lessonHourly:2000,meetingHourly:null});
 assert.equal((await h.ok('payroll/rates/list',{auth})).staff[0].rates[0].meetingConfigured,false);
 // Synthetic parent records remain byte-for-byte unchanged except payroll linkage metadata.
 const family=(await h.ok('admin/families/create',{auth,name:'【テスト】家',email:'p@example.invalid'})).family;
 const kid=(await h.ok('admin/students/create',{auth,familyId:family.id,familyName:'【テスト】子',givenName:'甲',baseRate30:1500})).student;
 h.clock=Date.parse('2026-10-17T15:00:00+09:00');
 await h.ok('schedule/lessons/create',{auth,studentId:kid.id,date,start:'13:00',minutes:90,subject:'数学',deliveryMode:'in_person',staffId:staff.id,force:true});
 let l=h.rows('select * from lessons where studentId=?',kid.id)[0];
 await h.ok('schedule/lessons/decide',{auth,id:l.id,version:l.version});
 h.clock=Date.parse('2026-10-17T15:00:00+09:00');l=h.rows('select * from lessons where id=?',l.id)[0];await h.ok('schedule/lessons/done',{auth,id:l.id,version:l.version});
 const original=h.rows('select * from lessons where id=?',l.id)[0];
 const intervals=[{start:'12:55',end:'13:00',kind:'prep'},{start:'13:00',end:'13:45',kind:'other',label:'【テスト】見学'},{start:'13:45',end:'14:30',kind:'lesson'},{start:'14:30',end:'14:35',kind:'prep'}];
 let d=(await h.ok('work/submit',{auth:ta,date,version:0,intervals,reason:'初日の実績'})).day;
 let v=(await h.ok('payroll/staff',{auth,staffId:staff.id,month:'2026-10'})).preview;assert.equal(v.canConfirm,false);
 d=(await h.ok('work/confirm',{auth,staffId:staff.id,date,version:d.version,reviewed:true,reason:'見学と途中交代を確認'})).day;
 v=(await h.ok('payroll/staff',{auth,staffId:staff.id,month:'2026-10'})).preview;
 assert.equal(v.workMinutes,100);assert.equal(v.lessonMinutes,0);assert.equal(v.prepMinutes,0);assert.equal(v.gross,3333);assert.equal(v.items.length,1);
 assert.deepEqual(h.rows('select * from lessons where id=?',l.id)[0],original);
 h.clock=Date.parse('2026-11-01T10:00:00+09:00');
 const pay=(await h.ok('payroll/confirm',{auth,staffId:staff.id,month:'2026-10'})).payroll;
 const fixed=h.rows('select * from payrollItems where payrollId=?',pay.id);
 assert.equal(pay.workMinutes,100);
 assert.equal((await h.call('work/submit',{auth:ta,date,version:d.version,intervals,reason:'訂正'})).error.code,'confirmed');
 assert.equal((await h.ok('work/correction',{auth:ta,date,version:d.version,reason:'終了は14:40でした'})).requiresPayrollCorrection,true);
 assert.equal((await h.ok('work/day',{auth,staffId:staff.id,date})).corrections.length,1);
 assert.deepEqual(h.rows('select * from payrollItems where payrollId=?',pay.id),fixed);
 assert.equal((await h.ok('payroll/staff',{auth,staffId:staff.id,month:'2026-11'})).preview.gross,0);
 await h.ok('payroll/void',{auth,id:pay.id,version:pay.version,reason:'勤務時間の訂正'});
 const after=h.rows('select * from workDays where id=?',d.id)[0];assert.equal(after.payrollId,'');
 assert.deepEqual(h.rows('select * from payrollItems where payrollId=?',pay.id),fixed);
});

test('overlap and breaks are checked; cancelled work records are retained for allowance review',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,ta=await w.invite(),date='2026-10-17';h.clock=Date.parse(date+'T21:00:00+09:00');
 let r=await h.call('work/submit',{auth:ta,date,version:0,intervals:[{start:'13:00',end:'15:00',kind:'other'},{start:'14:00',end:'16:00',kind:'lesson'}],reason:'重複'});assert.equal(r.error.code,'overlap');
 r=await h.ok('work/submit',{auth:ta,date,version:0,intervals:[{start:'13:00',end:'19:05',kind:'lesson'}],reason:'休憩不足でも実績を消さない'});
 assert.match(r.warnings.issues.join(),/休憩/);
 assert.equal((await h.call('work/confirm',{auth,staffId:staff.id,date,version:r.day.version,reason:'確認'})).error.code,'needReview');
 const zero=await h.ok('work/submit',{auth:ta,date,version:r.day.version,intervals:[],reason:'【テスト】取消の訂正',note:'塾都合の勤務取消、休業手当を確認'});
 assert.equal(zero.day.actual.length,0);assert.equal(h.rows('select count(*) n from workDayRevisions')[0].n,2);
});

test('agreement makes the teacher official at once; remaining payroll setup stays an owner checklist',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,ta=await w.invite();
 assert.equal((await h.ok('staff/me',{auth:ta})).me.employmentAccess,false,'契約の成立までは業務画面を使えない');
 assert.equal((await h.call('employment/activate',{auth,staffId:staff.id})).error.code,'incomplete','契約が成立していなければ使えるようにできない');
 let r=await w.issue(await w.create());r=await w.pref(r,ta);r=await w.deliver(r);r=await w.agree(r,ta);
 assert.equal((await h.ok('staff/me',{auth:ta})).me.employmentAccess,true,'本人の同意で成立したら、そのまま正式な講師（業務画面）');
 assert.equal(h.rows("select * from auditLog where action='employmentActivated'").length,1);
 await h.ok('payroll/rates/save',{auth,staffId:staff.id,startsOn:'2026-10',lessonHourly:2000,meetingHourly:null});
 assert.deepEqual((await w.get()).checks,['労働保険（労災保険など）の届出・確認'],'残りは最初の給与までに代表がすること（勤務予定・講師マニュアルは条件にしない）');
 const pp=(await w.get()).profile,before=pp.data;
 await h.ok('employment/save',{auth,staffId:staff.id,version:pp.version,data:{insuranceChecked:true}});
 const after=(await w.get()).profile.data;assert.equal(after.insuranceChecked,true);assert.deepEqual({...after,insuranceChecked:before.insuranceChecked},before,'一部だけ保存しても、ほかの項目は消えない');
 assert.deepEqual((await w.get()).checks,[]);
 await h.ok('employment/activate',{auth,staffId:staff.id}); // 以前の流れで成立した講師のための手動の入口（何度押しても同じ）
 assert.equal(h.rows("select * from auditLog where action='employmentActivated'").length,1);
});

test('pay date uses previous banking day; unknown calendars are not silently confirmed',async()=>{
 const {payrollPayOn,calendarKnown}=await import('../cf/v2/bank-calendar.mjs');
 assert.equal(payrollPayOn('2026-09'),'2026-10-23');
 assert.equal(payrollPayOn('2026-06'),'2026-07-24');
 assert.equal(payrollPayOn('2026-10'),'2026-11-25');
 assert.equal(calendarKnown(2028),false);
});

test('new accounts cannot be assigned future teaching while preparation is incomplete',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w;await w.invite();
 const family=(await h.ok('admin/families/create',{auth,name:'【テスト】担当確認',email:'gated-parent@example.invalid'})).family;
 const student=(await h.ok('admin/students/create',{auth,familyId:family.id,familyName:'【テスト】',givenName:'生徒',baseRate30:1500})).student;
 const r=await h.call('schedule/lessons/create',{auth,studentId:student.id,date:'2026-10-18',start:'13:00',minutes:90,subject:'数学',deliveryMode:'in_person',staffId:staff.id,force:true});
 assert.equal(r.error.code,'employmentNotReady');
 assert.equal(h.rows('select count(*) n from lessons where staffId=?',staff.id)[0].n,0);
});
test('database rejects stale payroll basis and actual-work edits after confirmation',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,ta=await w.invite();h.clock=Date.parse('2026-10-17T15:00:00+09:00');
 await h.ok('payroll/rates/save',{auth,staffId:staff.id,startsOn:'2026-10',lessonHourly:2000,meetingHourly:null});
 let d=(await h.ok('work/submit',{auth:ta,date:'2026-10-17',version:0,intervals:[{start:'13:00',end:'14:00',kind:'other'}],reason:'見学'})).day;
 d=(await h.ok('work/confirm',{auth,staffId:staff.id,date:d.date,version:d.version,reviewed:true,reason:'確認'})).day;
 const v=(await h.ok('payroll/staff',{auth,staffId:staff.id,month:'2026-10'})).preview;
 assert.equal(JSON.parse(v.workBasis)[0].version,d.version);
 h.clock=Date.parse('2026-11-01T12:00:00+09:00');
 const p=(await h.ok('payroll/confirm',{auth,staffId:staff.id,month:'2026-10'})).payroll;
 assert.throws(()=>h.db2._sqlite.prepare("update workDays set actual='[]' where id=?").run(d.id),/payroll is confirmed/);
 const columns=h.rows('pragma table_info(payrollMonths)').map(x=>x.name);
 const row=h.rows('select * from payrollMonths where id=?',p.id)[0];row.id='stale-test';row.month='2026-11';row.workBasis='[]';
 assert.throws(()=>h.db2._sqlite.prepare('insert into payrollMonths('+columns.join(',')+') values('+columns.map(()=>'?').join(',')+')').run(...columns.map(k=>row[k])),/work changed/);
});

test('correction requests reach owner queue and answers leave both request and original payroll intact',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,ta=await w.invite();h.clock=Date.parse('2026-10-17T15:00:00+09:00');
 const d=(await h.ok('work/submit',{auth:ta,date:'2026-10-17',version:0,intervals:[{start:'13:00',end:'14:00',kind:'other'}],reason:'見学'})).day;
 await h.ok('work/correction',{auth:ta,date:d.date,version:d.version,reason:'終了時刻を確認したい'});
 const before=await w.get();assert.equal(before.requests.length,1);
 assert.equal((await h.ok('employment/list',{auth})).staff.find(x=>x.id===staff.id).pendingCorrections,1);
 const requestId=before.requests[0].id;
 assert.equal((await h.call('work/correction/respond',{auth:ta,staffId:staff.id,date:d.date,version:d.version,requestId,message:'自己回答'})).error.code,'forbidden');
 await h.ok('work/correction/respond',{auth,staffId:staff.id,date:d.date,version:d.version,requestId,message:'本人と確認し、元の時刻で正しいと確認しました'});
 assert.equal((await w.get()).requests.length,0);
 const read=await h.ok('work/day',{auth:ta,date:d.date});assert.equal(read.corrections.length,1);assert.equal(read.answers.length,1);assert.equal(read.day.version,d.version);
});

test('a snapshot fixed under the earlier layout keeps its body text; only the heading shows Japanese dates',async()=>{
 const {employmentDocument}=await import('../cf/v2/employment-document.mjs');
 const text='### 雇用契約書（兼 労働条件通知書）\n\n**第1条（契約期間）**\n\n1. 期間の定めあり：2026-10-17から2027-03-31まで。';
 const html=employmentDocument({id:'ec-old',revision:1,status:'agreed',method:'electronic',contentHash:'x',snapshot:JSON.stringify({layoutVersion:'20261017-2',staffName:'【テスト】講師',startDate:'2026-10-17',endDate:'2027-03-31',text})});
 assert.match(html,/期間の定めあり：2026-10-17から2027-03-31まで。/,'締結済みの本文は作り直さない');
 assert.match(html,/対象期間 2026年10月17日〜2027年3月31日/);
});
