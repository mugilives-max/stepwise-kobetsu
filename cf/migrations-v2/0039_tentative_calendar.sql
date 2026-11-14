-- 調整中・確認待ちの授業を代表の Google カレンダーへ写した予定（2026-11-14 本人「調整中の授業も１日の終わりとかにカレンダーに反映してほしい」）。足すだけ。
-- 授業 1 つに予定 1 つ。eventId は Google の予定 ID（作るときに決める目印 v2t…）。hash は題名・日時などの指紋（変われば作り直す）。
-- effectId は最後に頼んだ作成（effects.id。送れたかを次の晩に確かめる）。cf/v2/tentative-calendar.mjs
CREATE TABLE tentativeEvents (
  lessonId TEXT PRIMARY KEY,                    -- lessons.id（授業の行が消えても残り、次の晩に予定ごと消す。外部キーにしない）
  eventId TEXT NOT NULL,
  hash TEXT NOT NULL,
  effectId INTEGER NOT NULL DEFAULT 0,
  syncedAt TEXT NOT NULL
);
