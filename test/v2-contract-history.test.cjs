'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV2 } = require('./helpers/v2-harness.cjs');
const { createD1, migrationFiles, columns } = require('./helpers/d1-harness.cjs');
const at = s => Date.parse(s + '+09:00');
async function world() {
  const h = await createV2(), auth = await h.owner();
  const fam = (await h.ok('admin/families/create', { auth, name:'架空家', email:'parent@example.invalid' })).family;
  const kid = (await h.ok('admin/students/create', { auth, familyId:fam.id, familyName:'架空', givenName:'一郎', baseRate30:1500 })).student;
  const parent = (await h.ok('family/invite/accept', { token:h.linkFrom((await h.ok('admin/families/invite',{auth,id:fam.id}),h.mails().at(-1))), password:'family password 1' })).auth;
  const plan = async (extra={}) => (await h.ok('billing/plans/save',{auth,studentId:kid.id,subject:'数学',kind:'通常',startDate:'2026-11-01',endDate:'2026-11-30',minutes:90,fee:4500,count:4,...extra})).line;
  const row = id => h.rows('select * from planLines where id = ?',id)[0];
  const approve = async (p, time='2026-10-02T12:00:00+09:00') => h.call('billing/plans/consent',{auth,id:p.id,version:row(p.id).version,consenterName:'架空 保護者',consentedAt:time,via:'LINE'});
  return { h,auth,fam,kid,parent,plan,row,approve };
}
test('contract versions: old consent opens its own immutable text, and unknown legacy links remain unknown', async () => {
  const {h,auth,parent,fam} = await world();
  await h.ok('admin/terms/set',{auth,version:'old',title:'旧規約',url:'https://example.invalid/old',from:'2026-10-01',note:'旧説明'});
  await h.ok('family/terms/accept',{ consenterName:'架空 保護者',auth:parent,version:'old',agree:true,consenterName:'架空 保護者'});
  await h.ok('admin/terms/set',{auth,version:'new',title:'新規約',url:'https://example.invalid/new',from:'2026-11-01'});
  const t = (await h.ok('family/contracts',{auth:parent})).terms;
  assert.equal(t.agreed.url,'https://example.invalid/old');
  assert.equal(t.history[0].consenterName,'架空 保護者');
  assert.equal(t.history[0].recordedAt,'2026-10-02T03:00:00.000Z');
  assert.equal(t.needs,true);
  assert.equal((await h.call('admin/terms/set',{auth,version:'old',title:'旧規約',url:'https://example.invalid/changed',from:'2026-10-01',note:'旧説明'})).status,409);
  assert.throws(()=>h.db2._sqlite.prepare("update termsVersions set url='changed' where version='old'").run());
  h.db2._sqlite.prepare("update families set termsVersion='unknown',termsAcceptedAt='2026-08-01' where id=?").run(fam.id);
  const legacy=(await h.ok('family/terms',{auth:parent})).terms;
  assert.equal(legacy.agreed.version,'unknown'); assert.equal(legacy.agreed.url,'');
});

test('consent: actual approval and entry are separate, including a same-day early lesson', async () => {
  const {h,auth,kid,parent,plan,row,approve} = await world();
  const p=await plan({startDate:'2026-10-01',endDate:'2026-10-31'});
  await h.ok('billing/plans/send',{auth,familyId:kid.familyId});
  await h.ok('schedule/lessons/create',{auth,studentId:kid.id,date:'2026-10-02',start:'08:00',minutes:90,subject:'数学',kind:'通常',deliveryMode:'in_person',force:true});
  const ls=h.rows('select * from lessons where studentId=?',kid.id)[0];
  await h.ok('schedule/lessons/decide',{auth,id:ls.id,version:ls.version});
  assert.equal((await approve(p,'2026-10-02T09:00:00+09:00')).error.code,'afterLessonConsent');
  assert.equal((await h.call('family/plans/decide',{ consenterName:'架空 保護者',auth:parent,id:p.id,version:row(p.id).version,approvedCount:4,consenterName:'架空 保護者'})).error.code,'afterLessonConsent');
  assert.equal((await h.call('billing/plans/consent',{auth,id:p.id,version:row(p.id).version,consentDate:'2026-10-02',via:'LINE'})).error.code,'needConsenter');
  const result=await approve(p,'2026-10-02T07:00:00+09:00'); assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(row(p.id).consentedAt,'2026-10-01T22:00:00.000Z'); assert.equal(row(p.id).recordedAt,'2026-10-02T03:00:00.000Z');
  assert.ok(row(p.id).recordedByName); assert.equal(row(p.id).consenterName,'架空 保護者');
});

