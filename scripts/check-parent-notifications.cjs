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
 let served=h;
 const server=http.createServer(async(req,res)=>{
  try {
   const url=new URL(req.url,'http://localhost');
   if(url.pathname.startsWith('/v2/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const r=await served.call(url.pathname.slice(4),JSON.parse(Buffer.concat(chunks).toString()||'{}'));
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
  const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:390,height:844}});
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||u.protocol==='data:')return r.continue();report.externalRequests.push(u.origin);return r.abort();});
  await context.addInitScript(({parent,auth,clock,kid})=>{if(!localStorage.getItem('sw2_family'))localStorage.setItem('sw2_family',parent);localStorage.setItem('sw2_staff',auth);sessionStorage.setItem('sw2_family_kid',kid);Date.now=()=>clock;},{parent,auth,clock:h.clock,kid:kid.id});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(origin+'/family/#confirm?student='+sis.id+'&month=2026-10');
  // 授業日時の承認は予定の画面で（2026-10-27）: リンクは予定へ。選んだ授業だけ承認する
  await page.locator('[data-action="ask-all"]').waitFor();
  assert.match(page.url(),/#schedule\?student=/);
  assert.match(await page.locator('#app').innerText(),/二郎/);
  await page.locator('[data-action="ask-all"]').click();
  await page.locator('[data-action="ask-send"]').waitFor();
  assert.match(await page.locator('[data-action="ask-send"]').innerText(),/承認する（2件）/);
  await page.screenshot({path:path.join(out,'01-schedule-mobile.png'),fullPage:true});
  await page.locator('[data-action="ask-send"]').click();
  await page.getByRole('status').filter({hasText:'2件を承認しました'}).waitFor();
  assert.deepEqual(h.rows('select status from lessons where id in (?,?) order by id',b.id,near.id).map(r=>r.status),['decided','decided']);
  assert.equal(h.rows('select status from lessons where id=?',a.id)[0].status,'proposed','other child untouched');
  assert.equal(h.rows("select count(*) n from lessons where status='decided'")[0].n,2);
  report.checks.push('second child deep link opens the schedule; selected lessons approved; no other-child approval');

  await page.goto(origin+'/family/#'+target);
  await page.locator('[data-form="plan-approve"]').waitFor();
  const form=page.locator('[data-form="plan-approve"]');
  assert.deepEqual(JSON.parse(await form.getAttribute('data-refs')),[{id:p.id,version:original.version}],'link excludes a later different proposal in the same month');
  await form.locator('input[data-consenter]').fill('【テスト】架空 保護者');
  await page.setViewportSize({width:390,height:1200});
  await page.screenshot({path:path.join(out,'02-agreement-mobile.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await form.getByRole('button',{name:'この内容で承認する',exact:true}).click();
  await page.getByRole('status').filter({hasText:'の受講計画書を承認しました'}).waitFor();
  assert.equal(row(p.id).status,'approved');assert.equal(row(p2.id).status,'proposed');
  await page.reload();await page.getByText('承認をお願いしている受講計画書はありません。',{exact:false}).waitFor();
  assert.equal(await page.locator('[data-form="plan-approve"]').count(),0);
  await page.goto(origin+'/family/#contracts');await page.locator('details.ph').first().waitFor({state:'attached'}); // 承認した控えは、アカウントの「契約・同意の控え」（2026-10-27）
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
  const clean=await browser.newContext({reducedMotion:'reduce',viewport:{width:390,height:844}});
  await clean.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const cp=await clean.newPage();cp.on('pageerror',e=>report.errors.push(e.message));
  await cp.goto(origin+'/family/#'+target);
  await cp.getByRole('button',{name:'ログイン',exact:true}).waitFor();
  assert.match(await cp.locator('#app').innerText(),/書類・料金を確認するためにログイン/);
  await cp.screenshot({path:path.join(out,'03-login-context.png'),fullPage:true});
  await cp.goto(origin+'/family/#reset='+encodeURIComponent(resetToken));
  await cp.locator('[data-form="reset"]').waitFor();
  await cp.locator('[data-form="reset"] [name="password"]').fill('changed synthetic password');
  await cp.locator('[data-form="reset"] [name="confirm"]').fill('changed synthetic password');
  assert.equal(await cp.locator('[name="password"]').inputValue(),'changed synthetic password','password entry survived rendering');
  assert.equal(await cp.locator('[name="confirm"]').inputValue(),'changed synthetic password','confirmation entry survived rendering');
  const resetResponse=cp.waitForResponse(r=>r.url().endsWith('/v2/family/reset/confirm'),{timeout:10000}).catch(async()=>{throw Error('Reset form did not submit: '+JSON.stringify({text:await cp.locator('#app').innerText(),errors:report.errors,validity:await cp.locator('form').evaluate(f=>Array.from(f.elements).map(x=>({name:x.name,length:x.value?.length,valid:x.validity?.valid}))) }));});
  await cp.getByRole('button',{name:'パスワードを変える',exact:true}).click();
  const resetBody=await (await resetResponse).json();
  assert.equal(resetBody.ok,true,JSON.stringify(resetBody.error));
  assert.equal(resetBody.returnTo,target);
  await cp.waitForFunction(t=>location.hash==='#'+t,target);
  await cp.locator('.bar-title').filter({hasText:'受講計画の承認'}).waitFor(); // お知らせのリンクは承認の画面で開く（2026-10-27）
  report.checks.push('login context and cross-browser password-reset return');
  await cp.goto(origin+'/family/#invite=invalid');
  await cp.getByRole('link',{name:'mugilives@gmail.com',exact:true}).waitFor();
  await cp.locator('.notice.error').waitFor();
  assert.equal(await cp.locator('.notice.error').innerText(),'リンクが正しくありません。メールのリンクを開き直してください');
  await cp.screenshot({path:path.join(out,'04-expired-link-help.png'),fullPage:true,animations:'disabled'});
  report.checks.push('invalid/expired invitation recovery');
  await clean.close();

  // Reset invalidated old session: authenticate synthetic test family again.
  const fresh=(await h.ok('family/login',{email:fam.email,password:'changed synthetic password'})).auth;
  await page.evaluate(x=>localStorage.setItem('sw2_family',x),fresh);
  const condition=(await h.ok('admin/conditions/propose',{auth,studentId:kid.id,minutes:90,fee:4500,deliveryMode:'in_person',fromMonth:'2026-11'})).condition;
  const specialResult=await h.ok('admin/specials/propose',{auth,studentId:kid.id,title:'【テスト】個別問題解説',purpose:'試験の復習',content:'専用問題の解説',reason:'専用準備',prep:'問題を解く',minutes:90,fee:6000,fromDate:'2026-11-01',toDate:'2026-12-31'});
  await page.goto(origin+'/family/#money?kind=condition&refs='+condition.id+'.'+condition.no);
  await page.locator('[data-action="cond-agree"]').waitFor();
  assert.equal(await page.getByText('この条件書は同意済み、または更新・取り下げ済みです。',{exact:false}).count(),0);
  await page.goto(origin+'/family/#money?kind=special&refs='+specialResult.special.id+'.'+specialResult.special.no);
  await page.locator('[data-action="special-agree"]').waitFor();
  assert.equal(await page.getByText('この提案は対応済み、または変更されています。',{exact:false}).count(),0);
  report.checks.push('condition and special-condition links show the exact proposed document number');
  await h.ok('admin/terms/set',{auth,version:'synthetic-new',title:'【テスト】規約',url:'https://example.invalid/terms'});
  await h.ok('admin/terms/request',{auth,familyIds:[fam.id]});
  await page.goto(origin+'/family/#plan');
  await page.locator('p.notice').filter({hasText:'共通規約・個別受講条件書への同意'}).waitFor();
  assert.equal(await page.locator('[data-form="plan-approve"] button.primary:enabled').count(),0);
  await page.goto(origin+'/family/#agree');await page.locator('button.btn svg').first().waitFor();
  await page.setViewportSize({width:1280,height:900});
  const documentIcons=await page.locator('button.btn svg').evaluateAll(es=>es.map(x=>x.getBoundingClientRect().width));
  assert.ok(documentIcons.length>=1 && documentIcons.every(w=>w<=24),'document buttons keep small icons');
  await page.screenshot({path:path.join(out,'05-prerequisites-desktop.png'),fullPage:true,animations:'disabled'});
  report.checks.push('prerequisites explained next to disabled approval');
  await page.goto(origin+'/family/#home');await page.getByText('対応が必要なこと',{exact:true}).waitFor();
  report.checks.push('home overview remains usable after notification-target navigation');

  const sampleInv={id:'iv_synthetic',month:'2026-09',status:'void',total:4500,version:2,voidReason:'【テスト】内訳訂正',items:[],dueDate:'2026-10-23',dueNote:'LINEで合意'};
  const voidHtml=await page.evaluate(async v=>(await import('/assets/v2/portal-ui.js?v=20261016-notices')).invoiceSheet(v,{multi:false}),sampleInv);
  assert.match(voidHtml,/お支払いは不要/);assert.doesNotMatch(voidHtml,/data-action="inv-report"/);
  const dueHtml=await page.evaluate(async v=>(await import('/assets/v2/portal-ui.js?v=20261016-notices')).invoiceSheet(v,{multi:false}),{...sampleInv,status:'confirmed',bank:'【テスト】架空銀行'});
  assert.match(dueHtml,/2026-10-23/);assert.match(dueHtml,/架空銀行/);
  await page.setContent('<meta name="viewport" content="width=device-width"><link rel="stylesheet" href="'+origin+'/assets/v2/base.css">'+dueHtml);
  await page.screenshot({path:path.join(out,'06-invoice-payment.png'),fullPage:true,animations:'disabled'});
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
  h2.db2._sqlite.prepare("update lessons set noticeState='external',noticeAt=askedAt,confirmBy='2026-09-04' where status='proposed'").run(); // 2026-10-27 より前に締め切りを付けて送った授業（今は締め切りを付けない）
  const cx={db:h2.db2,env:h2.env,now:Date.parse('2026-09-05T00:10:00+09:00'),effects:[],actor:{kind:'system',id:'test'}};
  await autoConfirm(cx);
  const {recordEffects}=await import('../cf/v2/effects.mjs');await recordEffects(h2.db2,cx.effects,h2.clock);
  await h2.ok('schedule/lessons/update',{auth:au,id:lr().id,version:lr().version,date:'2026-09-10',start:'18:00',minutes:90,subject:'数学',kind:'通常',deliveryMode:'in_person',staffId:''});
  const changedNotice=h2.mails().at(-1);
  assert.deepEqual(changedNotice.notice.targets,[{id:lr().id,version:lr().version}],'changed lesson notice uses saved record ID and version');
  assert.ok(changedNotice.body.includes('kind=lesson&refs='+lr().id+'.'+lr().version));
  h2.clock=Date.parse('2026-09-10T19:00:00+09:00');
  await h2.ok('schedule/lessons/cancel',{auth:au,id:lr().id,version:lr().version});
  const fr=()=>h2.rows('select * from cancellationFees')[0];
  await h2.ok('billing/fees/decide',{auth:au,id:fr().id,version:fr().version,decision:'charge'});
  await h2.ok('family/fees/relief',{auth:pa,id:fr().id,version:fr().version,reason:'【テスト】事情の確認をお願いします'});
  await h2.ok('billing/fees/relief',{auth:au,id:fr().id,version:fr().version,result:'reduced',amount:1500,response:'【テスト】ご連絡の状況を確認し、減額しました'});
  h2.clock=Date.parse('2026-10-16T12:00:00+09:00');
  for(const l of h2.rows("select * from lessons where status='decided'"))await h2.ok('schedule/lessons/done',{auth:au,id:l.id,version:l.version});
  const inv=(await h2.ok('billing/confirm',{auth:au,familyId:extra.fam.id,month:'2026-09',dueReviewed:true,dueDate:'2026-10-23',dueNote:'【テスト】LINEで合意'})).invoice;
  await h2.ok('billing/void',{auth:au,id:inv.id,version:inv.version,reason:'【テスト】明細の訂正'});
  // Follow the real generated business links against the second isolated family.
  served=h2;
  const linksContext=await browser.newContext({reducedMotion:'reduce',viewport:{width:390,height:844}});
  await linksContext.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||u.protocol==='data:')return r.continue();report.externalRequests.push(u.origin);return r.abort();});
  await linksContext.addInitScript(auth=>localStorage.setItem('sw2_family',auth),pa);
  const lp=await linksContext.newPage();lp.on('pageerror',e=>report.errors.push(e.message));
  const mailHash=m=>new URL(m.body.match(/https:\/\/www\.stepwise-education\.jp\/family\/[^\s]+/)[0]).hash;
  await lp.goto(origin+'/family/'+mailHash(changedNotice));
  await lp.locator('.bsheet').waitFor();
  assert.match(await lp.locator('.sch-month').innerText(),/2026年9月/);
  assert.match(await lp.locator('.bsheet').innerText(),/キャンセル/);
  await lp.goto(origin+'/family/'+mailHash(h2.mails().find(m=>m.subject.includes('キャンセル料の申請への回答'))));
  await lp.locator('.bsheet').waitFor();
  assert.match(await lp.locator('.bsheet').innerText(),/1,500/);
  await lp.goto(origin+'/family/'+mailHash(h2.mails().find(m=>m.subject.includes('請求取消し'))));
  await lp.getByText('この請求は取り消されています。お支払いは不要です。',{exact:false}).waitFor();
  assert.equal(await lp.locator('[data-action="inv-report"]').count(),0);
  report.checks.push('actual generated lesson, fee-response and void-invoice links open authenticated current details');
  await linksContext.close();served=h;
  // Review copies contain only synthetic data; redact invitation/reset bearer strings.
  const emails=h.mails().concat(h2.mails()).filter(m=>m.audience==='family').map(m=>({subject:m.subject,body:m.body.replace(/#(invite|reset)=[^\s]+/g,'#$1=TEST-LINK'),status:m.status}));
  for(const m of emails)assert.doesNotMatch(m.body,/undefined|NaN/,'notice has no missing identifiers or values');
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fs.writeFileSync(path.join(out,'emails.html'),'<!doctype html><html lang="ja"><meta charset="utf-8"><title>保護者通知の見本（未公開・架空データ）</title><style>body{font:16px system-ui;max-width:800px;margin:32px auto;padding:20px}article{border:1px solid #ddd;padding:20px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style><h1>保護者通知の見本</h1><p>未公開の確認用です。架空データで生成し、実メールは送信していません。</p>'+emails.map(m=>'<article><h2>'+escape(m.subject)+'</h2><pre>'+escape(m.body)+'</pre></article>').join('')+'</html>');
  fs.writeFileSync(path.join(out,'emails.json'),JSON.stringify(emails,null,2));
  const expectedSubjects=[/保護者ページの登録/,/パスワードの再設定/,/個別受講条件書のお知らせ/,/特別単価のご提案/,/授業内容・回数・料金をご確認ください（受講計画書）/,/受講計画書の確認のお願い（再案内）/,/授業の日程の承認のお願い/,/授業の日時が確定しました/,/授業の日時を変更しました/,/授業をキャンセルしました/,/キャンセル料のお知らせ/,/キャンセル料の申請への回答/,/月分の授業料のお知らせ/,/請求取消し/];
  for(const re of expectedSubjects)assert.ok(emails.some(m=>re.test(m.subject)),'missing actual template: '+re);
  report.templateSubjects=expectedSubjects.map(re=>emails.find(m=>re.test(m.subject)).subject);
  report.checks.push('all 13 existing notification templates and invoice-void template generated without sending');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
  console.log(JSON.stringify(report));fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
