'use strict';
// Isolated synthetic records only. External requests are blocked; nothing is deployed.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {employmentWorld}=require('../test/helpers/employment-fixture.cjs');
(async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,root=path.resolve(__dirname,'..');
 const out=path.join(root,'staff-bank-review-output');fs.mkdirSync(out,{recursive:true});
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
 const fill=async(p,number)=>{
  const f=p.locator('[data-form="bank-edit"]');
  for(const [key,value] of Object.entries({bankName:'【テスト】銀行',bankCode:'0001',branchName:'【テスト】支店',branchCode:'002',accountNumber:number,holderKana:'テスト コウシ'}))await f.locator('[name="'+key+'"]').fill(value);
  await f.locator('[name="accountType"]').selectOption('ordinary');
  await f.getByRole('button',{name:'入力内容を確認する',exact:true}).click();
  await p.locator('[data-form="bank-submit"]').waitFor();
  assert.equal(await p.locator('[data-form="bank-submit"] [name="agree"]').isChecked(),false);
 };
 try{
  const ta=await w.invite(),before={profiles:h.rows('select * from employmentProfiles'),contracts:h.rows('select * from employmentContracts'),payroll:h.rows('select * from payrollMonths'),mails:h.mails().length};
  employee=await make(ta,390);owner=await make(auth,1280);
  await employee.goto(origin+'/staff/#employment');
  await employee.locator('a[href="#bank"]').click();
  await employee.getByRole('heading',{name:'給与の振込先',exact:true}).waitFor();
  await employee.getByRole('button',{name:'振込先を登録する',exact:true}).click();
  await fill(employee,'0123456');
  await employee.locator('[data-form="bank-submit"] [name="agree"]').check();
  await employee.getByRole('button',{name:'入力内容を修正する',exact:true}).click();
  await fill(employee,'0123456');
  assert.equal(h.rows('select * from staffBankRequests').length,0,'review step is not submission');
  await employee.screenshot({path:path.join(out,'01-employee-review-mobile.png'),fullPage:true});
  await employee.locator('[data-form="bank-submit"] [name="agree"]').check();
  let r=await send(employee,'[data-form="bank-submit"]','同意して振込先を提出する','employment/bank/submit');
  assert.equal(r.requests[0].status,'pending');
  await employee.getByText('提出済みです。代表の確認をお待ちください。',{exact:true}).waitFor();
  assert.equal(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal((await employee.evaluate(()=>JSON.stringify(localStorage))).includes('0123456'),false);
  await employee.screenshot({path:path.join(out,'02-employee-pending-mobile.png'),fullPage:true});
  await owner.goto(origin+'/staff/#employment='+staff.id);
  await owner.locator('a[href^="#bank="]',{hasText:'確認してください'}).click();
  await owner.locator('[data-form="bank-accept"]').waitFor();
  assert.equal(await owner.locator('[data-form="bank-accept"] [name="confirm"]').isChecked(),false);
  assert.equal(await owner.locator('[data-form="bank-edit"]').count(),0);
  await owner.getByText('口座情報と同意の全文を確認',{exact:true}).click();
  await owner.getByText('0123456',{exact:true}).waitFor();
  await owner.screenshot({path:path.join(out,'03-owner-review.png'),fullPage:true});
  await owner.locator('[data-form="bank-accept"] [name="confirm"]').check();
  r=await send(owner,'[data-form="bank-accept"]','確認して振込先に採用する','employment/bank/review');
  const accepted=r.acceptedId;
  await owner.getByRole('heading',{name:'現在の振込先',exact:true}).waitFor();
  await employee.reload();await employee.getByRole('heading',{name:'現在の振込先',exact:true}).waitFor();
  await employee.screenshot({path:path.join(out,'04-employee-accepted-mobile.png'),fullPage:true});
  await employee.getByRole('button',{name:'振込先を変更・再提出する',exact:true}).click();
  await fill(employee,'0765432');await employee.locator('[data-form="bank-submit"] [name="agree"]').check();
  r=await send(employee,'[data-form="bank-submit"]','同意して振込先を提出する','employment/bank/submit');assert.equal(r.acceptedId,accepted);
  await owner.reload();await owner.locator('[data-form="bank-accept"]').waitFor();
  await owner.getByText('修正をお願いする',{exact:true}).click();
  await owner.locator('[data-form="bank-return"] [name="reason"]').fill('【テスト】支店名をもう一度確認してください');
  r=await send(owner,'[data-form="bank-return"]','修正を依頼する','employment/bank/review');assert.equal(r.acceptedId,accepted);
  await employee.reload();await employee.getByText('修正してほしい内容：【テスト】支店名をもう一度確認してください',{exact:true}).waitFor();
  await employee.screenshot({path:path.join(out,'05-return-keeps-current-mobile.png'),fullPage:true});
  await employee.locator('a.back').click(); // 本人の画面は上の戻るボタンだけ（重複のリンクは出さない）
  await employee.locator('a[href="#bank"]',{hasText:'修正して登録し直してください'}).waitFor();
  assert.deepEqual(h.rows('select * from employmentProfiles'),before.profiles);
  assert.deepEqual(h.rows('select * from employmentContracts'),before.contracts);
  assert.deepEqual(h.rows('select * from payrollMonths'),before.payroll);
  assert.equal(h.mails().length,before.mails);
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
  report.checks.push('owner and employee flow verified; mobile no horizontal overflow','review and revision reset consent','bank details absent from localStorage','no profile/contract/payroll changes or notification');
 }catch(e){report.failure=e.stack;if(employee)await employee.screenshot({path:path.join(out,'failure-employee.png'),fullPage:true}).catch(()=>{});if(owner)await owner.screenshot({path:path.join(out,'failure-owner.png'),fullPage:true}).catch(()=>{});throw e;}
 finally{console.log(JSON.stringify(report));fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