test('plan archive survives edits and deletion and is restricted to the family at the time', async () => {
  const {h,auth,kid,parent,plan,row,approve}=await world();
  const p=await plan({startDate:'2026-05-01',endDate:'2026-05-31'});
  assert.equal((await approve(p,'2026-05-01T09:00:00+09:00')).ok,true);
  assert.equal((await h.ok('family/money',{auth:parent})).plans.length,1,'old approved plan is visible');
  await h.ok('billing/plans/save',{auth,id:p.id,version:row(p.id).version,fee:4000});
  let history=(await h.ok('family/contracts',{auth:parent})).plans;
  const agreed=history.find(x=>x.id===p.id && x.status==='approved');
  assert.equal(agreed.fee,4500); assert.equal(agreed.approvedCount,4);
  await h.ok('billing/plans/delete',{auth,id:p.id,version:row(p.id).version});
  history=(await h.ok('family/contracts',{auth:parent})).plans;
  assert.equal(history.find(x=>x.status==='approved').fee,4500);
  const other=(await h.ok('admin/families/create',{auth,name:'別家',email:'other@example.invalid'})).family;
  const otherAuth=(await h.ok('family/invite/accept',{token:h.linkFrom((await h.ok('admin/families/invite',{auth,id:other.id}),h.mails().at(-1))),password:'family password 2'})).auth;
  assert.deepEqual((await h.ok('family/contracts',{auth:otherAuth,familyId:kid.familyId})).plans,[]);
  h.db2._sqlite.prepare('update students set familyId=? where id=?').run(other.id,kid.id);
  assert.deepEqual((await h.ok('family/contracts',{auth:otherAuth})).plans,[]);
  assert.equal((await h.ok('family/contracts',{auth:parent})).plans.some(x=>x.id===p.id),true);
});

test('new documents preserve old files, show the purpose and explicit evidence, and retain past versions', async () => {
  const {h,auth,kid,parent}=await world();
  const body={auth,studentId:kid.id,minutes:90,fee:4500,deliveryMode:'in_person',fromMonth:'2026-11'};
  const c=(await h.ok('admin/conditions/propose',body)).condition;
  const filesBefore=new Map([...h.env.FILES._m].map(([k,v])=>[k,Buffer.from(v.b)]));
  await h.ok('family/conditions/agree',{ consenterName:'架空 保護者',auth:parent,id:c.id,agree:true,consenterName:'架空 保護者'});
  await h.ok('admin/conditions/propose',{...body,fromMonth:'2026-12'});
  for (const [key,bytes] of filesBefore) assert.deepEqual(Buffer.from(h.env.FILES._m.get(key).b),bytes);
  const history=(await h.ok('family/contracts',{auth:parent})).conditions.items[0].history;
  assert.equal(history.length,2); assert.ok(history.find(x=>x.id===c.id).docFileId);
  const special={auth,studentId:kid.id,title:'試験個別解説',content:'毎回の個別解説',reason:'専用準備',prep:'問題確認',minutes:90,fee:6000,fromDate:'2026-11-01',toDate:'2026-12-31'};
  assert.equal((await h.call('admin/specials/propose',special)).ok,false,'purpose is required');
  const sp=(await h.ok('admin/specials/propose',{...special,purpose:'合格 <script>alert(1)</script>'})).special;
  const file=(await h.ok('files/link',{auth:parent,id:sp.docFileId})).url;
  const html=await (await h.raw('GET',file)).text();
  assert.match(html,/指導の目的/); assert.match(html,/&lt;script&gt;/); assert.doesNotMatch(html,/<script>/);
  await h.ok('family/specials/agree',{ consenterName:'架空 保護者',auth:parent,id:sp.id,agree:true,consenterName:'架空 保護者'});
  await h.ok('admin/specials/end',{auth,id:sp.id});
  assert.equal((await h.ok('family/contracts',{auth:parent})).specials.past[0].id,sp.id);
});

