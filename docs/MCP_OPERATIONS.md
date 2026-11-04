# MCP(ChatGPT / Codex 連携)運用手順

最終整理: 2026-09-08。**MCPの接続・鍵変更・停止・再配置・トラブル対応はこのファイルを正本**とします。設計理由・未採用の更新候補・過去検証は [MCP_DESIGN.md](MCP_DESIGN.md)、全体構成は [SYSTEM.md](SYSTEM.md)、未完了の作業は [FUTURE_WORK.md](FUTURE_WORK.md) を参照してください。

照合基準は `stepwise-kobetsu` の `1f0f522` と、別リポジトリ `stepwise-mcp` の `c3fc9e0`。今回の整理はローカルソースと既存文書の確認であり、Cloudflare・ChatGPT・Codexの現在の認証や本番疎通を再検証したものではありません。過去の登録済み記録を現在の疎通確認に代えず、作業目的に必要な状態を確認します。

## 0. 2026-10-08 から：作り直し（v2）を読む（閲覧だけ）

2026-10-08 の切り替えで、今の台帳（D1 `stepwise`）は読むだけになり、正本は v2（D1 `stepwise-v2`、API は Worker `stepwise-api` の `/v2/`）。MCP も同日から **v2 を読む**形にした（`stepwise-mcp` 0.4.0、`src/toolsV2.ts`・`src/v2.ts`）。

```
ChatGPT / Codex ─OAuth(パスフレーズ)─► Workers "stepwise-mcp"(/mcp) ─serviceKey─► Workers "stepwise-api"(/v2/…) ─► D1 stepwise-v2
```

- **鍵**：`stepwise-api` の Secret `V2_SERVICE_KEY` と、`stepwise-mcp` の Secret `STEPWISE_V2_KEY` に同じ値（36 バイトの乱数）。鍵が合えば、代表のスタッフとして **読むだけの操作**（`cf/v2/service.mjs` の `SERVICE_READS`）を通す。登録・変更は `service` のエラーで断る。鍵は Secret にだけ置く（文書・Git・チャットに書かない）。替えるときは乱数を作って両方の Secret に入れ直し、両 Worker を出し直す。
- **MCP 側**：`STEPWISE_V2_KEY` と `STEPWISE_API_URL` が要る。閲覧のツールは 5 つ。前の仕組み（GAS）向けのツールとコードは 2026-11-04 に除いた。
- **ツール**：`find_student`（students/list）、`get_schedule`（schedule/staff/range。授業・連絡・共有予定・先生の休み・面談。`version` と連絡の `id` も返す）、`get_student`（students/hub）、`get_pending_actions`（home/today と monthly/overview。給与は見せない）、`get_billing_summary`（billing/month と billing/fees/list）。
- **返さないもの**：メール・電話・専用リンク（名前が Link で終わる項目すべて）・Meet の URL・鍵（`scrub`）。Worker も `students/hub` の専用リンクを外のサービスに渡さない。
- **確かめ方**：`stepwise-kobetsu` で `V2_SERVICE_KEY=<仮の鍵> node scripts/dev-v2-preview.mjs` を起動し、`stepwise-mcp` で `STEPWISE_API_URL=http://localhost:8790 STEPWISE_V2_KEY=<同じ鍵> node test/v2-client.mjs`。本番には触れない。
- **登録・変更**は管理画面（/staff/）か、下の「書き込み」のツールで行う。
- 以下の 1〜 章は今の仕組み（GAS / 今の Worker）向けの記述で、切り替え後は参考。

### 書き込み（2026-10-13〜。予定の保存と、選んだ授業だけのお知らせを分ける）

きっかけ：体験授業の登録で別の生徒を選び、その場でメールが届いてしまった（取り戻せない）。保存は未送信のまま、お知らせは選んだ授業だけを確かめてから、の 2 段にする。設計の元は Kura の reference/stepwise-mcp-write-claude-handoff.md、コードは `cf/v2/mcp-writes.mjs`（Worker）と `stepwise-mcp` の `src/toolsV2Write.ts`。

```
ChatGPT / Codex ─► stepwise-mcp ─serviceWriteKey─► stepwise-api /v2/mcp/… （mcp/ の道だけ）
```

