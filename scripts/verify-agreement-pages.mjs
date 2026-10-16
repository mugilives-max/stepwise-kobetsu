// Public read-only verification; no credentials, login, or family data.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source='c936eaf2856378b65a1cf270dcef13b92b7c79d9';
const paths=['assets/v2/agreement-document.js','assets/v2/portal-ui.js','staff/app.js','staff/billing.js','staff/extras.js','staff/index.html','family/app.js','family/index.html','assets/v2/schedule-view.js'];
const normalize=s=>s.replace(/\r\n/g,'\n').trim();
const hash=s=>createHash('sha256').update(s).digest('hex');
const results=[];
for(const path of paths){
 const expected=normalize(await readFile('release-source/'+path,'utf8'));
 let match=false;
 for(let i=0;i<36;i++){
  const r=await fetch('https://www.stepwise-education.jp/'+path+'?verify='+source,{cache:'no-store',signal:AbortSignal.timeout(30000)});
  if(r.ok&&hash(normalize(await r.text()))===hash(expected)){match=true;break;}
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 if(!match)throw new Error('Public asset does not match reviewed source: '+path);
 results.push(path);
}
const r=await fetch('https://stepwise-api.stepwise-edu.workers.dev/',{signal:AbortSignal.timeout(30000)});
const h=await r.json();
if(!r.ok||!h.ok||h.release!=='2026-10-16-agreement-documents')throw new Error('Public Worker health mismatch.');
console.log(JSON.stringify({source,publicAssetsMatch:results,workerHealth:true,productionWrites:false,authenticatedProductionDocumentTest:false}));
