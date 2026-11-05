'use strict';

// ホーム画面のアプリとして入れられるようにした（段階 D）。
//
// 生徒のページは専用リンク（?k=）で本人を見分けている。ホーム画面から開くとその ?k= が
// 付かないので、端末が鍵を覚えていないと何もできない画面になる。貼り直せる入口を出し、
// そこが確かに働くことを確かめる。合成の値だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUI, state, flush } = require('./helpers/operations-ui-harness.cjs');

const root = f => path.resolve(__dirname, '..', f);

test('生徒・保護者のページがホーム画面に入れられる', () => {
  for (const page of ['yoyaku', 'hogosha']) {
    const html = fs.readFileSync(root(page + '/index.html'), 'utf8');
    assert.match(html, /rel="manifest" href="manifest.webmanifest"/, page + ': manifest がつながっていない');
    assert.match(html, /rel="apple-touch-icon"/, page + ': iPhone 用のアイコンがない');
    const manifest = JSON.parse(fs.readFileSync(root(page + '/manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.start_url, '/' + page + '/');
    assert.equal(manifest.scope, '/' + page + '/');
    assert.equal(manifest.display, 'standalone');
    for (const icon of manifest.icons) {
      const file = root(icon.src.replace(/^\//, ''));
      assert.ok(fs.existsSync(file), '無いアイコンを指している: ' + icon.src);
      const bytes = fs.readFileSync(file);
      const size = Number(icon.sizes.split('x')[0]);
      assert.equal(bytes.readUInt32BE(16), size, icon.src + ': 幅が宣言と違う');
      assert.equal(bytes.readUInt32BE(20), size, icon.src + ': 高さが宣言と違う');
    }
  }
});

test('生徒と保護者と管理で、別々のアイコンになっている', () => {
  const seen = new Map();
  for (const page of ['yoyaku', 'hogosha', 'kanri']) {
    const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(root(page + '/icon-512.png'))).digest('hex');
    assert.ok(!seen.has(hash), page + ' と ' + seen.get(hash) + ' が同じアイコンになっている');
    seen.set(hash, page);
  }
});

// ---- 鍵を覚えていない状態で開いたとき ----

function guardUI() { return createUI('student', { local: new Map() }); }






// ---- Meet のリンクは、届くまで「準備中」 ----
// 確定は Meet の発行を待たない。届くまで画面は準備中を出し、リンクが入ったら差し替わる。

const { studentReady } = require('./helpers/operations-ui-harness.cjs');

function onlineSlot(extra) {
  return Object.assign({ id: 'slot-online', date: '2026-09-10', start: '17:00', min: 60, subject: '英語',
    deliveryMode: 'online', st: 'mine' }, extra || {});
}



