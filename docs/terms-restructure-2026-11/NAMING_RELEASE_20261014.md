# 契約書類の名称統一（2026-10-14）

規約・関連書類・Web/PDF・管理システムを、本人が選んだ次の3名称へ統一し、本番反映と検証を完了した。

| 旧名称 | 新名称 |
|---|---|
| 基本指導条件書（旧個別指導条件書） | 受講条件書（通常指導） |
| 特殊指導条件書 | 受講条件書（特殊指導） |
| 指導計画承認書 | 受講合意書 |

## 公開した内容

- 正本は [TERMS.md](TERMS.md)、版は `2026-11-20261014-r5`。適用開始日の記載は2026年11月1日のまま。
- r4から名称・見出し・該当する指示語のみを変更した。全135項を照合し、103項は完全一致、32項は確認済みの名称置換後に一致。料金表・実質条件は変更していない。
- [Web版](https://www.stepwise-education.jp/terms/2026-11-20261014-r5/)・[PDF](https://www.stepwise-education.jp/terms/2026-11-20261014-r5/stepwise-terms-2026-11-20261014-r5.pdf)を公開した。
- 空欄の3様式：[通常指導](https://www.stepwise-education.jp/terms/2026-11-20261014-r5/documents/regular/)・[特殊指導](https://www.stepwise-education.jp/terms/2026-11-20261014-r5/documents/special/)・[受講合意書](https://www.stepwise-education.jp/terms/2026-11-20261014-r5/documents/agreement/)。各Web版に1ページPDFを付けた。
- 旧5版のWeb/PDFと免除案内の計12ファイルはblob一致で保持。[一覧](https://www.stepwise-education.jp/terms/)から参照できる。
- 原稿の編集・生成・検証・公開はGitHub上で実施し、ローカルに作業用原稿・出力を作っていない。

## システムと既存書面の保存

- 管理・保護者画面、受講内容の案・合意履歴、書類見本、新規生成書面の表示名を統一した。まだ合意していない案は「受講合意書（案）」等で区別する。
- 新規提案は `templateVersion=20261014-r5`。r3/legacyの提案は、更新後に承認しても提案時の様式・名称・ファイル名を維持する。保存済み書面の本文は書き換えない。
- 既存の契約・同意・計画履歴・ファイル記録・家庭・生徒・設定を更新前の非公開スナップショットと照合し、一致を確認した。
- データ移行・適用規約の設定切替・保護者への送信・同意の代行は行っていない。
- 予定の4段階の実装は別作業。この名称変更で段階分離や確認操作が完成したことにはならない。

## 確認結果

- [PR #71](https://github.com/mugilives-max/stepwise-kobetsu/pull/71)をmainへ反映。公開したアプリケーションのcommitは `a65bbcdac4dfde320497b308af7948d4acf86191`。
- [文書生成](https://github.com/mugilives-max/stepwise-kobetsu/actions/runs/38562908850)：7章32条135項、179アンカー、3表、MarkdownとHTML全文一致。規約PDF全12ページと3様式各1ページを画像で確認。日本語フォント埋め込み・289本文ブロック・390/320px幅も確認した。詳細は [PUBLICATION_CHECKS_20261014_R5.json](PUBLICATION_CHECKS_20261014_R5.json)。
- [システム検証](https://github.com/mugilives-max/stepwise-kobetsu/actions/runs/38563147104)：118テスト成功。隔離したデータベースと架空家庭で画面・書面見本・履歴参照・旧テンプレート保持を確認。
- [Pages公開](https://github.com/mugilives-max/stepwise-kobetsu/actions/runs/38563397730)成功。公開Webと書類一覧、本番管理画面の3名称をブラウザーで確認した。本番の書面見本は別タブを開く方式がブラウザー操作環境で制限されたため、その閲覧完了までは確認していない。見本生成は上記の隔離環境で検証済み。
- [本番更新](https://github.com/mugilives-max/stepwise-kobetsu/actions/runs/38563501703)：118テスト、更新前コードの一致、非公開バックアップの保存・再読込照合まで成功。その後、公開コマンドが正常終了を返さなかった。
- 再公開せず、[PR #72](https://github.com/mugilives-max/stepwise-kobetsu/pull/72)の[確認専用実行](https://github.com/mugilives-max/stepwise-kobetsu/actions/runs/38564505915)で、新Workerがすでに稼働していることを確認。公開済みモジュールは上記commitのビルドと一致（ソースマップ参照末尾のみ比較時に除外可）。API、既存URL、定期処理、接続先・実行設定、既存10表の全行を照合した。
- 確認済みWorker：`09539a30-3b0c-4132-92e7-96d7ec010422`、release：`2026-10-14-document-names`。公開コマンドの終了エラー自体の原因は未特定。反映状態は確認専用実行の成功を根拠にする。

## 非公開の控え・再開時の注意

- 更新前のWorker・設定・契約記録・manifestは、非公開R2バケット `stepwise-files` の `release-backups/document-names-20261014/38563501703-1/` に保存し再読込照合済み。
- 完了確認manifestは同バケットの `release-verification/document-names-20261014/38564505915-1/` に保存し再読込照合済み。個人情報や鍵の値はGitHubに記載しない。
- 今回の公開手順を再実行する必要はない。規約版の有効化・家庭への案内・同意取得は、予定段階の実装と運用準備を確認して別途進める。
