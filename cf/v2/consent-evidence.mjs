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
