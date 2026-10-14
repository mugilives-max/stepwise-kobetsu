// メール・カレンダーの控え（v2 の effects 表）。応答を返したあとで Apps Script に頼む。
// 頼み方（action=effects、items の形）は今の仕組み（cf/worker/write.mjs の deliverEffects）と同じ。
// 次のものは実際には送らず、送らなかったことと理由を記録する。
// - テスト用の家族・スタッフあて（testOnly）
// - 切り替え前の保護者あて（held）
const skipReason = e => e.testOnly ? 'テスト用のため送らない' : e.held ? 'まだ切り替え前のため送らない' : '';
export async function recordEffects(db, items, now) {
  if (!items.length) return [];
  const at = new Date(now).toISOString();
  const rows = await db.batch(items.map(e => db.prepare('insert into effects (createdAt, kind, payload, status, error) values (?, ?, ?, ?, ?)')
    .bind(at, e.kind, JSON.stringify(e), skipReason(e) ? 'dismissed' : 'pending', skipReason(e))));
  return rows.map((r, i) => ({ id: Number(r.meta && r.meta.last_row_id) || 0, item: items[i] })).filter(x => !skipReason(x.item));
}

export async function deliverEffects(env, db, queued, fetcher = fetch) {
  if (!queued.length) return { sent: 0 };
  if (!env.GAS_URL || !env.SYNC_KEY) return { sent: 0, skipped: 'GAS_URL / SYNC_KEY が未設定' };
  let error = '', payload = null;
  try {
    const res = await fetcher(env.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'follow',
      body: JSON.stringify({ action: 'effects', key: env.SYNC_KEY, items: queued.map(q => { const { testOnly, audience, held, ...item } = q.item; return item; }) }) });
    payload = await res.json().catch(() => null);
    if (!res.ok || !payload || payload.error) error = (payload && payload.error) || ('HTTP ' + res.status);
  } catch (e) { error = String((e && e.message) || e); }
  // カレンダーの仮の目印 → 本物の予定 ID と Meet の URL を、授業・面談に書き戻す（Meet は取れたときだけ）
  const writebacks = payload && Array.isArray(payload.writebacks) ? payload.writebacks : [];
  for (const table of ['lessons', 'meetings']) if (writebacks.length) await db.batch(writebacks.map(w => db.prepare(`update ${table} set calendarEventId = ?, meetUrl = case when ? <> '' then ? else meetUrl end where calendarEventId = ? or calendarEventId = ? || '@google.com'`)
    .bind(String(w.eventId || ''), String(w.meetUrl || ''), String(w.meetUrl || ''), String(w.marker || ''), String(w.marker || ''))));
  // 予定を作る頼みは、その目印の書き戻しが返ってきたときだけ「送れた」。返ってこなければ（作成を断られた・設定が off など）失敗として残す。
  // Apps Script は項目ごとの失敗を failed に入れて、全体は ok を返す（gas/Sync.gs effectsOp_）。どの項目かは分からないので、カレンダーの失敗の文を添える
  const backs = new Set(writebacks.map(w => String(w.marker || '')));
  const calFailed = (payload && Array.isArray(payload.failed) ? payload.failed : []).filter(f => /^calendar/.test(String(f && f.kind || ''))).map(f => String(f.error || '')).filter(Boolean);
  const itemError = q => error || (q.item.kind === 'calendarCreate' && !backs.has(String(q.item.marker || ''))
    ? 'カレンダーに予定ができませんでした（' + (calFailed[0] || '予定の ID が返ってきませんでした') + '）' : '');
  const at = new Date().toISOString();
  await db.batch(queued.map(q => { const e = itemError(q); return db.prepare('update effects set status = ?, attempts = attempts + 1, error = ?, sentAt = ? where id = ?')
    .bind(e ? 'failed' : 'sent', e.slice(0, 300), e ? '' : at, q.id); }));
  const failed = queued.filter(q => itemError(q)).length;
  return { sent: queued.length - failed, failed, error };
}
