-- 通常指導の基準単価を 90 分あたりで持つ（2026-10-14 本人「30分あたりで記載されているのが気持ち悪い。90分あたりに」。契約書の基本指導条件も 1 回 90 分と授業料）。
-- 正本は baseFee90（90 分の授業料、円）。baseRate30（30 分）は互換のために残し、baseFee90 ÷ 3 を四捨五入して一緒に書く（読むところは baseFee90 を使う）。
-- 今の行は baseRate30 × 3 で埋める（1,500 円 → 4,500 円）。
ALTER TABLE students ADD COLUMN baseFee90 INTEGER NOT NULL DEFAULT 0;
UPDATE students SET baseFee90 = baseRate30 * 3;
