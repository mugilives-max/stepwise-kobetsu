// 送れなかったメール・カレンダーを見て、送り直す・取り下げる（教室管理者）。effects 表（effects.mjs）。
// 毎日の定期実行でも、失敗したものを 3 回まで送り直す（retryFailedEffects）。
import { fail, audit } from './util.mjs';
import { requireStaff } from './staff.mjs';
import { deliverEffects, recordEffects } from './effects.mjs';

const LABEL = { mail: 'メール', calendarCreate: 'カレンダーに予定を作る', calendarUpdate: 'カレンダーの予定を直す', calendarDelete: 'カレンダーの予定を消す', calendarMeet: 'Meet のリンク' };
const parse = s => { try { return JSON.parse(s) || {}; } catch { return {}; } };
const view = r => { const p = parse(r.payload); const body = p.body && typeof p.body === 'object' ? p.body : {};
  return { id: r.id, createdAt: r.createdAt, kind: r.kind, label: LABEL[r.kind] || r.kind, status: r.status, deliveryState: r.deliveryState, canRetry: !['unknown','sending'].includes(r.deliveryState), scheduleNotice: p.notice?.type === 'schedule', attempts: r.attempts, error: r.error, sentAt: r.sentAt,
    to: p.to || '', subject: p.subject || body.summary || '', audience: p.audience || '', held: !!p.held, testOnly: !!p.testOnly }; };
const STALE_MS = 10 * 60e3;

export const effectsAdminRoutes = {
  'admin/effects/resolve': async (c,b) => {
    await requireStaff(c,b,'manager');
    const note=String(b.note||'').trim();
    if(!['sent','notSent'].includes(b.result)||note.length<5) fail('needEvidence','送信先を確認した結果と、その根拠を書いてください');
    const row=await c.db.prepare("select * from effects where id = ? and deliveryState in ('unknown','sending')").bind(Number(b.id)).first();
    if(!row) fail('notFound','確認が必要な送信記録がありません',404);
    if(row.deliveryState==='sending' && Date.parse(row.createdAt)>c.now-10*60e3) fail('busy','送信の応答を待っています。10分後に確認してください',409);
    await c.db.prepare("update effects set status = ?, deliveryState = ?, deliveryKey = case when ? = 'notSent' then '' else deliveryKey end, error = ?, sentAt = ? where id = ?")
      .bind(b.result==='sent'?'sent':'failed',b.result==='sent'?'sent':'failed',b.result,'管理者確認：'+note,b.result==='sent'?new Date(c.now).toISOString():'',row.id).run();
    await audit(c,'effectsResolve',String(row.id),{result:b.result,note});
    return {};
  },

  // 直近 30 日。送れなかったもの（failed と、10 分以上たっても pending のもの）、送ったもの（最近 50 件）、送らなかったもの（切り替え前・テスト用）の数
  'admin/effects/list': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const since = new Date(c.now - 30 * 86400e3).toISOString(), stale = new Date(c.now - STALE_MS).toISOString();
    const rows = (await c.db.prepare('select id, createdAt, kind, payload, status, attempts, error, sentAt, deliveryState from effects where createdAt >= ? order by id desc limit 400').bind(since).all()).results;
    return {
      failed: rows.filter(r => r.status === 'failed' || (r.status === 'pending' && r.createdAt < stale)).map(view),
      recent: rows.filter(r => r.status === 'sent').slice(0, 50).map(view),
      dismissed: rows.filter(r => r.status === 'dismissed').length,
    };
  },
  // 送り直す（失敗したもの・止まっているものだけ）
  'admin/effects/retry': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 50);
    if (!ids.length) fail('needIds', '送り直すものを選んでください');
    const rows = (await c.db.prepare(`select * from effects where id in (${ids.map(() => '?').join(',')}) and status in ('failed', 'pending') and deliveryState not in ('unknown','sending') order by id`).bind(...ids).all()).results;
    if (!rows.length) fail('nothing', '送り直せるものがありません（もう送ったか、取り下げたものです）');
    const r = await deliverEffects(c.env, c.db, rows.map(x => ({ id: x.id, item: parse(x.payload) })));
    await audit(c, 'effectsRetry', '', { ids: rows.map(x => x.id), sent: r.sent, error: r.error || r.skipped || '' });
    if (r.skipped) fail('unavailable', '送る先（Apps Script）の設定がありません', 503);
    return { sent: r.sent, failed: r.failed, unknown: r.unknown, dismissed: r.dismissed, error: r.error || '' };
  },
  // テスト送信: 代表あてに 1 通送る（送る先の Apps Script を差し替えたときの確かめ）
  'admin/effects/test': async (c, b) => {
    const me = await requireStaff(c, b, 'manager');
    const item = { kind: 'mail', to: 'TEACHER', subject: '[ステップワイズ] 送信の確認', body: `${me.name} さんがスタッフ画面から送った確認のメールです。届いていれば、メールとカレンダーの送る先は生きています。\n送った時刻: ${new Date(c.now + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}`, audience: 'staff' };
    const queued = await recordEffects(c.db, [item], c.now);
    const r = await deliverEffects(c.env, c.db, queued);
    await audit(c, 'effectsTest', '', { sent: r.sent, error: r.error || r.skipped || '' });
    if (r.skipped) fail('unavailable', '送る先（Apps Script）の設定がありません', 503);
    if (!r.sent) fail('failed', '送れませんでした: ' + r.error, 502);
    return { sent: 1 };
  },
  // 取り下げる（もう要らないもの。送らない）
  'admin/effects/dismiss': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 50);
    if (!ids.length) fail('needIds', '取り下げるものを選んでください');
    const r = await c.db.prepare(`update effects set status = 'dismissed', error = '教室管理者が取り下げ' where id in (${ids.map(() => '?').join(',')}) and status in ('failed', 'pending')`).bind(...ids).run();
    await audit(c, 'effectsDismiss', '', { ids });
    return { dismissed: Number(r.meta && r.meta.changes) || 0 };
  },
};

