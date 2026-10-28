// Old issued invoices keep their original rule; new invoices store the agreed date.
// 共通規約 r17 以降に同意した家族の通常の期限は請求確定月の末日で、土日祝日でもずらさない（第19条3項。2026-10-28 本人「翌営業日なのは嫌だな」→「Aでいこう」）。それより前の版は15日（土日祝日は翌営業日）
export const monthEndDue = termsVersion => Number((/-r(\d+)$/.exec(String(termsVersion || '')) || [])[1] || 0) >= 17;
export const normalDueDate = (today, termsVersion) => monthEndDue(termsVersion) ? new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10) : today.slice(0, 8) + '15';
export function invoiceDueText(inv) {
  if(inv.dueDate) return inv.dueDate + (inv.dueNote ? '（個別に合意した期限）' : inv.dueDate.slice(8) === '15' ? '（土日祝日の場合は翌営業日）' : '（期限の日までに振込の手続きをしてください）');
  const [y,m]=String(inv.month).split('-').map(Number),d=new Date(Date.UTC(y,m,15));
  return d.toISOString().slice(0,10)+'（土日祝日の場合は翌営業日・発行済み請求書の条件）';
}
