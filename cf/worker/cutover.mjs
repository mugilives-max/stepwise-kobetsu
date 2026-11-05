// 切り替え（9段目）: 今の仕組みを止める。docs/CUTOVER_RUNBOOK.md
// 目印は今の台帳の config 'v2CutoverAt'（切り替えた時刻）。新しい仕組みの「切り替える」ボタンが書き、「元に戻す」が消す（cf/v2/cutover.mjs）。
// 目印があるあいだは、今の仕組みの読み書きと毎日の自動処理（請求の確定・仮予定の決定）を止める。
// 読み取りも 2026-11-05 に止めた（前の画面は転送だけになった。Worker に残るのは疎通確認だけ）。
export async function frozenAt(env) {
  try { const r = await env.DB.prepare("select value from config where key = 'v2CutoverAt'").first(); return r && r.value ? String(r.value) : ''; }
  catch { return ''; }
}
export const MOVED = {
  error: '新しいページに切り替えました。このページは使えません。保護者の方は https://www.stepwise-education.jp/family/ 、生徒の方は今のリンクを開き直すと新しいページになります。',
  errorCode: 'movedToV2', moveTo: { family: '/family/', student: '/student/', staff: '/staff/' },
};