// 定期実行: 48 時間以内に失敗したものを、3 回まで送り直す
export async function retryFailedEffects(env, db, now) {
  const since = new Date(now - 48 * 3600e3).toISOString(), stale = new Date(now - STALE_MS).toISOString();
  // 失敗したものと、送る途中で止まったもの（応答のあとの送信が切れた・Apps Script が遅かった）。2026-10-11 に 10 分より前の pending を足した
  const rows = (await db.prepare("select * from effects where attempts < 3 and deliveryState not in ('unknown','sending') and createdAt >= ? and (status = 'failed' or (status = 'pending' and createdAt < ?)) order by id limit 50").bind(since, stale).all()).results;
  if (!rows.length) return { retried: 0, sent: 0 };
  const r = await deliverEffects(env, db, rows.map(x => ({ id: x.id, item: parse(x.payload) })));
  return { retried: rows.length, sent: r.sent };
}
// 止まったままの送信を、次の誰かの操作のついでに送る（応答のあとの送信は、deploy や Apps Script の遅さで切れることがある。2026-10-11）
// 3 分より前の pending に「送っている途中」の印（error 欄）を付けてから送る（同時に 2 回送らないため。status の CHECK に新しい値を足さずに済む）。
// 印のまま 10 分たったものは夜の送り直しが拾う
export const SWEEP_AFTER_MS = 3 * 60e3, SWEEPING = '送っている途中';
export async function sweepStaleEffects(env, db, now) {
  if (!env.GAS_URL || !env.SYNC_KEY) return { swept: 0 };
  const before = new Date(now - SWEEP_AFTER_MS).toISOString();
  const rows = (await db.prepare("select * from effects where status = 'pending' and error = '' and deliveryState not in ('unknown','sending') and attempts < 3 and createdAt < ? order by id limit 5").bind(before).all()).results;
  const mine = [];
  for (const x of rows) { const r = await db.prepare("update effects set error = ? where id = ? and status = 'pending' and error = ''").bind(SWEEPING, x.id).run(); if (r.meta && r.meta.changes) mine.push({ id: x.id, item: parse(x.payload) }); }
  if (!mine.length) return { swept: 0 };
  const r = await deliverEffects(env, db, mine);
  return { swept: mine.length, sent: r.sent, error: r.error || '' };
}
// 送れなかったものの数（「今日」の対応することに出す）
export async function failedEffectsCount(db, now) {
  const since = new Date(now - 30 * 86400e3).toISOString(), stale = new Date(now - STALE_MS).toISOString();
  const r = await db.prepare("select count(*) n from effects where createdAt >= ? and (status = 'failed' or (status = 'pending' and createdAt < ?))").bind(since, stale).first();
  return r ? Number(r.n) : 0;
}
