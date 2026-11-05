// 前の画面の URL を新しい画面へ転送する。前の画面の中身はもう無く、これだけが残っている（2026-11-05）。
// 昔のリンクやホーム画面のアイコンから来る人がいるので、URL は消さない。
// - 保護者ページ（/hogosha/、/yoyaku/#family）→ /family/
// - 生徒のマイページ（/yoyaku/?k=…）→ /student/?k=…（鍵はそのまま。端末に覚えている鍵も使う）
// - 管理画面（/kanri/）→ /staff/
(function () {
  function saved() { try { return localStorage.getItem('sw_k') || ''; } catch (e) { return ''; } }
  var p = location.pathname, to = '/staff/';
  if (p.indexOf('/hogosha') === 0 || (p.indexOf('/yoyaku') === 0 && location.hash.indexOf('#family') === 0)) to = '/family/';
  else if (p.indexOf('/yoyaku') === 0) {
    var k = new URLSearchParams(location.search).get('k') || saved();
    to = '/student/' + (k ? '?k=' + encodeURIComponent(k) : '');
  }
  location.replace(to);
})();
