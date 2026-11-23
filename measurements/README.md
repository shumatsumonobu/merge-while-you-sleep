# 測定の記録

GitHub の runner で骨格を試し、測ったときの記録。設計書（[docs/design/](../docs/design/)）の各節の「確認結果」と、[results.md](../docs/design/results.md) の「試験結果」「測定結果」と、リポジトリのルートの [README.md](../README.md) の数字の根拠。読む人が書いてある数字と結果を自分で確かめるためのもの

測った条件は [results.md の「測定結果」](../docs/design/results.md#測定結果)に書いた（GitHub ホストの runner `ubuntu-24.04`、[Claude Code](https://code.claude.com/docs) 2.1.319、試験用のリポジトリ。導入した例は [examples/](../examples/)）

## e2e-runs/ ── Issue からマージまでの実行

実行ごとのディレクトリ（`<名前>/`）に、ジョブのログ（`run.log`）、ジョブの時刻（`jobs.json`）、PR、Issue、Issue のコメント、CI の check run（`pr.json`、`issue.json`、`comments.json`、`checks.json`）と、まとめ（`summary.txt`）

| 名前 | 実装と修正の工程のモデル | 結果 |
|---|---|---|
| sonnet1、sonnet2、sonnet4 | `sonnet`（既定） | マージまで進んだ |
| sonnet3 | `sonnet`（既定） | 計画の工程が「完了条件が足りない」と返し、人に引き継いだ |
| opus1、opus2 | `opus` | マージまで進んだ |
| reorg1 | `sonnet`（既定） | このリポジトリのディレクトリの構成（actions/、lib/ など）を今の形に整理したあとの確かめ。測定の表には入れていない |
| review3 | `sonnet`（既定） | 3回目のレビューの修正を入れた今の版（試験用のリポジトリのコミット 63d7647）の確かめ。マージまで進んだ。results.md の6本の表とは別の表に書いた |
| direct1 | `sonnet`（既定） | README の導入の手順の検証。action を別のリポジトリから `uses:` で呼び出した。完了条件まで書いた Issue。マージまで進んだ |
| direct2 | `sonnet`（既定） | direct1 と同じ形で下書きから始めた Issue。マージまで進んだ |
| example1 | `sonnet`（既定） | README の「実行例」の実行。[merge-while-you-sleep-example](https://github.com/shumatsumonobu/merge-while-you-sleep-example) の Issue #2 → PR #3。下書きから始め、質問に1回回答した。マージまで進んだ |

- example1 には、下書きのジョブのログ（`draft-<実行の ID>.log`。下書き、回答のあとの下書きのし直し、起動ラベルを付けたときの実行待ちの通知の3つ）と、Issue のタイムライン（`timeline.json`）も置いた
- direct1、direct2、example1 は measure.sh を使わずに実行したので、`summary.txt` に `wall_seconds` が無い。代わりに Issue の `created_at`（`issue_created`）と PR の `mergedAt`（`pr_merged`）を書いた
- `summary.txt` の `wall_seconds` は、手元のスクリプトが Issue を作る前から、Issue が閉じたのを見るまでの秒数。文書の「Issue を作成してからマージまで」は、Issue の `created_at` から PR の `mergedAt` までで、`wall_seconds` より短い
- review3 の実行のとき measure.sh が PR を GitHub の検索（`Closes #34 in:body`）で探し、別の PR（#25）を誤って選んだ。PR の本文の `Closes #<番号>` が完全に一致するものを選ぶように修正し、review3 の `pr.json`、`checks.json`、`summary.txt` の `pr=` を、正しい PR #35 で取り直した。前の実行の `pr.json` はどれも Issue と PR の番号の組み合わせが正しいことを確かめた
- `draft4/`、`draft6/` と `draft-issues.summary.txt` は、下書きから始めた Issue（試験用のリポジトリの #4、#6）の Issue、コメント、タイムラインの JSON と、人の操作の数え方。上の表の実行とは別
- `gate-overhead.txt` はゲートを隔離したときに増える時間（probe5 の出力）

## probe-runs/ ── 確かめるためのワークフローの実行のログ

認証情報の代わりにランダムな目印を置き、読めたかどうかだけをログに出力した。ワークフローごとのディレクトリ（`<ワークフロー>/`）に `<実行の ID>.log` の名前で置いた

| ワークフロー | 確認した項目 |
|---|---|
| probe | sandbox とゲートから読めるもの、書けるもの、アクセスできるもの。`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` の有無と、`denyRead` の書き方の比較。hooks とスキル、cgroup |
| probe2 | App のトークンで `--match-head-commit` と `update-branch` |
| probe3 | ゲートの中の道具（[vitest](https://vitest.dev/)、[go](https://go.dev/)、[cargo](https://doc.rust-lang.org/cargo/)） |
| probe4 | 攻撃の筋書き（入れ子のリポジトリ、許していないツール、残るプロセス、ルートの `.claude` と `.github`）と、sandbox の中の cargo |
| probe5 | ゲートを隔離したときに増える時間 |
| probe6 | sandbox の中の cargo と、ホームの隠しファイル |
| probe7 | スキルを名前ごとに許す形（hooks を書いた基準コミットのスキル、作業の中で作ったスキル）。3回実行した。1回目は作業の中でスキルを作るコマンドの書き方を誤った。3回目はスキルの照合を厳しくしたあとの版 |
| probe8 | sandbox の中の sudo、グループ、no_new_privs |
| probe9 | JavaScript action の Node.js と、PATH の Node.js |

## scripts/ ── 確かめるためと測るためのスクリプト

- `probe*.mjs` は確かめるためのワークフローの本体。`workflows/` は probe から probe8 のワークフローの定義で、試験用のリポジトリの `.github/workflows/` に置いて手動で起動した。`probe9-node-action/` は probe9 のワークフローと action
- `measure.sh` は 1本実行して測るスクリプト。対象のリポジトリ（`R=`）は試験用のリポジトリのまま。再実行するときは自分のリポジトリに置き換える
- `diffscan-cases.mjs` は検査を無効にする書き方の照合（手元で実行）
- どれも試験用のリポジトリの中の置き場所（`.github/actions/merge-while-you-sleep/`）から読み込む形のまま。probe から probe6 は、このリポジトリのディレクトリの構成を今の形に整理する前の置き場所（`shared/`、`work/`）を読む。ログの古い実行は途中の版で動かした

## 公開する前に調べたもの

2026-11-16 と 2026-11-17 に試験用のリポジトリと手元の作業の場所から移したとき、ユーザー名、勤務先の名前、メール、手元のパス、認証情報の形、セッション ID のパターンで調べた。当てはまるものは0件で、置換はしていない。パターンが機能することは、当てはまるはずの行を5行入れて、5行とも一致することで確かめた（2026-11-16）

2026-11-24 に、試験に使った GitHub App の Client ID（`e2e-runs/` の `run.log` 10個と `probe-runs/probe2/` のログ3個の計22か所）を `<APP_CLIENT_ID>` に置換した。Client ID は認証情報ではないが、試験の App を辿れる。置換前と置換後の差分は該当する22行だけで、置換を戻すと元の行と一致することを確かめた。同じ日に example1 の `run.log` の実行例の App の Client ID 2か所も同じく置換した（差分は該当する2行だけ）
