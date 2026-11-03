-- 授業ごとの「請求しない」（2026-11-03 本人「30分の授業…中途半端だしもう請求しなくていい」）。足すだけ。
-- 1 = この授業は請求に入れない（授業の記録・回数・給与はそのまま）。既定 0 は今までどおり
ALTER TABLE lessons ADD COLUMN noCharge INTEGER NOT NULL DEFAULT 0;
