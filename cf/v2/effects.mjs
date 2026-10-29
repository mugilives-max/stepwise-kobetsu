// Durable per-item delivery. Unknown results never enter automatic retry.
import { newId } from './util.mjs';
import { currentNotice, scheduleDelivery } from './notice-policy.mjs';
import { mailAttachment } from './files.mjs';
const skipReason = e => e.testOnly ? 'テスト用のため送らない' : e.held ? 'まだ切り替え前のため送らない' : '';
// カレンダーの送信で Apps Script が「ロックのタイムアウト」を返したとき（2026-10-27・10-29 の 2 件）。設定を読むところで止まり、予定は作っていない。
// 結果不明のまま放っておかず、未送信として自動で送り直す（2026-10-29 本人「この送れなかったやつをそのまま放置されるシステムどうにかならないかな」）
export const LOCK_BUSY = 'Google の処理が混み合って送れませんでした（未送信。自動で送り直します）';
export const isLockTimeout = (item,err) => String(item?.kind||'').startsWith('calendar') && /ロックのタイムアウト|lock timeout|timed out waiting for lock/i.test(String(err||''));
export async function recordEffects(db,items,now) {
  if (!items.length) return [];
  const at=new Date(now).toISOString();
  const rows=await db.batch(items.map(e=>db.prepare('insert into effects (createdAt,kind,payload,status,error,deliveryKey) values (?,?,?,?,?,?)')
    .bind(at,e.kind,JSON.stringify(e),skipReason(e)?'dismissed':'pending',skipReason(e),newId('delivery'))));
  return rows.map((r,i)=>({id:Number(r.meta?.last_row_id)||0,item:items[i]})).filter(x=>!skipReason(x.item));
}
export async function deliverEffects(env,db,queued,fetcher=fetch,now=Date.now()) {
  if (!queued.length) return {sent:0,failed:0,unknown:0};
  if (!env.GAS_URL || !env.SYNC_KEY) {
    for (const q of queued) await scheduleDelivery(db,q.item,'hold',new Date(now).toISOString());
    return {sent:0,failed:0,skipped:'GAS_URL / SYNC_KEY が未設定'};
  }
  const mine=[]; let dismissed=0,blocked=0;
  for (const q of queued) {
    if(q.item.notice?.type==='schedule') {
      let hold=false;
      for(const t of q.item.notice.targets||[]) if(await db.prepare("select 1 from lessons where id = ? and askedAt = ? and noticeState = 'hold'").bind(t.id,t.askedAt).first())hold=true;
      if(hold){blocked++;continue;}
    }
    if (!(await currentNotice(db,q.item,now))) {
      await db.prepare("update effects set status = 'dismissed', error = '対象が変更・完了・取消し済み、または送信対象外' where id = ? and status in ('pending','failed') and deliveryState not in ('unknown','sending')").bind(q.id).run();
      dismissed++; continue;
    }
    const key=newId('delivery');
    const r=await db.prepare("update effects set deliveryState = 'sending', deliveryKey = case when deliveryKey = '' then ? else deliveryKey end, attempts = attempts + 1, attemptAt = ? where id = ? and status in ('pending','failed') and deliveryState not in ('unknown','sending') and error <> '送っている途中'")
      .bind(key,new Date(now).toISOString(),q.id).run();
    if (r.meta?.changes) { const row=await db.prepare('select deliveryKey from effects where id = ?').bind(q.id).first(); mine.push({...q,key:row.deliveryKey}); }
  }
  let sent=0,failed=0,unknown=0,error='';
  // Relay limit is 50. Every item keeps the same durable key across safe retries.
  for (let start=0;start<mine.length;start+=50) {
    const batch=mine.slice(start,start+50); let payload=null,transport='';
    const attached=await Promise.all(batch.map(async q=>q.item.kind==='mail'&&Array.isArray(q.item.attachFiles)?(await Promise.all(q.item.attachFiles.slice(0,3).map(id=>mailAttachment(env,db,id).catch(()=>null)))).filter(Boolean):null));
    try {
      const res=await fetcher(env.GAS_URL,{method:'POST',headers:{'Content-Type':'application/json'},redirect:'follow',
        body:JSON.stringify({action:'effects',key:env.SYNC_KEY,items:batch.map((q,i)=>{const {testOnly,audience,held,notice,attachFiles,...item}=q.item;return {...item,...(attached[i]&&attached[i].length?{attachments:[...(item.attachments||[]),...attached[i]]}:{}),deliveryId:q.key};})})});
      payload=await res.json().catch(()=>null);
      if (!res.ok || !payload || payload.error) transport=payload?.error||'HTTP '+res.status;
    } catch(err) { transport=String(err?.message||err); }
    const backs=payload?.writebacks||[];
    for (const table of ['lessons','meetings']) for (const w of backs) if (w.marker && w.eventId) await db.prepare('update '+table+" set calendarEventId = ?, meetUrl = case when ? <> '' then ? else meetUrl end where calendarEventId = ? or calendarEventId = ? || '@google.com'")
      .bind(String(w.eventId),String(w.meetUrl||''),String(w.meetUrl||''),String(w.marker),String(w.marker)).run();
    for (const q of batch) {
      const matches=(payload?.results||[]).filter(r=>r.id===q.key);
      let state='unknown',err=transport||'通知単位の送信結果を確認できません。再送前に送信先を確認してください';
      if (!transport && matches.length===1 && ['sent','failed','unknown'].includes(matches[0].status)) {state=matches[0].status;err=matches[0].error||'';}
      // Legacy relay: only an unambiguous complete success or a single identified failure is usable.
      else if (!transport && !Array.isArray(payload?.results)) {
        const fs=payload?.failed||[];
        if (!fs.length && payload?.done===batch.length) {state='sent';err='';}
        else if (batch.length===1 && fs.length===1 && fs[0].kind===q.item.kind) {state=q.item.kind==='mail'?'unknown':'failed';err=fs[0].error||'送信に失敗しました';}
      }
      if (q.item.kind==='calendarCreate' && state==='sent' && !backs.some(w=>w.marker===q.item.marker)) {state='failed';err='カレンダーの予定 ID が返りませんでした';}
      if (state==='unknown' && isLockTimeout(q.item,err)) {state='failed';err=LOCK_BUSY;await db.prepare("update effects set deliveryKey = '' where id = ?").bind(q.id).run();}
      const at=new Date(now).toISOString();
      await db.prepare("update effects set status = ?, deliveryState = ?, error = ?, sentAt = ? where id = ? and deliveryState = 'sending'")
        .bind(state==='sent'?'sent':'failed',state,err.slice(0,300),state==='sent'?at:'',q.id).run();
      await scheduleDelivery(db,q.item,state,at);
      // 雇用契約書のメール（本人がメールでの受け取りを希望）が送れたら、その時刻で交付を記録する。発行した同じ版だけ
      const cd=q.item.contractDelivery;
      if(state==='sent'&&cd?.id){
       const u=await db.prepare("update employmentContracts set deliveredAt=?,deliveryNote=?,updatedAt=?,version=version+1 where id=? and status='issued' and deliveredAt='' and contentHash=? and method='electronic'")
        .bind(at,'システムのメールで契約書の全文を '+String(cd.recipient||'')+' へ送付',at,String(cd.id),String(cd.hash||'')).run();
       if(u.meta?.changes)await db.prepare("insert or ignore into employmentEvents(contractId,action,actualAt,recordedAt,actorId,actorName,detail,contractVersion) select id,'交付を記録',?,?,'system','システム',?,version from employmentContracts where id=?")
        .bind(at,at,JSON.stringify({method:'electronic',recipient:String(cd.recipient||''),note:'システムのメールで送付'}),String(cd.id)).run();
      }
      if(state==='sent')sent++;else if(state==='unknown')unknown++;else failed++;
      if(err)error=err;
    }
  }
  return {sent,failed,unknown,dismissed,blocked,error};
}
