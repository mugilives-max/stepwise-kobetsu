-- MCP からの書き込み（予定の保存と、選んだ授業だけのお知らせを分ける）。2026-10-13、Kura の reference/stepwise-mcp-write-claude-handoff.md。
-- 保存は未送信（held）で、お知らせは選んだ授業 ID だけ・プレビューの確認値が合うときだけ。同じ requestId の再実行は保存済みの結果を返す。

-- 依頼ごとの記録（冪等）。kind: lessonsSave / notice / reschedule / trialCreate。入力のハッシュが違う同じ requestId は断る
CREATE TABLE mcpRequests (
  requestId TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  inputHash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  result TEXT NOT NULL DEFAULT '{}',             -- 返した結果（秘密は入れない）
  actorId TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- 保存の項目ごとの記録。授業の行と同じバッチで書くので、同じ項目が 2 回作られることはない
CREATE TABLE mcpRequestItems (
  requestId TEXT NOT NULL,
  itemKey TEXT NOT NULL,
  inputHash TEXT NOT NULL,
  lessonId TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  PRIMARY KEY (requestId, itemKey)
);

-- 授業ごとのお知らせの履歴（誰に・何を・いつ送ったか）。訂正しても消さない。effectId は effects 表のメール（無ければ NULL）
CREATE TABLE lessonNotices (
  id TEXT PRIMARY KEY,
  requestId TEXT NOT NULL,
  lessonId TEXT NOT NULL,
  studentId TEXT NOT NULL,
  action TEXT NOT NULL,                          -- propose（仮予定のお知らせ）/ decideTrial（体験を決定・カレンダー）/ reschedule（日時の変更のお知らせ）
  effectId INTEGER,
  toMasked TEXT NOT NULL DEFAULT '',             -- 宛先（伏せ字）
  createdAt TEXT NOT NULL
);
CREATE INDEX lessonNotices_lesson ON lessonNotices(lessonId);
CREATE INDEX lessonNotices_request ON lessonNotices(requestId);
