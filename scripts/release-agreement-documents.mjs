// Manual GitHub-only release. No migrations, consent writes, family messages or terms activation.
import { readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ensure, runWrangler, compareModule, activeDeployment, assertPrivateBucket } from './release-contract-system.mjs';

const repo='mugilives-max/stepwise-kobetsu', worker='stepwise-api', bucket='stepwise-files';
const base='fb64b7c1b3219aefa17b5993663ba1557d217dd5';
const reviewedSource='c936eaf2856378b65a1cf270dcef13b92b7c79d9';
const request=JSON.parse(await readFile('release-control/scripts/agreement-release-request.json','utf8'));
const operation=request.operation;

const expectedRelease='2026-10-16-agreement-documents';
const source=resolve('release-source'), baseline=resolve('baseline');
const hash=b=>createHash('sha256').update(b).digest('hex');
let stage='authorization and source',dir;
const check=(ok,msg)=>ensure(ok,msg);
const q=s=>'"'+s.replaceAll('"','""')+'"';
try {
 check(process.env.GITHUB_ACTIONS==='true' && process.env.GITHUB_EVENT_NAME==='push'
  && process.env.GITHUB_REF==='refs/heads/codex/agreement-release-20261016' && process.env.GITHUB_REPOSITORY===repo,'Use the explicitly authorized agreement release branch.');
 check(['inspect','publish','verify'].includes(operation) && request.source===reviewedSource,'Unreviewed release request.');
 const git=cwd=>spawnSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).stdout.trim();
 check(git(source)===reviewedSource && git(baseline)===base,'Unexpected checkouts.');
 const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
 check(token?.length>20 && /^[a-f0-9]{32}$/.test(account||''),'Deployment credentials unavailable.');
 dir=await mkdtemp(join(tmpdir(),'stepwise-agreement-documents-'));
 const prefix=operation==='verify'?request.backupPrefix:'release-backups/agreement-documents-20261016/'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
 check(/^release-backups\/agreement-documents-20261016\/\d+-\d+$/.test(prefix||''),'Invalid private backup reference.');
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
 let tables=[];
 const schema=(await cf('/d1/database/91ea045c-94a4-413f-91c1-1e29ebe6eb24/query',{sql:"SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"}))[0];
 check(schema?.success && Array.isArray(schema.results),'Could not inspect production schema.');
 tables=schema.results.map(r=>r.name);
 check(['conditions','specials','termsConsents','termsVersions','planLines','planRevisions','files','families','students','settings'].every(t=>tables.includes(t)),'Required contract tables missing.');
 const lessonSchema=schema.results.find(r=>r.name==='lessons')?.sql||'';
 check(lessonSchema.includes('askedAt')&&lessonSchema.includes('agreement'),'The published lesson-stage migration is missing; do not run migrations here.');
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
   const expected=await readFile(join(out,name));
   let comparison=compareModule(actual,expected,!name.endsWith('.wasm'));
   if(comparison==='different'&&!name.endsWith('.wasm')){
    const esbuild=await import(resolve(source,'node_modules/esbuild/lib/main.js'));
    const options={loader:'js',minifyWhitespace:true,legalComments:'none',sourcefile:'worker.js'};
    const a=(await esbuild.transform(actual.toString('utf8'),options)).code;
    const e=(await esbuild.transform(expected.toString('utf8'),options)).code;
    if(a===e) comparison='formatting-only';
    else {
      let start=0;while(start<Math.min(a.length,e.length)&&a[start]===e[start])start++;
      console.log(JSON.stringify({module:name,comparison:'different',actualBytes:actual.length,expectedBytes:expected.length,firstDifference:start,expectedContext:e.slice(Math.max(0,start-100),start+180)}));
    }
   }
   console.log(JSON.stringify({module:name,comparison}));
   check(comparison!=='different','Worker modules differ from '+label+'; review concurrent changes.');
  }
 }
 stage='read-only production preflight';
 const currentMain=await fetch('https://api.github.com/repos/'+repo+'/git/ref/heads/main',{headers:{Authorization:'Bearer '+process.env.GH_READ_TOKEN}});
 check(currentMain.ok && (await currentMain.json()).object.sha===base,'Main moved; review before deployment.');
 await privacy();
 let before,raw,data,settings,manifest;
 if(operation==='verify'){
  async function readPrivate(name){const file=join(dir,'original-'+name);runWrangler(source,['r2','object','get',bucket+'/'+prefix+'/'+name,'--file',file,'--remote','--config','cf/wrangler.jsonc']);return readFile(file);}
  manifest=JSON.parse(await readPrivate('manifest-before.json'));
  data=JSON.parse(await readPrivate('contracts-before.json'));
  settings=JSON.parse(await readPrivate('worker-settings-before.json'));
  check(manifest.source===reviewedSource&&manifest.base===base&&manifest.backupPrefix===prefix,'Unexpected checkpoint.');
  check(manifest.recordsHash===hash(JSON.stringify(data))&&manifest.workerHash===hash(await readPrivate('worker-before.bin')),'Original backup integrity failed.');
  before=manifest.before;
 }else{
  before=await deployment();raw=await rawWorker();
  console.log(JSON.stringify({activeWorkerVersion:before.versionId,operation}));
  await modulesMatch(raw,baseline,'reviewed-baseline');
  data=await snapshot();
  settings=await cf('/workers/scripts/'+worker+'/settings');
  if(operation==='inspect'){
   check(JSON.stringify(before)===JSON.stringify(await deployment()),'Concurrent deployment during preflight.');
   console.log(JSON.stringify({source:reviewedSource,baseline:base,workerVersion:before.versionId,baselineModulesMatch:true,tablesChecked:tables.length,privateBucket:true,lessonStageSchemaPresent:true,productionWrites:false}));
   process.exitCode=0;
  }else{
 stage='private recoverable backup';
 await save('worker-before.bin',raw.bytes);
 await save('worker-settings-before.json',Buffer.from(JSON.stringify(settings)));
 await save('contracts-before.json',Buffer.from(JSON.stringify(data)));
 await save('schema-before.json',Buffer.from(JSON.stringify(schema.results)));
 manifest={source:reviewedSource,base,before,workerContentType:raw.type,workerHash:hash(raw.bytes),recordsHash:hash(JSON.stringify(data)),backupPrefix:prefix};
 await save('manifest-before.json',Buffer.from(JSON.stringify(manifest)));
 check(JSON.stringify(before)===JSON.stringify(await deployment()),'Concurrent Worker deployment.');
 check(JSON.stringify(data)===JSON.stringify(await snapshot()),'Contract records changed during preflight; stop and inspect.');
 stage='publish tested Worker';
 try {runWrangler(source,['deploy','--config','cf/wrangler.jsonc','--keep-vars']);}
 catch {
   // Wrangler can exit after a successful upload. Inspect exactly once; never redeploy automatically.
   check((await deployment()).versionId!==before.versionId,'Publication command failed before a new version became active.');
   console.log('Publication command returned an error; inspecting the active version without retrying.');
 }
  }
 }
 if(operation!=='inspect'){
 const after=await deployment();check(after.versionId!==before.versionId,'No new Worker version.');
 stage='verify public code and existing records';
 await modulesMatch(await rawWorker(),source,'published-source');
 const health=await fetch('https://stepwise-api.stepwise-edu.workers.dev/',{signal:AbortSignal.timeout(60000)});
 const healthBody=await health.json();check(health.ok && healthBody.ok===true && healthBody.release===expectedRelease,'Public health verification failed.');
 const healthPaths=['billing/plans/document','family/plans/document','billing/plans/history'];
 for(const path of healthPaths){
  const r=await fetch('https://stepwise-api.stepwise-edu.workers.dev/v2/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(60000)});
  const b=await r.json();check(!b.ok && !b.html && (r.status===401||r.status===403||/auth|login|unauthorized/i.test(String(b.error?.code||b.code||''))),'Document route must reject unauthenticated access.');
 }
 const schedules=await cf('/workers/scripts/'+worker+'/schedules');
 check(JSON.stringify(schedules.schedules.map(s=>s.cron).sort())===JSON.stringify(['10 15 * * *']),'Production schedule changed.');
 check((await cf('/workers/scripts/'+worker+'/subdomain')).enabled===true,'Existing public URL disabled.');
 const currentSettings=await cf('/workers/scripts/'+worker+'/settings');
 for(const key of ['bindings','compatibility_date','compatibility_flags']) {
  const norm=x=>Array.isArray(x)?x.map(v=>JSON.stringify(v)).sort():x;
  check(JSON.stringify(norm(settings[key]))===JSON.stringify(norm(currentSettings[key])),'Runtime settings changed: '+key);
 }
 const afterData=await snapshot();check(JSON.stringify(data)===JSON.stringify(afterData),'Existing contract records changed; inspect privately.');
 check(JSON.stringify(after)===JSON.stringify(await deployment()),'Concurrent deployment during verification.');
 await save('manifest-published.json',Buffer.from(JSON.stringify({...manifest,after,recordsPreserved:true})));
 const summary={source:reviewedSource,verificationSource:process.env.GITHUB_SHA,backupPrefix:prefix,release:expectedRelease,beforeVersion:before.versionId,workerVersion:after.versionId,privateBackupVerified:true,modulesMatch:true,tablesChecked:tables.length,allExistingRecordsUnchanged:true,documentRoutesRequireAuthentication:true,migrationsRun:false,termsActivated:false,messagesSent:false};
 console.log(JSON.stringify(summary));
 await writeFile(process.env.GITHUB_STEP_SUMMARY,'## Agreement document publication verified\n\n'+JSON.stringify(summary,null,2)+'\n');
 }
} catch(e) {
 const msg=e instanceof Error && !/https?:|Bearer|token=|password/i.test(e.message)?e.message:'Private details withheld.';
 console.error('Stopped at '+stage+': '+msg);
 console.error('No automatic rollback or database retry. Inspect the active Worker and private backup before further action.');
 process.exitCode=1;
} finally {if(dir)await rm(dir,{recursive:true,force:true});}
