'use strict';
// gas-effects の weeklyBackup: 台帳の JSON を置き、まだ無いファイルだけを足し、壊れたファイルは置かない
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const source = fs.readFileSync('gas-effects/Code.gs', 'utf8');
const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
function folder(name) {
  const f = { name, folders: [], files: [], getFoldersByName: n => iter(f.folders.filter(x => x.name === n)), createFolder: n => { const c = folder(n); f.folders.push(c); return c; },
    getFilesByName: n => iter(f.files.filter(x => x.getName() === n && !x.trashed)), getFiles: () => iter(f.files.filter(x => !x.trashed)),
    createFile: blob => { const c = { getName: () => blob.name, blob, setTrashed() { c.trashed = true; } }; f.files.push(c); return c; } };
  return f;
}
function world({ bytes = Buffer.from('pdf-bytes'), sha } = {}) {
  const calls = [], root = folder('root'), key = 'k'.repeat(30);
  const answers = {
    'backup/drive': () => ({ ok: true, takenAt: '2026-11-07T19:00:00.000Z', tables: { lessons: [] }, files: [{ id: 'fl_a', name: '成績.pdf', mime: 'application/pdf', sha256: sha || crypto.createHash('sha256').update(bytes).digest('hex') }] }),
    'backup/drive/file': () => ({ ok: true, base64: bytes.toString('base64') }),
    'backup/drive/done': () => ({ ok: true }),
  };
  const ctx = {
    DriveApp: { getRootFolder: () => root },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => key }) },
    UrlFetchApp: { fetch: (url, o) => { const route = url.replace(/^.*\/v2\//, ''); calls.push([route, JSON.parse(o.payload)]); return { getContentText: () => JSON.stringify(answers[route]()), getResponseCode: () => 200 }; } },
    Utilities: {
      formatDate: d => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10), newBlob: (data, mime, name) => ({ data, mime, name }),
      base64Decode: s => [...Buffer.from(s, 'base64')].map(b => (b > 127 ? b - 256 : b)),
      computeDigest: (_, b) => [...crypto.createHash('sha256').update(Buffer.from(b.map(x => (x + 256) % 256))).digest()].map(b2 => (b2 > 127 ? b2 - 256 : b2)),
      DigestAlgorithm: { SHA_256: 'sha256' },
    },
  };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return { ctx, root, calls, key, dir: name => root.folders[0].folders[0].folders[0].folders.find(f => f.name === name) };
}

test('the ledger and new files go under Kura/塾/バックアップ, and the Worker hears it finished', () => {
  const w = world();
  assert.match(w.ctx.weeklyBackup(), /2026-11-08\.json ファイル 1 件/);
  assert.equal(w.root.folders[0].name, 'Kura');
  assert.deepEqual(w.dir('台帳').files.map(f => f.getName()), ['2026-11-08.json']);
  assert.deepEqual(w.dir('ファイル').files.map(f => f.getName()), ['fl_a_成績.pdf']);
  assert.deepEqual(w.calls.at(-1), ['backup/drive/done', { key: w.key, files: 1, left: 0 }]);
});

test('a second run replaces that day and does not fetch the file again', () => {
  const w = world();
  w.ctx.weeklyBackup(); w.ctx.weeklyBackup();
  assert.equal(w.dir('台帳').files.filter(f => !f.trashed).length, 1);
  assert.equal(w.calls.filter(c => c[0] === 'backup/drive/file').length, 1);
  assert.deepEqual(w.calls.at(-1)[1].files, 0);
});

test('a damaged file stops the run so the Worker does not record success', () => {
  const w = world({ sha: 'f'.repeat(64) });
  assert.throws(() => w.ctx.weeklyBackup(), /壊れています/);
  assert.equal(w.dir('ファイル').files.length, 0);
  assert.equal(w.calls.some(c => c[0] === 'backup/drive/done'), false);
});
