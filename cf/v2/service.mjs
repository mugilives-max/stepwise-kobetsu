// 外のサービス（MCP など）からの読み取り用の鍵。本文の serviceKey が Worker の Secret `V2_SERVICE_KEY` と一致したとき、
// 代表（owner）のスタッフとして「読むだけ」の操作を通す（SERVICE_READS）。書き込みは断る。
// 鍵は Cloudflare の Secret にだけ置く（文書・Git・チャットに書かない）。
import { sha256Hex } from './util.mjs';

export const SERVICE_READS = new Set([
  'students/list', 'students/hub', 'schedule/staff/range', 'home/today', 'monthly/overview',
  'billing/month', 'billing/family', 'billing/plans/list', 'billing/fees/list',
  'records/pending', 'homework/reported', 'grades/overview', 'grades/student',
  'admin/families/list', 'admin/families/get', 'admin/effects/list', 'admin/terms/get','admin/backup/list','admin/conditions/get','admin/specials/get','admin/docs/sample', 'payroll/month',
]);
const same = (a, b) => a.length === b.length && sha256Hex(a) === sha256Hex(b); // 長さの違いで落ちる以外は時間が一定
// 鍵が合えば代表のスタッフの行、合わなければ null。鍵が設定されていなければ null
export async function serviceActor(c, key) {
  const expected = String(c.env.V2_SERVICE_KEY || '');
  if (expected.length < 32 || typeof key !== 'string' || !same(key, expected)) return null;
  const who = await c.db.prepare("select * from staff where status = 'active' and (contractType = 'owner' or roles like '%manager%') order by contractType = 'owner' desc, createdAt limit 1").first();
  return who || null;
}

// 書き込み用の鍵（V2_SERVICE_WRITE_KEY。読み取りの鍵とは別）。mcp/ の道（cf/v2/mcp-writes.mjs の SERVICE_WRITES）だけを、代表のスタッフとして通す。
// 鍵が設定されていなければ書き込みは誰にもできない。対象は V2_SERVICE_WRITE_SCOPE が 'all' でなければテスト用の生徒だけ。
export async function serviceWriteActor(c, key) {
  const expected = String(c.env.V2_SERVICE_WRITE_KEY || '');
  if (expected.length < 32 || typeof key !== 'string' || !same(key, expected)) return null;
  if (expected === String(c.env.V2_SERVICE_KEY || '')) return null; // 読み取りの鍵と同じ値なら通さない（読み取りの鍵を書き込みに上げない）
  const who = await c.db.prepare("select * from staff where status = 'active' and (contractType = 'owner' or roles like '%manager%') order by contractType = 'owner' desc, createdAt limit 1").first();
  return who || null;
}
