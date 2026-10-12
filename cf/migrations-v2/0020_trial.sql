-- 体験生（まだ入塾していない人）。2026-10-12 本人（手順書 #48）「正式入塾していない体験生の授業も臨時で予定表に登録・記録できる仕組みを作る」。
-- 生徒の行をそのまま使い（入塾したら trial = 0 にするだけで引き継げる）、体験生の印を足す。
-- 体験の授業は授業の種類「体験」（lessons.kind）で、請求・取消料には入れない（cf/v2/trial.mjs の TRIAL_KIND）。
ALTER TABLE students ADD COLUMN trial INTEGER NOT NULL DEFAULT 0;
