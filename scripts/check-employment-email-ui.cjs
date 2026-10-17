'use strict';
// Isolated synthetic records only. External requests are blocked; nothing is deployed.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {employmentWorld}=require('../test/helpers/employment-fixture.cjs');
(async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,root=path.resolve(__dirname,'..');
 const out=path.join(root,'employment-email-review-output');fs.mkdirSync(out,{recursive:true});
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

 let owner;
 const send=async(form,route)=>{
  const response=owner.waitForResponse(r=>new URL(r.url()).pathname==='/v2/'+route&&r.request().method()==='POST');
  await owner.locator(form+' button').click();const r=await (await response).json();
  report.checks.push({route,ok:r.ok,code:r.error?.code});
  await owner.locator('button[disabled]').first().waitFor({state:'detached'});
 };
 try{
  owner=await make(auth,390);
  await owner.goto(origin+'/staff/#employment');
  const f='[data-form="em-new"]';
  await owner.locator(f).waitFor();
  assert.equal(await owner.locator(f+' input[name="email"]').getAttribute('required'),null);
  await owner.locator(f+' input[name="familyName"]').fill('【テスト】メール未定');
  await owner.locator(f+' input[name="givenName"]').fill('乙');
  await send(f,'employment/save');
  await owner.getByRole('heading',{name:'【テスト】メール未定 乙 さんの雇用・勤務'}).waitFor();
  // 勤務条件の欄は、本人情報の確認が済むまで閉じている（開いてから入力する）
  if(!await owner.locator('[data-form="em-profile"]').isVisible())await owner.getByText('勤務条件・代表の確認事項',{exact:true}).click();
  await owner.locator('[data-form="em-profile"] textarea[name="preparationNote"]').fill('【テスト】メール未定でも勤務条件を保存');
  await send('[data-form="em-profile"]','employment/save');
  await owner.getByText('保存しました',{exact:true}).waitFor();
  const id=owner.url().split('#employment=')[1];
  const get=()=>h.ok('employment/get',{auth,staffId:id});
  assert.equal((await get()).staff.email,'');
  assert.equal((await get()).profile.data.preparationNote,'【テスト】メール未定でも勤務条件を保存');
  assert.equal(await owner.locator('[data-form="em-invite"]').count(),0);
  assert.equal(h.mails().length,0);
  await owner.reload();await owner.locator('[data-form="em-email"]').waitFor();
  if(!await owner.locator('[data-form="em-profile"]').isVisible())await owner.getByText('勤務条件・代表の確認事項',{exact:true}).click();
  assert.equal(await owner.locator('[data-form="em-profile"] textarea[name="preparationNote"]').inputValue(),'【テスト】メール未定でも勤務条件を保存');
  assert.equal(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await owner.screenshot({path:path.join(out,'01-draft-without-email.png'),fullPage:true,animations:'disabled'});
  await owner.locator('[data-form="em-email"] input[name="email"]').fill('employment@example.invalid');
  await send('[data-form="em-email"]','employment/email');
  await owner.getByText('このメールアドレスは登録済みです。既存の講師を確認してください',{exact:true}).waitFor();
  assert.equal((await get()).staff.email,'');
  await owner.locator('[data-form="em-email"] input[name="email"]').fill('new-draft@example.invalid');
  await send('[data-form="em-email"]','employment/email');
  await owner.getByText('メールアドレスを保存しました。メールは送っていません。',{exact:true}).waitFor();
  assert.equal((await get()).staff.email,'new-draft@example.invalid');
  assert.equal(h.mails().length,0);
  const invite='[data-form="em-invite"]';
  await owner.locator(invite).waitFor();
  assert.equal(await owner.locator(invite+' input[name="confirm"]').isChecked(),false);
  await owner.screenshot({path:path.join(out,'02-email-saved-not-invited.png'),fullPage:true,animations:'disabled'});
  await owner.locator(invite+' input[name="confirm"]').check();
  await owner.locator('[data-form="em-email"] input[name="email"]').fill('confirmed-draft@example.invalid');
  await send('[data-form="em-email"]','employment/email');
  await owner.locator(invite).waitFor();
  assert.equal(await owner.locator(invite+' input[name="confirm"]').isChecked(),false,'email change resets old recipient approval');
  assert.equal(await owner.locator(invite+' input[name="email"]').inputValue(),'confirmed-draft@example.invalid');
  await owner.locator(invite+' input[name="confirm"]').check();
  await send(invite,'employment/invite');
  await owner.getByText('招待を受け付けました。送信状況を確認してください。',{exact:true}).waitFor();
  assert.equal(h.mails().length,1);assert.equal(h.mails()[0].to,'confirmed-draft@example.invalid');
  assert.equal(await owner.locator('[data-form="em-email"]').count(),0);
  assert.equal((await get()).staff.employmentAccess,false);
  report.checks.push('mobile draft saved/reloaded with no email or message','duplicate email rejected without record change','later email save sends nothing; explicit invite uses saved recipient','invited address protected; business access remains disabled');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
 }catch(e){report.failure=e.stack;if(owner)await owner.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw e;}
 finally{console.log(JSON.stringify(report));fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
