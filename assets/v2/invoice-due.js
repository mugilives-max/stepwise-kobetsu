// Old issued invoices keep their original rule; new invoices store the agreed date.
export function invoiceDueText(inv) {
  if(inv.dueDate) return inv.dueDate + (inv.dueNote ? '（個別に合意した期限）' : '（土日祝日の場合は翌営業日）');
  const [y,m]=String(inv.month).split('-').map(Number),d=new Date(Date.UTC(y,m,15));
  return d.toISOString().slice(0,10)+'（土日祝日の場合は翌営業日・発行済み請求書の条件）';
}
