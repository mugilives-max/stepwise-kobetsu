// 台帳の控え（D1 → R2）。毎日の定期実行（runV2Scheduled）で、DB2 の全表を 1 つの JSON にして R2（FILES）の backup/<日付>.json に置く。
// - 守るもの: D1 の巻き戻し（30 日）を過ぎてから気づく間違い。同じ Cloudflare のアカウントの中なので、アカウントごとの事故は
//   ドライブへの週次の写し（gas-effects の weeklyBackup が backup/drive を取りに来る）で守る（issues/stepwise-v2-backup.md）。
// - 90 日より古い控えは消す。鍵は backup/ で始まり、files 表には載らないので、files/get からは開けない（教室管理者が admin/backup/list で見る）。
// - 教室管理者は admin/backup/run でいつでも取れる（切り替えや移行の前に）。
import { fail, audit } from './util.mjs';
import { requireStaff } from './staff.mjs';

export const BACKUP_PREFIX = 'backup/';
export const KEEP_DAYS = 90;
export const jstDate = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

export async function listTables(db) {
  const { results } = await db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'd1_%' and name not like '_cf_%' order by name").all();
  return results.map(r => r.name);
}

// 全表をそのまま（行の配列）。D1 は 1 回の応答が大きすぎると断るので、表ごとに取る
export async function snapshot(db, now) {
  const tables = {}; let rows = 0;
  for (const name of await listTables(db)) { const r = (await db.prepare(`select * from "${name}"`).all()).results; tables[name] = r; rows += r.length; }
  return { takenAt: new Date(now).toISOString(), tables, rows };
}

export async function backupToR2(env, db, now) {
  if (!env.FILES) return { skipped: 'FILES が未設定' };
  const snap = await snapshot(db, now);
  const key = BACKUP_PREFIX + jstDate(now) + '.json';
  const counts = Object.fromEntries(Object.entries(snap.tables).map(([k, v]) => [k, v.length]));
  const body = new TextEncoder().encode(JSON.stringify({ takenAt: snap.takenAt, counts, tables: snap.tables })); // バイト数で数える（日本語は 1 文字 3 バイト）
  await env.FILES.put(key, body, { httpMetadata: { contentType: 'application/json' }, customMetadata: { takenAt: snap.takenAt, rows: String(snap.rows) } });
  const removed = await prune(env, now);
  return { key, tables: Object.keys(snap.tables).length, rows: snap.rows, bytes: body.length, removed };
}

async function prune(env, now) {
  const cutoff = BACKUP_PREFIX + jstDate(now - KEEP_DAYS * 86400e3) + '.json'; let removed = 0;
  for (const o of await listBackups(env)) if (o.key < cutoff) { await env.FILES.delete(o.key); removed++; }
  return removed;
}

export async function listBackups(env) {
  if (!env.FILES) return [];
  const out = []; let cursor;
  do {
    const r = await env.FILES.list({ prefix: BACKUP_PREFIX, cursor, include: ['customMetadata'] }); // 行数は customMetadata に持つ（頼まないと返ってこない）
    for (const o of r.objects) out.push({ key: o.key, date: o.key.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + 10), size: o.size, rows: Number((o.customMetadata || {}).rows || 0) || 0 });
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => (a.key < b.key ? 1 : -1)); // 新しい順
}

// 画面に出す形: 最新の日付、何日分、古すぎないか（2 日以上たっていたら注意）
export async function backupStatus(env, now) {
  const list = await listBackups(env);
  const latest = list[0] || null;
  const stale = !latest || latest.date < jstDate(now - 2 * 86400e3);
  const at = await driveAt(env.DB2);
  return { latest, count: list.length, keepDays: KEEP_DAYS, stale, recent: list.slice(0, 7), drive: { date: at ? jstDate(Date.parse(at)) : '', stale: !at || now - Date.parse(at) >= DRIVE_STALE_DAYS * 86400e3 } };
}

