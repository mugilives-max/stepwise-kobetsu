// Verification after a partial publication. Never deploys, migrates, activates terms or sends messages.
import { readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ensure, runWrangler, compareModule, activeDeployment, assertPrivateBucket } from './release-contract-system.mjs';

const repo='mugilives-max/stepwise-kobetsu', worker='stepwise-api', bucket='stepwise-files';
const base='77b91fbdfb9e40ccbb2f28a082d3577a3ff052b2';
const expectedRelease='2026-10-14-document-names';
const publishedSource='a65bbcdac4dfde320497b308af7948d4acf86191';
const source=resolve('release-source'), verifier=resolve('verification-source');
const hash=b=>createHash('sha256').update(b).digest('hex');
let stage='authorization and source',dir;
const check=(ok,msg)=>ensure(ok,msg);
const q=s=>'"'+s.replaceAll('"','""')+'"';
try {
 check(process.env.GITHUB_ACTIONS==='true' && process.env.GITHUB_EVENT_NAME==='workflow_dispatch'
  && process.env.GITHUB_REF==='refs/heads/main' && process.env.GITHUB_REPOSITORY===repo,'Use manual main-branch publication.');
 check(process.env.EXPECTED_SHA===process.env.GITHUB_SHA && /^[a-f0-9]{40}$/.test(process.env.EXPECTED_SHA),'The selected main SHA is not the reviewed SHA.');
 const git=cwd=>spawnSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).stdout.trim();
 check(git(source)===publishedSource && git(verifier)===process.env.EXPECTED_SHA,'Unexpected checkouts.');
 const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
 check(token?.length>20 && /^[a-f0-9]{32}$/.test(account||''),'Deployment credentials unavailable.');
 dir=await mkdtemp(join(tmpdir(),'stepwise-document-names-'));
 const prefix='release-verification/document-names-20261014/'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
 async function cf(path,body,raw=false){
  const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{
   method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
  check(r.ok,'Cloudflare request failed: HTTP '+r.status);
  if(raw)return {bytes:Buffer.from(await r.arrayBuffer()),type:r.headers.get('content-type')};
  const data=await r.json();check(data.success===true,'Cloudflare did not confirm success.');return data.result;
 }
 const deployment=async()=>activeDeployment(await cf('/workers/scripts/'+worker+'/deployments'));
 const rawWorker=()=>cf('/workers/scripts/'+worker,undefined,true);
 const privacy=async()=>assertPrivateBucket(await cf('/r2/buckets/'+bucket+'/domains/managed'),await cf('/r2/buckets/'+bucket+'/domains/custom'));
 async function save(name,bytes){
  await privacy();const file=join(dir,name),copy=join(dir,'verify-'+name),object=bucket+'/'+prefix+'/'+name;
  await writeFile(file,bytes,{mode:0o600});
  runWrangler(source,['r2','object','put',object,'--file',file,'--remote','--config','cf/wrangler.jsonc']);
  runWrangler(source,['r2','object','get',object,'--file',copy,'--remote','--config','cf/wrangler.jsonc']);
  check(hash(bytes)===hash(await readFile(copy)),'Private backup read-back mismatch.');
 }
 const tables=['conditions','specials','termsConsents','termsVersions','planLines','planRevisions','files','families','students','settings'];
 async function snapshot(){
  const results=await cf('/d1/database/91ea045c-94a4-413f-91c1-1e29ebe6eb24/query',{sql:tables.map(t=>'SELECT * FROM '+q(t)).join(';')});
  check(results.length===tables.length && results.every(x=>x.success===true && Array.isArray(x.results)),'Incomplete contract snapshot.');
  return Object.fromEntries(tables.map((t,i)=>[t,results[i].results.map(x=>JSON.stringify(x,Object.keys(x).sort())).sort()]));
 }
 async function modulesMatch(raw,cwd,label){
  check(raw.type?.includes('multipart/form-data'),'Worker source format cannot be verified.');
  const parts=await new Response(raw.bytes,{headers:{'Content-Type':raw.type}}).formData();
  const out=join(dir,label);
  runWrangler(cwd,['deploy','--config','cf/wrangler.jsonc','--dry-run','--outdir',out]);
  const names=(await readdir(out)).filter(n=>/\.(m?js|wasm)$/.test(n));
  const remote=[...parts.entries()].filter(([k,v])=>/\.(m?js|wasm)$/.test(k)||/\.(m?js|wasm)$/.test(v?.name||''));
  check(names.length>0 && remote.length===names.length,'Worker module count mismatch.');
  for(const name of names){
   const entries=remote.filter(([k,v])=>k===name||v.name===name);check(entries.length===1,'Worker module name mismatch.');
   const part=entries[0][1],actual=typeof part==='string'?Buffer.from(part):Buffer.from(await part.arrayBuffer());
   check(compareModule(actual,await readFile(join(out,name)),!name.endsWith('.wasm'))!=='different','Worker modules differ from '+label+'; review concurrent changes.');
  }
 }
 stage='read-only original checkpoint verification';
 await privacy();
 const original='release-backups/document-names-20261014/38563501703-1/';
 async function readPrivate(name){
  const file=join(dir,'original-'+name);
  runWrangler(source,['r2','object','get',bucket+'/'+original+name,'--file',file,'--remote','--config','cf/wrangler.jsonc']);
  return readFile(file);
 }
 const manifest=JSON.parse(await readPrivate('manifest-before.json'));
 const data=JSON.parse(await readPrivate('contracts-before.json'));
 const settings=JSON.parse(await readPrivate('worker-settings-before.json'));
 check(manifest.source===publishedSource && manifest.base===base && manifest.backupPrefix===original.slice(0,-1),'Unexpected original checkpoint.');
 check(manifest.workerHash===hash(await readPrivate('worker-before.bin')) && manifest.recordsHash===hash(JSON.stringify(data)),'Original backup integrity failed.');
 const before=manifest.before,after=await deployment();
 check(after.versionId!==before.versionId,'Publication did not create an active new version; investigate before retrying.');
 console.log('Original private backup verified; no publication or migration repeated.');
 stage='verify public code and existing records';
 await modulesMatch(await rawWorker(),source,'published-source');
 const health=await fetch('https://stepwise-api.stepwise-edu.workers.dev/',{signal:AbortSignal.timeout(60000)});
 const healthBody=await health.json();check(health.ok && healthBody.ok===true && healthBody.release===expectedRelease,'Public health verification failed.');
 const currentSettings=await cf('/workers/scripts/'+worker+'/settings');
 for(const key of ['bindings','compatibility_date','compatibility_flags']) {
  const norm=x=>Array.isArray(x)?x.map(v=>JSON.stringify(v)).sort():x;
  check(JSON.stringify(norm(settings[key]))===JSON.stringify(norm(currentSettings[key])),'Runtime settings changed: '+key);
 }
 stage='verify URL and schedule';
 const subdomain=await cf('/workers/scripts/'+worker+'/subdomain');
 check(subdomain.enabled===true,'Existing Worker URL is not enabled.');
 const schedules=await cf('/workers/scripts/'+worker+'/schedules');
 check(JSON.stringify(schedules.schedules.map(s=>s.cron).sort())===JSON.stringify(['10 15 * * *']),'Production schedules differ from the reviewed configuration.');
 stage='verify unchanged contract records';
 const afterData=await snapshot();check(JSON.stringify(data)===JSON.stringify(afterData),'Existing contract records changed; inspect privately.');
 check(JSON.stringify(after)===JSON.stringify(await deployment()),'Concurrent deployment during verification.');
 await save('manifest-published.json',Buffer.from(JSON.stringify({...manifest,after,recordsPreserved:true,verifiedAfterPartialPublication:true,verificationSource:process.env.EXPECTED_SHA})));
 const summary={source:publishedSource,verificationSource:process.env.EXPECTED_SHA,release:expectedRelease,beforeVersion:before.versionId,workerVersion:after.versionId,privateBackupVerified:true,modulesMatch:true,existingContractRecordsUnchanged:true,publicationRepeated:false,migrationsRun:false,termsActivated:false,messagesSent:false};
 console.log(JSON.stringify(summary));
 await writeFile(process.env.GITHUB_STEP_SUMMARY,'## Document names publication verified without redeployment\n\n'+JSON.stringify(summary,null,2)+'\n');
} catch(e) {
 const msg=e instanceof Error && !/https?:|Bearer|token=|password/i.test(e.message)?e.message:'Private details withheld.';
 console.error('Stopped at '+stage+': '+msg);
 console.error('No automatic rollback or database retry. Inspect the active Worker and private backup before further action.');
 process.exitCode=1;
} finally {if(dir)await rm(dir,{recursive:true,force:true});}
