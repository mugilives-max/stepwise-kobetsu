'use strict';
// 入塾の案内と申込みの画面の確認（2026-10-18 本人決定。cf/v2/enrollment.mjs・family/enroll.js・staff/students.js）。
// メモリの台帳と架空の体験生で、代表（PC幅）→ 保護者（スマホ幅）を最初から通す。外への通信はしない。
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createV2}=require('../test/helpers/v2-harness.cjs');
(async()=>{
 const h=await createV2(), auth=await h.owner();
 h.db2._sqlite.prepare("insert into settings (key, value, updatedAt) values ('live', '1', '')").run(); // 切り替えたあと（本番と同じ）
 const trial=await h.ok('admin/trials/create',{auth,familyName:'【テスト】架空',givenName:'体験',grade:'中3',school:'',note:''});
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
 const report={checks:[],externalRequests:[],errors:[]},out=path.join(root,'enrollment-ui-output');fs.mkdirSync(out,{recursive:true});
 const make=async(width,init)=>{
  const c=await browser.newContext({viewport:{width,height:900}});
  await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||['data:','about:','blob:'].includes(u.protocol))return r.continue();report.externalRequests.push(u.origin);return r.abort();});
  if(init)await c.addInitScript(init);
  const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.on('dialog',d=>d.accept());return p;
 };
 const fits=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
 let owner,parent;
 try {
  owner=await make(1100);await owner.context().addInitScript(t=>localStorage.setItem('sw2_staff',t),auth);
  // 1. 規約を公開する前は送れない
  await owner.goto(origin+'/staff/#student='+trial.studentId+'/summary');
  await owner.getByRole('heading',{name:'入塾の手続き',exact:true}).waitFor();
  assert.equal(await owner.locator('[data-form="enroll-offer"] button.primary').isDisabled(),true,'規約が無いうちは案内できない');
  await owner.getByText('共通規約をまだ使い始めていません',{exact:false}).waitFor();
  await h.ok('admin/terms/set',{auth,version:'2026-11-r9',title:'受講規約（2026年11月版）',url:'https://example.invalid/terms',from:'2026-11-01'});
  await owner.reload();
  const f='[data-form="enroll-offer"]';
  await owner.fill(f+' input[name="email"]','enroll-ui@example.invalid');assert.equal(await owner.locator(f+' input[name="fee"]').inputValue(),'4500','基準単価は 4,500円 から');assert.equal(await owner.locator(f+' input[name="fromMonth"]').inputValue(),'2026-10','開始は今月から');await owner.locator(f+' input[name="subjects"][value="英語"]').check();await owner.locator(f+' input[name="subjects"][value="数学"]').check();await owner.getByText('実施形態',{exact:true}).waitFor();assert.equal(await owner.locator(f+' input[name="studentContact"]').count(),0,'お休みの連絡は保護者が決める');
  await owner.screenshot({path:path.join(out,'01-owner-offer.png'),fullPage:true});
  const mails=h.mails().length;
  await owner.locator(f+' button.primary').click();
  await owner.getByRole('heading',{name:'保護者の申込みを待っています',exact:true}).waitFor();
  assert.equal(h.mails().length,mails+1,'招待のメールが 1 通');
  const invite=await owner.locator('button[data-action="copy"]').getAttribute('data-text');assert.equal(await owner.locator('p.copy').count(),0,'リンクの文字は出さず、コピーのボタンだけ');
  assert.ok(invite.includes('/family/#invite='),'メールが届かないときのリンクが出る');
  await owner.screenshot({path:path.join(out,'02-owner-waiting.png'),fullPage:true});
  await owner.goto(origin+'/staff/#students');await owner.getByText('入塾の申込み待ち',{exact:true}).waitFor();
  report.checks.push('owner offer: blocked until terms published, then one invite mail and a copyable link; list shows waiting');
  // 2. 保護者（スマホ幅）: パスワード → 申込みの画面
  parent=await make(390);
  await parent.goto(origin+'/family/'+invite.slice(invite.indexOf('#')));
  await parent.fill('input[name="password"]','family password 1');await parent.fill('input[name="confirm"]','family password 1');
  await parent.locator('[data-form="invite"] button.primary').click();
  await parent.locator('[data-form="enroll-input"]').waitFor();
  assert.equal(await parent.evaluate(()=>location.hash),'#enroll','パスワードのあと、そのまま申込みの画面');
  assert.equal(await fits(parent),true);
  await parent.screenshot({path:path.join(out,'03-parent-input-mobile.png'),fullPage:true});
  await parent.locator('[data-form="enroll-input"] button.primary').click();
  assert.equal(await parent.locator('[aria-invalid="true"]').count(),10,'保護者の姓・名・ふりがな2つ・電話・郵便番号・住所と、生徒のふりがな2つ・学校');
  assert.equal(await parent.locator('select[data-enroll="grade"]').inputValue(),'中3','学年は選択肢から（体験のときの値が選ばれている）');
  assert.equal(await parent.locator('select[data-enroll="stage"]').inputValue(),'中学生','区分が先（学年から決まる）');
  await parent.selectOption('select[data-enroll="stage"]','小学生');
  assert.deepEqual(await parent.locator('select[data-enroll="grade"] option').allInnerTexts(),['選んでください','1年','2年','3年','4年','5年','6年'],'区分を変えると学年を選び直す');
  await parent.selectOption('select[data-enroll="stage"]','中学生');await parent.selectOption('select[data-enroll="grade"]','中3');
  const g=(k,v)=>parent.fill(`[data-enroll="${k}"]`,v);
  await g('guardianFamilyName','【テスト】架空');await g('guardianGivenName','花子');await g('guardianFamilyKana','かくう');await g('guardianGivenKana','はなこ');await g('phone','090-1234-5678');await g('zip','3430002');await g('address','【テスト】越谷市1-2-3');
  await g('familyKana','かくう');await g('givenKana','たいけん');await g('school','【テスト】第一中学校');
  await parent.locator('[data-form="enroll-input"] button.primary').click();
  await parent.getByRole('heading',{name:'入力内容の確認',exact:true}).waitFor();
  await parent.getByText('〒343-0002 【テスト】越谷市1-2-3',{exact:true}).waitFor();
  await parent.getByRole('button',{name:'個別受講条件書の全文を開く',exact:true}).waitFor(); // 同意の前に全文を開ける（確認の画面にも）
  await parent.getByRole('link',{name:'共通規約の全文を開く',exact:true}).waitFor();
  assert.equal(h.rows('select count(*) n from termsConsents')[0].n,0,'確認の画面ではまだ何も記録しない');
  // 同意は全文を開いてから（開くまで印を付けられない）
  await parent.screenshot({path:path.join(out,'04a-parent-confirm-locked.png'),fullPage:true});
  assert.equal(await parent.locator('[data-form="enroll-apply"] input[name="agree"]').isDisabled(),true,'全文を開くまで同意の印は付けられない');
  await parent.locator('[data-form="enroll-apply"] button.primary').click();
  await parent.getByText('共通規約と個別受講条件書の全文を開いて確かめてください',{exact:true}).waitFor();
  for(const name of ['個別受講条件書の全文を開く','共通規約の全文を開く']){const [doc]=await Promise.all([parent.context().waitForEvent('page'),parent.locator(`.agree-docs [aria-label="${name}"]`).click()]);
    if(name.startsWith('個別受講条件書')){await doc.waitForURL(/^blob:/);await doc.waitForLoadState();assert.ok((await doc.textContent('body')).includes('【テスト】架空 花子 様'),'個別受講条件書の宛名は入れた保護者の氏名');}
    await doc.close();}
  report.externalRequests=report.externalRequests.filter(u=>u!=='https://example.invalid'); // 共通規約の全文（このテストの架空の URL）を開いた分
  assert.equal(await parent.locator('[data-form="enroll-apply"] input[name="agree"]').isDisabled(),false,'両方を開いたら印を付けられる');
  assert.equal(await parent.locator('.agree-docs li.done').count(),2,'開いた全文に ✓');
  await parent.locator('[data-form="enroll-apply"] button.primary').click();
  await parent.getByText('「同意します」に印を付けてください',{exact:false}).waitFor();
  await parent.locator('[data-form="enroll-apply"] input[name="agree"]').check();
  await parent.screenshot({path:path.join(out,'04-parent-confirm-mobile.png'),fullPage:true});
  await parent.locator('[data-form="enroll-apply"] button.primary').click();
  await parent.getByRole('heading',{name:'お申込みを受け付けました',exact:true}).waitFor();
  await parent.screenshot({path:path.join(out,'05-parent-done-mobile.png'),fullPage:true});
  const s=h.rows('select trial, enrolledOn from students where id = ?',trial.studentId)[0];
  assert.deepEqual([s.trial,s.enrolledOn],[0,'2026-10-02'],'申し込んだ日にそのまま入塾（開始は今月）');
  assert.equal(h.rows('select consenterName from termsConsents')[0].consenterName,'【テスト】架空 花子','同意者名は入れた氏名');
  await parent.goto(origin+'/family/#home');await parent.getByText('やること',{exact:true}).waitFor();
  assert.equal((await parent.locator('#app').innerText()).includes('共通規約への同意'),false,'申込みで同意したので、別に求めない');
  report.checks.push('parent: password then the application page, required fields marked, confirm records nothing, consent required, enrolled at once with the typed name');
  // 3. 代表: 入塾した
  await owner.goto(origin+'/staff/#student='+trial.studentId+'/summary');
  await owner.getByRole('heading',{name:'入塾しました',exact:true}).waitFor();
  await owner.screenshot({path:path.join(out,'06-owner-enrolled.png'),fullPage:true});
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
  report.checks.push('owner sees the enrolled state and the next step (plans)');
 }catch(e){report.failure=e.stack;if(owner)await owner.screenshot({path:path.join(out,'failure-owner.png'),fullPage:true}).catch(()=>{});if(parent)await parent.screenshot({path:path.join(out,'failure-parent.png'),fullPage:true}).catch(()=>{});throw e;}
 finally{console.log(JSON.stringify(report));fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