test('migration is additive: original columns, consent records, files and historical agreement text remain intact', async () => {
  const {h,auth,kid,parent,plan,approve}=await world();
  const p=await plan(); assert.equal((await approve(p)).ok,true);
  const c=(await h.ok('admin/conditions/propose',{auth,studentId:kid.id,minutes:90,fee:4500,deliveryMode:'in_person',fromMonth:'2026-11'})).condition;
  await h.ok('family/conditions/agree',{ consenterName:'架空 保護者',auth:parent,id:c.id,agree:true});
  await h.ok('admin/terms/set',{auth,version:'fixture-old',title:'旧版',url:'https://example.invalid/old'});
  await h.ok('family/terms/accept',{ consenterName:'架空 保護者',auth:parent,version:'fixture-old',agree:true});
  const db=createD1({migrate:false}), ms=migrationFiles('migrations-v2'), migration=ms.find(m=>m.name==='0023_contract_history.sql');
  for(const m of ms.filter(m=>m.name<'0023_contract_history.sql')) db._sqlite.exec(m.sql);
  const saved={}; db._sqlite.exec('pragma foreign_keys=off');
  for(const table of ['settings','families','students','conditions','specials','termsConsents','planLines','files']) {
    const cols=columns(db,table), rows=h.rows('select '+cols.join(',')+' from '+table);
    db._sqlite.exec('delete from '+table);
    for(const r of rows) db._sqlite.prepare('insert into '+table+' ('+cols.join(',')+') values ('+cols.map(()=>'?').join(',')+')').run(...cols.map(k=>r[k]));
    saved[table]={cols,rows:JSON.parse(JSON.stringify(rows))};
  }
  db._sqlite.exec('pragma foreign_keys=on'); db._sqlite.exec(migration.sql);
  for(const [table,{cols,rows}] of Object.entries(saved)) assert.deepEqual(JSON.parse(JSON.stringify(db._sqlite.prepare('select '+cols.join(',')+' from '+table).all())),rows,table+' original columns unchanged');
  const copied=JSON.parse(db._sqlite.prepare('select snapshot from planRevisions where planId=?').get(p.id).snapshot);
  assert.equal(copied.fee,4500); assert.equal(copied.consenterName,''); assert.equal(copied.consentedAt,'');
  assert.equal(db._sqlite.prepare('select templateVersion from conditions').get().templateVersion,'legacy');
  assert.equal(db._sqlite.prepare("select value from settings where key='termsVersion'").get().value,'fixture-old');
  assert.equal(db._sqlite.prepare("select url from termsVersions where version='fixture-old'").get().url,'https://example.invalid/old');
  const legacy=await import('../cf/v2/condition-doc-legacy.mjs'), current=await import('../cf/v2/condition-doc.mjs');
  const cond=db._sqlite.prepare('select * from conditions').get(), student=h.rows('select * from students where id=?',kid.id)[0], family=h.rows('select * from families')[0], terms={version:'fixture-old',title:'旧版',url:'https://example.invalid/old'};
  assert.equal(current.conditionDocHtml({cond,student,family,terms}),legacy.conditionDocHtml({cond,student,family,terms}),'old templates stay exact');
});

test('copied plans keep their proposer without copying the previous consent', async()=>{
 const {h,auth,kid,plan,approve}=await world();
 const p=await plan(); assert.equal((await approve(p)).ok,true);
 await h.ok('billing/plans/copyMonth',{auth,studentId:kid.id,month:'2026-12'});
 const copy=h.rows("select * from planLines where startDate='2026-12-01'")[0];
 assert.ok(copy.proposedByName);assert.equal(copy.instructionType,'regular');assert.equal(copy.consenterName,'');
});

test('a former student stays in the archive without blocking current family approvals', async()=>{
 const {h,auth,kid,parent}=await world();
 await h.ok('admin/conditions/propose',{auth,studentId:kid.id,minutes:90,fee:4500,deliveryMode:'in_person',fromMonth:'2026-11'});
 h.db2._sqlite.prepare("update students set status='left' where id=?").run(kid.id);
 const money=await h.ok('family/money',{auth:parent});
 assert.equal(money.conditions.needs,false);
 assert.equal((await h.ok('family/contracts',{auth:parent})).conditions.items[0].history.length,1);
});
test('a concurrently replaced condition cannot produce a false agreement or another file', async()=>{
 const {h,auth,kid,parent}=await world();
 const c=(await h.ok('admin/conditions/propose',{auth,studentId:kid.id,minutes:90,fee:4500,deliveryMode:'in_person',fromMonth:'2026-11'})).condition;
 const prepare=h.db2.prepare, files=h.env.FILES._m.size;
 h.db2.prepare=sql=>{
  if(sql.startsWith("update conditions set status = 'agreed'")) return {bind:()=>({run:async()=>({meta:{changes:0}})})};
  return prepare(sql);
 };
 const r=await h.call('family/conditions/agree',{auth:parent,id:c.id,agree:true,consenterName:'架空 保護者'});
 assert.equal(r.error.code,'conflict');assert.equal(h.env.FILES._m.size,files);
 assert.equal(h.rows('select status from conditions where id=?',c.id)[0].status,'proposed');
});

test('plan history keeps purpose breakdowns with the exact saved version', async()=>{
 const {h,auth,parent,plan,row,approve}=await world();
 const parts=[{label:'テスト対策',count:2},{label:'教材の定着',count:2}];
 const p=await plan({parts});
 const archived=()=>h.rows('select snapshot from planRevisions where planId=? order by rowVersion',p.id).map(r=>JSON.parse(r.snapshot));
 assert.equal(archived()[0].parts,JSON.stringify(parts));
 assert.equal((await approve(p)).ok,true);
 await h.ok('billing/plans/save',{auth,id:p.id,version:row(p.id).version,parts:[{label:'変更後',count:4}]});
 assert.equal(archived().at(-1).parts,JSON.stringify([{label:'変更後',count:4}]));
 const history=(await h.ok('family/contracts',{auth:parent})).plans;
 assert.deepEqual(history.find(x=>x.status==='approved').parts,parts);
});
