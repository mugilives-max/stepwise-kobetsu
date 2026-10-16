// The same notice eligibility is used by parent/student/staff displays.
export function automaticDeadline(l) {
  if(!['sent','external'].includes(l.noticeState)||!l.noticeAt||!l.confirmBy)return '';
  const at=Date.parse(l.noticeAt);if(!Number.isFinite(at))return '';
  const earliest=new Date(at+9*3600e3+3*86400e3).toISOString().slice(0,10);
  return l.confirmBy>=earliest?l.confirmBy:'';
}
