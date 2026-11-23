# CLAUDE.md

このリポジトリで作業する Claude Code 向けの決まり。製品の芯と、忘れると手戻りになることを書く。仕組みの詳細と設計判断の理由は [docs/design/](docs/design/)

## 概要

人がやりたいことを書いた Issue からマージまでを [Claude Code](https://code.claude.com/docs) が自走する [GitHub Actions](https://docs.github.com/actions) の骨格

- 起点: 人がやりたいことを書いた Issue。完了条件は Claude Code が下書きし、人が承認する ── 人が承認した完了条件が Claude Code の外にある唯一の採点基準。承認していない完了条件では実行しない
- 終点: マージ。デプロイは持たず、プロジェクトに元からある CD に任せる
- 最小の骨格にする。ほかの開発者が自分のプロジェクトに入れやすいことを優先し、仕様を固定する
- GitHub Actions の上で動かす。手元の PC は使わない。認証はサブスク（Pro / Max）の OAuth トークン
- 導入できるのは公開リポジトリか GitHub の有料のプラン（Pro、Team、Enterprise）のリポジトリ ── auto-merge と必須のステータスチェックが無料のプランでは公開リポジトリでしか使えない（docs/design/adoption.md の導入する側の前提）

## 原則

- コマンドで決まるもの（テスト・lint・型検査の合否、テストの書き換え、自動マージの範囲）はコマンドで決める。Claude Code には残り（計画、テスト作成、実装、完了条件と設計のレビュー）だけをさせる
- Claude Code の自己申告を合否に使わない。判定には生データ（テストの出力、diff）を混ぜる
- Claude Code が自分のゲートを外せないようにする。`.github/workflows` とテストの設定は自動マージの範囲の外
- 人への引き継ぎは決めた理由のときだけ（docs/design/escalation.md の表）: 始められない、完了条件が足りない、上限に達した、判定が決まらない、変更が無い、自動マージの範囲の外を変える、提出のあと自動マージまで進めない、守りが働いた、途中で終わった。理由ごとに人が次にやることを決めておく
- 上限（反復の回数、コスト、時間）と繰り返しの検知は仕組みに持たせる。人は見ていない前提
- 判定が決まらなければ止める。既定の工程に流さない
- モデル: 間違えたときにコマンドで検出できる工程は安いモデル、検出できない工程は Opus。工程ごとに設定で差し替えられる
- 導入先の CLAUDE.md とスキルはそのまま使う。hooks と、hooks を書いたスキルは動かさない。設定のファイルに helper のコマンドがあれば始めない ── hooks と helper は sandbox の外で、Claude Code が書き換えられる作業ディレクトリの内容を実行しうる（docs/design/security.md の守り）

## 使いやすさの要件

正確さと品質は前提。加えて次を満たす

- 速さ
- 再実行のしやすさ（やり直し、手元での再現）
- 使いやすさ（導入の手間、既定値で動くこと）
- セキュリティの防御・ガード・事前の検知

検査はタイミングを決めて置く。毎回実行すると全体が遅くなり、Claude Code の応答も遅くなる

- ツール呼び出しごとに実行するのは照合だけで済むもの（permission の deny ルール）に限る。hooks や Claude Code による検査を毎回挟まない
- 安い順に並べ、失敗したらそこで止めて修正に戻す。コストの高い検査（Claude Code によるレビュー、ミューテーションテスト）は安い検査を全部通過したものにだけ実行する
- 結果が変わらない検査は1回だけ
- 仕組みで起きないようにできるものは検査にしない（例: PR 用トークンを Claude Code が動くジョブに置かない。提出は別のジョブにする）

## 用語

docs/design/terms.md が正本。同じものを2つの言い方で呼ばない。文書、コード、コメント、Issue へのコメントで同じ語を使う

| 用語 | 英語 | 使わない言い方 |
|---|---|---|
| 完了条件 | acceptance criteria | 受け入れ条件、要件 |
| 下書き | draft | ─ |
| 承認 | approval | OK、確認 |
| 承認の記録 | approval record | ─ |
| 実行 | run | ─ |
| 実行待ち | queue | キュー、順番待ち |
| 事前確認 | preflight | 事前チェック、プリフライト、開始の確認 |
| 作業 | work | ─ ── 実行の2つ目のジョブ |
| 終了処理 | cleanup | 後片付け、終わりの確認 |
| 基準コミット | base commit | ベース、土台、土台のコミット |
| 基準コミットのスキル | base skills | 土台のスキル |
| 下書きラベル | draft label | ─ |
| 起動ラベル | trigger label | トリガー、起動用のラベル |
| 引き継ぎラベル | escalation label | 人の判断待ちラベル |
| 工程 | stage | 段、ステップ、フェーズ ── GitHub Actions の step と区別する |
| 反復 | round | ループ、ラウンド、イテレーション、往復 |
| ゲート | gate | 関門 |
| 着手前のゲート | base gate | 土台のゲート |
| 失敗の確認 | red first | 赤先行 ── loop-engineering-playbook の語。参考の節で1回だけ併記する |
| 検査 | check | チェック |
| レポート | report | 報告（レポートの意味で） |
| 生データ | raw data | 生のデータ |
| 判定 | judge | 判定役、conductor |
| 自動マージの範囲 | allowlist | 許可リスト、自動マージしてよい範囲 |
| 固定の除外ファイル | fixed deny list | 必ず外すファイル |
| 変更禁止ファイル | protected files | 保護ファイル、変えさせないファイル |
| 上限 | limit | 止め役 |
| 繰り返しの検知 | loop detection | 同じ往復の検知、同じ反復の検知 |
| 人への引き継ぎ | escalation | 人を呼ぶ、差し戻し |
| 提出 | submit | 公開、publish（提出の意味で） |
| 続きから進める | resume | 再開、レジューム |
| PR 用トークン | PR token | 強いトークン、公開用トークン |
| 認証情報 | credential | 鍵（GitHub App の「秘密鍵」は原典の語なので使う） |
| 外部の投稿者 | ─ | 外の人 |
| ミューテーションテスト | mutation testing | 変異チェック ── loop-engineering-playbook の語。参考の節で1回だけ併記する |
| Claude Code | Claude Code | AI（単独）── 一般の話では「コーディングエージェント」 |

- 使わない言い方はその用語の意味で使うときだけ避ける ── 「公開するリポジトリ」の公開、「報告がある」の報告は別の意味なので使ってよい
- GitHub と TAKT の用語は原典のまま（必須のステータスチェック、TAKT のステップ）── 原典の何を指すかを読者が確かめられる
- 専門用語は初出で1回だけ括弧で補う
- 口語と造語を混ぜない ── 初見の読者が止まる。回す、叩く、吐く、食う、落とし穴、のような類い
- 製品名は原典の表記に合わせる（`Claude Code`、`GitHub`、`GitHub Actions`、`Node.js`）。勝手に略さない（リポではなくリポジトリ）

## GitHub の注意点

- `GITHUB_TOKEN` で起こしたイベントは、新しいワークフローの実行をほぼ作らない（例外は `workflow_dispatch` と `repository_dispatch`）。PR の作成・更新では `pull_request` の実行が承認待ちになり、自走が止まる。PR は PR 用トークンで作る（GitHub Docs の [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)）
- auto-merge を `GITHUB_TOKEN` で有効にするとマージ後の push でワークフローが起きず、既存の CD が動かないという報告が複数のリポジトリの issue にある（例: [BreakableHoodie/settimesdotca#1209](https://github.com/BreakableHoodie/settimesdotca/issues/1209)）。公式 Docs では未確認
- ワークフローの step を繰り返す構文はない。GitHub Docs の [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) に loop や retry のキーワードが無く、`if` は step を飛ばせるが繰り返せない

## 作業の進め方

- 設計を固めてから実装する。設計書に未決を残しているうちはコードを書かない ── 実行しないと確認できないもの（実装のあとで測ること）は別
- 設計書（docs/design/）は公開前提。仕組みと、設計判断ごとの理由を書く
- 設計書を書き始める前に、構成（見出し）と主な用語を出して合意を取る
- 未決は1つずつ決める: 案を比べ、自分でレビューして穴を塞ぎ、最善の案で決めて設計書に書く。本人に毎回は確認しない。読めば確かめられることは先に確かめ、未確認を残さない。実行しないと確認できないものだけ「実装のときに確かめること」に残す
- 実行しないと確認できないもの（トークン量、モデルの比較）は実装のあとで測る。測った値は README の数字の根拠になるので記録を残す
- 外部ツールの仕様と issue の状態は変わる。使う前に今の状態を確かめる

## 試験用のリポジトリ

- GitHub の runner で動かす試験（実装のときに確かめること、実装のあとで試すこと、実装のあとで測ること）はこのリポジトリの外に作る試験用のリポジトリでする ── この骨格を導入する側のリポジトリとして使う
- 試験が全部終わったら試験用のリポジトリの内容をこのリポジトリに移す ── このリポジトリを見る人が、導入した例と、README の数字の根拠を見られる
- 移す前に手元のパス、ユーザー名、セッション ID、トークンを洗う。何をいつ置換したかをこのリポジトリの記録に1行残す

## 公開時の注意点

- コミットするファイルに手元のパス（ユーザー名の入った絶対パス、手元の clone の場所）を書かない
- [TAKT](https://github.com/nrslib/takt) の設計を参考にしている。README にそのことを1行入れる。コードや文章をコピーするなら MIT の著作権表示を残す

## 参照

- WIP.md: 作業の一覧と、どこまで終わって何が残っているか。gitignore の対象で公開しない
  - 作業を始める前に読む
  - 作業の区切りで更新する。終わった項目は印を付けて残し、最終更新の日付を変える
  - 新しい作業が出たら一覧に追加する。本人の作業待ちと判断待ちも書く
- [loop-engineering-playbook](https://github.com/shumatsumonobu/loop-engineering-playbook): ゲートの考え方（失敗の確認、テストの凍結、ミューテーションテスト）の元。失敗の確認は playbook では赤先行と呼ぶ
