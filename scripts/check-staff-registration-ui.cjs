'use strict';
// Isolated synthetic records only. External requests are blocked; nothing is deployed.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {employmentWorld}=require('../test/helpers/employment-fixture.cjs');
(async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,root=path.resolve(__dirname,'..');
 const out=path.join(root,'staff-registration-review-output');fs.mkdirSync(out,{recursive:true});
 const report={checks:[],externalRequests:[],errors:[]};
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');
   if(u.pathname.startsWith('/v2/')){
    const chunks=[];for await(const b of req)chunks.push(b);
    const payload=JSON.parse(Buffer.concat(chunks).toString()||'{}');
    if(u.pathname==='/v2/employment/save')report.checks.push({save:payload.staffId?'profile':'new',preparationNote:payload.data?.preparationNote||''});
    const r=await h.call(u.pathname.slice(4),payload);
    res.setHeader('content-type','application/json');res.end(JSON.stringify(r));return;
   }
   const p=path.resolve(root,'.'+decodeURIComponent(u.pathname));
   if(!p.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
   const file=fs.statSync(p).isDirectory()?path.join(p,'index.html'):p;
   res.setHeader('content-type',{'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
  }catch(e){res.writeHead(404);res.end('not found');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch();
 const make=async(token,width)=>{
  const c=await browser.newContext({viewport:{width,height:900}});
  await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||['data:','about:','blob:'].includes(u.protocol))return r.continue();report.externalRequests.push(u.origin);return r.abort();});
  await c.addInitScript(({token})=>{localStorage.setItem('sw2_staff',token);Date.now=()=>Date.parse('2026-10-17T15:00:00+09:00');},{token});
  const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));return p;
 };

 let owner,employee;
 const send=async(p,form,button,route)=>{
  const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/v2/'+route&&r.request().method()==='POST');
  await p.locator(form).getByRole('button',{name:button,exact:true}).click();
  const r=await(await response).json();assert.equal(r.ok,true,route+' failed');
  report.checks.push(route);
  await p.locator('button[disabled]').first().waitFor({state:'detached'});
  return r;
 };

 try{
  const made=await h.ok('employment/save',{auth,familyName:'【テスト】本人',givenName:'登録',email:'registration-ui@example.invalid'});
  const id=made.staff.id;
  await h.ok('employment/invite',{auth,staffId:id,confirm:true});
  const ta=(await h.ok('staff/invite/accept',{token:h.linkFrom(h.mails().at(-1)),password:'test registration password'})).auth;
  employee=await make(ta,390);owner=await make(auth,1280);
  await employee.goto(origin+'/staff/#employment');
  await employee.getByRole('heading',{name:'まず本人情報を登録してください',exact:true}).waitFor();
  assert.equal(await employee.locator('[data-form="em-profile"]').count(),0);
  assert.equal(await employee.locator('[data-form="em-registration"]').isVisible(),true);
  assert.equal(await employee.locator('[data-form="em-registration"] [name="confirm"]').isChecked(),false);
  await employee.screenshot({path:path.join(out,'01-first-registration-mobile.png'),fullPage:true});
  const f=employee.locator('[data-form="em-registration"]');
  await f.locator('[name="address"]').fill('【テスト】架空市0-0');
  await f.locator('[name="availability"]').fill('土曜日13〜15時');
  await f.locator('[name="otherWork"]').fill('なし');
  await f.locator('[name="taxSituation"]').selectOption('unknown');
  await f.locator('[name="confirm"]').check();
  await send(employee,'[data-form="em-registration"]','本人情報を提出する','employment/registration/submit');
  await employee.getByRole('heading',{name:'本人情報を提出しました。代表の確認待ちです',exact:true}).waitFor();
  await employee.screenshot({path:path.join(out,'02-submitted-mobile.png'),fullPage:true});
  assert.equal(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal((await employee.evaluate(()=>JSON.stringify(localStorage))).includes('架空市'),false);
  await owner.goto(origin+'/staff/#employment='+id);
  await owner.getByRole('heading',{name:'提出された本人情報を確認してください',exact:true}).waitFor();
  assert.equal(await owner.locator('[data-form="em-profile"] [name="address"]').count(),0);
  await owner.getByText('修正を依頼する',{exact:true}).first().click();
  await owner.locator('[data-form="em-registration-return"] [name="reason"]').fill('【テスト】勤務可能時間を再確認');
  await send(owner,'[data-form="em-registration-return"]','修正を依頼する','employment/registration/review');
  await employee.reload();await employee.getByRole('heading',{name:'本人情報を修正して再提出してください'}).waitFor();
  await employee.locator('[data-form="em-registration"] [name="availability"]').fill('土曜日14〜15時');
  assert.equal(await employee.locator('[data-form="em-registration"] [name="confirm"]').isChecked(),false);
  await employee.locator('[data-form="em-registration"] [name="confirm"]').check();
  await send(employee,'[data-form="em-registration"]','本人情報を提出する','employment/registration/submit');
  await owner.reload();await owner.locator('[data-form="em-registration-accept"]').waitFor();
  await owner.screenshot({path:path.join(out,'03-owner-review.png'),fullPage:true});
  await owner.locator('[data-form="em-registration-accept"] [name="confirm"]').check();
  await send(owner,'[data-form="em-registration-accept"]','本人情報を確認して反映する','employment/registration/review');
  const d=await h.ok('employment/get',{auth,staffId:id});assert.equal(d.profile.data.availability,'土曜日14〜15時');assert.equal(d.profile.data.taxDeclaration,'');
  await employee.reload();await employee.getByRole('heading',{name:'代表が勤務条件・契約書を準備しています',exact:true}).waitFor();
  await employee.screenshot({path:path.join(out,'04-preparing-contract-mobile.png'),fullPage:true});
  const bank=employee.getByRole('link',{name:'給与の振込先（登録・同意）',exact:true}),rect=await bank.boundingBox();assert.ok(rect.width>200&&rect.height<140,'bank link is not a vertical one-character column');
  await bank.click();await employee.getByRole('heading',{name:'給与の振込先',exact:true}).waitFor();
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
  report.checks.push('employee first action, return and resubmit, owner adoption, unknown tax not payroll consent, mobile layout verified');
 }catch(e){report.failure=e.stack;if(employee)await employee.screenshot({path:path.join(out,'failure-employee.png'),fullPage:true}).catch(()=>{});if(owner)await owner.screenshot({path:path.join(out,'failure-owner.png'),fullPage:true}).catch(()=>{});throw e;}
 finally{console.log(JSON.stringify(report));fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
