// Notification validity is checked again immediately before delivery/retry.
import { iso } from './util.mjs';
export async function currentNotice(db, item, now = Date.now()) {
  if (item.testOnly || item.held) return false;
  const n = item.notice;
  if (!n) return true; // Legacy records are retained; never bulk-replay old sent records.
  if (n.type === 'challenge') {
    return !!(await db.prepare("select 1 from authChallenges where id = ? and usedAt = '' and expiresAt > ?").bind(n.id,iso(now)).first());
  }
  const tables = {plan:'planLines',condition:'conditions',special:'specials',invoice:'invoices',fee:'cancellationFees',schedule:'lessons',lesson:'lessons',invoiceVoid:'invoices'};
  const table = tables[n.type]; if (!table) return false;
  for (const t of n.targets || []) {
    const r = await db.prepare('select * from '+table+' where id = ?').bind(t.id).first();
    if (!r) return false;
    if(item.audience==='family') {
      const family = r.familyId ? await db.prepare('select * from families where id = ?').bind(r.familyId).first() :
        await db.prepare('select f.* from families f join students s on s.familyId=f.id where s.id = ?').bind(r.studentId).first();
      if(!family || family.status!=='active' || family.email!==item.to)return false;
    }
    if (n.type === 'schedule') {
      if (r.status !== 'proposed' || r.askedAt !== t.askedAt || (t.noticeId && r.noticeId!==t.noticeId) || Date.parse(r.date+'T'+r.start+':00+09:00') <= now) return false;
    } else if (['plan','condition','special'].includes(n.type)) {
      if (r.status !== 'proposed' || Number(r.version) !== Number(t.version)) return false;
    } else if (n.type === 'invoice' && !['confirmed','reported'].includes(r.status)) return false;
    else if (n.type === 'invoiceVoid' && r.status !== 'void') return false;
    else if (t.version && Number(r.version) !== Number(t.version)) return false;
  }
  return true;
}
export async function scheduleDelivery(db,item,state,at) {
  if (item.notice?.type !== 'schedule') return;
  for (const t of item.notice.targets || []) {
    // A failure permanently holds this notice. Automatic retry cannot silently restore its old deadline.
    await db.prepare("update lessons set noticeState = case when noticeState = 'hold' then 'hold' else ? end, noticeAt = case when ? = 'sent' and noticeState <> 'hold' then ? else noticeAt end where id = ? and askedAt = ? and status = 'proposed' and noticeId = ?")
      .bind(state === 'sent' ? 'sent' : 'hold',state,at,t.id,t.askedAt,t.noticeId||'').run();
  }
}
