'use strict';
// GitHub runner only. No production credentials or external requests.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{agreementFixture}=require('../test/helpers/agreement-fixture.cjs');
(async()=>{
 const {h,auth,fam,kid,parent,plan,row}=await agreementFixture();
 const sis=(await h.ok('admin/students/create',{auth,familyId:fam.id,familyName:'【テスト】架空',givenName:'二郎',baseRate30:1500})).student;
 const lesson=async(studentId,date,extra={})=>{
  await h.ok('schedule/lessons/create',{auth,studentId,date,start:'17:00',minutes:60,subject:'数学',deliveryMode:'in_person',send:'ask',...extra});
  return h.rows('select * from lessons where studentId=? and date=? order by createdAt desc',studentId,date)[0];
 };
 const a=await lesson(kid.id,'2026-10-20'),b=await lesson(sis.id,'2026-10-21'),near=await lesson(sis.id,'2026-10-04');
 h.db2._sqlite.prepare("update lessons set noticeState='external',noticeAt=askedAt where id in (?,?)").run(a.id,b.id);
 const p=await plan();await h.ok('billing/plans/send',{auth,familyId:fam.id});
 const p2=await plan({subject:'英語'});await h.ok('billing/plans/send',{auth,familyId:fam.id});
 const original=row(p.id),target='money?kind=plan&refs='+p.id+'.'+original.version;
 await h.ok('billing/plans/remind',{auth,familyId:fam.id});
 await h.ok('family/reset/request',{email:fam.email,returnTo:target});
 const resetToken=h.linkFrom(h.mails().at(-1));
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

 const out=path.join(root,'parent-notification-output');fs.mkdirSync(out,{recursive:true});
 const report={checks:[],externalRequests:[],errors:[]};
 try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||u.protocol==='data:')return r.continue();report.externalRequests.push(u.origin);return r.abort();});
  await context.addInitScript(({parent,auth,clock,kid})=>{if(!localStorage.getItem('sw2_family'))localStorage.setItem('sw2_family',parent);localStorage.setItem('sw2_staff',auth);sessionStorage.setItem('sw2_family_kid',kid);Date.now=()=>clock;},{parent,auth,clock:h.clock,kid:kid.id});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(origin+'/family/#confirm?student='+sis.id+'&month=2026-10');
  await page.locator('[data-action="agree-all"]').first().waitFor();
  assert.equal(await page.locator('[data-action="agree-all"]').count(),2,'two deadline groups for selected second child');
  assert.match(await page.locator('#app').innerText(),/二郎/);
  const refs=await page.locator('[data-action="agree-all"]').evaluateAll(es=>es.flatMap(e=>JSON.parse(e.dataset.refs)));
  assert.deepEqual(refs.map(x=>x.id).sort(),[b.id,near.id].sort());
  await page.screenshot({path:path.join(out,'01-schedule-mobile.png'),fullPage:true});
  await page.locator('[data-action="agree-all"]').first().click();
  await page.getByRole('status').filter({hasText:'1件を確定しました'}).waitFor();
  assert.equal(h.rows('select status from lessons where id=?',a.id)[0].status,'proposed','other child untouched');
  assert.equal(h.rows("select count(*) n from lessons where status='decided'")[0].n,1);
  report.checks.push('second child deep link, distinct deadlines, exact displayed IDs/versions, no other-child approval');

  await page.goto(origin+'/family/#'+target);
  await page.locator('[data-form="plan-approve"]').waitFor();
  const form=page.locator('[data-form="plan-approve"]');
  assert.deepEqual(JSON.parse(await form.getAttribute('data-refs')),[{id:p.id,version:original.version}],'link excludes a later different proposal in the same month');
  await form.locator('input[data-consenter]').fill('【テスト】架空 保護者');
  await page.screenshot({path:path.join(out,'02-agreement-mobile.png'),fullPage:true});
  await form.getByRole('button',{name:'この内容で承認する',exact:true}).click();
  await page.getByRole('status').filter({hasText:'PDF保存できます'}).waitFor();
  assert.equal(row(p.id).status,'approved');assert.equal(row(p2.id).status,'proposed');
  await page.reload();await page.getByText('メールでお知らせした対象を表示しています。',{exact:false}).waitFor();
  assert.equal(await page.locator('[data-form="plan-approve"]').count(),0);
  assert.ok(await page.locator('[data-action="agreement-doc"]').count()>0,'approved PDF action retained');
  report.checks.push('agreement link excludes new proposal; completion, return visit and PDF copy');

  // Old version cannot become a new approval by following an old notification.
  const old2=row(p2.id);
  await h.ok('billing/plans/save',{auth,...old2,fee:4400});
  await h.ok('billing/plans/send',{auth,familyId:fam.id});
  await page.goto(origin+'/family/#money?kind=plan&refs='+p2.id+'.'+old2.version);
  await page.getByText('古い案からは承認できません。',{exact:false}).waitFor();
  assert.equal(await page.locator('[data-form="plan-approve"]').count(),0);
  report.checks.push('changed proposal is explicitly stale');

  // New browser: reset token carries destination server-side; auth remains required.
  const clean=await browser.newContext({viewport:{width:390,height:844}});
  await clean.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const cp=await clean.newPage();cp.on('pageerror',e=>report.errors.push(e.message));
  await cp.goto(origin+'/family/#'+target);
  await cp.getByRole('button',{name:'ログイン',exact:true}).waitFor();
  assert.match(await cp.locator('#app').innerText(),/書類・料金を確認するためにログイン/);
  await cp.screenshot({path:path.join(out,'03-login-context.png'),fullPage:true});
  await cp.goto(origin+'/family/#reset='+encodeURIComponent(resetToken));
  await cp.locator('[name="password"]').fill('changed synthetic password');
  await cp.locator('[name="confirm"]').fill('changed synthetic password');
  await cp.getByRole('button',{name:'パスワードを変える',exact:true}).click();
  await cp.waitForURL('**/#'+target);
  await cp.getByText('メールでお知らせした対象を表示しています。',{exact:false}).waitFor();
  report.checks.push('login context and cross-browser password-reset return');
  await cp.goto(origin+'/family/#invite=invalid');
  await cp.getByRole('link',{name:'mugilives@gmail.com',exact:true}).waitFor();
  await cp.screenshot({path:path.join(out,'04-expired-link-help.png'),fullPage:true});
  report.checks.push('invalid/expired invitation recovery');
  await clean.close();

  // Reset invalidated old session: authenticate synthetic test family again.
  const fresh=(await h.ok('family/login',{email:fam.email,password:'changed synthetic password'})).auth;
  await page.evaluate(x=>localStorage.setItem('sw2_family',x),fresh);
  const condition=(await h.ok('admin/conditions/propose',{auth,studentId:kid.id,minutes:90,fee:4500,deliveryMode:'in_person',fromMonth:'2026-11'})).condition;
  await h.ok('admin/specials/propose',{auth,studentId:kid.id,title:'【テスト】個別問題解説',purpose:'試験の復習',content:'専用問題の解説',reason:'専用準備',prep:'問題を解く',minutes:90,fee:6000,fromDate:'2026-11-01',toDate:'2026-12-31'});
  await h.ok('admin/terms/set',{auth,version:'synthetic-new',title:'【テスト】規約',url:'https://example.invalid/terms'});
  await page.goto(origin+'/family/#money');
  await page.getByText('受講合意書の承認には、先に上の受講規約・受講条件書への同意が必要です。',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-form="plan-approve"] button.primary:enabled').count(),0);
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:path.join(out,'05-prerequisites-desktop.png'),fullPage:true});
  report.checks.push('prerequisites explained next to disabled approval');

  const sampleInv={id:'iv_synthetic',month:'2026-09',status:'void',total:4500,version:2,voidReason:'【テスト】内訳訂正',items:[],dueDate:'2026-10-23',dueNote:'LINEで合意'};
  const voidHtml=await page.evaluate(async v=>(await import('/assets/v2/portal-ui.js?v=20261016-notices')).invoiceSheet(v,{multi:false}),sampleInv);
  assert.match(voidHtml,/お支払いは不要/);assert.doesNotMatch(voidHtml,/data-action="inv-report"/);
  const dueHtml=await page.evaluate(async v=>(await import('/assets/v2/portal-ui.js?v=20261016-notices')).invoiceSheet(v,{multi:false}),{...sampleInv,status:'confirmed',bank:'【テスト】架空銀行'});
  assert.match(dueHtml,/2026-10-23/);assert.match(dueHtml,/架空銀行/);
  await page.setContent('<meta name="viewport" content="width=device-width"><link rel="stylesheet" href="'+origin+'/assets/v2/portal.css">'+dueHtml);
  await page.screenshot({path:path.join(out,'06-invoice-payment.png'),fullPage:true});
  report.checks.push('invoice due date, bank and void state with no payment button');

  // Exercise remaining real templates in a separate synthetic family.
  const extra=await agreementFixture(),h2=extra.h,au=extra.auth,pa=extra.parent,ki=extra.kid;
  h2.clock=Date.parse('2026-09-01T12:00:00+09:00');
  await extra.approve(await extra.plan({startDate:'2026-09-01',endDate:'2026-09-30'}),{consentedAt:'2026-09-01T11:00:00+09:00'});
  await h2.ok('schedule/lessons/create',{auth:au,studentId:ki.id,date:'2026-09-10',start:'17:00',minutes:90,subject:'数学',deliveryMode:'in_person',send:'ask'});
  let lr=()=>h2.rows('select * from lessons')[0];
  h2.db2._sqlite.prepare("update lessons set noticeState='external',noticeAt=askedAt").run();
  const {autoConfirm}=await import('../cf/v2/schedule.mjs');
  await autoConfirm({db:h2.db2,env:h2.env,now:Date.parse('2026-09-05T00:10:00+09:00'),effects:[],actor:{kind:'system',id:'test'}});
  // Capture auto-confirm effects without delivering them.
  await h2.ok('schedule/lessons/create',{auth:au,studentId:ki.id,date:'2026-09-12',start:'17:00',minutes:90,subject:'数学',deliveryMode:'in_person',send:'ask'});
  h2.db2._sqlite.prepare("update lessons set noticeState='external',noticeAt=askedAt where status='proposed'").run();
  const cx={db:h2.db2,env:h2.env,now:Date.parse('2026-09-05T00:10:00+09:00'),effects:[],actor:{kind:'system',id:'test'}};
  await autoConfirm(cx);
  const {recordEffects}=await import('../cf/v2/effects.mjs');await recordEffects(h2.db2,cx.effects,h2.clock);
  await h2.ok('schedule/lessons/update',{auth:au,id:lr().id,version:lr().version,date:'2026-09-10',start:'18:00',minutes:90,subject:'数学',kind:'通常',deliveryMode:'in_person',staffId:''});
  h2.clock=Date.parse('2026-09-10T19:00:00+09:00');
  await h2.ok('schedule/lessons/cancel',{auth:au,id:lr().id,version:lr().version});
  const fr=()=>h2.rows('select * from cancellationFees')[0];
  await h2.ok('billing/fees/decide',{auth:au,id:fr().id,version:fr().version,decision:'charge'});
  await h2.ok('family/fees/relief',{auth:pa,id:fr().id,version:fr().version,reason:'【テスト】事情の確認をお願いします'});
  await h2.ok('billing/fees/relief',{auth:au,id:fr().id,version:fr().version,result:'reduced',amount:1500,response:'【テスト】ご連絡の状況を確認し、減額しました'});
  h2.clock=Date.parse('2026-10-16T12:00:00+09:00');
  const inv=(await h2.ok('billing/confirm',{auth:au,familyId:extra.fam.id,month:'2026-09',dueReviewed:true,dueDate:'2026-10-23',dueNote:'【テスト】LINEで合意'})).invoice;
  await h2.ok('billing/void',{auth:au,id:inv.id,version:inv.version,reason:'【テスト】明細の訂正'});
  // Review copies contain only synthetic data; redact invitation/reset bearer strings.
  const emails=h.mails().concat(h2.mails()).filter(m=>m.audience==='family').map(m=>({subject:m.subject,body:m.body.replace(/#(invite|reset)=[^\s]+/g,'#$1=TEST-LINK'),status:m.status}));
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fs.writeFileSync(path.join(out,'emails.html'),'<!doctype html><html lang="ja"><meta charset="utf-8"><title>保護者通知の見本（未公開・架空データ）</title><style>body{font:16px system-ui;max-width:800px;margin:32px auto;padding:20px}article{border:1px solid #ddd;padding:20px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style><h1>保護者通知の見本</h1><p>未公開の確認用です。架空データで生成し、実メールは送信していません。</p>'+emails.map(m=>'<article><h2>'+escape(m.subject)+'</h2><pre>'+escape(m.body)+'</pre></article>').join('')+'</html>');
  fs.writeFileSync(path.join(out,'emails.json'),JSON.stringify(emails,null,2));
  assert.ok(new Set(emails.map(m=>m.subject)).size>=14,'13 existing template types plus invoice void');
  report.checks.push('all 13 existing notification templates and invoice-void template generated without sending');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
  console.log(JSON.stringify(report));fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
