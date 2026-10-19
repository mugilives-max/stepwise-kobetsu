// 検証環境を最初の状態（架空のデータ）に戻す。画面の帯の「最初の状態に戻す」と同じことを、公開の手順から行う。
//   node scripts/staging-reset.mjs <検証環境の住所> [--if-empty | --force]
// --if-empty: まだ何も入っていない（初めて公開した）ときだけ戻す。--force: いつでも戻す。
const [base, mode = '--if-empty'] = process.argv.slice(2);
if (!base || !/^https?:\/\/[^/]+$/.test(base)) { console.error('検証環境の住所（https://… 末尾の / なし）を渡してください'); process.exit(2); }
if (/stepwise-education\.jp|stepwise-api\./.test(base)) { console.error('本番の住所には使えません'); process.exit(2); }
const post = async (route, body = {}) => { const r = await fetch(base + '/v2/' + route, { method: 'POST', body: JSON.stringify(body) }); return r.json(); };
const info = await post('staging/info');
if (!info.ok) { console.error('検証環境に接続できません'); process.exit(1); }
if (mode === '--if-empty' && info.seeded) { console.log('架空のデータが入っているので、そのままにします'); process.exit(0); }
for (let step = 0; ; step++) {
  const r = await post('staging/reset', { confirm: 'reset', step });
  if (!r.ok) { console.error('戻せませんでした（手順 ' + step + '）：' + (r.error ? r.error.message : '')); process.exit(1); }
  if (r.done) break;
}
const after = await post('staging/info');
if (!after.seeded) { console.error('戻したあとに架空のデータが見つかりません'); process.exit(1); }
console.log('最初の状態に戻しました（' + after.builtAt + ' に作った架空のデータ）');
