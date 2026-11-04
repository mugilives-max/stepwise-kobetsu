// Read-only family archive. The family route never accepts a caller-provided family/student id.
import { fail } from './util.mjs';
import { requireFamily } from './family.mjs';
import { requireStaff } from './staff.mjs';
import { familyTerms } from './terms.mjs';
import { familyConditions } from './conditions.mjs';
import { familySpecials } from './specials.mjs';
import { lineView } from './billing.mjs';
// 家族の契約・同意の控え。保護者の「契約」の前の版と、スタッフの契約者の「契約」が同じものを読む
async function familyContracts(c, f) {
  const students = (await c.db.prepare('select * from students where familyId = ? order by createdAt').bind(f.id).all()).results;
  const rows = (await c.db.prepare("select r.* from planRevisions r where r.familyId=? and r.status<>'draft' order by r.id desc").bind(f.id).all()).results;
  const plans = rows.map(r => {
    const p = JSON.parse(r.snapshot);
    return lineView(p, { archiveId:r.id, capturedAt:r.capturedAt, studentName:r.studentName });
  });
  return { terms:await familyTerms(c.db,f), conditions:await familyConditions(c.db,students), specials:await familySpecials(c.db,students), plans };
}
export const contractRoutes = {
  'family/contracts': async (c,b) => familyContracts(c, await requireFamily(c,b)),
  'admin/families/contracts': async (c,b) => {
    await requireStaff(c,b,'manager');
    const f = await c.db.prepare('select * from families where id = ?').bind(String(b.id||'')).first();
    if (!f) fail('notFound','家族が見つかりません',404);
    return familyContracts(c,f);
  },
};
