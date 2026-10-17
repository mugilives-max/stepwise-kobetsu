// Authorized GitHub-only release of PR #107 (employment contract period written as 2026年11月1日から2027年3月31日まで。 in new drafts and the admin/docs/sample; layout 20261018-1). No migration; private backups; no user notifications or contract writes. Fixed contract snapshots are not touched.
// Modelled on release-staff-docs.mjs (PR #105/#106): inspect → publish → verify → pages, each triggered by a push of the request file on the release branch.
import {readFile,writeFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ensure as check,runWrangler,compareModule,activeDeployment,assertPrivateBucket} from './release-contract-system.mjs';
const repo='mugilives-max/stepwise-kobetsu',base='947b68ecc8383d2f887bb8864b645c7cd25d693f'; // base: source of the Worker published on 2026-10-18 (PR #105, 2026-10-18-staff-docs)
const sourceSha='f91c7a64202ef7595d17c8d44970ec69d36c88cd',worker='stepwise-api',db='91ea045c-94a4-413f-91c1-1e29ebe6eb24',bucket='stepwise-files';
const mainBeforePublish='12bb5816b63df9b8814cefd1e111d944d8147ee7',pullNumber=107,releaseLabel='2026-10-18-employment-period',branch='claude/employment-period-release-20261018',backupRoot='release-backups/employment-period-20261018/';
const source=resolve('release-source'),baseline=resolve('baseline'),request=JSON.parse(await readFile('release-control/scripts/employment-period-release-request.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex'),q=s=>'"'+s.replaceAll('"','""')+'"';
const same=(a,b,msg)=>check(JSON.stringify(a)===JSON.stringify(b),msg);
let dir,stage='authorization';
try{
 check(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_REF==='refs/heads/'+branch&&process.env.GITHUB_REPOSITORY===repo,'Use the authorized onboarding release branch.');
 check(['inspect','publish','verify','pages'].includes(request.operation)&&request.source===sourceSha,'Unexpected release request.');
 const git=cwd=>spawnSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).stdout.trim();
 check(git(source)===sourceSha&&git(baseline)===base,'Unexpected source checkout.');
 const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
 check(token?.length>20&&/^[a-f0-9]{32}$/.test(account||''),'Deployment credentials unavailable.');
 dir=await mkdtemp(join(tmpdir(),'stepwise-employment-period-'));
 const prefix=['verify','pages'].includes(request.operation)?request.backupPrefix:backupRoot+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
 check(new RegExp('^'+backupRoot.replaceAll('/','\\/')+'\\d+-\\d+$').test(prefix||''),'Invalid private checkpoint.');
 async function cf(path,body,raw=false){
  const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
  check(r.ok,'Cloudflare HTTP '+r.status);
  if(raw)return {bytes:Buffer.from(await r.arrayBuffer()),type:r.headers.get('content-type')};
  const j=await r.json();check(j.success===true,'Cloudflare did not confirm success.');return j.result;
 }
 async function gh(path){const r=await fetch('https://api.github.com/repos/'+repo+path,{headers:{Authorization:'Bearer '+process.env.GH_READ_TOKEN},signal:AbortSignal.timeout(30000)});check(r.ok,'GitHub reference check failed.');return r.json();}
 async function query(sql){const a=await cf('/d1/database/'+db+'/query',{sql});check(Array.isArray(a)&&a.every(r=>r.success&&Array.isArray(r.results)),'Incomplete D1 query.');return a;}
 const rows=async sql=>(await query(sql))[0].results;
 const deployed=async()=>activeDeployment(await cf('/workers/scripts/'+worker+'/deployments'));
 const rawWorker=()=>cf('/workers/scripts/'+worker,undefined,true);
 const privacy=async()=>assertPrivateBucket(await cf('/r2/buckets/'+bucket+'/domains/managed'),await cf('/r2/buckets/'+bucket+'/domains/custom'));
 async function save(name,bytes){
  await privacy();const f=join(dir,name),copy=join(dir,'verify-'+name),key=bucket+'/'+prefix+'/'+name;
  await writeFile(f,bytes,{mode:0o600});
  runWrangler(source,['r2','object','put',key,'--file',f,'--remote','--config','cf/wrangler.jsonc']);
  runWrangler(source,['r2','object','get',key,'--file',copy,'--remote','--config','cf/wrangler.jsonc']);
  check(hash(bytes)===hash(await readFile(copy)),'Private backup read-back mismatch.');
 }
 async function readPrivate(name){const f=join(dir,'read-'+name);runWrangler(source,['r2','object','get',bucket+'/'+prefix+'/'+name,'--file',f,'--remote','--config','cf/wrangler.jsonc']);return readFile(f);}
 async function columnsNow(){
  const tables=await rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name");
  const cols={};for(const {name} of tables)cols[name]=(await rows('PRAGMA table_info('+q(name)+')')).map(r=>r.name);return cols;
 }
 async function snapshot(columns){
  const names=Object.keys(columns),out={};
  for(let i=0;i<names.length;i+=8){const batch=names.slice(i,i+8),results=await query(batch.map(t=>'SELECT '+columns[t].map(q).join(',')+' FROM '+q(t)).join(';'));
   check(results.length===batch.length,'Incomplete record snapshot.');
   batch.forEach((t,j)=>out[t]=results[j].results.map(r=>JSON.stringify(columns[t].map(c=>r[c]))).sort());}
  return out;
 }
 async function modulesMatch(raw,cwd,label){
  check(raw.type?.includes('multipart/form-data'),'Cannot verify Worker source format.');
  const parts=await new Response(raw.bytes,{headers:{'Content-Type':raw.type}}).formData(),out=join(dir,label);
  runWrangler(cwd,['deploy','--config','cf/wrangler.jsonc','--dry-run','--outdir',out]);
  const names=(await readdir(out)).filter(n=>/\.(m?js|wasm)$/.test(n)),remote=[...parts.entries()].filter(([k,v])=>/\.(m?js|wasm)$/.test(k)||/\.(m?js|wasm)$/.test(v?.name||''));
  check(names.length>0&&names.length===remote.length,'Worker module count mismatch.');
  for(const name of names){
   const entries=remote.filter(([k,v])=>k===name||v.name===name);check(entries.length===1,'Worker module name mismatch.');
   const part=entries[0][1],a=typeof part==='string'?Buffer.from(part):Buffer.from(await part.arrayBuffer()),e=await readFile(join(out,name));
   let match=compareModule(a,e,!name.endsWith('.wasm'));
   if(match==='different'&&!name.endsWith('.wasm')){
    const esbuild=await import(resolve(source,'node_modules/esbuild/lib/main.js')),options={loader:'js',minifyWhitespace:true,legalComments:'none',sourcefile:'worker.js'};
    if((await esbuild.transform(a.toString('utf8'),options)).code===(await esbuild.transform(e.toString('utf8'),options)).code)match='formatting-only';
   }
   console.log(JSON.stringify({module:name,comparison:match}));
   check(match!=='different','Worker differs from '+label+'. Stop for concurrent-source review.');
  }
 }
 const localMigrations=(await readdir(join(source,'cf/migrations-v2'))).filter(n=>n.endsWith('.sql')).sort();
 const applied=async()=> (await rows('SELECT name FROM d1_migrations ORDER BY name')).map(r=>r.name);
 // No migration in this release: schema, migration history and every existing record must be identical before and after.
 async function assertUnchanged(state){
  same(await applied(),localMigrations,'Migration set differs from reviewed source.');
  same(await rows('SELECT * FROM d1_migrations ORDER BY id'),state.migrationRows,'Migration history changed.');
  const current=await columnsNow();
  same(current,state.columns,'Schema changed.');
  const now=await snapshot(state.columns);
  for(const table of Object.keys(state.columns)){
   if(JSON.stringify(state.data[table])!==JSON.stringify(now[table]))console.log(JSON.stringify({recordDrift:table,beforeCount:state.data[table].length,afterCount:now[table].length}));
  }
  same(state.data,now,'Existing contract, consent, payroll, registration or other records changed. Stop for review.');
 }
 stage='source and check verification';
 const pr=await gh('/pulls/'+pullNumber);check(pr.head.sha===sourceSha&&pr.head.repo.full_name===repo,'PR source changed.');
 const currentMain=(await gh('/git/ref/heads/main')).object.sha;
 if(request.operation==='pages')check(pr.merged===true&&pr.merge_commit_sha===currentMain,'Pages check requires the reviewed PR on main.');
 else check(currentMain===mainBeforePublish&&!pr.merged,'Main moved before Worker publication.');
 check(request.checkRuns?.length===2,'Two reviewed checks required.');
 for(const id of request.checkRuns){const r=await gh('/actions/runs/'+id);check(r.conclusion==='success'&&r.head_sha===sourceSha,'Reviewed checks did not pass.');}
 await privacy();
 let state,manifest,settings,before;
 if(['verify','pages'].includes(request.operation)){
  manifest=JSON.parse(await readPrivate('manifest-before.json'));state=JSON.parse(await readPrivate('records-before.json'));settings=JSON.parse(await readPrivate('worker-settings-before.json'));before=manifest.before;
  check(manifest.source===sourceSha&&manifest.base===base&&manifest.prefix===prefix,'Wrong checkpoint.');
  check(hash(JSON.stringify(state))===manifest.recordsHash&&hash(await readPrivate('db2.sql'))===manifest.dbHash&&hash(await readPrivate('worker-before.bin'))===manifest.workerHash,'Backup integrity failed.');
 }else{
  stage='read-only production preflight';before=await deployed();const raw=await rawWorker();
  await modulesMatch(raw,baseline,'baseline');
  const names=await applied();check(new Set(names).size===names.length&&names.every(n=>localMigrations.includes(n)),'Unknown migration history.');
  same(localMigrations.filter(n=>!names.includes(n)),[],'No migration may be pending for this release.');
  const columns=await columnsNow();
  check(['staff','employmentProfiles','employmentContracts','employmentEvents','staffRegistrationRequests','staffRegistrationState','staffRegistrationReviews','workDays','payrollMonths','payrollItems'].every(t=>columns[t]),'Required existing tables missing.');
  state={columns,data:await snapshot(columns),migrationRows:await rows('SELECT * FROM d1_migrations ORDER BY id')};
  settings=await cf('/workers/scripts/'+worker+'/settings');
  if(request.operation==='inspect'){
   same(before,await deployed(),'Concurrent deployment during inspection.');
   console.log(JSON.stringify({operation:'inspect',source:sourceSha,baseline:base,workerVersion:before.versionId,baselineModulesMatch:true,pendingMigrations:[],tablesChecked:Object.keys(columns).length,privateBucket:true,productionWrites:false}));
  }else{
   stage='verified private backup';
   runWrangler(source,['d1','export','DB2','--remote','--config','cf/wrangler.jsonc','--output',join(dir,'db2.sql')]);
   const sql=await readFile(join(dir,'db2.sql'));check(sql.length>100&&sql.includes(Buffer.from('CREATE TABLE')),'Empty database export.');
   await save('db2.sql',sql);await save('records-before.json',Buffer.from(JSON.stringify(state)));
   await save('worker-before.bin',raw.bytes);await save('worker-settings-before.json',Buffer.from(JSON.stringify(settings)));
   manifest={source:sourceSha,base,prefix,before,workerContentType:raw.type,workerHash:hash(raw.bytes),dbHash:hash(sql),recordsHash:hash(JSON.stringify(state))};
   await save('manifest-before.json',Buffer.from(JSON.stringify(manifest)));
   same(before,await deployed(),'Concurrent Worker deployment.');
   same(state.data,await snapshot(state.columns),'Records changed before publication; stop.');
   stage='publish reviewed Worker';
   try{runWrangler(source,['deploy','--config','cf/wrangler.jsonc','--keep-vars']);}
   catch{check((await deployed()).versionId!==before.versionId,'Publication failed before a new version was active.');console.log('CLI returned an error after publication; verifying without redeploy.');}
  }
 }
 if(request.operation!=='inspect'){
  stage='verify published Worker and records';const after=await deployed();check(after.versionId!==before.versionId,'No new active Worker.');
  await modulesMatch(await rawWorker(),source,'published');
  await assertUnchanged(state);
  const r=await fetch('https://stepwise-api.stepwise-edu.workers.dev/',{signal:AbortSignal.timeout(30000)}),health=await r.json();check(r.ok&&health.ok&&health.release===releaseLabel,'Public API health failed.');
  for(const route of ['employment/registration/submit','employment/registration/review','employment/bank/get','employment/bank/submit','employment/bank/review','employment/list','employment/get','employment/mine','employment/save','employment/invite','employment/contract/document','work/list','payroll/month','billing/plans/document','family/plans/document','admin/docs/sample']){
   const rr=await fetch('https://stepwise-api.stepwise-edu.workers.dev/v2/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});
   const bb=await rr.json();
   const expectedMissingDocument=route==='employment/contract/document'&&rr.status===404&&bb.error?.code==='notFound';
   check(bb.ok===false&&!bb.html&&(expectedMissingDocument||((rr.status===401||rr.status===403)&&['needLogin','forbidden'].includes(bb.error?.code))),'Anonymous access check failed for '+route+' (HTTP '+rr.status+').');
   console.log(JSON.stringify({route,httpStatus:rr.status,resultCode:bb.error?.code,documentReturned:false}));
  }
  const currentSettings=await cf('/workers/scripts/'+worker+'/settings');
  for(const key of ['bindings','compatibility_date','compatibility_flags','placement','observability']){
   const norm=x=>Array.isArray(x)?x.map(v=>JSON.stringify(v)).sort():x;
   same(norm(settings[key]),norm(currentSettings[key]),'Runtime setting changed: '+key);
  }
  const schedules=await cf('/workers/scripts/'+worker+'/schedules');same(schedules.schedules.map(s=>s.cron).sort(),['10 15 * * *'],'Production schedule changed.');
  check((await cf('/workers/scripts/'+worker+'/subdomain')).enabled,'Public Worker URL disabled.');
  const assets=[];
  if(request.operation==='pages'){
   stage='verify published assets';
   for(const path of ['staff/index.html','staff/app.js','staff/extras.js','staff/payroll.js','staff/employment.js']){
    const expected=(await readFile(join(source,path),'utf8')).replace(/\r\n/g,'\n').trim();
    const rr=await fetch('https://www.stepwise-education.jp/'+path+'?verify='+sourceSha,{cache:'no-store',signal:AbortSignal.timeout(30000)});
    check(rr.ok&&hash((await rr.text()).replace(/\r\n/g,'\n').trim())===hash(expected),'Public file mismatch: '+path);assets.push(path);
   }
  }
  same(after,await deployed(),'Concurrent deployment during verification.');
  const summary={source:sourceSha,operation:request.operation,backupPrefix:prefix,beforeVersion:before.versionId,workerVersion:after.versionId,privateBackupVerified:true,modulesMatch:true,migration:null,tablesChecked:Object.keys(state.columns).length,allExistingRecordsUnchanged:true,existingContractConsentPayrollRegistrationRecordsUnchanged:true,runtimeSettingsPreserved:true,anonymousRequestsReturnNoData:true,missingEmploymentDocumentReturns404:true,publicAssetsMatch:assets,termsActivated:false,messagesSent:false};
  await save('manifest-'+request.operation+'.json',Buffer.from(JSON.stringify({...manifest,after,summary})));
  console.log(JSON.stringify(summary));await writeFile(process.env.GITHUB_STEP_SUMMARY,'## Employment contract period release verified\n\n'+JSON.stringify(summary,null,2)+'\n');
 }
}catch(e){
 const msg=e instanceof Error&&!/https?:|Bearer|token=|password/i.test(e.message)?e.message:'Private details withheld.';
 console.error('Stopped at '+stage+': '+msg);console.error('No automatic rollback or retry. Inspect active Worker and private checkpoint.');process.exitCode=1;
}finally{if(dir)await rm(dir,{recursive:true,force:true});}
