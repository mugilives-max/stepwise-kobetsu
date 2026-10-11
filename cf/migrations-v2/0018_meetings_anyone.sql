-- 登録していない人（問い合わせ・体験前）との面談も入れられるようにする（2026-10-11 本人「非登録の人との面談は記入できません。これをどうにかしたい」）。
-- meetings.familyId の参照制約を外し（空 = 家族の登録なし）、相手の名前（withName）を足す。SQLite は制約を直接外せないので表を作り直す。
CREATE TABLE meetings_new (
  id TEXT PRIMARY KEY,
  familyId TEXT NOT NULL DEFAULT '',             -- 登録した家族。空 = 登録していない人（withName に名前）
  withName TEXT NOT NULL DEFAULT '',             -- 登録していない相手の名前（例: 高橋さん（問い合わせ））
  studentId TEXT NOT NULL DEFAULT '',
  staffId TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  deliveryMode TEXT NOT NULL DEFAULT 'in_person' CHECK (deliveryMode IN ('in_person', 'online')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled')),
  title TEXT NOT NULL DEFAULT '',
  calendarEventId TEXT NOT NULL DEFAULT '',
  meetUrl TEXT NOT NULL DEFAULT '',
  payrollId TEXT NOT NULL DEFAULT '',             -- 0011 で足した列（給与に入れた面談）
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO meetings_new (id, familyId, withName, studentId, staffId, date, start, minutes, deliveryMode, status, title, calendarEventId, meetUrl, payrollId, createdAt, updatedAt, version)
  SELECT id, familyId, '', studentId, staffId, date, start, minutes, deliveryMode, status, title, calendarEventId, meetUrl, payrollId, createdAt, updatedAt, version FROM meetings;
DROP TABLE meetings;
ALTER TABLE meetings_new RENAME TO meetings;
CREATE INDEX meetings_date ON meetings(date, start);
CREATE INDEX meetings_family ON meetings(familyId, date);
