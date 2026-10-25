# stepwise-kobetsu — AI共通の入口

（2026-10-08 にリポジトリ名を stepwise-eisu から stepwise-kobetsu に変えた。塾は「ステップワイズ個別指導」で、英数教室は前身の名前のため。古い URL は GitHub が転送する。）

Claude / Codex 共通。塾のホームページと予約・管理システム。画面はGitHub Pages、APIはApps Script、業務データはDriveの2台帳にある。

## 重要な制約

- 作業開始時はGitの状態を確認し、既存の変更を上書きしない。共有作業先は `C:\Users\mugir\dev\stepwise-kobetsu`。同じファイルを同時編集しない。
- 動作確認の書き込みは名前が `【テスト】` で始まる生徒だけ。実生徒の予定・記録はテストで変更しない。移行・上書き・削除は対象と差分を確認し、復元可能にしてから行う。
- 公開リポジトリに実生徒の氏名・ID・専用リンク・認証情報を置かない。先生のパスワードは本人が入力する。新しいOAuth権限への同意はユーザーの明示的な承認が必要。既に許可された作業で段階ごとの再承認は求めない。
- 関連する変更はローカルでまとめて開発・検証し、公開を一括で行う。公開単位と例外は [SYSTEM.md 6章](docs/SYSTEM.md#6-更新デプロイ手順) を参照する。`gas/*.gs` は本番へ反映するソースで、開発中の未反映差分はGitで区別する。GitへのpushだけではGASに反映されない。

## 画面の大原則：レイアウトに説明させる（2026-10-25 本人）

「不要なセカンダリラベルや説明を避ける。レイアウトに説明させる。」管理システム（/staff/・/family/・/student/）とホームページを作る・直すときは、すべてこれに従う。

- 見出し・ボタン・値で分かることに、補足の小さな文字・説明文・注記を重ねない（一覧の行の下の灰色の一行、見出しの下の説明、「〜できます」「〜します」の案内など）。
- まとまり・順番・重みは、並び・区切り・余白・大きさ・位置で示す。文で説明したくなったら、まず配置を直す。
- ラベルは値だけでは何か分からないときだけ付ける（日付・金額・名前のように見れば分かる値に「日付：」を付けない）。
- 文字で残すのは、配置では伝わらないことだけ：取り消せない操作で起きること、締め切り、お金、エラーと直し方。
- 経緯と具体例は [UI_UX_REVIEW.md](docs/UI_UX_REVIEW.md#基本方針レイアウトに説明させる)。

## 必要なときに読む

全資料の通読は不要。対象に関係する節とコードを読む。

| 作業 | 正本・参照先 |
|---|---|
| 構成、台帳、画面、API、デプロイ | [SYSTEM.md](docs/SYSTEM.md) |
| 本人が自分で試す検証環境（ステージング。架空のデータ・メールは送らない・最初の状態に戻せる） | [SYSTEM.md 6-0](docs/SYSTEM.md#6-0-検証環境ステージング2026-10-19) |
| 未完了事項、次の作業、運用上の判断 | [FUTURE_WORK.md](docs/FUTURE_WORK.md) |
| UI・UXの目的、合意した方針、課題・改善候補・未決事項 | [UI_UX_REVIEW.md](docs/UI_UX_REVIEW.md) |
| 保護者認証の変更・検証・復旧 | [PARENT_AUTH.md](docs/PARENT_AUTH.md) |
| メール通知（誰に・いつ・何を送るか、止め方）の追加・変更 | [EMAIL_NOTIFICATIONS.md](docs/EMAIL_NOTIFICATIONS.md) |
| MCPの接続・停止・更新 / 将来の書き込み設計 | [MCP_OPERATIONS.md](docs/MCP_OPERATIONS.md) / [MCP_DESIGN.md](docs/MCP_DESIGN.md) |
| 授業サイクルの導入順 / 初回実装 | [REDESIGN_MASTER_PLAN.md](docs/REDESIGN_MASTER_PLAN.md) / [LESSON_CYCLE_PHASE1_SPEC.md](docs/LESSON_CYCLE_PHASE1_SPEC.md) |
| 作り直し（v2）の要件・設計・進み具合（家族が根っこ、`cf/v2/`・`cf/migrations-v2/`・`/staff/`） | [REQUIREMENTS.md](docs/REQUIREMENTS.md) / [REBUILD_DESIGN.md](docs/REBUILD_DESIGN.md) / [FEATURE_INVENTORY.md](docs/FEATURE_INVENTORY.md) / 切り替えの手順と案内文 [CUTOVER_RUNBOOK.md](docs/CUTOVER_RUNBOOK.md) |
| 受講規約・正式採用本文（2026-10-14改訂、Web・PDFとシステムへの適用状況はREADME）/ 公開・同意への反映状況 | [TERMS.md](docs/terms-restructure-2026-11/TERMS.md) / [採用・公開の状態](docs/terms-restructure-2026-11/README.md) |
| 日程の決め方（締め切りと自動確定・確定後の変更）の設計 | [SCHEDULING_FLOW_DESIGN.md](docs/SCHEDULING_FLOW_DESIGN.md)。旧規約草案ではなく上記の正式採用本文を参照する |
| 講師の雇用契約書（労働条件通知書を兼ねる）の下書き | [EMPLOYMENT_CONTRACT_DRAFT.md](docs/EMPLOYMENT_CONTRACT_DRAFT.md) |
| 過去の調査根拠 / 旧契約条項案 | [REDESIGN_CURRENT_STATE.md](docs/REDESIGN_CURRENT_STATE.md) / [CONTRACT_CLAUSES_DRAFT.md](docs/CONTRACT_CLAUSES_DRAFT.md) |

本人が決めたこと（条件・方針・数値）をこのリポジトリの文書に書いたら、同じときに Kura の記憶にも残す（MCP の `remember`。誰が・いつ・前の値も。me の `skills/memory-write.md` の「決まったことと状態の書き方」、2026-10-15）。記憶の外で決めたことが記憶に入らず、古い草案から話が進んだことがあるため。

仕様や運用が変わったら該当する正本を更新し、後続作業に影響する未解決事項だけをFUTURE_WORKへ残す。別の引き継ぎ資料やDriveの本文コピーを増やさない。

確認は影響に合わせる。文書だけならリンク・参照・記述の整合、コードなら変更した機能の構文・回帰テスト、公開時は影響する画面/APIの反映を確認する。全テストや本番操作を毎回一律に行わない。