| MCP のツール | Worker の道 | すること | メール |
|---|---|---|---|
| `save_lessons` | `mcp/lessons/save` | 授業をまとめて**未送信（held）**で保存。`dry_run` で判定だけ。`request_id` で冪等（同じ ID の再実行・並行・応答の消失で増えない。違う内容で同じ ID は断る） | 0 |
| `get_lessons` | `mcp/lessons/get` | ID で読み戻す（状態・版・お知らせの履歴） | 0 |
| `fix_unsent_lesson` | `mcp/lessons/fix` | 未送信の授業だけ直す（生徒の付け替えも）。版が合うときだけ | 0 |
| `preview_lesson_notice` | `mcp/notices/preview` | 選んだ授業 ID だけについて、生徒・宛先（伏せ字）・本文・通数・状態の変わり方と確認値（confirm）。対象の生徒（studentIds）と違う授業・送ったあとの授業・重複は断る | 0 |
| `send_lesson_notice` | `mcp/notices/send` | confirm が今の状態と合うときだけ、選んだ授業（下書き・調整中）だけの**確認をお願いする**（確認待ち。締め切りを 1 つにそろえ、保護者に生徒ごと 1 通。近い授業は締め切りなし。結果に LINE に貼る文 `lineText`）。体験はメールなしで確定（カレンダー）。同じ requestId は二重に送らない | 生徒ごと 1 |
| `reschedule_lesson` | `mcp/lessons/reschedule` | 授業の変更（日時・長さ・科目・種類・形式・担当）。下書きは黙って。送ったあとの授業は dry_run の confirm が要る。確認待ちは日時を変えると調整中に戻る。1:2 などの要確認は `force` | 確定した授業の日時が変わるときだけ 1 通 |
| `create_trial_student` | `mcp/trials/create` | 体験生の登録。**専用リンク（生徒ページへの永続アクセス）は作らない**（`off.` の使えない鍵。管理画面の「専用リンクを作り直す」で使えるようになる）。同じ名前の体験生がいれば止める | 0 |
| `get_write_request` | `mcp/requests/get` | requestId の結果と、送ったメールの今の状態（sent / pending / failed） | 0 |
| `add_student_event` | `mcp/events/add` | 生徒のテスト・行事・授業ができない日の登録（管理画面の「予定」と同じ。登録者はスタッフ）。`dry_run` で判定と、同じ期間の同じ種類の予定（overlapping）を見せる。`request_id` で冪等。同じ期間に同じ種類があれば止める（別の予定なら `allow_overlap`）。直す・消すのは管理画面。2026-11-01、AI が「テストの日程は書き込めない」と答えたため | 0 |
| `show_lessons` | `mcp/lessons/show` | 選んだ下書きを**調整中**にする（管理画面の「調整中にする」と同じ）。保護者・生徒のページに「調整中」で出るが、締め切りもメールもない。1 つでも下書きでない・ほかの生徒・過去の授業が入っていれば何もしない。体験生は断る（`send_lesson_notice` で確定に）。`dry_run` で対象だけ、`request_id` で冪等。2026-11-01、AI が「MCP からは調整中にできない」と答えたため | 0 |
| `unsend_lessons` | `mcp/lessons/unsend` | 選んだ調整中・確認待ちを**下書きに戻す**（保護者・生徒のページから消える） | 0 |
| `rest_lesson` | `mcp/lessons/rest` | お休みにする。dry_run の confirm が要る。確定した授業はカレンダーから消す。前日23時を過ぎた確定の授業は断る（取消料の判断は管理画面） | 0 |
| `add_teacher_off` | `mcp/teacherOff/add` | 先生の休みの登録（1 人か教室全体、31 日まで）。重なる授業は見せるだけで動かさない | 0 |
| `resolve_contact` | `mcp/contacts/resolve` | 生徒・保護者からの連絡を済みにする。授業は変えない | 0 |
| `record_exam` | `mcp/exams/save` | 試験と科目ごとの点数の登録・更新。保護者・生徒のページに出る。成績票の添付と試験の削除は管理画面 | 0 |

