-- 退塾の手続き（2026-10-28 本人「今って退塾の手続きがないので…作った方が良いのかもしれない」）。足すだけ。
-- leaveOn は最終受講日（YYYY-MM-DD）、leaveNoticeAt は保護者から終了の連絡を受けた日時（ISO）。手続きをすると入り、在籍は最終受講日のあとに代表が「退会」にする（共通規約 第22条2項）
ALTER TABLE students ADD COLUMN leaveOn TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN leaveNoticeAt TEXT NOT NULL DEFAULT '';
