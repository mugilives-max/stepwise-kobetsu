// Public read-only verification; no credentials, login, or family data.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source='71ba752ce0a0516c299a51fd2956070b10ac8228';
const paths=["assets/v2/family-target.js","staff/extras.js","assets/v2/invoice-due.js","staff/billing.js","family/app.js","assets/v2/portal-ui.js","staff/schedule.js","family/index.html","staff/index.html","staff/app.js","assets/v2/notice-view.js","assets/v2/schedule-view.js","student/app.js","student/index.html","assets/v2/base.css"];
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
if(!r.ok||!h.ok||h.release!=='2026-10-16-parent-notifications')throw new Error('Public Worker health mismatch.');
console.log(JSON.stringify({source,publicAssetsMatch:results,workerHealth:true,productionWrites:false,authenticatedProductionDocumentTest:false}));
