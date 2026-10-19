// 作り直し（v2）の画面を、本番に触れずに手元で見るための小さなサーバー。
// 新しい台帳（DB2）と今の台帳（DB）をメモリの SQLite で用意し（test/helpers と同じ）、架空の家族・生徒・授業・記録・計画・請求を入れて、
// 画面（/family/・/student/・/staff/）と API（POST /v2/…）を同じ場所から出す。
//   node scripts/dev-v2-preview.mjs            → http://localhost:8790/family/ （ログイン: parent@example.invalid / family password 1）
//   node scripts/dev-v2-preview.mjs --live     → 切り替えたあとの状態（「準備中」の案内を出さない）
// 生徒のマイページは起動時に出るリンク（/student/?k=…）。スタッフは owner@example.invalid / correct horse battery。初回登録を試す講師は teacher-new@example.invalid / teacher password 1。
// 本番のデータ・メール・カレンダーには一切つながらない。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from './demo-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8790), LIVE = process.argv.includes('--live');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const { h, k, kh } = await seed({ live: LIVE });
if (process.env.V2_SERVICE_KEY) h.env.V2_SERVICE_KEY = process.env.V2_SERVICE_KEY; // MCP の読み取りの鍵を試すとき
if (process.env.V2_SERVICE_WRITE_KEY) h.env.V2_SERVICE_WRITE_KEY = process.env.V2_SERVICE_WRITE_KEY; // MCP の書き込みの鍵を試すとき（mcp/ の道だけ）
if (process.env.V2_SERVICE_WRITE_SCOPE) h.env.V2_SERVICE_WRITE_SCOPE = process.env.V2_SERVICE_WRITE_SCOPE;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  h.clock = Date.now();
  if (url.pathname.startsWith('/v2/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    let out;
    if (req.method === 'POST' && (req.headers['content-type'] || '').includes('json') || (req.method === 'POST' && body.length && body[0] === 0x7b)) {
      let b = {}; try { b = JSON.parse(body.toString('utf8') || '{}'); } catch {}
      const r = await h.call(url.pathname.slice(4), b);
      const { status, ...rest } = r;
      res.writeHead(status || 200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(rest));
    }
    out = await h.raw(req.method, url.pathname.slice(4) + url.search, body.length ? body : undefined);
    res.writeHead(out.status, Object.fromEntries(out.headers)); return res.end(Buffer.from(await out.arrayBuffer()));
  }
  if (url.pathname === '/' && !(req.headers.accept || '').includes('text/html')) {
    const live = h.rows("select value from settings where key = 'live'")[0];
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'stepwise-api', release: 'preview', cutover: { live: !!live && live.value === '1', oldReadOnlySince: '' } }));
  }
  let p = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
server.listen(PORT, () => {
  console.log(`v2 preview: http://localhost:${PORT}/family/  (parent@example.invalid / family password 1)${LIVE ? '  [live]' : ''}`);
  console.log(`student (太郎): http://localhost:${PORT}/student/?k=${encodeURIComponent(k)}`);
  console.log(`student (花):   http://localhost:${PORT}/student/?k=${encodeURIComponent(kh)}`);
  console.log(`staff: http://localhost:${PORT}/staff/  (owner@example.invalid / correct horse battery)`);
  console.log(`staff (新しい講師・初回登録): http://localhost:${PORT}/staff/  (teacher-new@example.invalid / teacher password 1)`);
});
