'use strict';
// 前の画面（/kanri/・/hogosha/・/yoyaku/）は転送だけ。昔のリンクとホーム画面のアイコンから新しい画面へ移す
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('assets/v2-move.js', 'utf8');
function forward(url, saved = '') {
  const u = new URL(url, 'https://www.stepwise-education.jp'); const went = [];
  vm.runInNewContext(source, {
    URLSearchParams,
    location: { pathname: u.pathname, search: u.search, hash: u.hash, replace: to => went.push(to) },
    localStorage: { getItem: k => (k === 'sw_k' ? saved : null) },
  });
  assert.equal(went.length, 1, url + ' は 1 回だけ移す');
  return went[0];
}

test('old links reach the matching new screen and keep the student key', () => {
  assert.equal(forward('/kanri/'), '/staff/');
  assert.equal(forward('/kanri/?stay=1'), '/staff/', '読むだけで残す入口はもう無い');
  assert.equal(forward('/kanri/#instructor-invite=x'), '/staff/');
  assert.equal(forward('/hogosha/'), '/family/');
  assert.equal(forward('/hogosha/#family?mode=resend'), '/family/');
  assert.equal(forward('/yoyaku/#family/home'), '/family/');
  assert.equal(forward('/yoyaku/?k=a%2Bb#home'), '/student/?k=a%2Bb');
  assert.equal(forward('/yoyaku/', 'saved-key'), '/student/?k=saved-key', '端末に覚えている鍵も使う');
  assert.equal(forward('/yoyaku/'), '/student/');
});

test('a blocked localStorage does not stop the forward', () => {
  const went = [];
  vm.runInNewContext(source, { URLSearchParams, location: { pathname: '/yoyaku/', search: '', hash: '', replace: to => went.push(to) }, get localStorage() { throw new Error('blocked'); } });
  assert.deepEqual(went, ['/student/']);
});

test('the old pages hold nothing but the forward, a plain link and the home-screen files', () => {
  for (const [dir, to] of [['kanri', '/staff/'], ['hogosha', '/family/'], ['yoyaku', '/student/']]) {
    const html = fs.readFileSync(dir + '/index.html', 'utf8');
    assert.deepEqual([...html.matchAll(/<script\b[^>]*src="([^"?]+)/g)].map(m => m[1]), ['/assets/v2-move.js'], dir);
    assert.doesNotMatch(html, /<script>|<style/, dir);
    assert.match(html, new RegExp('href="' + to + '"'), dir);
    assert.ok(fs.existsSync(dir + '/manifest.webmanifest') && fs.existsSync(dir + '/icon-192.png'), dir + ' のアイコンは残す');
  }
  for (const dir of ['hogosha', 'yoyaku']) assert.ok(fs.existsSync(dir + '/sw.js'), dir + ' の sw.js は残す（入れた端末の通知の受け口）');
});
