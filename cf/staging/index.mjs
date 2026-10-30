// 検証環境（ステージング）の Worker。本番とは別の台帳（D1）・別のファイル置き場（R2）で、本番と同じ v2 の仕組みを動かす（2026-10-19 本人の依頼）。
// - 画面（staff・family・student）と API（/v2/）を同じ場所から出す（scripts/build-staging.mjs が public/ を作る）
// - メールは本当には送らない（GAS_URL を持たない）。送ったはずのメールは「送ったメール」（/v2/staging/mails）で見る
// - 「最初の状態に戻す」（/v2/staging/reset）: snapshot.json の架空のデータを入れ直す。D1 の 1 回の呼び出しの上限に収まるよう、数回に分けて行う
// - 本文の中の本番の住所（招待のリンクなど）は、この検証環境の住所に置き換えて返す
import { handleV2 } from '../v2/index.mjs';
import snapshot from './snapshot.json';

const PROD = 'https://www.stepwise-education.jp';
const PER_STEP = 40; // 1 回の呼び出しで流す文の数
const NOINDEX = { 'X-Robots-Tag': 'noindex, nofollow' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...NOINDEX } });

// 入れ直しの手順: トリガーを外す → 子の表から空にする → 親の表から入れる → トリガーを戻す
const PLAN = [
  ...snapshot.triggers.map(t => `DROP TRIGGER IF EXISTS "${t.name}"`),
  ...[...snapshot.order].reverse().map(t => `DELETE FROM "${t}"`),
  ...snapshot.inserts,
  ...snapshot.triggers.map(t => t.sql),
];
const STEPS = Math.ceil(PLAN.length / PER_STEP) + 1; // 最後の 1 回はファイル（R2）

async function reset(env, body) {
  if (body.confirm !== 'reset') return json({ ok: false, error: { code: 'needConfirm', message: '最初の状態に戻すときは確認が必要です' } }, 400);
  const step = Number(body.step || 0);
  if (!Number.isInteger(step) || step < 0 || step >= STEPS) return json({ ok: false, error: { code: 'badStep', message: '手順の番号が正しくありません' } }, 400);
  if (step < STEPS - 1) {
    const part = PLAN.slice(step * PER_STEP, (step + 1) * PER_STEP);
    await env.DB2.batch([env.DB2.prepare('PRAGMA defer_foreign_keys = on'), ...part.map(s => env.DB2.prepare(s))]);
  } else {
    for (const f of snapshot.files) await env.FILES.put(f.key, Uint8Array.from(atob(f.b64), ch => ch.charCodeAt(0)), { httpMetadata: f.httpMetadata, customMetadata: f.customMetadata });
  }
  return json({ ok: true, step, steps: STEPS, done: step === STEPS - 1 });
}

// 送ったはずのメール（新しい順）。本番の住所はこの検証環境の住所にして返す
async function mails(env, origin) {
  const rows = (await env.DB2.prepare("select id, createdAt, payload from effects where kind = 'mail' order by id desc limit 50").all()).results;
  const list = rows.map(r => { let p = {}; try { p = JSON.parse(r.payload); } catch {} return { id: r.id, at: r.createdAt, to: p.to || '', subject: p.subject || '', body: String(p.body || '').replaceAll(PROD, origin), audience: p.audience || '' }; });
  return json({ ok: true, mails: list });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), origin = url.origin;
    if (url.pathname === '/v2/staging/reset' && request.method === 'POST') { let b = {}; try { b = await request.json(); } catch {} return reset(env, b); }
    if (url.pathname === '/v2/staging/mails' && request.method === 'POST') return mails(env, origin);
    if (url.pathname === '/v2/staging/info' && request.method === 'POST') {
      const n = await env.DB2.prepare('select count(*) n from staff').first().catch(() => ({ n: 0 }));
      // 生徒の専用リンクは、いま台帳にある鍵から作る（公開のたびに作り直す snapshot の鍵とは、戻すまで一致しない）
      const kid = async given => (await env.DB2.prepare("select linkCode from students where familyName = '架空' and givenName = ? and linkCode not like 'off.%'").bind(given).first().catch(() => null))?.linkCode || '';
      const links = {};
      for (const [k, given] of [['taro', '太郎'], ['hana', '花']]) { const code = await kid(given); if (code) links[k] = origin + '/student/?k=' + encodeURIComponent(code); }
      // 入塾の手続きを試す体験生（架空 体験）。入塾したあとは出さない
      const trial = await env.DB2.prepare("select id, linkCode from students where familyName = '架空' and givenName = '体験' and trial = 1").first().catch(() => null);
      if (trial && trial.linkCode && !trial.linkCode.startsWith('off.')) links.trial = origin + '/student/?k=' + encodeURIComponent(trial.linkCode);
      // 契約更新の手続きを試す家族（scripts/demo-seed.mjs の山本さん）
      const renewal = await env.DB2.prepare("select id from families where email = 'renewal-parent@example.invalid'").first().catch(() => null);
      return json({ ok: true, seeded: Number(n && n.n) > 0, builtAt: snapshot.builtAt, links, trial: trial ? trial.id : '', renewal: renewal ? renewal.id : '' });
    }
    if (url.pathname.startsWith('/v2/')) {
      const res = await handleV2(request, env, ctx, NOINDEX);
      if (!(res.headers.get('Content-Type') || '').includes('application/json')) return res;
      const text = (await res.text()).replaceAll(PROD, origin);
      return new Response(text, { status: res.status, headers: res.headers });
    }
    // 画面が切り替えの状態を確かめる口（assets/v2/api.js の liveState）。検証環境はいつも「切り替えたあと」
    if (url.pathname === '/' && !(request.headers.get('Accept') || '').includes('text/html'))
      return json({ ok: true, service: 'stepwise-staging', release: 'staging', cutover: { live: true, oldReadOnlySince: '' } });
    // 規約の一覧（設定 → 共通規約が読む）: 全文・PDF のリンクを検証環境の写しに向ける（本番にまだ無い版も開けるように）
    if (url.pathname === '/terms/versions.json') {
      const res = await env.ASSETS.fetch(request);
      return new Response((await res.text()).replaceAll(PROD, origin), { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
    }
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return out;
  },
};
