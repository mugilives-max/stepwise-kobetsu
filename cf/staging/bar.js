// 検証環境の帯（scripts/build-staging.mjs が staff・family・student の画面に足す）。本番の画面には入らない。
// 「送ったメール」: 本当には送らないメールの控えを見る（招待のリンクもここから開ける）。「最初の状態に戻す」: 架空のデータを入れ直す。
(() => {
  const css = `
  .stg-bar{position:relative;z-index:30;background:#7a2e0e;color:#fff;font:600 12.5px/1.4 system-ui,sans-serif;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:6px 12px}
  .stg-bar b{font-weight:700;margin-right:auto}
  .stg-bar a,.stg-bar button{all:unset;cursor:pointer;color:#fff;border:1px solid rgba(255,255,255,.55);border-radius:999px;padding:3px 10px;font-weight:600}
  .stg-bar a:focus-visible,.stg-bar button:focus-visible{outline:2px solid #fff;outline-offset:1px}
  .stg-sheet{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.45);display:flex;justify-content:center;align-items:flex-end}
  .stg-panel{background:#fff;color:#18232d;width:min(720px,100%);max-height:86vh;overflow:auto;border-radius:14px 14px 0 0;padding:16px;box-sizing:border-box;font:14px/1.6 system-ui,sans-serif}
  .stg-panel h2{font-size:16px;margin:0 0 4px}
  .stg-panel .stg-x{all:unset;cursor:pointer;float:right;font-size:14px;border:1px solid #cbd5e1;border-radius:999px;padding:2px 12px}
  .stg-mail{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin:10px 0}
  .stg-mail .m{color:#64748b;font-size:12px}
  .stg-mail pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 system-ui,sans-serif;margin:8px 0 0}
  .stg-mail a{color:#1d4ed8}
  @media (min-width:760px){.stg-sheet{align-items:center}.stg-panel{border-radius:14px}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const bar = document.createElement('div'); bar.className = 'stg-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', '検証環境');
  bar.innerHTML = '<b>検証環境（本番ではありません。メールは送られません）</b><button type="button" data-stg="mails">送ったメール</button><a href="/">ログインの一覧</a><button type="button" data-stg="reset">最初の状態に戻す</button>';
  document.body.prepend(bar);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  const post = (route, body = {}) => fetch('/v2/' + route, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
  function sheet(html) {
    const s = document.createElement('div'); s.className = 'stg-sheet'; s.innerHTML = `<div class="stg-panel" role="dialog" aria-modal="true">${html}</div>`;
    s.addEventListener('click', e => { if (e.target === s || e.target.closest('.stg-x')) s.remove(); });
    document.body.appendChild(s); return s;
  }
  async function showMails() {
    const s = sheet('<button type="button" class="stg-x">閉じる</button><h2>送ったメール</h2><p class="m">読み込んでいます…</p>');
    const r = await post('staging/mails');
    const list = r.ok ? r.mails : [];
    s.querySelector('.stg-panel').innerHTML = '<button type="button" class="stg-x">閉じる</button><h2>送ったメール</h2><p style="margin:0;color:#64748b;font-size:12.5px">検証環境では本当には送りません。本番なら届くメールを、新しい順に出します。リンクは押すと別のタブで開きます。</p>'
      + (list.length ? list.map(m => `<div class="stg-mail"><div class="m">${esc(new Date(m.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}・宛先 ${esc(m.to)}</div><strong>${esc(m.subject)}</strong><pre>${linkify(m.body)}</pre></div>`).join('') : '<p>まだありません。</p>');
  }
  async function reset(btn) {
    if (!confirm('検証環境の記録をすべて消して、最初の状態（架空のデータ）に戻しますか？\nログインもすべて外れます。本番には影響しません。')) return;
    btn.disabled = true;
    try {
      for (let step = 0; ; step++) {
        btn.textContent = `戻しています（${step + 1}）…`;
        const r = await post('staging/reset', { confirm: 'reset', step });
        if (!r.ok) throw new Error(r.error ? r.error.message : '失敗しました');
        if (r.done) break;
      }
      for (const k of Object.keys(localStorage)) if (k.startsWith('sw2_')) localStorage.removeItem(k);
      for (const k of Object.keys(sessionStorage)) if (k.startsWith('sw2_')) sessionStorage.removeItem(k);
      alert('最初の状態に戻しました。ログインの一覧から入り直してください。');
      location.href = '/';
    } catch (e) { alert('戻せませんでした：' + e.message + '\nもう一度押してください。'); btn.disabled = false; btn.textContent = '最初の状態に戻す'; }
  }
  bar.addEventListener('click', e => { const b = e.target.closest('[data-stg]'); if (!b) return; if (b.dataset.stg === 'mails') showMails(); if (b.dataset.stg === 'reset') reset(b); });
  window.stagingShowMails = showMails; window.stagingReset = reset;
})();
