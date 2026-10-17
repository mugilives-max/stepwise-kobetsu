'use strict';
// Isolated synthetic records only. External requests are blocked; nothing is deployed.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {employmentWorld}=require('../test/helpers/employment-fixture.cjs');
(async()=>{
 const w=await employmentWorld(),{h,auth,staff}=w,ta=await w.invite(),root=path.resolve(__dirname,'..');
 const out=path.join(root,'employment-review-output');fs.mkdirSync(out,{recursive:true});
 const report={checks:[],externalRequests:[],errors:[]};
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');
   if(u.pathname.startsWith('/v2/')){
    const chunks=[];for await(const b of req)chunks.push(b);
    const r=await h.call(u.pathname.slice(4),JSON.parse(Buffer.concat(chunks).toString()||'{}'));
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
 let owner,self;
 const noOverflow=async p=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile page fits');
 const submit=async(p,form)=>{await p.locator(form+' button:not([type="button"])').last().click();await p.locator('button[disabled]').first().waitFor({state:'detached'}).catch(()=>{});};
 try {
  owner=await make(auth,1100);self=await make(ta,390);
  await owner.goto(origin+'/staff/#employment='+staff.id);
  await owner.locator('[data-form="em-draft"]').waitFor();
  assert.equal(await owner.locator('[data-form="em-draft"] [name="availability"]').count(),0,'勤務希望は契約書に入れない');
  assert.equal(await owner.locator('[data-form="em-draft"] [name="taxDeclaration"]').count(),0,'甲欄・乙欄は給与の設定で扱う');
  for(const f of ['em-pay','em-shift','em-todo'])assert.equal(await owner.locator('[data-form="'+f+'"]').count(),0,f+' は契約書の準備の段階で出さない');
  await owner.locator('[data-form="em-draft"] input[name="method"][value="paper"]').check();
  await owner.locator('[data-form="em-draft"] button.primary').click();
  await owner.getByRole('heading',{name:'契約書の案（第1版）',exact:true}).waitFor();
  let paper=(await w.get()).contracts[0];
  const paperHtml=(await h.ok('employment/contract/document',{auth,id:paper.id})).html;
  await owner.screenshot({path:path.join(out,'01-owner-onboarding.png'),fullPage:true,animations:'disabled'});
  report.checks.push('owner sees only the contract items, then creates a paper draft without agreement or new mail');
  assert.equal((await w.get()).contracts[0].status,'draft');

  await h.ok('employment/contract/withdraw',{auth,id:paper.id,version:paper.version,reason:'【テスト】電子経路を確認'});
  let r=await w.create();
  await owner.reload();
  await owner.getByRole('heading',{name:'契約書の案（第2版）',exact:true}).waitFor();
  const issue='[data-form="em-issue"][data-id="'+r.id+'"]';
  await owner.locator(issue+' input[name="agree"]').check();
  await owner.locator(issue+' button').click();
  await owner.getByRole('heading',{name:'契約書（第2版）',exact:true}).waitFor();
  await owner.getByRole('heading',{name:'本人の受け取り方法を待っています',exact:true}).waitFor();
  r=await w.contract(r.id);assert.equal(r.status,'issued');
  await self.goto(origin+'/staff/#students');
  await self.locator('[data-form="em-preference"]').waitFor();
  assert.equal(await self.locator('#nav a[href="#students"]').count(),0,'preparation account has no students navigation');
  const pref='[data-form="em-preference"]';
  await self.locator(pref+' input[name="wish"]').check();
  await self.locator(pref+' button').click();
  await self.getByText('保存しました',{exact:true}).waitFor();
  r=await w.contract(r.id);assert.ok(r.preferenceAt);assert.equal(r.status,'issued');
  r=await w.deliver(r);
  await self.reload();
  const accept='[data-form="em-accept"]';
  await self.locator(accept+' input[name="consenterName"]').fill('【テスト】講師 甲');
  await self.locator(accept+' input[name="received"]').check();
  await self.locator(accept+' input[name="agree"]').check();
  assert.equal(await self.locator(accept+' input[name="consenterName"]').inputValue(),'【テスト】講師 甲');
  await noOverflow(self);
  await self.screenshot({path:path.join(out,'02-employee-agreement.png'),fullPage:true,animations:'disabled'});
  await self.locator(accept+' button').click();
  await self.getByText('第2版（電子）・締結済み',{exact:true}).waitFor();
  r=await w.contract(r.id);assert.equal(r.status,'agreed');
  report.checks.push('employee restricted entry, electronic preference, separate receipt and exact-version acceptance on mobile');

  h.clock=Date.parse('2026-10-17T15:00:00+09:00');
  await h.ok('payroll/rates/save',{auth,staffId:staff.id,startsOn:'2026-10',lessonHourly:2000,meetingHourly:null});
  await owner.goto(origin+'/staff/#work='+staff.id+'/2026-10-17');
  const plan='[data-form="wk-plan"]';
  await owner.locator(plan).waitFor();
  await owner.locator(plan+' input[name="start_0"]').fill('12:55');
  await owner.locator(plan+' input[name="end_0"]').fill('13:00');
  await owner.locator(plan+' select[name="kind_0"]').selectOption('prep');
  for(const [i,start,end,kind,label] of [[1,'13:00','13:45','other','授業見学'],[2,'13:45','14:30','lesson','途中から指導'],[3,'14:30','14:35','prep','授業記録']]){
   await owner.locator(plan+' button[data-action="wk-add"]').click();
   await owner.locator(plan+' input[name="start_'+i+'"]').fill(start);
   await owner.locator(plan+' input[name="end_'+i+'"]').fill(end);
   await owner.locator(plan+' select[name="kind_'+i+'"]').selectOption(kind);
   await owner.locator(plan+' input[name="label_'+i+'"]').fill(label);
  }
  assert.equal(await owner.locator(plan+' input[name="start_0"]').inputValue(),'12:55','adding row retains other fields');
  await owner.locator(plan+' input[name="reason"]').fill('【テスト】初日の見学と指導');
  await owner.locator(plan+' button:not([type="button"])').click();
  await owner.getByText('保存しました',{exact:true}).waitFor();
  await self.goto(origin+'/staff/#work='+staff.id+'/2026-10-17');
  await self.locator('[data-form="wk-agree"] input[name="agree"]').check();
  await self.locator('[data-form="wk-agree"] button').click();
  await self.getByText('本人の予定確認：確認済み',{exact:true}).waitFor();
  const actual='[data-form="wk-submit"]';
  await self.locator(actual+' input[name="reason"]').fill('【テスト】予定どおりに勤務した');
  await self.locator(actual+' button:not([type="button"])').click();
  await self.getByText('状態：確認中',{exact:true}).waitFor();
  await noOverflow(self);
  await self.locator('[data-form="wk-submit"] button.primary:not([disabled])').waitFor();
  await self.screenshot({path:path.join(out,'03-employee-work.png'),fullPage:true,animations:'disabled'});
  await self.screenshot({path:path.join(out,'03-employee-work-screen.png'),fullPage:false,animations:'disabled'});
  await owner.reload();
  await owner.locator('[data-form="wk-confirm"] input[name="reason"]').fill('【テスト】100分の勤務と賃金を確認');
  await owner.locator('[data-form="wk-confirm"] input[name="reviewed"]').check();
  await owner.locator('[data-form="wk-confirm"] button').click();
  await owner.getByText('状態：確認済み',{exact:true}).waitFor();
  let v=(await h.ok('payroll/staff',{auth,staffId:staff.id,month:'2026-10'})).preview;
  assert.equal(v.workMinutes,100);assert.equal(v.gross,3333);assert.equal(v.issues.length,0);
  report.checks.push('structured time inputs retain edits; employee agrees, submits 100 minutes; owner confirms; 3,333 yen without duplicate pay');
  await owner.screenshot({path:path.join(out,'04-owner-work.png'),fullPage:true,animations:'disabled'});

  for(const [name,html] of [['paper',paperHtml],['electronic',(await h.ok('employment/contract/document',{auth:ta,id:r.id})).html]]){
   const doc=await owner.context().newPage();await doc.setContent(html);await doc.emulateMedia({media:'print'});await doc.evaluate(()=>document.fonts.ready);
   assert.equal(await doc.locator('table').evaluateAll(ts=>ts.filter(t=>t.scrollWidth>t.clientWidth+1).length),0);
   const text=await doc.locator('body').innerText();for(const expected of ['第1条','第11条','2,000円','2026-10-17','2027-03-31','他の勤務先','講師 甲'])assert.ok(text.includes(expected),name+' '+expected);
   assert.ok(!text.includes('【講師の氏名】')&&!text.includes('提出状況の確認日：【'),'personalized fields');
   await doc.pdf({path:path.join(out,name+'-contract.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;font-size:8px;text-align:center;color:#666">【テスト】確認用・実際の契約ではありません　<span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
   await doc.close();
  }
  report.checks.push('fixed paper/electronic contract print layout and complete personalized text');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
 }catch(e){report.failure=e.stack;if(owner)await owner.screenshot({path:path.join(out,'failure-owner.png'),fullPage:true,animations:'disabled'}).catch(()=>{});if(self)await self.screenshot({path:path.join(out,'failure-employee.png'),fullPage:true,animations:'disabled'}).catch(()=>{});throw e;}
 finally{fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
