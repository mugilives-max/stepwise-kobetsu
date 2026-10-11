-- 個別指導条件（規約 第2条の「個別指導条件書」）。2026-10-12 本人の決定「v2 に作る」。
-- 生徒ごとに、基本の授業時間と1回の税込基本単価・形式・人数・生徒本人の連絡の可否・科目・特記・適用開始月を版（no）で持つ。
-- 教室管理者が「条件を決めてお知らせ」（proposed）→ 保護者が保護者ページで同意（agreed）。書面・LINE の承諾は教室管理者が記録する。
-- 新しい版をお知らせすると、前の proposed は replaced。前の agreed はそのまま残り、新しい版に同意するまでの有効な条件になる。
CREATE TABLE conditions (
  id TEXT PRIMARY KEY,
  studentId TEXT NOT NULL REFERENCES students(id),
  no INTEGER NOT NULL,                          -- 版（生徒ごとに 1, 2, …）
  minutes INTEGER NOT NULL,                     -- 基本の授業時間（分）
  fee INTEGER NOT NULL,                         -- 1回の税込基本単価（円）
  deliveryMode TEXT NOT NULL DEFAULT '',        -- in_person / online / both
  groupSize TEXT NOT NULL DEFAULT '',           -- 人数の説明（教室は最大2名、オンラインは1対1 など）
  studentContact INTEGER NOT NULL DEFAULT 0,    -- 生徒本人からの連絡（前日23時までの無料のお休み）を認める
  subjects TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',                -- 特記事項（共通条件と異なる合意）
  fromMonth TEXT NOT NULL DEFAULT '',           -- 適用開始月（YYYY-MM）
  termsVersion TEXT NOT NULL DEFAULT '',        -- お知らせしたときの規約の版
  status TEXT NOT NULL CHECK (status IN ('proposed', 'agreed', 'replaced')),
  proposedAt TEXT NOT NULL,
  proposedBy TEXT NOT NULL DEFAULT '',
  agreedAt TEXT NOT NULL DEFAULT '',
  agreedVia TEXT NOT NULL DEFAULT '',           -- 保護者ページ / LINE / 書面 …
  agreedBy TEXT NOT NULL DEFAULT '',            -- family:<id> / staff:<id>
  agreedNote TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX conditions_student ON conditions(studentId, no);
