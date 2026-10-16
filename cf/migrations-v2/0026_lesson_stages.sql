-- 授業の予定の段階（2026-10-14 本人決定、2026-10-16 実装。Kura issues/stepwise-lesson-stages、規約 r9 第13〜15条）
-- 下書き（held）→ 調整中（proposed・askedAt 空：お互いに見える・締め切りなし・メールなし・自動で確定しない）
-- → 確認待ち（proposed・askedAt あり：1 回のお願いで締め切り 1 つ・メール 1 通）→ 確定（decided）
-- status の値は変えない（CHECK を作り直さない）。確認待ちかどうかは askedAt で分ける
ALTER TABLE lessons ADD COLUMN askedAt TEXT NOT NULL DEFAULT '';   -- 確認をお願いした時刻（空 = 調整中）
ALTER TABLE lessons ADD COLUMN agreement TEXT NOT NULL DEFAULT ''; -- 確定のもとになった合意（保護者ページのボタン・LINE・電話など。先生が書く。自動確定は「締め切りまでに連絡なし」）
-- 今の行: 締め切りのある調整中（今までの「送った」もの）は確認待ち、締め切りの無いもの（近い授業）は調整中として読む
UPDATE lessons SET askedAt = updatedAt WHERE status IN ('proposed', 'rested') AND confirmBy <> '' AND decidedAt = '';
