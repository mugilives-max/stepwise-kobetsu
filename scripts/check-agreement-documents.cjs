'use strict';
// In-memory synthetic data only; run on GitHub, never against production.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {agreementFixture}=require('../test/helpers/agreement-fixture.cjs');
(async()=>{
 const {h,auth,parent,kid,plan,approve,row,refs}=await agreementFixture();
 const p=await plan(), english=await plan({subject:'英語',comment:'比較表現・関係代名詞の復習。学校の教材を使い、文の組み立てを確認します。'});
 await h.ok('billing/plans/send',{auth,familyId:kid.familyId});
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
 const out=path.join(root,'agreement-document-output');fs.mkdirSync(out,{recursive:true});
 const report={checks:[],externalRequests:[],pdfs:[]}, errors=[];
 try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin||['data:','blob:','about:'].includes(u.protocol))return route.continue();report.externalRequests.push(u.origin);return route.abort();});
  await context.addInitScript(({parent,auth,origin})=>{
   if(location.origin!==origin)return;
   localStorage.setItem('sw2_family',parent);localStorage.setItem('sw2_staff',auth);
   const RealDate=Date; window.Date=class extends RealDate {constructor(...args){super(...(args.length?args:['2026-10-16T03:00:00Z']));}static now(){return new RealDate('2026-10-16T03:00:00Z').getTime();}};
  },{parent,auth,origin});
  const page=await context.newPage();context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
  const savePdf=async(tab,name)=>{
   await tab.evaluate(()=>document.fonts.ready);
   await tab.emulateMedia({media:'print'});
   assert.equal(await tab.locator('table').evaluateAll(ts=>ts.filter(t=>t.scrollWidth>t.clientWidth+1).length),0,'tables fit');
   await tab.pdf({path:path.join(out,name+'.pdf'),format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;text-align:center;font-size:8px;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
   report.pdfs.push(name);
  };
  await page.goto(origin+'/family/#money');
  await page.locator('[data-plan-count="'+p.id+'"]').selectOption('3');
  await page.locator('input[data-consenter="2026-11"]').fill('【テスト】入力中の保護者');
  const before=h.rows('select * from planLines');
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'提示された案を印刷・PDF保存'}).click();
  const draft=await popupPromise;await draft.getByRole('heading',{name:'受講合意書（案）',exact:true}).waitFor();
  assert.match(await draft.locator('body').innerText(),/36,000円/,'proposal uses saved counts, not unsaved input');
  assert.equal(await page.locator('[data-plan-count="'+p.id+'"]').inputValue(),'3');
  assert.equal(await page.locator('input[data-consenter="2026-11"]').inputValue(),'【テスト】入力中の保護者');
  assert.deepEqual(h.rows('select * from planLines'),before);
  assert.equal(await draft.evaluate(()=>window.opener),null);
  await savePdf(draft,'proposal');await draft.close();
  report.checks.push('family proposal popup preserves form inputs and does not approve');
  await approve(p,{approvedCount:3});await approve(english);
  const saved=refs(row(p.id),row(english.id));
  await page.reload();
  const approvedPopup=page.waitForEvent('popup');await page.getByRole('button',{name:'印刷・PDF保存',exact:true}).first().click();
  const approved=await approvedPopup;await approved.getByRole('heading',{name:'受講合意書の控え',exact:true}).waitFor();
  assert.match(await approved.locator('body').innerText(),/31,500円/);
  await savePdf(approved,'approved');await approved.close();
  await page.getByRole('button',{name:'過去の契約・同意の控え',exact:true}).click();
  await page.locator('summary').filter({hasText:'受講計画合意書の履歴'}).click();
  const historyPopup=page.waitForEvent('popup');await page.getByRole('button',{name:'この版を印刷・PDF保存'}).first().click();
  const history=await historyPopup;await history.getByRole('heading',{name:'受講合意書の控え',exact:true}).waitFor();await history.close();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(out,'family.png'),fullPage:true});
  report.checks.push('family approved and archive documents, mobile width');
  await page.goto(origin+'/staff/#plans');
  await page.locator('button[data-action="pl-student"]').first().click(); // 生徒を押すと、その月の受講合意書
  await page.getByRole('button',{name:/の受講計画合意書を見る/}).first().click();
  const staffPopup=page.waitForEvent('popup');await page.getByRole('button',{name:'印刷・PDF保存',exact:true}).click();
  const staffDoc=await staffPopup;await staffDoc.getByRole('heading',{name:'受講合意書の控え',exact:true}).waitFor();await staffDoc.close();
  await page.locator('button[data-action="pl-close"]').first().click();
  await page.getByRole('button',{name:/の過去の版$/}).first().click();
  await page.getByRole('button',{name:'この版を印刷・PDF保存'}).first().waitFor();
  await page.screenshot({path:path.join(out,'staff-history.png'),fullPage:true});
  report.checks.push('manager combined output and past-version entry');
  await page.goto(origin+'/staff/#docs');
  const samplePromise=page.waitForEvent('popup');await page.locator('[data-action="doc-sample"][data-type="agreement"]').click();
  const sample=await samplePromise;await sample.getByText('見本・架空の記録です。実際の契約ではありません。').waitFor();
  await savePdf(sample,'sample');await sample.close();
  // Long content and missing historical fields: no present-day data substituted.
  const {agreementDocHtml}=await import('../cf/v2/agreement-doc-20261016.mjs');
  const records=Array.from({length:3},(_,i)=>({studentName:'【テスト】長文確認',capturedAt:'2026-10-02T03:00:00Z',line:{
   ...row(p.id),id:'long_sample_'+i,subject:['数学','英語','国語'][i],comment:('定期テストに向けて、学校で学んだ範囲を復習します。間違えた理由を一緒に確認し、次の問題に取り組みます。\n').repeat(7)+'末尾確認'+i,
   parts:[{label:'<記号>・長い名称の教材と目的'.repeat(4),count:4}],consenterName:'',consentedAt:'',consentDate:'2026-09-30',recordedAt:'',recordedByName:'',termsVersion:'legacy-unknown',conditionId:''
  },terms:{}}));
  const long=await context.newPage();await long.setContent(agreementDocHtml({records,documentId:'AG-LONG-SYNTHETIC',sample:true}));await savePdf(long,'long-history');await long.close();
  // Editing afterward cannot alter previously selected PDF data.
  const original=await h.ok('family/plans/document',{auth:parent,refs:saved});
  await h.ok('billing/plans/save',{auth,id:p.id,version:row(p.id).version,fee:4000});
  assert.equal((await h.ok('family/plans/document',{auth:parent,refs:saved})).html,original.html);
  report.checks.push('saved versions unchanged after edit; long text and unknown legacy evidence rendered');
  assert.deepEqual(errors,[]);assert.deepEqual(report.externalRequests,[]);
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
