// The same notice eligibility is used by parent/student/staff displays.
// 締め切りで自動に確定することはもうしない（2026-10-27 本人「システム側で自動締切で授業を登録するなどは行わない」）。前に締め切りを付けて送った授業も、締め切りを出さない
export function automaticDeadline(l) {
  return '';
}
export function automaticDeadline20261014(l) {
  if(!['sent','external'].includes(l.noticeState)||!l.noticeAt||!l.confirmBy)return '';
  const at=Date.parse(l.noticeAt);if(!Number.isFinite(at))return '';
  const earliest=new Date(at+9*3600e3+3*86400e3).toISOString().slice(0,10);
  return l.confirmBy>=earliest?l.confirmBy:'';
}
