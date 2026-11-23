# 導入と使用方法

導入の前提、導入の手順の理由、リポジトリの変数、action ごとの入力、起動方法。設計書の入口は [README.md](README.md)

導入先の決まりの扱い（[security.md の「Claude Code に認証情報を読ませない」](security.md#claude-code-に認証情報を読ませない)）

- 導入先の CLAUDE.md とスキルはそのまま使う ── 導入先がすでに書いた決まりと手順がこの仕組みの中の [Claude Code](https://code.claude.com/docs) にも適用される
- hooks と、hooks を書いたスキルは動かさない
- 設定のファイルに helper のコマンド（`apiKeyHelper` など、Claude Code が認証などのために設定のファイルに書かれたとおりに実行するコマンド）があれば始めない

## 導入の前提

- リポジトリの設定で auto-merge を有効にする ── GitHub Docs の [Automatically merging a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request) に「Before you use auto-merge, it must be enabled for the repository.」
- マージ先のブランチに必須のステータスチェックを設定する（ブランチ保護かルールセット）── auto-merge は、必要なレビューが揃い、ステータスチェックがすべて成功したあとにマージする（同じページ）
  - その中にテストのコマンドを新しいマシンで実行するチェックを入れる ── 作業のジョブのゲートが飛ばされたとき、テストの合否を最後に確かめるのはこれだけ。事前確認はチェックがあることしか確かめられない
- 無料のプランでは公開リポジトリでしか使えない ── auto-merge、ブランチ保護、ルールセットはどれも、GitHub Free では公開リポジトリだけ、GitHub Pro、GitHub Team、GitHub Enterprise では非公開リポジトリでも使える
  - 根拠: GitHub Docs の原稿（[github/docs](https://github.com/github/docs) の data/reusables/gated-features の auto-merge.md、protected-branches.md、repo-rules.md）に「Auto-merge for pull requests is available in public repositories with GitHub Free and GitHub Free for organizations, and in public and private repositories with GitHub Pro, GitHub Team, ...」。ブランチ保護とルールセットも同じ書き方
- runner は GitHub ホストの Ubuntu ── Claude Code の sandbox（Claude Code が Bash で起動したコマンドの、読める場所、書ける場所、外への通信先を絞る Claude Code の機能。[Sandboxing](https://code.claude.com/docs/en/sandboxing)）とゲートの隔離が、Linux の機能（[bubblewrap](https://github.com/containers/bubblewrap)）を使う。self-hosted runner は前提にしていない（[security.md の「守る対象」](security.md#守る対象)の守らないもの）
- 入力 `pass_env` に Secrets の入った環境変数を書かない（[security.md の「ゲートのコマンドを隔離する」](security.md#ゲートのコマンドを隔離する)）
- リポジトリの設定でワークフローの `GITHUB_TOKEN` の既定の権限を読み取りにし、[GitHub Actions](https://docs.github.com/actions) に PR の作成と承認を許す設定を外す ── Settings → Actions → General の Workflow permissions で「Read repository contents and packages permissions」を選び、「Allow GitHub Actions to create and approve pull requests」を外す
- この仕組みのブランチ（`merge-while-you-sleep/**`）と PR で起きるワークフロー全部（`pull_request`、ブランチを絞らない `push`、PR の head を checkout する `pull_request_target`、CI の結果を受けて動く `workflow_run` など）に、`permissions` で書き込みの権限を付けない ── どれも Claude Code が書いたコードを実行しうる（[security.md の「提出を別のジョブにする」](security.md#提出を別のジョブにする)）
- それらのワークフローに渡す Secrets は Claude Code が書いたコードから読める前提で選ぶ ── 同じリポジトリのブランチからの PR なので、CI の設定によっては Secrets が渡る
- 作業の action より前の step で、作業ディレクトリと、ゲートと Claude Code に参照させる道具のディレクトリ（`gate_read_paths` を含む）に、認証情報のファイルを置かない（例: [google-github-actions/auth](https://github.com/google-github-actions/auth) は `create_credentials_file: false` にする）
  - 作業の最初にあった git の管理の外のファイルは作業ディレクトリの外へ移す。ただし `workspace_keep` のディレクトリは残すのでそこに置いた認証情報は読める
- templates/ のワークフローの `cache-mode: read` を `write` に変えない。ジョブにも `cache-mode: write` を書かない ── ジョブに書いた値はワークフローに書いた値より優先される（GitHub Docs の [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) に「A job-level value overrides the workflow-level value for that job.」）（[run.md の「ワークフローのファイルとジョブ」](run.md#ワークフローのファイルとジョブ)）
- リポジトリの設定で入力 `merge_method` のマージの方法（既定: squash）を許可する（Settings → General の Pull Requests）
- マージキューと、署名付きのコミットの必須を使わない ── どちらにも対応しない（[submit.md の「CI が成功してもマージできない場合」](submit.md#ci-が成功してもマージできない場合)）
- 作業のジョブの準備の step で git の管理の中のファイルを変えない（例: `npm install` ではなく `npm ci`）── work.mjs は作業の最初に管理の中のファイルに変更があれば始められないとして止める。準備の step が作ったファイルと Claude Code の変更を見分けられなくなるため
- マージ先は default ブランチに決まっている（変えられない）── 事前確認が default ブランチの先頭を基準コミットにする
- ブランチ保護かルールセットで PR の承認を必須にしていると、毎回 CI が成功した時点で「承認が必要」として人に引き継ぐ。承認すれば予約した自動マージでそのままマージされる（[submit.md の「CI が成功してもマージできない場合」](submit.md#ci-が成功してもマージできない場合)）
- ゲートと Claude Code の sandbox の中は既定では外と通信できない ── テストが外部と通信するなら入力 `gate_network` と `network_allow_domains` で許す
- 依存を `workspace_keep` の既定（`node_modules`、`.venv`、`venv`、`vendor`）の外に入れるプロジェクトは、`workspace_keep` に追加する

事前確認がこのうち次のものを、Claude Code を呼び出す前に確かめる。満たしていなければ実行せずに足りない設定を Issue に書く。ほかの前提（CI の権限、準備の step、`pass_env` など）は確かめられない

- auto-merge が有効か
- default ブランチに必須のステータスチェックがあるか
- 入力 `merge_method` のマージの方法が許可されているか
- ワークフローの `GITHUB_TOKEN` の既定の権限が読み取りか
- PR の作成と承認を許す設定が外れているか
- マージキューと、署名付きのコミットの必須が無いか

## 導入の手順の理由

手順そのものはルートの [README の「導入」](../../README.md#導入)にある。この節は、手順のうち README に無い理由と、名前を変えたときに合わせて修正するものを書く

- GitHub App を作る
  - 権限は [security.md の「PR 用トークンの種類」](security.md#pr-用トークンの種類)の「App に付ける権限」の表のとおり
  - Webhook の Active を外す ── この仕組みは webhook を使わない。外さないと URL を求められる
  - インストールできる先を「Only on this account」にし、インストールは使うリポジトリだけにする ── 秘密鍵が漏れたときの範囲をインストール先に絞る
- ラベルを3つ、最初の Issue の前に作る ── Issue のテンプレートはリポジトリに無いラベルを付けない（[draft.md の「下書きの開始条件」](draft.md#下書きの開始条件)）。事前確認も無いラベルを作るが、それでは最初の Issue に間に合わない
- templates/ のワークフローと Issue のテンプレートをコピーする
  - 依存のインストールのような、プロジェクトごとに違う準備は作業の action より前の step に書く
  - ワークフローのファイルの名前を変えたら、実行待ちの通知の入力 `run_workflow` と、事前確認の入力 `draft_workflow` も同じ名前に修正する
  - ラベルの名前を変数で変えたら Issue のテンプレートの `labels` も同じ名前に修正する

## リポジトリの変数

パターンと一覧の値はカンマか改行で区切る。区切ったあとの項目のうち `#` で始まるものは読まない

| 変数 | 既定 | 使い道 |
|---|---|---|
| `APP_CLIENT_ID` | なし（必須。入力 `token` を渡すときは不要） | GitHub App の Client ID。テンプレートが事前確認と提出の action の入力 `app_client_id` に渡す |
| `MERGE_WHILE_YOU_SLEEP_ALLOW_PATHS` | なし（必須） | 自動マージの範囲のパターン（例: `src/**,test/**`）。新しいテストのファイルもここに合うときだけ範囲に入る |
| `MERGE_WHILE_YOU_SLEEP_DENY_PATHS` | なし | 固定の除外ファイルに追加するパターン |
| `MERGE_WHILE_YOU_SLEEP_DENY_PATTERNS` | なし | 追加した行にあれば範囲の外にする書き方に、追加するもの（既定の書き方は[submit.md の「検査を無効にする書き方と外の画像」](submit.md#検査を無効にする書き方と外の画像)） |
| `MERGE_WHILE_YOU_SLEEP_TEST_PATHS` | [gates.md の「ゲート」](gates.md#ゲート)のパターン | テストのファイルのパターン。書くと既定のパターンを置き換える。作業のジョブのゲートと、提出のジョブの既存のテストの確かめ直しの両方が読む |
| `MERGE_WHILE_YOU_SLEEP_DRAFT_LABEL` | `merge-while-you-sleep: draft` | 下書きラベルの名前 |
| `MERGE_WHILE_YOU_SLEEP_TRIGGER_LABEL` | `merge-while-you-sleep: run` | 起動ラベルの名前 |
| `MERGE_WHILE_YOU_SLEEP_ESCALATION_LABEL` | `merge-while-you-sleep: needs-human` | 引き継ぎラベルの名前 |

事前確認は使うラベルが無ければ作る ── ラベルの作成に必要なのは Issues か Pull requests の書き込み（GitHub Docs の [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) の `POST /repos/{owner}/{repo}/labels`）で、`GITHUB_TOKEN` の `issues: write` で足りる

## action ごとの入力

各 action の action.yml の説明はこの表の要約

### 下書きの action（`draft`）

| 入力 | 必須か | 既定 |
|---|---|---|
| `claude_code_oauth_token` | 必須 | ─ |
| `github_token` | 任意 | `${{ github.token }}` ── draft.mjs のプロセスだけが持ち、Claude Code には渡さない |
| `model_draft` | 任意 | `opus` ── `--model` に渡す値（別名の `opus`、`sonnet` か、モデルの ID）。工程ごとの既定は [run.md の「モデル」](run.md#モデル)の表 |
| `max_draft_questions`、`max_draft_minutes`、`max_draft_cost_usd` | 任意 | [gates.md の「上限と繰り返しの検知」](gates.md#上限と繰り返しの検知)の表 ── `max_draft_questions` が数えるのは質問を返した下書きの回数（1回の下書きで質問が複数あっても1回。質問の無い下書きは数えない）。`max_draft_minutes` を上げるときはテンプレートの `timeout-minutes` も上げる |

### 実行待ちの通知の action（`notify`）

| 入力 | 必須か | 既定 |
|---|---|---|
| `github_token` | 任意 | `${{ github.token }}` |
| `run_workflow` | 任意 | `merge-while-you-sleep-run.yml` ── 実行待ちの数を数える、実行用のワークフローのファイル名 |

### 事前確認の action（`preflight`）

| 入力 | 必須か | 既定 |
|---|---|---|
| `app_client_id` と `app_private_key` | 必須（`token` を渡すときは不要） | ─ |
| `token` | 任意 | ─ ── 個人用アクセストークンで動かすとき |
| `github_token` | 任意 | `${{ github.token }}` ── `GITHUB_TOKEN` で済む操作（権限の確かめ、Issue へのコメント、下書きの実行と artifact（ワークフローの実行に付けて保存するファイル。ジョブの間とワークフローの間の受け渡しに使う）の読み取り）に使う |
| `merge_method` | 任意 | `squash` ── リポジトリの設定で許されているかを確かめる |
| `draft_workflow` | 任意 | `merge-while-you-sleep-draft.yml` ── 下書きのコメントを書いた実行が下書き用のワークフローのものかを確かめるため |

### 作業の action（`work`）

| 入力 | 必須か | 既定 |
|---|---|---|
| `claude_code_oauth_token` | 必須 | ─ |
| `test_command` | 必須 | ─ |
| `base_commit`、`approval` | 必須 | ─ ── 事前確認のジョブの出力（基準コミット、承認の記録） |
| `resume` | 任意 | ─ ── 事前確認のジョブの出力（続きから進めるときの PR。最初からのときは空） |
| `lint_command` | 任意 | 実行しない |
| `typecheck_command` | 任意 | 実行しない |
| `mutation_command` | 任意 | 実行しない |
| `test_file_command` | 任意 | なし ── テストのファイルを引数に取るテストのコマンド。渡すと失敗の確認を新しいテストのファイルごとに確かめる |
| `network_allow_domains` | 任意 | なし ── Claude Code の sandbox で通信を許すドメイン |
| `gate_network` | 任意 | `false` ── ゲートの中で通信を許すか |
| `pass_env` | 任意 | なし ── ゲートと Claude Code に追加で渡す環境変数の名前 |
| `workspace_keep` | 任意 | `node_modules`、`.venv`、`venv`、`vendor` ── 作業の最初にあった git の管理の外のファイルのうち、ゲートと Claude Code に読み取り専用で参照させるディレクトリ |
| `gate_read_paths` | 任意 | なし ── ゲートと Claude Code の sandbox に追加で参照させるディレクトリ |
| `allow_tools` | 任意 | なし ── Claude Code に追加で許す組み込みのツール。sandbox で動く工程にだけ追加する |
| `github_token` | 任意 | `${{ github.token }}` ── work.mjs のプロセスだけが持ち、Claude Code とゲートのコマンドには渡さない |
| `model_plan`、`model_write_tests`、`model_implement`、`model_fix`、`model_resolve_conflicts`、`model_review` | 任意 | 計画、テスト作成、レビューは `opus`、実装、修正、競合の解消は `sonnet` ── `--model` に渡す値（別名か、モデルの ID）。理由は [run.md の「モデル」](run.md#モデル)の表 |
| `max_rounds`、`max_same_finding`、`max_gate_failures`、`max_test_returns`、`max_cost_usd`、`max_work_minutes` | 任意 | [gates.md の「上限と繰り返しの検知」](gates.md#上限と繰り返しの検知)の表 ── `max_work_minutes` を上げるときはテンプレートの作業のジョブの `timeout-minutes`（150分）も上げる |

### 提出の action（`submit`）

| 入力 | 必須か | 既定 |
|---|---|---|
| `app_client_id` と `app_private_key` | 必須（`token` を渡すときは不要） | ─ |
| `token` | 任意 | ─ ── 個人用アクセストークンで動かすとき |
| `github_token` | 任意 | `${{ github.token }}` ── `GITHUB_TOKEN` で済む操作（Issue へのコメント、CI の結果の読み取り）に使う |
| `merge_method` | 任意 | `squash` |
| `base_commit`、`approval`、`work_report` | 必須 | ─ ── 事前確認と作業のジョブの出力（基準コミット、承認の記録、作業のレポートの要約） |
| `bundle_head` | 必須 | ─ ── 作業のジョブの出力（bundle の先頭の SHA） |
| `automerge` | 任意 | `false` ── 作業のジョブの出力（自動マージを予約してよいか）。予約するのはこの値と提出のジョブの確かめ直しの両方が予約してよいときだけ |
| `resume` | 任意 | ─ ── 事前確認のジョブの出力（続きから進めるときの PR と、その時点の先頭。提出のジョブは PR の先頭をこの値と照合し、作業のジョブの出力は使わない） |
| `bundle_path` | 任意 | `RUNNER_TEMP` の下の `merge-while-you-sleep-bundle/work.bundle` ── [actions/download-artifact](https://github.com/actions/download-artifact) で受け取った bundle のパス |

### 終了処理の action（`cleanup`）

| 入力 | 必須か | 既定 |
|---|---|---|
| `needs` | 必須 | ─ ── `toJSON(needs)` |
| `target` | 任意 | `run` ── どちらのワークフローの終了処理か（`draft`、`run`） |
| `github_token` | 任意 | `${{ github.token }}` |

- ジョブの間で受け渡す値は templates/ のワークフローが `needs.<ジョブ>.outputs` を `with` で入力に渡す。`run:` の中に `${{ }}` で書かない ── 承認の記録には Issue のタイトルが入る。GitHub Docs の [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) は信頼できない値を扱うときに「Use an action instead of an inline script」を勧めている
- テストのコマンドを必須にするのは、推測で決めると、導入した人が思っているのと別のコマンドで合否を決めることになるため
- 事前確認と提出の action は `CLAUDE_CODE_OAUTH_TOKEN` を受け取らない ── 認証情報を置くジョブを減らす

## 起動方法

判断: Issue に起動ラベルを付けたら起動する（`issues` イベントの `labeled`。テンプレートで起動ラベルが付いて作られたときは `opened`）

理由

- 誰が起動できるかを GitHub の権限で絞れる ── ラベルを付けられるのは triage 以上の権限を持つ人だけ（GitHub Docs の [Managing labels](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels) に「Anyone with triage access to a repository can apply and dismiss labels.」）。コメントや Issue の作成で起動すると、公開リポジトリでは誰でも起動でき、起動した人の権限を確かめる検査が別に必要になる。[claude-code-action](https://github.com/anthropics/claude-code-action) も起動できるのを書き込み権限のある人に絞っている（claude-code-action の docs/faq.md）
- 外部の投稿者が書いた Issue をそのまま Claude Code に読ませない ── Issue の本文に Claude Code への指示を埋め込まれても、権限のある人が読んで起動ラベルを付けるまで動かない
- やり直しが1つの操作で済む ── ラベルを外して付け直すともう一度起動する
- 実行が自分自身を起動しない ── 実行の中で `GITHUB_TOKEN` を使ってラベルを付け外ししても、新しい実行は作られない（GitHub Docs の [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)）
- 起動に使うワークフローは default ブランチのもの ── `issues` イベントは default ブランチにあるワークフローのファイルでしか起動しない（GitHub Docs の [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)）。作業ブランチでワークフローが書き換えられても起動のしかたは変わらない

制約

- 起動ラベルは triage の権限でも付けられるので、事前確認で、付けた人が書き込み権限以上かを確かめる。満たさなければ実行せずにコメントする ── triage の権限では PR をマージできない。起動ラベルで実行させれば自動マージまで進むので、絞らないと triage の人がマージできることになる
- 起動ラベルの名前は変数 `MERGE_WHILE_YOU_SLEEP_TRIGGER_LABEL` で変えられる

比較した案

- Issue の作成で起動する ── 公開リポジトリでは誰でも作れる。完了条件を書き終える前に起動することがある
- コメントで起動する ── 誰でもコメントできるので権限の検査が必要。コメントの本文が Claude Code への入力に混ざる経路も増える
- アサインで起動する ── 割り当てる相手として専用のアカウントが必要