- **鍵**：`stepwise-api` の Secret `V2_SERVICE_WRITE_KEY` と、`stepwise-mcp` の Secret `STEPWISE_V2_WRITE_KEY` に同じ値。**読み取りの鍵（V2_SERVICE_KEY）とは別の値**にする（同じ値は Worker が断る）。読み取りの鍵では mcp/ の道は通らず、書き込みの鍵では mcp/ 以外（一般の管理 API）は通らない。どちらの Secret も無ければ、書き込みのツールは出ない・誰も書けない。
- **範囲**：`stepwise-api` の `V2_SERVICE_WRITE_SCOPE` が `all` でなければ、テスト用の生徒（testOnly か名字が【テスト】）だけ。本物の生徒に使うのは、テストで流れを確かめてから `all` にする（本人の承認）。**2026-10-13 に `all`**（`cf/wrangler.jsonc` の vars。【テスト】の生徒で本番の一回りを確かめ、本人が承認）。テスト用だけに戻すときは、その行を消して deploy。
- **履歴**：送ったお知らせは `lessonNotices`（授業ごと・宛先は伏せ字・メールの effects の ID）。訂正しても消さない。依頼は `mcpRequests` / `mcpRequestItems`。メールは送信の控え（effects）に入り、届いたかは effects の状態。送れなかったメールを自動で再送はしない（送信の記録で送り直す）。
- **しないこと**：授業の確定・削除、請求・金額・契約・同意の代行・支払い、汎用の管理 API の直通。保存や訂正のついでのお知らせ。
- **確かめ方（本番に触れない）**：`stepwise-kobetsu` で `node --test test/v2-mcp-writes.test.cjs`（受入条件。誤選択→訂正→プレビュー→送信、冪等、選んだ ID だけ、古いプレビュー、日程変更、体験生のリンク）。MCP までつなぐなら、仮の鍵 2 つで `scripts/dev-v2-preview.mjs --live`（`V2_SERVICE_KEY`・`V2_SERVICE_WRITE_KEY`）を起動し、`stepwise-mcp` で `node test/v2-write-client.mjs`（`STEPWISE_API_URL`・`STEPWISE_V2_KEY`・`STEPWISE_V2_WRITE_KEY`）。
- **使えるようにする手順（本人の承認が要る）**：①DB2 の移行 `0021_mcp_writes.sql` → ②`stepwise-api` の deploy → ③新しい乱数を作り、`stepwise-api` に `V2_SERVICE_WRITE_KEY`、`stepwise-mcp` に `STEPWISE_V2_WRITE_KEY` を Secret で入れる（値は文書・Git・チャットに書かない）→ ④`stepwise-mcp` の deploy（ツールが出る）→ ⑤【テスト】の生徒で一回りを確かめる → ⑥`V2_SERVICE_WRITE_SCOPE=all`。止めるときは ③の Secret を消す（ツールが消え、Worker も断る）。

## 1. 構成と置き場所

```
ChatGPT(Chat/Work)  ─OAuth(パスフレーズ)─►  Cloudflare Workers "stepwise-mcp"  ─mcpKey─►  GAS(/exec)  ─►  スプレッドシート
Codex(このPC)       ─OAuth(パスフレーズ)─►  同じ Cloudflare Workers(/mcp)      ─mcpKey─►  GAS(/exec)   ※2026-09-08 にリモート版へ一本化
(予備)Codex         ─stdio────────────►  PC内の同じコード(dist/stdio.js) ─mcpKey─►  GAS(/exec)   ※config.toml にコメントアウトで残置
```

