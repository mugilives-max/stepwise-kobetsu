'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { createV2 } = require('./helpers/v2-harness.cjs');

test('legacy and r3 templates remain byte-identical for both pending and agreed documents', async () => {
 const common = { student:{familyName:'【テスト】',givenName:'生徒'}, family:{name:'【テスト】家庭'}, terms:{version:'old',url:'https://example.invalid/old'}, proposer:'【テスト】担当', now:'2026-10-14T00:00:00Z' };
 for(const kind of ['condition','special']) {
  const field=kind==='condition'?'cond':'sp', fn=kind+'DocHtml';
  const current=await import('../cf/v2/'+kind+'-doc.mjs');
  for(const version of ['legacy','20261012-r3']) {
   const prior=await import('../cf/v2/'+kind+'-doc-'+(version==='legacy'?'legacy':'r3')+'.mjs');
   for(const status of ['proposed','agreed']) {
    const row={templateVersion:version,status,no:1,minutes:90,fee:4500,fromMonth:'2026-11',fromDate:'2026-11-01',toDate:'2026-11-30',note:'基本指導条件書という本人の自由記述を保存',title:'【テスト】解説',purpose:'試験対策'};
    assert.equal(current[fn]({...common,[field]:row}),prior[fn]({...common,[field]:row}));
   }
  }
 }
 const expected={"condition":"4b136e24e09f6d5f9eaa5014c58cf41ef6f83c92","special":"1ba4ee2deb4c29d70f7e78d85f7648dd31f60a3d"};
 for(const [kind,blob] of Object.entries(expected)) {
  const bytes=fs.readFileSync(require('node:path').join(__dirname,'../cf/v2/'+kind+'-doc-r3.mjs'));
  assert.equal(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),blob);
 }
});

test('new condition proposals use r6 (specials r5); an r3 pending proposal keeps its old title on later approval', async () => {
 const h=await createV2(), auth=await h.owner();
 const f=(await h.ok('admin/families/create',{auth,name:'【テスト】家庭',email:'parent@example.invalid'})).family;
 const s=(await h.ok('admin/students/create',{auth,familyId:f.id,familyName:'【テスト】',givenName:'生徒',baseRate30:1500})).student;
 const parent=(await h.ok('family/invite/accept',{token:h.linkFrom((await h.ok('admin/families/invite',{auth,id:f.id}),h.mails().at(-1))),password:'family password 1'})).auth;
 const c=(await h.ok('admin/conditions/propose',{auth,studentId:s.id,minutes:90,fee:4500,deliveryMode:'in_person',fromMonth:'2026-11'})).condition;
 assert.equal(h.rows('select templateVersion from conditions where id=?',c.id)[0].templateVersion,'20261019-r6');
 const before=new Map([...h.env.FILES._m].map(([k,v])=>[k,Buffer.from(v.b)]));
 h.db2._sqlite.prepare("update conditions set templateVersion='20261012-r3' where id=?").run(c.id);
 await h.ok('family/conditions/agree',{auth:parent,id:c.id,agree:true,consenterName:'【テスト】保護者'});
 const oldFile=h.rows("select * from files where refId=? order by rowid desc",c.id)[0];
 assert.match(oldFile.name,/基本指導条件書/);
 const sp=(await h.ok('admin/specials/propose',{auth,studentId:s.id,title:'【テスト】個別解説',purpose:'試験対策',content:'解説',reason:'専用準備',prep:'問題確認',minutes:90,fee:6000,fromDate:'2026-11-01',toDate:'2026-11-30'})).special;
 assert.equal(h.rows('select templateVersion from specials where id=?',sp.id)[0].templateVersion,'20261014-r5');
 h.db2._sqlite.prepare("update specials set templateVersion='20261012-r3' where id=?").run(sp.id);
 await h.ok('family/specials/agree',{auth:parent,id:sp.id,agree:true,consenterName:'【テスト】保護者'});
 assert.match(h.rows("select * from files where refId=? order by rowid desc",sp.id)[0].name,/特殊指導条件書/);
 for(const [key,bytes] of before) assert.deepEqual(Buffer.from(h.env.FILES._m.get(key).b),bytes);
});
