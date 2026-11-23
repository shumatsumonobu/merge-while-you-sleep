# 設計書

merge-while-you-sleep の設計書。仕組みと、設計判断ごとの理由を書く ── このツールを自分のプロジェクトに入れるか判断したい開発者と、このリポジトリを修正する人に向けたもの

- 状態: 実装した。未決は無い
  - 手元のテスト（Claude Code とゲートの実行をスタブに差し替え、git は本物）は成功する
  - 各節の「実装のときに確かめること」は利用枠の上限の1件を除いて、GitHub の runner で確かめた
  - [results.md の「試験結果」](results.md#試験結果)の攻撃の筋書き14件を確かめた（runner で12件、手元で1件、コードを読んで1件）
  - GitHub の runner で [results.md の「測定結果」](results.md#測定結果)の値を測った
- 外部のツールと資料は 2026-11-04〜2026-11-17 に確かめた内容で書いた（確認結果に日付を書いたものはその日）

## ファイル

| ファイル | 内容 |
|---|---|
| [README.md](README.md) | 目的と範囲、全体の流れ、決定の主体、構成、参考 |
| [terms.md](terms.md) | 用語。文書、コード、コメント、Issue へのコメントで使う語の正本 |
| [draft.md](draft.md) | 完了条件の下書き、人が完了条件を書くとき、承認の記録 |
| [run.md](run.md) | ワークフローのファイルとジョブ、修正の反復、指示文、モデル、複数の Issue を同時に起動した場合、再実行 |
| [gates.md](gates.md) | ゲート、判定、自動マージの範囲、検査のタイミング、上限と繰り返しの検知 |
| [submit.md](submit.md) | 提出のジョブで確かめ直すこと、提出のジョブの決まり、自動マージの予約、提出のあとに CI が失敗した場合、CI が成功してもマージできない場合 |
| [escalation.md](escalation.md) | 人への引き継ぎ |
| [security.md](security.md) | 守り、トークンと権限 |
| [adoption.md](adoption.md) | 導入と使い方 |
| [results.md](results.md) | 測定結果、試験結果（GitHub の runner で測った値と、攻撃の筋書きを試した結果） |

## 目的と範囲

人がやりたいことを書いた Issue からマージまでを [Claude Code](https://code.claude.com/docs) が自走する仕組み。[GitHub Actions](https://docs.github.com/actions) の上で動き、手元の PC を使わない

- 起点: 人がやりたいことを書いた Issue。完了条件は Claude Code が下書きし、人が承認する。人が完了条件まで書いた Issue は下書きを飛ばす
- 終点: マージ。デプロイは持たず、プロジェクトに元からある CD に任せる
- 最小の骨格にする ── 基本の部分だけのほうが、ほかの開発者が自分のプロジェクトに入れやすい
- 導入できるリポジトリ: 公開リポジトリか、GitHub の有料のプランのリポジトリ（[adoption.md の「導入の前提」](adoption.md#導入の前提)）
- 範囲に入れないもの: 1つの Issue で複数のリポジトリを変えること ── 1回の実行が扱うのは Issue があるリポジトリ1つだけ

満たすこと

- 正確さと品質 ── 前提
- 速さ ── [gates.md の「検査のタイミング」](gates.md#検査のタイミング)の決まりに従う。準備は1回で済ませる
- 再実行のしやすさ ── やり直しを、起動ラベルを付け直す1つの操作で始められる。このリポジトリの手元のテスト（`npm test`）は Claude Code と GitHub の API をスタブに差し替えて、作業の流れを再現する
- 使いやすさ ── 導入は、GitHub App とリポジトリの設定、ラベルの作成、templates/ のワークフロー2つと Issue のテンプレート2つのコピー、Secrets 2つと変数2つの登録。自動マージの範囲のほかは既定値のままで動く
- セキュリティ ── 防御、ガード、事前の検知を持つ（[security.md の「守り」](security.md#守り)）
- 止まったときは理由と次にやることを Issue にコメントする

終点をマージにした理由

- PR で止めると全部の PR を人が読むことになる ── 人の手間の大半がそこに残る
- デプロイまで持つと、デプロイ先によってプロジェクトごとに内容が変わり、入れやすい骨格にならない。main へのマージでデプロイするプロジェクトならマージを終点にしても本番まで反映される

完了条件を承認するのは人、書くのは Claude Code にした理由

- 人が承認した完了条件が Claude Code の外にある唯一の採点基準になる ── 課題も完了条件も Claude Code が決めると作った本人が採点する形に戻る。書くのが Claude Code でも、承認するかを人が決めればこの線は守れる
- 人が完了条件を全部書く形だと人の手間の大半が起点に残る ── 人がするのは、やりたいことを書く、承認する、の2つ。質問があれば、答えるが増える
- 先例: [TAKT](https://github.com/nrslib/takt) は、人がコーディングエージェントと会話してやりたいことを具体化し、Issue の文章は会話からコーディングエージェントが作成し、作るかどうかを人が決める（TAKT の docs/README.ja.md に「「Issueを建てる」を選ぶと、作成前に「タスクにつみますか？ [Y/n]」と確認されます。」）
- 範囲を広げるなら完了条件がすでに機械で決まっているタスクから（例: 依存の更新なら「既存のテストが全部成功する」）

## 全体の流れ

```
Issue（人がやりたいことを書く）
→ 下書き（Claude Code が完了条件の案と質問をコメント）→ 人がコメントで答える …（質問が無くなるまで）
　（外部の投稿者が書いた Issue は、権限のある人が下書きラベルを付けてから）
　（人が完了条件まで書いた Issue は、下書きを飛ばす）
→ 人が承認する（起動ラベルを付ける）→ 実行待ち
→ 事前確認（権限と設定、承認の記録、基準コミット）
→ 作業: 着手前のゲート → 計画 → テスト作成 → 失敗の確認 → 実装
　→ ゲート → レビュー → 修正 → ゲート → レビュー …（レビューの指摘が無くなるまで）
→ 提出（別のジョブ。確かめ直し、push、PR の作成、自動マージの予約、CI を待つ）
→ 自動マージ →（既存の CD がデプロイ）
→ 終了処理（途中で終わった実行があれば、人に引き継ぐ）
```

流れの中の語（ほかの用語は [terms.md](terms.md)、ゲートの内容は [gates.md の「ゲート」](gates.md#ゲート)）

- 着手前のゲート: Claude Code を呼び出す前に基準コミットで、テスト、lint、型検査のコマンドが成功することを確かめるゲート
- 失敗の確認: 実装の前に、新しく書いたテストが失敗することを確かめるゲート
- 確かめ直し: 提出のジョブが新しいマシンで変更をもう一度照合すること（変更禁止ファイル、自動マージの範囲、既存のテストなど。[submit.md の「提出のジョブで確かめ直すこと」](submit.md#提出のジョブで確かめ直すこと)）

## 決定の主体

原則: コマンドで決まるものはコマンドで決め、Claude Code には残りだけをさせる ── コマンドは Claude Code の利用枠を使わないので Claude Code に問い合わせる回数そのものが減る

| 工程と検査 | 決めるもの |
|---|---|
| 完了条件の下書き | Claude Code |
| 完了条件の承認 | 人 |
| 承認のあとに承認の対象が書き換えられていないか | コマンド（事前確認） |
| 計画 | Claude Code |
| テスト作成 | Claude Code |
| 実装 | Claude Code |
| テストの合否 | コマンド |
| lint の合否 | コマンド |
| 型検査の合否 | コマンド |
| 実装と修正の工程でテストのファイルを変えていないか | コマンド（作業のジョブ。工程ごとのコミットの差分） |
| 既存のテストを変えていないか | コマンド（作業のジョブのテスト作成の変更範囲と、提出のジョブの基準コミットとの差分） |
| 変更が自動マージの範囲に収まっているか | コマンド（提出のジョブ） |
| 完了条件を満たしているか | Claude Code（レビュー） |
| 設計 | Claude Code（レビュー） |
| CI の必須のステータスチェック | GitHub |
| マージ | GitHub |

Claude Code の自己申告（「テストは成功した」「修正済み」）を合否に使わない ── 合否はコマンドの終了コードと、GitHub の必須のステータスチェックで決まる

## 構成

判断: [Node.js](https://nodejs.org/) の JavaScript action（`runs.using: node24`）にし、ジョブごとに action を1つ置く

- action のコードは実行時の依存（npm のパッケージ）を持たない
- 例外は作業の action が sandbox（Claude Code が Bash で起動したコマンドの、読める場所、書ける場所、外への通信先を絞る Claude Code の機能。[terms.md](terms.md)）のために入れる seccomp フィルタ（`@anthropic-ai/sandbox-runtime`）だけ。action のコードはこれを読み込まない（[security.md の「供給元を固定する」](security.md#供給元を固定する)）
- 型検査とテストの道具は開発時だけ使う

```
actions/          導入する側のワークフローが uses: で呼び出す action。ジョブごとに1つ
  draft/            下書き（action.yml と draft.mjs）
  notify/           実行待ちの通知（action.yml と notify.mjs）
  preflight/        事前確認（action.yml と preflight.mjs）。App の秘密鍵を扱う。Claude Code は呼び出さない
  work/             作業（action.yml と work.mjs）。流れ、ゲート、上限、判定を work.mjs の1ファイルに書く
    sandbox-runtime/  seccomp フィルタ（@anthropic-ai/sandbox-runtime）の package.json と package-lock.json
  submit/           提出（action.yml と submit.mjs）。App の秘密鍵を扱う。Claude Code は呼び出さない
  cleanup/          終了処理（action.yml と cleanup.mjs）。下書き用と実行用のワークフローの両方で使う
lib/              action が共有する部品
  actions.mjs       GitHub Actions とのやりとり（入力、出力、状態、ログ、伏せ字）
  process.mjs       子プロセスの起動と、子プロセス（ゲート、Claude Code）に渡す環境変数
  git.mjs           git の呼び方（フックと外部の道具を使わない設定）と、差分の読み方
  github.mjs        GitHub の API の呼び方、イベント、ラベルの名前、権限とラベルのイベントの確かめ
  paths.mjs         テストのファイルのパターン、変更禁止ファイル、依存の定義、固定の除外ファイル、@ の取り込み
  diff-scan.mjs     追加した行と削除した行の照合（検査を無効にする書き方、外の画像）
  sanitize.mjs      文面の消毒
  escalation.mjs    人への引き継ぎ（理由、コメントの印、ラベル）と止め方
  defaults.mjs      工程ごとのモデルと、上限の既定値
  claude.mjs        Claude Code の導入と呼び出し（レポートの形、指示文の組み立て、設定のファイル、cgroup）。下書きと作業の action が使う
  pr-token.mjs      PR 用トークンの発行と取り消し。事前確認と提出の action だけが使う
prompts/          工程ごとの指示文（draft.md、plan.md、write-tests.md、implement.md、fix.md、review.md、resolve-conflicts.md）
templates/        導入する側がコピーするワークフロー2つ（workflows/）と、Issue のテンプレート2つ（ISSUE_TEMPLATE/）
test/             action と lib/ のテスト ── Claude Code と GitHub の API をスタブに差し替えて実行する
docs/design/      設計書（このファイルと、節ごとのファイル）
figures/          README の図（flow.html が元、flow.png はそれを画像に変換したもの）
tools/figure/     図の HTML を PNG に変換するスクリプト（Playwright を使う。このリポジトリを保守するときだけ使う）
examples/         試験用のリポジトリに導入した例（GitHub の runner で試した内容）
measurements/     測定の記録（ジョブのログ、PR と Issue の JSON）と、確かめるためのスクリプト
```

- lib/ に部品を置くのは固定の除外ファイルとテストのパターンを、作業のジョブ（ゲートと照合）と提出のジョブ（確かめ直し）が同じ値で読むため ── 2つのファイルに書くと食い違いうる
- 部品を内容ごとのファイルに分けるのは読む人が確かめたい部品だけを開けるようにするため

導入する側はワークフローのファイル2つにジョブを7つ書き、各ジョブで同じ名前の action を指定する（例: `uses: shumatsumonobu/merge-while-you-sleep/actions/work@<コミットの SHA>`。[run.md の「ワークフローのファイルとジョブ」](run.md#ワークフローのファイルとジョブ)）。言語の準備と依存のインストールは作業の action より前の step に書く

artifact（ワークフローの実行に付けて保存するファイル。ジョブの間とワークフローの間の受け渡しに使う）の扱い


- artifact をアップロードするのは templates/ のワークフローの step（[actions/upload-artifact](https://github.com/actions/upload-artifact)）── GitHub の REST API には artifact を作る操作が無い（GitHub Docs の [REST API endpoints for GitHub Actions artifacts](https://docs.github.com/en/rest/actions/artifacts) に「download, delete, and retrieve information about workflow artifacts」）
- 作業と下書きの action はアップロードするファイル（bundle、下書きのコメントの ID と本文のハッシュ）を `RUNNER_TEMP` に書く ── Claude Code とゲートのコマンドが書けない場所
- 提出のジョブは同じ実行の artifact を [actions/download-artifact](https://github.com/actions/download-artifact) で受け取る。事前確認は下書きの実行の artifact を REST API で読む
- どの action もコミットの SHA で指定する（[security.md の「供給元を固定する」](security.md#供給元を固定する)）

理由

- 導入する側に Node.js の準備も npm install も求めない ── runner は action の依存をインストールしないので、実行時の依存があると、`node_modules` か、1ファイルにまとめた `dist/` をこのリポジトリに入れることになる（GitHub Docs の [Create a JavaScript action](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action)）
- 対象プロジェクトの Node.js に左右されない ── composite action（step を並べて作る action）だと PATH にある Node.js を使うので、対象プロジェクトが入れた版で動く。中で [setup-node](https://github.com/actions/setup-node) を使うと逆に対象プロジェクトのテストが使う Node.js を差し替える
- JSON をそのまま扱える ── `claude -p --output-format json` の結果、`--json-schema` で受け取る構造化出力、GitHub の REST API と GraphQL API の応答を、[jq](https://jqlang.org/) を使わずに読める。bash で書くと、反復の状態、回数、コストの積算を扱う部分が壊れやすい
- 1ファイルで読み切れる大きさに保てる ── 導入する側が動かす前に内容を読んで確かめられる
- 依存を増やさない ── 書き込み権限のあるトークンを扱うので、依存が増えるほどサプライチェーン攻撃を受ける面が広がる
- action をジョブごとに分けると、App の秘密鍵を受け取るコード（事前確認と提出）が、Claude Code を呼び出すコード（下書きと作業）と別になる ── 事前確認と提出の action は Claude Code も対象プロジェクトのコードも実行しない
- ワークフローの `uses:` を見ればどのジョブの処理かを確認できる。各 action の入力はそのジョブで使うものだけになる ── 1つの action が入力でジョブを選ぶ形にすると、どの入力がどのジョブのものかを、導入する人が調べることになる
- [loop-engineering-playbook](https://github.com/shumatsumonobu/loop-engineering-playbook) のハーネスと同じ形 ── `harness/integrated.mjs` は import が `node:` の組み込みだけ。ゲートの実装と、Claude Code をスタブに差し替えたテストを移しやすい

指示文を prompts/ に分けるのは散文をコードと分けたほうが読みやすく、差分も分かれるため。「1ファイルで読み切れる」はロジックに当てはめる

依存は効率が上がると示せたものだけ追加する

[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) は、ツール呼び出しの検査を同じプロセスの関数で挟めるが、使わない ── overview のページに「Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK.」とあり、サブスクの認証と組み合わせられない

確認結果（2026-11-10、GitHub ホストの runner `ubuntu-24.04` で1回。試験用のリポジトリにラベルの無い Issue を作成して起動した）

- `runs.main` に `.mjs` を指定した action が動く ── 終了処理の action（actions/cleanup/cleanup.mjs）の step が成功で終わった
- サブディレクトリの action から同じリポジトリのほかのディレクトリ（`lib/`、`prompts/`）を読める ── runner は action のリポジトリ全体をコミットの SHA で取得する（ジョブのログに「Download action repository '<owner>/<repo>@<SHA>'」）
  - `lib/`: cleanup.mjs が自分のディレクトリの外にある共有の部品を読み込んで動いた
  - `prompts/`: 下書きの action が `prompts/draft.md` から指示文を組み立て、下書きのコメントを書いた
- ワークフローの最上位の `cache-mode: read` を runner が受け付ける ── ジョブのログの冒頭に「Cache mode: read」
- `concurrency` に `queue: max` を書いたワークフローが起動する ── 2つのワークフローとも実行が作られ、ワークフローのファイルの注記は0件
- ラベルの名前に `: ` を含めてもワークフローの `env` で action に渡せる ── ログの env に `merge-while-you-sleep: draft` がそのまま出力された（値を引用符で囲んである）

確認結果（2026-11-17、GitHub ホストの runner `ubuntu-24.04` で1回。記録は measurements/probe-runs の probe9）

- JavaScript action は runner に同梱の Node.js で動き、PATH の Node.js を変えない ── setup-node で Node.js 20 を入れたジョブで、`runs.using: node24` の action の `process.version` は v24.22.1（`/opt/runner-cache/externals/node24/bin/node`）、action の前、中、あとの PATH の `node --version` は v20.20.2 だった

## 参考

### TAKT

[TAKT](https://github.com/nrslib/takt)（MIT）は、コーディングエージェントの作業手順を YAML のワークフローで決めて外から実行する CLI。2026-11-04 時点の main（v0.74.0）のコードと文書を読んだ。動かしてはいない

この設計の判定と上限の考え方は TAKT を参考にした。コードと文章はコピーしていない

### loop-engineering-playbook

[loop-engineering-playbook](https://github.com/shumatsumonobu/loop-engineering-playbook) は、同じ作者が手元の PC で Claude Code にコードを書かせ続ける仕組みを作って測った記録

- 同じところ: 人が書くのはタスクだけ。合否はハーネスがテストで決め、Claude Code の自己申告を信じない。実装中にテストを書き換えたら不合格。失敗し続けたら人に引き継ぐ
- 違うところ: playbook は手元の PC で実行し、ローカルで元のブランチに統合するところまで。計画とレビューの工程が無く、テストで確かめられないことは合格に入らない
- このリポジトリで追加するもの: GitHub の上で Issue からマージまで PC なしで進む。テストで確かめられない設計と完了条件を Claude Code によるレビューが確かめる
- 取り入れるもの: ゲートの考え方（失敗の確認、テストの凍結、ミューテーションテスト ── playbook では失敗の確認を「赤先行」、ミューテーションテストを「変異チェック」と呼ぶ）と、規約違反への対処（playbook の README の「規約違反への対処」の節）
- 別のリポジトリにした理由: playbook は実測の記録が中心で、条件を変えると載っている数字の前提が崩れる
