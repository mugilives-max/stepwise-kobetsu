// Shared allowlist. Business links locate records; server authorization is always required.
const pages = new Set(['home','schedule','confirm','learning','money','account','events','grades','enroll','plan','agree','contracts']);
const idOK = s => /^[A-Za-z0-9_-]{1,100}$/.test(s);
export function safeFamilyTarget(raw) {
  if (typeof raw !== 'string' || raw.length > 14000 || /[\\\\\r\n]/.test(raw)) return '';
  const [path, query = ''] = raw.replace(/^#/, '').split('?');
  if (!pages.has(path.split('/')[0]) || (path.includes('/') && path !== 'learning/grades')) return '';
  const p = new URLSearchParams(query), q = new URLSearchParams();
  for (const k of ['student','month','kind','refs']) {
    const v = p.get(k); if (!v) continue;
    if (k === 'student' && !idOK(v)) return '';
    if (k === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return '';
    if (k === 'kind' && !['plan','condition','special','invoice','fee','lesson'].includes(v)) return '';
    if (k === 'refs' && (v.split(',').length > 100 || !v.split(',').every(x => { const [id,version,...extra] = x.split('.'); return idOK(id) && /^\d+$/.test(version) && !extra.length; }))) return '';
    q.set(k,v);
  }
  return path + (q.size ? '?' + q.toString() : '');
}
export function familyTarget(page, options = {}) {
  return safeFamilyTarget(page + '?' + new URLSearchParams(Object.entries(options).filter(([,v]) => v !== undefined && v !== '')).toString());
}
export function targetParts(raw) {
  const safe = safeFamilyTarget(raw) || 'home', [path, query = ''] = safe.split('?'), p = new URLSearchParams(query);
  return { path, student: p.get('student') || '', month: p.get('month') || '', kind: p.get('kind') || '',
    refs: (p.get('refs') || '').split(',').filter(Boolean).map(x => { const [id,version] = x.split('.'); return {id,version:Number(version)}; }) };
}
export const targetPurpose = raw => ({confirm:'授業日時を確認する',schedule:'授業の予定を確認する',money:'書類・料金を確認する',learning:'学習の記録を確認する'}[targetParts(raw).path] || '保護者ページを開く');
export const targetRefs = rows => rows.map(x => x.id + '.' + x.version).join(',');