| もの | 場所 | 備考 |
|---|---|---|
| MCPサーバーのコード | `C:\Users\mugir\dev\stepwise-mcp`、GitHub private `mugilives-max/stepwise-mcp` | `src/tools.ts` ツール、`src/gas.ts` 中継・再試行、`src/stdio.ts` ローカル入口、`src/worker.ts` リモート入口、`wrangler.jsonc` 配置先 |
| リモート接続先 | `https://stepwise-mcp.stepwise-edu.workers.dev/mcp` | Worker `stepwise-mcp`、workers.devサブドメイン `stepwise-edu`、Cloudflareアカウント mugilives@gmail.com、KV binding `OAUTH_KV` |
| Cloudflare Secrets | Workerに設定 | `STEPWISE_GAS_URL`、`STEPWISE_MCP_KEY`、`MCP_LOGIN_PASSWORD`。値を文書・Git・チャット・コマンド引数に残さない |
| PC側の設定(予備のstdio用) | `C:\Users\mugir\dev\stepwise-mcp\.env`(gitignore) | `STEPWISE_GAS_URL`、`STEPWISE_MCP_KEY`、`STEPWISE_CLIENT=codex`。stdioは実行ファイルからプロジェクト直下の.envを解決するため、別の作業ディレクトリから起動できる。通常運用(リモート版)では使わない |
| GAS側 | Apps Script「ステップワイズ予約システム」のScript Properties `MCP_KEY` | `Code.gs`の `mcpEntry_`、`MCP_READ_OPS` / `MCP_WRITE_OPS`。先生用adminTokenとは独立 |
| 呼び出し記録 | 予約台帳の `mcpLog` | `time / requestId / client / op / target / params / result / ms`。requestIdは監査欄で、重複実行防止機能ではない |
| ChatGPT側の登録 | 接続設定内の「Stepwise」 | 2026-09-07にOAuthで登録した記録。設定画面の分類名や提供条件は使用中の画面で確認 |
| Codex側の登録 | `C:\Users\mugir\.codex\config.toml` の `[mcp_servers.stepwise]` | 2026-09-08 から `url = "https://stepwise-mcp.stepwise-edu.workers.dev/mcp"`(ChatGPTと同じ接続先)。認証は `codex mcp login stepwise`(OAuth、パスフレーズ)。旧stdio登録はコメントアウトで残置 |

### ChatGPTの接続・再接続

接続設定で上記 `/mcp` URLとOAuthを指定し、Stepwiseの認可画面で**MCP専用パスフレーズ**を入力します。Googleサインインではなく、先生・保護者ページのパスワードとも別です。接続先を確認し、パスフレーズをAIとの会話へ貼り付けません。

登録済みなら、まず既存Stepwiseの有効状態・認証エラーを確認します。削除して作り直すのは登録修復や再認証に必要な場合に限り、Worker障害やGASキー不一致を再登録で直そうとしません。組織の接続制限が表示される場合は、その制限に従って設定します。

### Codexの接続・再接続(リモート版、2026-09-08〜)

既存登録を重複させず、必要な項目だけ合わせます。秘密値を含まない登録形:

```toml
[mcp_servers.stepwise]
url = "https://stepwise-mcp.stepwise-edu.workers.dev/mcp"
startup_timeout_sec = 60
```

初回、または認証が切れたときは PowerShell で `codex mcp login stepwise` を実行します(Codex CLI 0.153 で確認。`codex mcp add --url` と `codex mcp login` が使える)。ブラウザに Stepwise の認可画面が開くので、**MCP専用パスフレーズ**(ChatGPT と同じもの)を本人が入力します。Codex は動的クライアント登録(DCR)で接続するため、認可画面と `mcpLog` の `client` 列には Codex 側が名乗る client_name が出ます(Worker は 2026-09-08 から OAuth の client_name を `client` として GAS に渡す)。登録の確認は `codex mcp get stepwise`、認証の解除は `codex mcp logout stepwise`。

利点: コード変更の反映が `npx wrangler deploy` の1系統だけになり、PC の `.env` と `dist` に依存しません。欠点: Worker か Cloudflare が止まると Codex からも読めません。その場合は `config.toml` にコメントアウトで残してある stdio 登録に戻し(`npm run build` 済みの `dist/stdio.js` と `.env` が必要)、Codex を再起動します。

(参考・予備)stdio 登録形:

```toml
[mcp_servers.stepwise]
command = "node"
args = ["C:/Users/mugir/dev/stepwise-mcp/dist/stdio.js"]
```

stdio は `.env` をプロセス開始時に読みます。`dist` や .env 変更後は Codex を再起動して読み直します。stdio に別の OAuth ログインはありませんが、PC アカウントと .env へのアクセスが信頼境界です。

## 2. いま使える機能

ツールの一覧は 0 章。1:2（同じ講師の 2 人同時）は `save_lessons`・`fix_unsent_lesson`・`reschedule_lesson` の要確認で止まり、先生が承知なら `force` で通す。3 人同時と同じ生徒の重なりは `force` でも通らない。

