-- Additive only: preserve every existing agreement, consent and file.
CREATE TABLE termsVersions (
 version TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
 fromDate TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', contentHash TEXT NOT NULL DEFAULT '',
 registeredAt TEXT NOT NULL DEFAULT ''
);
-- Capture only the version currently identified by settings. Never guess a URL for another version.
INSERT INTO termsVersions (version,title,url,fromDate,note,registeredAt)
SELECT value,
 COALESCE((SELECT value FROM settings WHERE key='termsTitle'),''),
 COALESCE((SELECT value FROM settings WHERE key='termsUrl'),''),
 COALESCE((SELECT value FROM settings WHERE key='termsFrom'),''),
 COALESCE((SELECT value FROM settings WHERE key='termsNote'),''),
 strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM settings WHERE key='termsVersion' AND value<>'';
-- Published catalogue entry only. Does not activate consent requests or change a family's agreement.
INSERT OR IGNORE INTO termsVersions (version,title,url,fromDate,contentHash,registeredAt)
VALUES ('2026-11-20261012-r3','受講規約（2026年11月版・10月12日改訂）',
 'https://www.stepwise-education.jp/terms/2026-11-20261012-r3/','2026-11-01',
 'git-blob:c7c69a5bfdfb9aacf92d78188d279b40cc3347d0','2026-10-12');
