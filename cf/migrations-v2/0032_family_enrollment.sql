-- 入塾の案内と申込み（2026-10-18 本人決定。cf/v2/enrollment.mjs）。足すだけ: 今の家族・生徒・同意・計画の行は変えない。
-- 保護者が申込みで入れる情報（受講申込書の契約者）
ALTER TABLE families ADD COLUMN guardianKana TEXT NOT NULL DEFAULT '';
ALTER TABLE families ADD COLUMN address TEXT NOT NULL DEFAULT '';
-- 代表が送った入塾の案内（受講条件書の案と開始月）と、保護者の申込み（受講申込書の控え）
CREATE TABLE enrollmentOffers (
 id TEXT PRIMARY KEY,
 familyId TEXT NOT NULL REFERENCES families(id),
 studentId TEXT NOT NULL REFERENCES students(id),
 conditionId TEXT NOT NULL REFERENCES conditions(id),
 fromMonth TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('offered','applied','withdrawn')),
 offeredAt TEXT NOT NULL, offeredBy TEXT NOT NULL, offeredByName TEXT NOT NULL DEFAULT '',
 appliedAt TEXT NOT NULL DEFAULT '', application TEXT NOT NULL DEFAULT '', contentHash TEXT NOT NULL DEFAULT '',
 termsVersion TEXT NOT NULL DEFAULT '', consenterName TEXT NOT NULL DEFAULT '',
 withdrawnAt TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX enrollmentOffers_student ON enrollmentOffers(studentId, offeredAt);
CREATE INDEX enrollmentOffers_family ON enrollmentOffers(familyId, status);
-- 申込み（受講申込書の控え）は変えない・消さない
CREATE TRIGGER enrollmentApplicationFixed BEFORE UPDATE ON enrollmentOffers WHEN OLD.status = 'applied' BEGIN SELECT RAISE(ABORT,'enrollment application is immutable'); END;
CREATE TRIGGER enrollmentOfferRetain BEFORE DELETE ON enrollmentOffers BEGIN SELECT RAISE(ABORT,'retain enrollment offer'); END;
