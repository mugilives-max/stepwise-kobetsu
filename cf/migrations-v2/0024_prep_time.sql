-- 授業の準備・授業記録の入力の時間（業務給）。2026-10-14 本人決定（Kura storage/stepwise-staff-prep-time-rule-2026-10-14.md）
-- 授業の前に 5 分・後に 5 分。授業・面談をしていない時間に入る分だけ数える（授業と授業の間は 1 回の間につき 10 分まで、続けての授業は 0 分）。
-- 時給は授業と同じ（業務給も 2,000 円）。同じ 1 分を二重に数えない。明細には日ごとの行（kind = prep）を入れる。
-- （置き換えたもの：PR #9 の「1 コマごとに 10 分・最低賃金」。マージしていない）
-- payrollItems.kind の CHECK に prep を足すため、表を作り直す（payrollItems はどこからも参照されていない。2026-10-14 時点で本番は 0 行）
CREATE TABLE payrollItems_new (
  id TEXT PRIMARY KEY,
  payrollId TEXT NOT NULL REFERENCES payrollMonths(id),
  kind TEXT NOT NULL CHECK (kind IN ('lesson', 'meeting', 'prep', 'adjust')),
  lessonId TEXT NOT NULL DEFAULT '',
  meetingId TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL DEFAULT '',
  minutes INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',                -- 例: 数学（架空 一郎さん）・面談・授業の準備・記録・調整の理由
  rate INTEGER NOT NULL DEFAULT 0,               -- 時給（準備・記録は授業の時給）
  amount INTEGER NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0
);
INSERT INTO payrollItems_new SELECT id, payrollId, kind, lessonId, meetingId, date, start, minutes, label, rate, amount, sortOrder FROM payrollItems;
DROP TABLE payrollItems;
ALTER TABLE payrollItems_new RENAME TO payrollItems;
CREATE INDEX payrollItems_payroll ON payrollItems(payrollId);
-- 月の明細に、準備・記録の時間と金額（総支給額に入る）
ALTER TABLE payrollMonths ADD COLUMN prepMinutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payrollMonths ADD COLUMN prepAmount INTEGER NOT NULL DEFAULT 0;
