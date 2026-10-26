'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {agreementFixture}=require('./helpers/agreement-fixture.cjs');
test('agreement documents require auth, hide drafts from families, and do not approve, notify or store files',async()=>{
 const {h,auth,parent,plan,refs,kid,row}=await agreementFixture(), p=await plan();
 const teacherAuth=await h.staffWith(auth,['teacher'],'teacher-agreement@example.invalid');
 const before=()=>JSON.stringify({plans:h.rows('select * from planLines'),revisions:h.rows('select * from planRevisions'),files:h.rows('select * from files'),mails:h.mails().length});
 const saved=before();
 assert.equal((await h.call('family/plans/document',{refs:refs(p)})).ok,false);
 assert.equal((await h.call('family/plans/document',{auth:parent,refs:refs(p)})).error.code,'notFound');
 assert.equal((await h.call('billing/plans/document',{auth:teacherAuth,refs:refs(p)})).ok,false);
 const d=await h.ok('billing/plans/document',{auth,refs:refs(p)});
 assert.match(d.html,/受講合意書（案）/);assert.match(d.html,/18,000円/);assert.match(d.html,/下書き・未提示/);
 assert.equal(before(),saved);
 await h.ok('billing/plans/send',{auth,familyId:kid.familyId});
 const proposed=row(p.id);
 const start=before(), f=await h.ok('family/plans/document',{auth:parent,refs:refs(proposed)});
 assert.match(f.html,/承認待ち/);assert.equal(before(),start);
});
test('approved exact versions survive edits, deletion, and later terms selection',async()=>{
 const {h,auth,parent,plan,approve,row,refs}=await agreementFixture();
 await h.ok('admin/terms/set',{auth,version:'agreement-old',url:'https://example.invalid/old',title:'旧規約'});
 await h.ok('family/terms/accept',{auth:parent,version:'agreement-old',agree:true,consenterName:'【テスト】架空 保護者'});
 const p=await plan();await approve(p,{approvedCount:3,consentedAt:'2026-10-02T12:00:00+09:00'});const approved=row(p.id), req={auth:parent,refs:refs(approved)};
 const before=await h.ok('family/plans/document',req);
 assert.match(before.html,/13,500円/);assert.match(before.html,/【テスト】架空 保護者/);assert.match(before.html,/12:00:00/);
 assert.match(before.html,/承認回数は提案回数から変更/);assert.match(before.html,/example.invalid\/old/);
 await h.ok('admin/terms/set',{auth,version:'agreement-new',url:'https://example.invalid/new',title:'新規約'});
 await h.ok('billing/plans/save',{auth,id:p.id,version:approved.version,fee:4000});
 await h.ok('billing/plans/delete',{auth,id:p.id,version:row(p.id).version});
 assert.deepEqual(await h.ok('family/plans/document',req),before);
 const history=await h.ok('billing/plans/history',{auth,studentId:approved.studentId});
 assert.ok(history.plans.some(x=>x.id===p.id&&x.version===approved.version));
});
test('family authorization uses archived ownership after a student transfer, not client ids',async()=>{
 const {h,auth,parent,plan,approve,row,refs,kid}=await agreementFixture();
 const p=await plan();await approve(p);const approved=row(p.id);
 const other=(await h.ok('admin/families/create',{auth,name:'【テスト】別家',email:'other-agreement@example.invalid'})).family;
 await h.ok('admin/families/invite',{auth,id:other.id});
 const otherAuth=(await h.ok('family/invite/accept',{token:h.linkFrom(h.mails().at(-1)),password:'synthetic password 2'})).auth;
 h.db2._sqlite.prepare('update students set familyId=?,familyName=? where id=?').run(other.id,'【テスト】変更後',kid.id);
 assert.equal((await h.call('family/plans/document',{auth:otherAuth,familyId:approved.familyId,refs:refs(approved)})).error.code,'notFound');
 assert.match((await h.ok('family/plans/document',{auth:parent,refs:refs(approved)})).html,/【テスト】架空 一郎/);
 assert.equal((await h.call('billing/plans/history',{auth:parent,studentId:kid.id})).ok,false);
});
test('combined output rejects duplicate versions, missing rows, mixed states, periods and students',async()=>{
 const {h,auth,parent,plan,approve,row,refs,fam}=await agreementFixture();
 const a=await plan(), b=await plan({subject:'英語'});
 const document=refs=>h.call('billing/plans/document',{auth,refs});
 assert.equal((await document(refs(a,b))).ok,true);
 for(const x of [[],[{id:a.id,version:'1'}],refs(a,a),[{id:'missing',version:1}],Array(61).fill({id:a.id,version:1})])assert.equal((await document(x)).ok,false);
 await approve(a);const approved=row(a.id);
 assert.equal((await document(refs(approved,b))).error.code,'mixedDocument');
 const c=await plan({startDate:'2026-12-01',endDate:'2026-12-31'});
 assert.equal((await document(refs(b,c))).error.code,'mixedDocument');
 const kid2=(await h.ok('admin/students/create',{auth,familyId:fam.id,familyName:'【テスト】架空',givenName:'二郎',baseRate30:1500})).student;
 const d=await plan({studentId:kid2.id});
 assert.equal((await document(refs(b,d))).error.code,'mixedDocument');
 // No partial output when a requested group contains a hidden draft.
 assert.equal((await h.call('family/plans/document',{auth:parent,refs:refs(approved,b)})).error.code,'notFound');
 const one=await document(refs(b)), again=await document(refs(b));
 assert.equal(one.documentId,again.documentId);
});
test('HTML escapes saved content and unknown historical evidence is never filled from current settings',async()=>{
 const {h,auth,parent,plan,approve,row,refs}=await agreementFixture();
 const p=await plan({comment:'<script>alert("x")</script>',parts:[{label:'<img src=x onerror=alert(1)>',count:4}]});
 await approve(p);const approved=row(p.id);
 const d=await h.ok('family/plans/document',{auth:parent,refs:refs(approved)});
 assert.match(d.html,/&lt;script&gt;/);assert.doesNotMatch(d.html,/<script>|<img src=x/);
 await h.ok('admin/terms/set',{auth,version:'later',url:'https://example.invalid/later',title:'後の規約'});
 const draft=await plan({subject:'英語'});
 const old=await h.ok('billing/plans/document',{auth,refs:refs(p)});
 assert.match(old.html,/記録なし/);assert.doesNotMatch(old.html,/example.invalid\/later/);
 const {agreementDocHtml}=await import('../cf/v2/agreement-doc-20261016.mjs');
 const legacy=agreementDocHtml({records:[{studentName:'【テスト】旧記録',line:{...approved,consenterName:'',consentedAt:'',consentDate:'2026-09-30',recordedAt:'',recordedByName:'',approvedCount:null,termsVersion:'unknown'},terms:{url:'javascript:alert(1)'}}],documentId:'legacy'});
 assert.match(legacy,/算出できません/);assert.match(legacy,/時刻の記録なし/);assert.doesNotMatch(legacy,/href="javascript:/);
 assert.ok(draft.id);
});
test('read-only parent preview and synthetic sample can open documents without writing consent',async()=>{
 const {h,auth,parent,plan,approve,row,refs,fam}=await agreementFixture();
 const p=await plan();await approve(p);
 const preview=await h.ok('admin/preview/start',{auth,kind:'family',id:fam.id});
 const token=decodeURIComponent(preview.url.split('#preview=')[1]);
 assert.ok(token.startsWith('pv2.'),preview.url);
 const req=refs(row(p.id));
 const normal=await h.ok('family/plans/document',{auth:parent,refs:req});
 const pv=await h.ok('family/plans/document',{auth:token,refs:req});
 assert.equal(pv.html,normal.html);
 const sample=await h.ok('admin/docs/sample',{auth,type:'agreement'});
 assert.match(sample.html,/見本・架空の記録/);assert.match(sample.html,/印刷・PDF/);
 assert.doesNotMatch(sample.html,/【テスト】架空 一郎/);
});

test('parent approval keeps the original proposal and a declined plan shows zero approved lessons',async()=>{
 const {h,auth,parent,kid,plan,refs,row}=await agreementFixture();
 const p=await plan(), q=await plan({subject:'英語'});
 await h.ok('billing/plans/send',{auth,familyId:kid.familyId});
 const original=row(p.id);
 const proposal=await h.ok('family/plans/document',{auth:parent,refs:refs(original)});
 await h.ok('family/plans/decide',{auth:parent,id:p.id,version:original.version,approvedCount:2,consenterName:'【テスト】保護者の承認'});
 await h.ok('family/plans/decide',{auth:parent,id:q.id,version:row(q.id).version,approvedCount:0,consenterName:'【テスト】保護者の承認'});
 const approved=await h.ok('family/plans/document',{auth:parent,refs:refs(row(p.id))});
 assert.match(approved.html,/9,000円/);assert.match(approved.html,/保護者ページ/);assert.match(approved.html,/【テスト】保護者の承認/);
 assert.deepEqual(await h.ok('family/plans/document',{auth:parent,refs:refs(original)}),proposal);
 const declined=await h.ok('family/plans/document',{auth:parent,refs:refs(row(q.id))});
 assert.match(declined.html,/受講合意書の記録（見送り）/);assert.match(declined.html,/<th>承認回数<\/th>/);assert.match(declined.html,/<td>0回<\/td>/);
});

// 2026-10-26 本人「書式を他の書類に合わせましょうか」: この日より後に保存した版は、個別受講条件書と同じ書式。前の版は前の様式のまま
test('agreement documents saved after 2026-10-26 use the same layout as the individual conditions document',async()=>{
 const {agreementDocHtmlR13,usesLayoutR13,NEW_LAYOUT_FROM}=await import('../cf/v2/agreement-doc-20261026.mjs');
 const line={id:'pl_1',version:1,status:'proposed',createdAt:'2026-10-27T03:00:00.000Z',subject:'数学',kind:'通常',startDate:'2026-11-01',endDate:'2026-11-30',count:4,minutes:90,fee:4500,comment:'二次関数の復習',parts:[{label:'二次関数',count:2},{label:'テスト対策',count:2}],instructionType:'regular',proposedByName:'【テスト】講師',proposedAt:'2026-10-27T03:00:00.000Z'};
 const rec=(l,at)=>({line:l,studentName:'【テスト】架空 一郎',capturedAt:at,terms:{title:'共通規約',url:'https://www.stepwise-education.jp/terms/2026-11-20261026-r13/'}});
 assert.equal(usesLayoutR13([rec({...line,createdAt:'2026-10-14T00:00:00.000Z'},NEW_LAYOUT_FROM)]),false,'前からの行は前の様式');
 assert.equal(usesLayoutR13([rec(line,'')]),true);
 const draft=agreementDocHtmlR13({records:[rec(line,NEW_LAYOUT_FROM)],documentId:'AG-a',guardianName:'【テスト】架空 花子'});
 assert.match(draft,/<h1>受講合意書<span class="draft">案<\/span><\/h1>/);assert.match(draft,/【テスト】架空 花子 様/);
 assert.match(draft,/class="key"/);assert.match(draft,/<h2>取り決め<\/h2>/);assert.match(draft,/まだ承認いただいていません/);
 assert.match(draft,/18,000円/);assert.match(draft,/二次関数 2回／テスト対策 2回/);assert.doesNotMatch(draft,/pl_1|ID：/,'内部の番号を出さない');
 const ok=agreementDocHtmlR13({records:[rec({...line,status:'approved',approvedCount:3,consenterName:'【テスト】承認した保護者',consentedAt:'2026-10-28T01:00:00.000Z',approvedVia:'保護者ページ'},NEW_LAYOUT_FROM)],documentId:'AG-b',guardianName:'今の保護者'});
 assert.match(ok,/【テスト】承認した保護者 様/,'承認のあとは意思表示した保護者');assert.doesNotMatch(ok,/今の保護者/);
 assert.match(ok,/13,500円/);assert.match(ok,/提案した回数/);assert.match(ok,/承認いただきました/);
 const no=agreementDocHtmlR13({records:[rec({...line,status:'declined',consenterName:'【テスト】保護者',consentedAt:'2026-10-28T01:00:00.000Z'},NEW_LAYOUT_FROM)],documentId:'AG-c'});
 assert.match(no,/<span class="draft">見送り<\/span>/);assert.match(no,/0円/);
});
test('the document route uses the new layout for versions saved after 2026-10-26, addressed to the guardian before approval',async()=>{
 const {h,auth,parent,plan,approve,refs,row,kid}=await agreementFixture({at:'2026-10-27T03:00:00Z'});
 const p=await plan();await h.ok('billing/plans/send',{auth,familyId:kid.familyId});
 const d=await h.ok('family/plans/document',{auth:parent,refs:refs(row(p.id))});
 assert.equal(d.layoutVersion,'20261026-r13');assert.match(d.html,/【テスト】架空 保護者 様/);assert.match(d.html,/<h2>取り決め<\/h2>/);
});
