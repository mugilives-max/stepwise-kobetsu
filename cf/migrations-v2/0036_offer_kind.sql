-- 以前からの家族の「契約の更新」（2026-10-29 本人「新しい規約と契約書類に以前から利用している顧客に承認してもらう…体験の生徒の入塾手続きを転用できる」）。足すだけ。
-- 入塾の案内（enrollmentOffers）と同じ行・同じ申込みの画面を使い、kind で分ける: enroll = 体験からの入塾、renewal = 在籍している生徒の契約の更新（共通規約と個別受講条件書への同意）
ALTER TABLE enrollmentOffers ADD COLUMN kind TEXT NOT NULL DEFAULT 'enroll';
