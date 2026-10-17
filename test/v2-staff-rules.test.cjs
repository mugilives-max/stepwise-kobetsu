'use strict';
// 講師のきまり（cf/v2/staff-rules.mjs）。雇用契約書 第9条7項。講師が今の版を読んだ記録と、勤務開始までにすることへの反映
const test=require('node:test'),assert=require('node:assert/strict');
const {employmentWorld}=require('./helpers/employment-fixture.cjs');
test('staff rules: employee reads the current version once; owner sees readers; readiness waits for it',async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,ta=await w.invite();
 let r=await h.ok('employment/rules/get',{auth:ta});
 assert.equal(r.rules.title,'講師のきまり（2026年11月版）');assert.equal(r.readAt,'');
 assert.ok(r.rules.sections.flatMap(x=>x[1]).includes('授業記録は、その日の授業中に塾のシステムに入れます。'));
 assert.ok(r.rules.sections.flatMap(x=>x[1]).some(x=>x.includes('LINE で代表に連絡')));
 assert.ok(r.rules.sections.flatMap(x=>x[1]).includes('オンラインの授業は、当面行いません。始めるときは、場所と進め方を前もってお知らせします。'));
 assert.ok((await w.get()).checks.includes('講師のきまり（本人の確認）'));
 assert.equal((await h.call('employment/rules/read',{auth:ta,hash:'old',confirm:true})).error.code,'staleRules');
 assert.equal((await h.call('employment/rules/read',{auth:ta,hash:r.hash})).error.code,'needConfirm');
 assert.equal((await h.call('employment/rules/read',{auth,hash:r.hash,confirm:true})).error.code,'forbidden','代表は読んだ記録を残さない');
 const first=(await h.ok('employment/rules/read',{auth:ta,hash:r.hash,confirm:true})).readAt;assert.ok(first);
 h.clock+=60000;assert.equal((await h.ok('employment/rules/read',{auth:ta,hash:r.hash,confirm:true})).readAt,first,'2回目は記録を増やさない');
 assert.equal(h.rows("select * from auditLog where action='staffRulesRead'").length,1);
 assert.ok(!(await w.get()).checks.includes('講師のきまり（本人の確認）'));assert.equal((await w.get()).rulesReadAt,first);
 const o=await h.ok('employment/rules/get',{auth});assert.deepEqual(o.readers.find(x=>x.id===staff.id),{id:staff.id,name:staff.name,readAt:first});
 assert.equal((await h.call('employment/rules/get',{})).error.code,'needLogin');
 // 書面（A4。印刷して渡せる）: 講師も代表も開ける。受け取りの欄つき
 for(const who of [ta,auth]){const html=(await h.ok('employment/rules/document',{auth:who})).html;for(const t of ['<title>講師のきまり（2026年11月版）</title>','@page { size: A4','受け取りの記録','講師の氏名（署名）'])assert.ok(html.includes(t),t);assert.doesNotMatch(html,/<script/);}
 assert.equal((await h.call('employment/rules/document',{})).error.code,'needLogin');
});