ALTER TABLE termsConsents ADD COLUMN consenterName TEXT NOT NULL DEFAULT '';
ALTER TABLE termsConsents ADD COLUMN recordedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE termsConsents ADD COLUMN recordedByName TEXT NOT NULL DEFAULT '';
ALTER TABLE termsConsents ADD COLUMN termsSnapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE conditions ADD COLUMN consenterName TEXT NOT NULL DEFAULT '';
ALTER TABLE conditions ADD COLUMN recordedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE conditions ADD COLUMN recordedByName TEXT NOT NULL DEFAULT '';
ALTER TABLE conditions ADD COLUMN templateVersion TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE specials ADD COLUMN consenterName TEXT NOT NULL DEFAULT '';
ALTER TABLE specials ADD COLUMN recordedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE specials ADD COLUMN recordedByName TEXT NOT NULL DEFAULT '';
ALTER TABLE specials ADD COLUMN templateVersion TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE specials ADD COLUMN purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE planLines ADD COLUMN consenterName TEXT NOT NULL DEFAULT '';
ALTER TABLE planLines ADD COLUMN consentedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE planLines ADD COLUMN recordedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE planLines ADD COLUMN recordedByName TEXT NOT NULL DEFAULT '';
ALTER TABLE planLines ADD COLUMN proposedByName TEXT NOT NULL DEFAULT '';
ALTER TABLE planLines ADD COLUMN conditionId TEXT NOT NULL DEFAULT '';
ALTER TABLE planLines ADD COLUMN specialId TEXT NOT NULL DEFAULT '';
ALTER TABLE planLines ADD COLUMN instructionType TEXT NOT NULL DEFAULT '';
CREATE TABLE planRevisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, planId TEXT NOT NULL, studentId TEXT NOT NULL, familyId TEXT NOT NULL, studentName TEXT NOT NULL,
 rowVersion INTEGER NOT NULL, status TEXT NOT NULL, snapshot TEXT NOT NULL, capturedAt TEXT NOT NULL,
 UNIQUE(planId,rowVersion)
);
CREATE INDEX planRevisions_student ON planRevisions(studentId,id);
-- Legacy rows are copied as they are, without fabricating consent metadata.
INSERT INTO planRevisions (planId,studentId,familyId,studentName,rowVersion,status,snapshot,capturedAt)
SELECT p.id,p.studentId,(SELECT familyId FROM students WHERE id=p.studentId),(SELECT familyName || ' ' || givenName FROM students WHERE id=p.studentId),p.version,p.status,json_object('id', p.id, 'studentId', p.studentId, 'parentId', p.parentId, 'subject', p.subject, 'kind', p.kind, 'startDate', p.startDate, 'endDate', p.endDate, 'count', p.count, 'minutes', p.minutes, 'fee', p.fee, 'comment', p.comment, 'status', p.status, 'approvedCount', p.approvedCount, 'proposedAt', p.proposedAt, 'approvedAt', p.approvedAt, 'approvedBy', p.approvedBy, 'approvedVia', p.approvedVia, 'consentDate', p.consentDate, 'approvalNote', p.approvalNote, 'termsVersion', p.termsVersion, 'familyAck', p.familyAck, 'familyAckAt', p.familyAckAt, 'familyAckNote', p.familyAckNote, 'remindedAt', p.remindedAt, 'version', p.version, 'createdAt', p.createdAt, 'updatedAt', p.updatedAt, 'consenterName', p.consenterName, 'consentedAt', p.consentedAt, 'recordedAt', p.recordedAt, 'recordedByName', p.recordedByName, 'proposedByName', p.proposedByName, 'conditionId', p.conditionId, 'specialId', p.specialId, 'instructionType', p.instructionType),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM planLines p;
CREATE TRIGGER plan_revision_insert AFTER INSERT ON planLines BEGIN
 INSERT OR IGNORE INTO planRevisions (planId,studentId,familyId,studentName,rowVersion,status,snapshot,capturedAt)
 VALUES (NEW.id,NEW.studentId,(SELECT familyId FROM students WHERE id=NEW.studentId),(SELECT familyName || ' ' || givenName FROM students WHERE id=NEW.studentId),NEW.version,NEW.status,json_object('id', NEW.id, 'studentId', NEW.studentId, 'parentId', NEW.parentId, 'subject', NEW.subject, 'kind', NEW.kind, 'startDate', NEW.startDate, 'endDate', NEW.endDate, 'count', NEW.count, 'minutes', NEW.minutes, 'fee', NEW.fee, 'comment', NEW.comment, 'status', NEW.status, 'approvedCount', NEW.approvedCount, 'proposedAt', NEW.proposedAt, 'approvedAt', NEW.approvedAt, 'approvedBy', NEW.approvedBy, 'approvedVia', NEW.approvedVia, 'consentDate', NEW.consentDate, 'approvalNote', NEW.approvalNote, 'termsVersion', NEW.termsVersion, 'familyAck', NEW.familyAck, 'familyAckAt', NEW.familyAckAt, 'familyAckNote', NEW.familyAckNote, 'remindedAt', NEW.remindedAt, 'version', NEW.version, 'createdAt', NEW.createdAt, 'updatedAt', NEW.updatedAt, 'consenterName', NEW.consenterName, 'consentedAt', NEW.consentedAt, 'recordedAt', NEW.recordedAt, 'recordedByName', NEW.recordedByName, 'proposedByName', NEW.proposedByName, 'conditionId', NEW.conditionId, 'specialId', NEW.specialId, 'instructionType', NEW.instructionType),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER plan_revision_update AFTER UPDATE ON planLines BEGIN
 INSERT OR IGNORE INTO planRevisions (planId,studentId,familyId,studentName,rowVersion,status,snapshot,capturedAt)
 VALUES (NEW.id,NEW.studentId,(SELECT familyId FROM students WHERE id=NEW.studentId),(SELECT familyName || ' ' || givenName FROM students WHERE id=NEW.studentId),NEW.version,NEW.status,json_object('id', NEW.id, 'studentId', NEW.studentId, 'parentId', NEW.parentId, 'subject', NEW.subject, 'kind', NEW.kind, 'startDate', NEW.startDate, 'endDate', NEW.endDate, 'count', NEW.count, 'minutes', NEW.minutes, 'fee', NEW.fee, 'comment', NEW.comment, 'status', NEW.status, 'approvedCount', NEW.approvedCount, 'proposedAt', NEW.proposedAt, 'approvedAt', NEW.approvedAt, 'approvedBy', NEW.approvedBy, 'approvedVia', NEW.approvedVia, 'consentDate', NEW.consentDate, 'approvalNote', NEW.approvalNote, 'termsVersion', NEW.termsVersion, 'familyAck', NEW.familyAck, 'familyAckAt', NEW.familyAckAt, 'familyAckNote', NEW.familyAckNote, 'remindedAt', NEW.remindedAt, 'version', NEW.version, 'createdAt', NEW.createdAt, 'updatedAt', NEW.updatedAt, 'consenterName', NEW.consenterName, 'consentedAt', NEW.consentedAt, 'recordedAt', NEW.recordedAt, 'recordedByName', NEW.recordedByName, 'proposedByName', NEW.proposedByName, 'conditionId', NEW.conditionId, 'specialId', NEW.specialId, 'instructionType', NEW.instructionType),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER terms_version_immutable BEFORE UPDATE ON termsVersions BEGIN
 SELECT RAISE(ABORT,'terms versions are immutable; register a new version');
END;
CREATE TRIGGER terms_version_keep BEFORE DELETE ON termsVersions BEGIN
 SELECT RAISE(ABORT,'terms versions are retained');
END;