## 3. 緊急停止と再開

| 目的 | 手順と影響 |
|---|---|
| **MCPのデータアクセスを全部止める** | Apps Scriptエディタで `mcpDisable` を実行し、Script Propertiesの `MCP_KEY` を削除。ChatGPT・CodexのMCPリクエストを拒否する。管理画面・生徒/保護者ページの認証は変えない。OAuth認可そのものを削除する操作ではない |
| **登録だけ止める(閲覧は残す)** | エディタで `mcpRestrictWritesToTest` を実行(`MCP_WRITE_SCOPE=test`)。実生徒・先生の休みへの登録が `scope` エラーで拒否される。戻すのは `mcpEnableWrites` |
| 再開する / キーを交換する | `mcpRotateKey` を実行し、新キーをPC.envの `STEPWISE_MCP_KEY` とWorker Secretの同名項目へ設定。キーは実行ログに表示されるので公開ログ等へ転記しない。旧キーは即無効で、設定途中はMCPが使えない。PC側プロセスを再起動し、両経路で必要最小限の読み取りを確認 |
| このChatGPTの登録だけを止める | ChatGPT側でStepwiseを無効化・削除。他の接続元や発行済みOAuth認可のサーバー側失効は保証しない |
| リモートMCPを止め、stdioを残す | Cloudflare側で当該Workerの公開入口を停止し、`/mcp`からデータを取得できないことを確認。既存OAuth認可を消したことにはならない |
| MCPログイン用パスフレーズ変更 | `npx wrangler secret put MCP_LOGIN_PASSWORD` の秘密入力を使う。12文字以上。新規認可は新しい値を要求するが、既存認可は別途扱う |

**パスフレーズ変更だけでは既存接続を失効できません。** access tokenは8時間ですが、refresh tokenで更新されます。「8時間待てば新パスフレーズが必要になる」という旧説明は使用しません。

