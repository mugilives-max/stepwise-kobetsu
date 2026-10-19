// 検証環境（ステージング）を作る準備: 画面のファイルと、最初の状態の控え（スナップショット）を cf/staging/ に置く。
//   node scripts/build-staging.mjs
// - 画面: staff・family・student・assets・terms をそのまま cf/staging/public/ へ写し、各画面の HTML に検証環境の帯（staging-bar.js）を足す。
// - 最初の状態: scripts/demo-seed.mjs の架空のデータをメモリの台帳で作り、表ごとの行（INSERT 文）・トリガー・ファイル（R2）を
//   cf/staging/snapshot.json に書く。検証環境の「最初の状態に戻す」はこれを入れ直す（cf/staging/index.mjs）。
// どちらも生成物なので Git には入れない（.gitignore）。本番のデータには一切触れない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from './demo-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'cf', 'staging'), PUB = path.join(OUT, 'public');

// ---- 画面のファイル ----
fs.mkdirSync(PUB, { recursive: true });
for (const e of fs.readdirSync(PUB)) fs.rmSync(path.join(PUB, e), { recursive: true, force: true }); // フォルダごとは消さない（手元の wrangler dev が見ているため）
for (const dir of ['staff', 'family', 'student', 'assets', 'terms']) fs.cpSync(path.join(ROOT, dir), path.join(PUB, dir), { recursive: true });
for (const f of ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(ROOT, f), path.join(PUB, f));
fs.copyFileSync(path.join(OUT, 'bar.js'), path.join(PUB, 'staging-bar.js'));
fs.copyFileSync(path.join(OUT, 'home.html'), path.join(PUB, 'index.html'));
const stamp = Date.now().toString(36);
for (const page of ['staff', 'family', 'student']) {
  const f = path.join(PUB, page, 'index.html');
  const html = fs.readFileSync(f, 'utf8');
  if (!html.includes('</body>')) throw new Error('no </body> in ' + page);
  fs.writeFileSync(f, html.replace('<title>', '<title>【検証】').replace('</body>', `  <script src="/staging-bar.js?v=${stamp}" defer></script>\n</body>`));
}

// ---- 最初の状態 ----
const { h, k, kh } = await seed({ live: true });
const db = h.db2._sqlite;
// 入れ直さない表（ログイン・送信の記録・プレビュー・招待のリンクは、最初の状態では空にする）
const EMPTY = new Set(['sessions', 'effects', 'previewSessions', 'authChallenges']);
const tables = db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%' and name <> 'd1_migrations' order by rowid").all().map(r => r.name);
// 親の表を先に（外部キー）。消すときは逆の順
const deps = Object.fromEntries(tables.map(t => [t, db.prepare(`pragma foreign_key_list("${t}")`).all().map(r => r.table).filter(x => x !== t && tables.includes(x))]));
const order = [], seen = new Set();
const visit = (t, stack = new Set()) => { if (seen.has(t)) return; if (stack.has(t)) throw new Error('circular foreign keys at ' + t); stack.add(t); for (const d of deps[t]) visit(d, stack); seen.add(t); order.push(t); };
for (const t of tables) visit(t);
const lit = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? "X'" + Buffer.from(v).toString('hex') + "'" : "'" + String(v).replaceAll("'", "''") + "'";
const inserts = [], LIMIT = 60000;
for (const t of order) {
  if (EMPTY.has(t)) continue;
  const rows = db.prepare(`select * from "${t}"`).all(); if (!rows.length) continue;
  const cols = Object.keys(rows[0]), head = `INSERT INTO "${t}" (${cols.map(c => '"' + c + '"').join(', ')}) VALUES `;
  let chunk = [];
  const flush = () => { if (chunk.length) inserts.push(head + chunk.join(', ')); chunk = []; };
  for (const r of rows) {
    const v = '(' + cols.map(c => lit(r[c])).join(', ') + ')';
    if (head.length + chunk.join(', ').length + v.length > LIMIT) flush();
    chunk.push(v);
  }
  flush();
}
const triggers = db.prepare("select name, sql from sqlite_master where type = 'trigger' order by rowid").all();
const files = [...h.env.FILES._m.entries()].map(([key, x]) => ({ key, b64: Buffer.from(x.b).toString('base64'), httpMetadata: (x.o && x.o.httpMetadata) || {}, customMetadata: (x.o && x.o.customMetadata) || {} }));
const snapshot = { builtAt: new Date().toISOString(), order, triggers, inserts, files, links: { taro: k, hana: kh } };
fs.writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify(snapshot));
console.log(JSON.stringify({ tables: order.length, inserts: inserts.length, triggers: triggers.length, files: files.length, bytes: fs.statSync(path.join(OUT, 'snapshot.json')).size }));