// ---- ドライブへの週次の写し（Cloudflare の外の控え。2026-11-05 本人） ----
// 本人のドライブに置くので、それだけで人になりすませる値と講師の口座番号は外す（全部入りは R2 の毎日の控えにある）。
// ログイン中の情報の表は写さず、次の欄は空にする。メールの本文にはログインや招待のリンクが入る。
const DRIVE_SKIP_TABLES = new Set(['sessions', 'authChallenges', 'fileTokens', 'previewSessions']);
const DRIVE_BLANK = { staff: ['passHash', 'passSalt'], families: ['passHash', 'passSalt'], students: ['linkCode'], staffBankRequests: ['contentHash'], effects: ['payload'] };
const DRIVE_STALE_DAYS = 9; // 週 1 回なので、9 日あいたら止まっている
export function forDrive(tables) {
  const out = {};
  for (const [name, rows] of Object.entries(tables)) {
    if (DRIVE_SKIP_TABLES.has(name)) continue;
    out[name] = rows.map(r => {
      const row = { ...r };
      for (const col of DRIVE_BLANK[name] || []) if (col in row) row[col] = '';
      if (name === 'staffBankRequests') row.account = withoutNumber(row.account);
      return row;
    });
  }
  return out;
}
const withoutNumber = v => { try { const a = JSON.parse(v); delete a.accountNumber; return JSON.stringify(a); } catch { return ''; } };
async function driveAt(db) {
  if (!db) return '';
  const r = await db.prepare("select value from settings where key = 'driveBackupAt'").first();
  return r ? String(r.value || '') : '';
}
// 鍵は Worker の SYNC_KEY。Apps Script の WORKER_SYNC_KEY と同じもの。ログインでは取れない
function driveKey(c, b) {
  const want = String(c.env.SYNC_KEY || ''), got = String(b.key || '');
  let diff = want.length >= 24 && got.length === want.length ? 0 : 1;
  for (let i = 0; i < want.length && i < got.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  if (diff) fail('badKey', '鍵が正しくありません', 403);
}
function base64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 24576) out += btoa(String.fromCharCode(...bytes.subarray(i, i + 24576))); // 3 の倍数で区切ると、つないでも正しい
  return out;
}
// 控えが止まったら代表に知らせる。毎日の控えは失敗した日ごと、ドライブは止まって 9 日目から 3 日おき
export async function backupAlerts(c, backup) {
  const lines = [];
  if (!backup || backup.error || backup.skipped) lines.push('毎日の台帳の控えが取れませんでした。');
  const at = await driveAt(c.db), days = at ? Math.floor((c.now - Date.parse(at)) / 86400e3) : 0;
  if (days >= DRIVE_STALE_DAYS && (days - DRIVE_STALE_DAYS) % 3 === 0) lines.push(`ドライブへの週次の控えが ${days} 日止まっています。`);
  if (lines.length) c.effects.push({ kind: 'mail', to: 'TEACHER', subject: '[ステップワイズ] 台帳の控えが止まっています', body: `${lines.join('\n')}\n\nスタッフ画面の 設定 → 送信の記録と控え で状態を確かめてください。` });
  return lines.length;
}

export const backupRoutes = {
  'backup/drive': async (c, b) => {
    driveKey(c, b);
    const snap = await snapshot(c.db, c.now);
    const files = (await c.db.prepare("select id, name, mime, size, sha256 from files where status = 'ready' order by createdAt").all()).results;
    return { takenAt: snap.takenAt, tables: forDrive(snap.tables), files };
  },
  'backup/drive/file': async (c, b) => {
    driveKey(c, b);
    const o = await c.env.FILES.get('f/' + String(b.id || ''));
    if (!o) fail('notFound', 'ファイルが見つかりません', 404);
    return { base64: base64(new Uint8Array(await new Response(o.body).arrayBuffer())) };
  },
  'backup/drive/done': async (c, b) => {
    driveKey(c, b);
    const at = new Date(c.now).toISOString();
    await c.db.prepare("insert into settings (key, value, updatedAt) values ('driveBackupAt', ?, ?) on conflict(key) do update set value = excluded.value, updatedAt = excluded.updatedAt").bind(at, at).run();
    await audit(c, 'driveBackup', '', { files: Number(b.files) || 0, left: Number(b.left) || 0 });
    return {};
  },
  'admin/backup/list': async (c, b) => { await requireStaff(c, b, 'manager'); return backupStatus(c.env, c.now); },
  'admin/backup/run': async (c, b) => {
    await requireStaff(c, b, 'manager');
    const r = await backupToR2(c.env, c.db, c.now);
    if (r.skipped) fail('unavailable', r.skipped, 503);
    await audit(c, 'backupRun', '', { key: r.key, rows: r.rows, bytes: r.bytes });
    return r;
  },
};
