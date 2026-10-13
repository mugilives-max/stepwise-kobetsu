// Read-only family archive. Never accepts a caller-provided family/student id.
import { requireFamily } from './family.mjs';
import { familyTerms } from './terms.mjs';
import { familyConditions } from './conditions.mjs';
import { familySpecials } from './specials.mjs';
import { lineView } from './billing.mjs';
export const contractRoutes = {
  'family/contracts': async (c,b) => {
    const me = await requireFamily(c,b);
    const students = (await c.db.prepare('select * from students where familyId = ? order by createdAt').bind(me.id).all()).results;
    const rows = (await c.db.prepare("select r.* from planRevisions r where r.familyId=? and r.status<>'draft' order by r.id desc").bind(me.id).all()).results;
    const plans = rows.map(r => {
      const p = JSON.parse(r.snapshot);
      return lineView(p, { archiveId:r.id, capturedAt:r.capturedAt, studentName:r.studentName });
    });
    return { terms:await familyTerms(c.db,me), conditions:await familyConditions(c.db,students), specials:await familySpecials(c.db,students), plans };
  }
};
