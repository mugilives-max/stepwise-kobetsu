-- 授業計画の行の、目的・教材ごとの回数（任意）。2026-10-13、Kura reference/stepwise-plan-presentation-claude-handoff.md
-- JSON の配列 [{"label":"ウィニングフィニッシュ","count":12}, …]。空（''）なら内訳なし（今までの行はすべて空のまま。書き換えない）。
-- 見せ方だけに使う。請求・割り当て（assignLines）・承認の単位は今までどおり行。
ALTER TABLE planLines ADD COLUMN parts TEXT NOT NULL DEFAULT '';
