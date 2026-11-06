-- 生徒ごとの「日程の条件」（2026-11-07 本人「生徒ごとに予定の調整をする上で考慮する条件みたいなのを記録しておく場所が必要」）。足すだけ。
-- 曜日・開始時刻の希望、一緒に入れる生徒などのくり返しの条件を自由に書く。教室管理者だけが見る。既定は空
ALTER TABLE students ADD COLUMN scheduleNote TEXT NOT NULL DEFAULT '';
