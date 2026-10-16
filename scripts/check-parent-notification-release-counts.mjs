// Read the verified private pre-release snapshot; print counts only.
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {runWrangler,ensure} from './release-contract-system.mjs';
const dir=await mkdtemp(join(tmpdir(),'stepwise-notice-counts-'));
try {
 const prefix='stepwise-files/release-backups/parent-notifications-20261016/38871846414-1/';
 async function read(name){const file=join(dir,name);runWrangler(resolve('release-source'),['r2','object','get',prefix+name,'--file',file,'--remote','--config','cf/wrangler.jsonc']);return readFile(file);}
 const manifest=JSON.parse(await read('manifest-before.json')),data=JSON.parse(await read('contracts-before.json'));
 ensure(createHash('sha256').update(JSON.stringify(data)).digest('hex')===manifest.recordsHash,'Private snapshot hash mismatch.');

 const previousStudents=new Map(data.students.map(x=>{const s=JSON.parse(x);return[s.id,s];}));
 const previousPending=data.lessons.map(x=>JSON.parse(x)).filter(l=>l.status==='proposed'&&l.askedAt&&l.date>=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tokyo'}));
 const livePending=previousPending.filter(l=>!previousStudents.get(l.studentId)?.testOnly);
 const pendingSummary={all:previousPending.length,nonTest:livePending.length,test:previousPending.length-livePending.length,nonTestStudents:new Set(livePending.map(l=>l.studentId)).size};
 console.log(JSON.stringify({existingNoticesNeedingDeliveryReview:pendingSummary}));

 console.log(JSON.stringify({snapshotSource:manifest.source,productionWrites:false,messagesSent:false}));
}finally{await rm(dir,{recursive:true,force:true});}
