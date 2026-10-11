-- 特殊指導の承認（規約 第5条）。2026-10-12 本人「大変な指導を、こういう条件と範囲を基準にやりますよ、それで承認しますか、みたいなものが欲しい」。
-- 生徒ごとに、特殊指導の名称（授業の種類の名前になる）・内容と範囲・通常指導との違い・準備・1回の時間と税込料金・対象期間を版で持ち、
-- 教室管理者が提案（proposed）→ 保護者が保護者ページで承認（agreed）。書面・LINE の承諾は教室管理者が記録。承認された名称の種類でだけ、
-- 基本単価を超える料金の計画を作れる（billing/plans/save）。終わったら ended。
CREATE TABLE specials (
  id TEXT PRIMARY KEY,
  studentId TEXT NOT NULL REFERENCES students(id),
  no INTEGER NOT NULL,
  title TEXT NOT NULL,                          -- 名称（例: 英検準1級対策）。授業の種類（lessonKinds）の名前にもなる
  content TEXT NOT NULL DEFAULT '',             -- 指導の内容と範囲
  reason TEXT NOT NULL DEFAULT '',              -- 通常指導との違い（なぜ特殊指導か）
  prep TEXT NOT NULL DEFAULT '',                -- 必要な準備
  minutes INTEGER NOT NULL,                     -- 1回の時間
  fee INTEGER NOT NULL,                         -- 1回の税込料金
  fromDate TEXT NOT NULL,                       -- 対象期間
  toDate TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  termsVersion TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('proposed', 'agreed', 'replaced', 'ended')),
  proposedAt TEXT NOT NULL,
  proposedBy TEXT NOT NULL DEFAULT '',
  agreedAt TEXT NOT NULL DEFAULT '',
  agreedVia TEXT NOT NULL DEFAULT '',
  agreedBy TEXT NOT NULL DEFAULT '',
  agreedNote TEXT NOT NULL DEFAULT '',
  endedAt TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX specials_student ON specials(studentId, no);
