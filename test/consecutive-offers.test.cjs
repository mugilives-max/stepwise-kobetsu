const test=require('node:test'),assert=require('node:assert/strict');
const {createSchedulingHarness,failWriteOnce}=require('./helpers/scheduling-harness.cjs');
const lessons=[{start:'16:00',min:90,subject:'英語',kind:'通常',deliveryMode:'in_person'},{start:'17:30',min:90,subject:'数学',kind:'通常',deliveryMode:'in_person'}];
function approve(h){h.approve({subject:'英語'});h.approve({subject:'数学'});}
test('consecutive offers repeat as a whole and retry does not duplicate saved lessons',()=>{
 const h=createSchedulingHarness();approve(h);const args={lessons,repeat:2,requestId:'consecutive-1'};
 const r=h.offer(args);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.added,4);
 assert.deepEqual(h.rows('slots').map(s=>[s.date,s.start,s.subject]),[['2026-09-15','16:00','英語'],['2026-09-15','17:30','数学'],['2026-09-22','16:00','英語'],['2026-09-22','17:30','数学']]);
 assert.equal(h.offer(args).replayed,true);assert.equal(h.rows('slots').length,4);
});
test('overlap inside the batch and a conflict on the final repeated lesson save nothing',()=>{
 const h=createSchedulingHarness();approve(h);
 assert.ok(h.offer({lessons:[lessons[0],{...lessons[1],start:'17:00'}]}).error);assert.equal(h.rows('slots').length,0);
 h.seedSlot({date:'2026-09-22',start:'18:00'});
 assert.ok(h.offer({lessons,repeat:2}).error);assert.equal(h.rows('slots').length,1);
});
test('each subject needs its own plan and suggestions never combine subjects',()=>{
 const h=createSchedulingHarness();let r=h.offer({lessons,planForce:true});assert.equal(r.needPlan,true);assert.equal(r.planSuggest.subject,'英語');assert.equal(r.planSuggest.count,1);
 h.approve({subject:'英語'});r=h.offer({lessons,planForce:true});assert.equal(r.planSuggest.subject,'数学');assert.equal(r.planSuggest.count,1);assert.equal(h.rows('slots').length,0);
});
test('retry recognizes a durable write even when the original request failed afterwards',()=>{
 const h=createSchedulingHarness();approve(h);const args={lessons,requestId:'lost-response'};
 failWriteOnce(h.spreadsheet.getSheetByName('slots'),()=>true,true);
 assert.ok(h.offer(args).error);assert.equal(h.rows('slots').length,2);
 assert.equal(h.offer(args).replayed,true);assert.equal(h.rows('slots').length,2);
});
