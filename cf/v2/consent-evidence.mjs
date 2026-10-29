import { fail, iso } from './util.mjs';

// The actual consent and the later data entry are separate facts.
export function consentEvidence(c, b, actor, family = null) {
  const name = String(b.consenterName || '').trim();
  if (!name || name.length > 100) fail('needConsenter', '承認・同意した保護者の氏名を100文字以内で入れてください');
  const raw = family ? iso(c.now) : String(b.consentedAt || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw)))
    fail('needConsentTime', '実際に承認・同意した日時を、時刻まで入れてください');
  const at = new Date(raw).toISOString();
  if (Date.parse(at) > c.now) fail('futureConsent', '未来の日時を承認・同意の日時にはできません');
  return { consenterName: name, consentedAt: at, recordedAt: iso(c.now), recordedByName: family ? name : String(actor.name || '').trim() };
}
export const evidenceView = r => ({ consenterName: r.consenterName || '', consentedAt: r.consentedAt || r.agreedAt || '', recordedAt: r.recordedAt || '', recordedByName: r.recordedByName || '', proposedByName: r.proposedByName || '' });

// 合意した書面の控えのメール（2026-10-29 本人「個別受講条件書と受講計画書は合意したら控えを送ってほしい」）。同意の日（日本時間）・方法・同意した方
export const consentLine = (at, via, who) => {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(String(at || '')) ? at + 'T00:00:00+09:00' : at || ''), d = Number.isFinite(t) ? new Date(t + 9 * 3600e3) : null;
  return [d ? (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日' : '', via, who].filter(Boolean).join('・');
};
export const COPY_PLACE = '同意した書面の控えは、保護者ページの「アカウント」→「契約・同意の控え」でいつでも開けます。';
// 書面のファイルは、いつもメールに付けて渡す（前の Apps Script は付けずに送る）。本文の「添付しています」は、入れ替えを確かめてから（settings の mailAttachments = on）
export const COPY_ATTACHED = '同意した書面の控えを、このメールに添付しています。保護者ページの「アカウント」→「契約・同意の控え」でもいつでも開けます。';
export async function copyMail(db, fileId) {
  const on = ((await db.prepare("select value from settings where key = 'mailAttachments'").first()) || {}).value === 'on';
  return { extra: fileId ? { attachFiles: [fileId] } : {}, place: on && fileId ? COPY_ATTACHED : COPY_PLACE };
}
