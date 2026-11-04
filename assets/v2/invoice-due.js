// Old issued invoices keep their original rule; new invoices store the agreed date.
// 新しい請求の通常の期限は授業を実施した月（請求の月）の翌月末日で、土日祝日でもずらさない（共通規約 r17 第19条3項。2026-10-28 本人「翌営業日なのは嫌だな」→「Aでいこう」）。
// 共通規約に未同意の家族も同じ（2026-11-04 本人「請求書の振込期限を翌月末日にする」「翌月以降の請求に反映されれば十分」）。monthEndDue は書面の文言の版の判断
export const monthEndDue = termsVersion => Number((/-r(\d+)$/.exec(String(termsVersion || '')) || [])[1] || 0) >= 17;
export const normalDueDate = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) + 1, 0)).toISOString().slice(0, 10);
export function invoiceDueText(inv) {
  if(inv.dueDate) return inv.dueDate + (inv.dueNote ? '（個別に合意した期限）' : inv.dueDate.slice(8) === '15' ? '（土日祝日の場合は翌営業日）' : '（期限の日までに振込の手続きをしてください）');
  const [y,m]=String(inv.month).split('-').map(Number),d=new Date(Date.UTC(y,m,15));
  return d.toISOString().slice(0,10)+'（土日祝日の場合は翌営業日・発行済み請求書の条件）';
}
