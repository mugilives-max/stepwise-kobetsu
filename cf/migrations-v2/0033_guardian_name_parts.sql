-- 保護者の氏名を姓・名に分けて持つ（2026-10-19 本人「保護者も氏名は姓・名分けた方が良い。契約書とかを管理する上で使う」）。
-- 足すだけ。今の guardianName・guardianKana（「姓 名」の 1 つの文）はそのまま残し、書面・同意の氏名に使い続ける。
ALTER TABLE families ADD COLUMN guardianFamilyName TEXT NOT NULL DEFAULT '';
ALTER TABLE families ADD COLUMN guardianGivenName TEXT NOT NULL DEFAULT '';
ALTER TABLE families ADD COLUMN guardianFamilyKana TEXT NOT NULL DEFAULT '';
ALTER TABLE families ADD COLUMN guardianGivenKana TEXT NOT NULL DEFAULT '';