既存OAuth認可・refresh tokenの個別失効手順は未整備です。整備する作業の正本は [FUTURE_WORKの該当課題](FUTURE_WORK.md#mcpの既存oauth認可の失効手順)。漏えい等で既存認可も止める必要がある場合は、まずGASキー無効化またはWorker入口停止でアクセスを遮断します。再開前に対象認可・トークンの失効を確認し、キーやパスフレーズの交換だけで解決したと扱いません。OAuth用KVにはクライアント登録等も入るため、原因確認なしに全件削除する手順にはしません。

GASのキー認証失敗は共通キャッシュで数え、20回以上で一時拒否します。失敗記録のTTLは600秒です。誤ったキーを繰り返し試さず、設定を確認して再試行します。

## 4. よくある作業(PowerShell、`cd C:\Users\mugir\dev\stepwise-mcp` してから)

目的別のコマンドです。上から全部実行するチェックリストではありません。作業前に `git status` で未完了変更を確認し、同じファイルを他のAIと同時編集しません。

| 目的 | コマンド | 注意点 |
|---|---|---|
| Cloudflareログイン先確認 | `npx wrangler whoami` | 想定アカウント・配置先と照合 |
| Cloudflare再ログイン | `npx wrangler login` | 認証が切れたときに本人がブラウザで認証 |
| Secret項目確認 | `npx wrangler secret list` | 名前だけで値の一致は確認できない |
| 専用パスフレーズ変更 | `npx wrangler secret put MCP_LOGIN_PASSWORD` | 3章の既存認可への影響を確認 |
| 予備stdio用コード生成 | `npm run build` | 通常運用(リモート版)では不要。stdioに戻すときだけ。`dist`更新後はプロセス再起動 |
| Workers再配置 | `npx wrangler deploy` | 本番変更。5章の検証と対象確認後に実行 |
| 本番ログ参照 | `npx wrangler tail` | 必要な期間だけ実行しCtrl+Cで終了。ログを公開文書や会話へそのまま貼らない |

既存テストには本番接続設定を使うものがあります。ドキュメント変更だけなら実行しません。実行前にソース・接続先・出力対象を確認します。

| テスト | 確認できること | 実行時の影響・限界 |
|---|---|---|
| `node --test test/v2-tools.test.mjs` | 応答の組み立てと `scrub`（`npm run build` のあと） | ネットワークなし |
| `node test/oauth-flow.mjs` | OAuthメタデータ・動的登録・認可画面・拒否。PASS指定時は認可後の呼び出しも実行 | BASEの既定はlocalhost。PASSが空でもクライアント登録と誤パスフレーズ1回を実行し、KVや失敗回数を変更する。本番へ単なる読み取り疎通として繰り返さない |

本番OAuth試験が必要な場合は `BASE`を対象のWorker originへ設定し、既存の `PASS`環境変数を意図せず引き継いでいないことを確認します。パスフレーズを使う試験は秘密値を安全に入力できる環境で行い、認可コードを含む出力や生徒データを外部へ貼り付けません。全体データが不要なら既存スクリプトを一括実行せず、対象を絞った読み取りや `mcpPing`で確認します。

## 5. ツールを追加・変更する手順

1. `stepwise-kobetsu` の `cf/v2/mcp-writes.mjs` に `mcp/` の道を足す。`dryRun` で何も書かず、`requestId` で冪等にし、`checkScope` を通す。テストは `test/v2-mcp-writes.test.cjs`。
2. 本番へは stepwise-kobetsu のリリース（PR → Worker → マージ）で出す。
3. `stepwise-mcp` の `src/toolsV2.ts`（閲覧）か `src/toolsV2Write.ts`（書き込み）にツールを足し、`npm run build` と `node --test test/v2-tools.test.mjs` を通す。
4. Worker のあとで `npx wrangler deploy` し、dry_run で確かめる。
5. この文書の 0 章の表を直す。

[MCP_DESIGN.md](MCP_DESIGN.md) の非公開の操作を増やすときは、本人に確かめる。

## 6. トラブルシューティング

| 症状 | 確認と対応 |
|---|---|
| ChatGPTで認証・接続失敗 | Workerの `/`に説明ページが出るか、`/mcp`が未認証を拒否するか確認。入口が動くことだけではGAS疎通は確認できない。Worker、OAuth、GASキーのどこで失敗したかを調べ、登録修復が必要と分かってから再接続 |
| パスフレーズ違い・試行制限 | WorkerはIP単位の失敗10回、失敗記録TTL600秒。繰り返し試さず、必要なら3章で変更。12文字未満のSecretでは設定エラー |
| ツールが要確認（`needsConfirm`・`needForce`）を返す | 1:2（同じ講師の 2 人同時）か、先生の休み・生徒の授業できない時間と重なっている。先生が承知なら `force=true` で再実行 |
| 遅い・通信失敗 | 中継は1試行25秒、例外時に1.5秒待って1回再試行。起動待ち・Spreadsheet・ScriptLock待ち等を切り分ける。正常なJSONの業務エラーは自動再試行しない。更新ツールへこの再送を流用しない |
| Codexで接続できない | まず `codex mcp get stepwise` で `url` が上記 `/mcp` か確認し、`codex mcp login stepwise` で再認証。Workerの `/` と `/mcp`(未認証で401)の応答も確認。予備のstdioに戻す場合は Node、生成済みdist/stdio.js、プロジェクト直下.envの存在・項目を確認し、ビルド後に再起動。.envの値を丸ごと出力しない |
| パスフレーズ変更後も接続可能 | refresh tokenで更新され得るため想定内。強制切断が目的なら3章の停止・認可失効を確認 |
| deployでsubdomain設定を要求 | whoamiとwrangler.jsoncが既存アカウント・Workerを指すか確認。新規作成が意図された作業と確認してから画面に沿って設定 |

## 7. 費用・上限

Workers、KV、GAS、接続元アプリの料金・上限は契約・アカウント種別・提供条件で変わります。初期文書の「追加費用0円」「規模的に超えない」「固定の無料枠・メール通数」を現在の保証に使いません。利用増加や配置変更時は、対象アカウントの請求設定・使用量・適用上限を確認してください。

現行コードの指定はGAS中継1試行25秒・例外時1回再試行、OAuth access token 8時間です。サービス側のCPU・実行時間・メール・KV上限とは区別します。現在MCPはメールを送る業務更新を公開していませんが、閲覧・ログ・OAuth登録でもリクエストや保存の使用量は増えます。
