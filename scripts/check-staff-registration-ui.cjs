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
  assert.equal(await employee.locator('[data-form="em-registration"] [name="confirm"]').count(),0,'登録ボタンの前に確認の印は求めない');
  assert.equal(await employee.locator('[data-form="em-registration"] [name="familyName"]').inputValue(),'','氏名は本人が入力する（招待時の表示名を写さない）');
  assert.equal(await employee.locator('[data-form="em-registration"] [name="availability"]').count(),0,'勤務可能時間は初回に聞かない');
  assert.equal(await employee.locator('[data-form="wk-open"]').count(),0,'初回に勤務予定・実績を出さない');
  assert.equal(await employee.getByRole('link',{name:'給与明細を確認する'}).count(),0,'初回に給与明細を出さない');
  assert.equal(await employee.locator('a[href="#bank"]').count(),0,'初回に振込先を出さない');
  assert.equal(await employee.locator('#nav a[href="#payroll"]').count(),0,'手続き中のメニューに給与を出さない');
  assert.equal(await employee.getByText('契約書・締結の控え',{exact:true}).count(),0,'初回に契約書の欄を出さない');
  await employee.screenshot({path:path.join(out,'01-first-registration-mobile.png'),fullPage:true,animations:'disabled'});
  const f=employee.locator('[data-form="em-registration"]');
  await f.locator('[name="familyName"]').fill('【テスト】本人');
  await f.locator('[name="givenName"]').fill('登録');
  await f.locator('[name="address"]').fill('【テスト】架空市0-0');
  assert.equal(await f.locator('[name="otherWorkHours"]').isVisible(),false,'勤務先があるか選ぶまで時間の欄は出さない');
  await f.locator('[name="otherEmployment"]').selectOption('yes');
  assert.equal(await f.locator('[name="otherWorkHours"]').isVisible(),true,'「ある」で時間の欄が出る');
  await f.locator('[name="otherEmployment"]').selectOption('no');
  assert.equal(await f.locator('[name="otherWorkHours"]').isVisible(),false,'「ない」では時間の欄を出さない');
  await f.locator('[name="taxSituation"]').selectOption('unknown');
  await send(employee,'[data-form="em-registration"]','本人情報を登録する','employment/registration/submit');
  await employee.getByRole('heading',{name:'本人情報を登録しました。代表の確認待ちです',exact:true}).waitFor();
  assert.equal(await employee.locator('[data-form="wk-open"]').count(),0,'確認待ちの間も勤務予定・実績を出さない');
  await employee.screenshot({path:path.join(out,'02-submitted-mobile.png'),fullPage:true,animations:'disabled'});
  assert.equal(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal((await employee.evaluate(()=>JSON.stringify(localStorage))).includes('架空市'),false);
  await owner.goto(origin+'/staff/#employment='+id);
  await owner.getByRole('heading',{name:'登録された本人情報を確認してください',exact:true}).waitFor();
  assert.equal(await owner.locator('[data-form="em-profile"] [name="address"]').count(),0);
  assert.equal(await owner.locator('[data-form="em-registration-accept"] [name="nameDecision"]').count(),0,'氏名が同じなら選択は出ない');
  await owner.getByText('修正を依頼する',{exact:true}).first().click();
  await owner.locator('[data-form="em-registration-return"] [name="reason"]').fill('【テスト】住所の番地を再確認');
  await send(owner,'[data-form="em-registration-return"]','修正を依頼する','employment/registration/review');
  await employee.reload();await employee.getByRole('heading',{name:'本人情報を直して登録し直してください'}).waitFor();
  assert.equal(await employee.locator('[data-form="em-registration"] [name="familyName"]').inputValue(),'【テスト】本人','登録し直すときは前回の入力を出す');
  await employee.locator('[data-form="em-registration"] [name="givenName"]').fill('登録二');
  await employee.locator('[data-form="em-registration"] [name="address"]').fill('【テスト】架空市1-1');
  await send(employee,'[data-form="em-registration"]','本人情報を登録する','employment/registration/submit');
  await owner.reload();await owner.locator('[data-form="em-registration-accept"]').waitFor();
  await owner.getByText('招待時：【テスト】本人 登録').waitFor();
  await owner.screenshot({path:path.join(out,'03-owner-review.png'),fullPage:true,animations:'disabled'});
  await owner.locator('[data-form="em-registration-accept"] [name="nameDecision"][value="apply"]').check();
  await send(owner,'[data-form="em-registration-accept"]','本人情報を確認して反映する','employment/registration/review');
  const d=await h.ok('employment/get',{auth,staffId:id});assert.equal(d.profile.data.address,'【テスト】架空市1-1');assert.equal(d.profile.data.availability,'');assert.equal(d.profile.data.taxDeclaration,'');assert.equal(d.staff.name,'【テスト】本人 登録二');
  await owner.getByRole('heading',{name:'【テスト】本人 登録二 さんの雇用・勤務',exact:true}).waitFor();
  await employee.reload();await employee.getByRole('heading',{name:'代表が勤務条件・契約書を準備しています',exact:true}).waitFor();
  assert.equal(await employee.locator('[data-form="wk-open"]').count(),0,'勤務日がないうちは勤務の記録を出さない');
  assert.equal(await employee.getByRole('link',{name:'給与明細を確認する'}).count(),0);
  await employee.screenshot({path:path.join(out,'04-preparing-contract-mobile.png'),fullPage:true,animations:'disabled'});
  const bank=employee.locator('a[href="#bank"]'),rect=await bank.boundingBox();assert.ok(rect.width>200&&rect.height<140,'bank link is not a vertical one-character column');
  await bank.click();await employee.getByRole('heading',{name:'給与の振込先',exact:true}).waitFor();
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
  report.checks.push('employee first action with own name, no availability or work/payroll items before adoption, return and resubmit, owner name decision and adoption, unknown tax not payroll consent, mobile layout verified');
 }catch(e){report.failure=e.stack;if(employee)await employee.screenshot({path:path.join(out,'failure-employee.png'),fullPage:true}).catch(()=>{});if(owner)await owner.screenshot({path:path.join(out,'failure-owner.png'),fullPage:true}).catch(()=>{});throw e;}
 finally{console.log(JSON.stringify(report));fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
