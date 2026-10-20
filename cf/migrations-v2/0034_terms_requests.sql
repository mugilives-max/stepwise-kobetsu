-- 受講規約: 「使う規約を決める」と「保護者に同意をお願いする」を分ける（2026-10-20 本人「決定するのと、同意をお願いするのが同時…気持ち悪い」）。足すだけ。
-- 代表が家族ごとに同意をお願いした記録。お願いしている間（open）だけ、その家族の保護者ページに同意のお願いが出て、同意するまで受講合意書は承認できない。
-- 取り下げは status を withdrawn にするだけで、記録は消さない。お願いした版・日時・一言は変えない。
CREATE TABLE termsRequests (
 id TEXT PRIMARY KEY,
 familyId TEXT NOT NULL REFERENCES families(id),
 version TEXT NOT NULL REFERENCES termsVersions(version),
 note TEXT NOT NULL DEFAULT '',
 requestedAt TEXT NOT NULL, requestedBy TEXT NOT NULL, requestedByName TEXT NOT NULL DEFAULT '',
 mailed INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('open','withdrawn')) DEFAULT 'open',
 withdrawnAt TEXT NOT NULL DEFAULT '', withdrawnBy TEXT NOT NULL DEFAULT ''
);
CREATE INDEX termsRequests_family ON termsRequests(familyId, version, status);
CREATE TRIGGER termsRequestFixed BEFORE UPDATE ON termsRequests
 WHEN NEW.id <> OLD.id OR NEW.familyId <> OLD.familyId OR NEW.version <> OLD.version OR NEW.note <> OLD.note OR NEW.requestedAt <> OLD.requestedAt OR NEW.requestedBy <> OLD.requestedBy OR NEW.mailed <> OLD.mailed OR OLD.status = 'withdrawn'
 BEGIN SELECT RAISE(ABORT,'terms request is immutable'); END;
CREATE TRIGGER termsRequestRetain BEFORE DELETE ON termsRequests BEGIN SELECT RAISE(ABORT,'retain terms request'); END;
