'use strict';
// Run in GitHub Actions only, against an in-memory database with synthetic families.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createV2}=require('../test/helpers/v2-harness.cjs');
(async()=>{
 const h=await createV2(), auth=await h.owner();
 const fam=(await h.ok('admin/families/create',{auth,name:'架空家',guardianName:'架空 保護者',email:'parent@example.invalid'})).family;
 const kid=(await h.ok('admin/students/create',{auth,familyId:fam.id,familyName:'架空',givenName:'一郎',baseRate30:1500})).student;
 const parent=(await h.ok('family/invite/accept',{token:h.linkFrom((await h.ok('admin/families/invite',{auth,id:fam.id}),h.mails().at(-1))),password:'family password 1'})).auth;
 await h.ok('admin/terms/set',{auth,version:'old',title:'旧規約',url:'https://example.invalid/old'});
 await h.ok('family/terms/accept',{auth:parent,version:'old',agree:true,consenterName:'架空 保護者'});
 await h.ok('admin/terms/set',{auth,version:'new',title:'新規約',url:'https://example.invalid/new'});
 await h.ok('admin/terms/request',{auth,familyIds:[fam.id]});
 const p=(await h.ok('billing/plans/save',{auth,studentId:kid.id,subject:'数学',kind:'通常',startDate:'2026-05-01',endDate:'2026-05-31',minutes:90,fee:4500,count:4})).line;
 await h.ok('billing/plans/consent',{auth,id:p.id,version:p.version,consenterName:'架空 保護者',consentedAt:'2026-05-01T09:00:00+09:00',via:'LINE'});
 const pendingCondition=(await h.ok('admin/conditions/propose',{auth,studentId:kid.id,minutes:90,fee:4500,deliveryMode:'in_person',fromMonth:'2026-11'})).condition;
 const pendingSpecial=(await h.ok('admin/specials/propose',{auth,studentId:kid.id,title:'試験個別解説',purpose:'得点改善',content:'個別問題の解説',reason:'専用準備',prep:'個別問題確認',minutes:90,fee:6000,fromDate:'2026-11-01',toDate:'2026-12-31'})).special;
 const root=path.resolve(__dirname,'..');
 const server=http.createServer(async(req,res)=>{
  try {
   const url=new URL(req.url,'http://localhost');
   if(url.pathname.startsWith('/v2/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const r=await h.call(url.pathname.slice(4),JSON.parse(Buffer.concat(chunks).toString()||'{}'));
    res.setHeader('content-type','application/json');res.end(JSON.stringify(r));return;
   }
   const p=path.resolve(root,'.'+decodeURIComponent(url.pathname));
   if(!p.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
   const file=fs.statSync(p).isDirectory()?path.join(p,'index.html'):p;
   const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
   res.setHeader('content-type',mime);res.end(fs.readFileSync(file));
  }catch(e){res.writeHead(404);res.end('not found');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port, browser=await chromium.launch();
 const report={checks:[],externalRequests:[]},out=path.join(root,'contract-ui-output');fs.mkdirSync(out,{recursive:true});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin||u.protocol==='data:')return route.continue();report.externalRequests.push(u.origin);return route.abort();});
  await context.addInitScript(({parent,auth})=>{localStorage.setItem('sw2_family',parent);localStorage.setItem('sw2_staff',auth);},{parent,auth});
  const page=await context.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/family/#money');
  await page.locator('input[data-consenter="'+pendingCondition.id+'"]').fill('架空 太郎');
  await page.locator('[data-cond-agree="'+pendingCondition.id+'"]').check();
  assert.equal(await page.locator('input[data-consenter="'+pendingCondition.id+'"]').inputValue(),'架空 太郎');
  await page.locator('input[data-consenter="'+pendingSpecial.id+'"]').fill('架空 花子');
  await page.locator('[data-special-agree="'+pendingSpecial.id+'"]').check();
  assert.equal(await page.locator('input[data-consenter="'+pendingSpecial.id+'"]').inputValue(),'架空 花子');
  report.checks.push('pending basic and special condition cards render and retain explicit names');
  await page.getByRole('button',{name:'過去の契約・同意の控え',exact:true}).click();
  await page.locator('summary').filter({hasText:'受講計画合意書の履歴'}).click();
  await page.getByText('第2版・2026-05-01〜2026-05-31',{exact:false}).waitFor();
  assert.match(await page.locator('#app').innerText(),/架空 保護者/);
  const links=await page.locator('a').evaluateAll(es=>es.filter(e=>e.textContent==='この版の全文').map(e=>e.href));
  assert.deepEqual(links,['https://example.invalid/old']);
  const lineHtml=await page.evaluate(async()=>{const {termsLine}=await import('/assets/v2/portal-ui.js?v=20261014-names');return termsLine({agreed:{version:'old',at:'2026-10-02',url:'https://example.invalid/old'},current:{url:'https://example.invalid/new'}});});
  assert.match(lineHtml,/example\.invalid\/old/);assert.doesNotMatch(lineHtml,/example\.invalid\/new/);
  const nameInput=page.locator('input[data-consenter="terms"]');
  await nameInput.fill('架空 太郎'); await page.locator('#terms-agree').check();
  assert.equal(await nameInput.inputValue(),'架空 太郎','rerender preserves explicit name');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'390px family page does not overflow');
  await page.screenshot({path:path.join(out,'family-history.png'),fullPage:true});
  report.checks.push('old fixed link, old plan, mobile layout, name retention');
  await page.goto(origin+'/staff/#terms');
  await page.getByRole('heading',{name:'今の版',exact:true}).waitFor();
  assert.match(await page.locator('#app').innerText(),/お願い中/,'the family asked to agree is listed as asked');
  await page.locator('[data-action="terms-decide-start"]').click();
  await page.getByRole('heading',{name:'切り替えるとどうなるか',exact:true}).waitFor();
  assert.match(await page.locator('#app').innerText(),/今通っている家族には、まだ何も出ません/);
  assert.equal(await page.locator('[data-form="terms-decide"] input[name="confirm"]').count(),0,'代表に「確かめました」の印は求めない');
  assert.equal((await h.ok('admin/terms/get',{auth})).terms.version,'new','opening the confirmation does not change the terms in use');
  report.checks.push('deciding the terms in use is separate from asking families to agree, and needs its own confirmation');
  await page.screenshot({path:path.join(out,'staff-terms.png'),fullPage:true});
  const {sampleDocHtml}=await import('../cf/v2/docs-sample.mjs');
  for(const type of ['condition','special']){
   await page.setViewportSize({width:1000,height:1400});
   await page.setContent(await sampleDocHtml(h.db2,type,h.clock));await page.emulateMedia({media:'print'});
   const bad=await page.locator('table').evaluateAll(ts=>ts.filter(t=>t.scrollWidth>t.clientWidth+1).length);assert.equal(bad,0,type+' table fits');
   assert.match(await page.locator('body').innerText(),type==='condition'?/個別受講条件書/:/特別単価合意書[\s\S]*指導の目的/);
   await page.screenshot({path:path.join(out,type+'.png'),fullPage:true}); report.checks.push(type+' printable layout');
  }
  assert.deepEqual(errors,[],'browser errors');assert.deepEqual(report.externalRequests,[],'all requests stay in synthetic test server');
  console.log(JSON.stringify(report));
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
