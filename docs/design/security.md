# 守りとトークン

認証情報とゲートを [Claude Code](https://code.claude.com/docs) と外から来る文面から守る仕組み。設計書の入口は [README.md](README.md)

## 守り

人が見ていない間に書き込み権限のあるトークンを持って動く仕組みなので、守りをこの節にまとめる

### 守る対象

- 守る対象: Claude Code の OAuth トークン（`CLAUDE_CODE_OAUTH_TOKEN`）、GitHub のトークン（`GITHUB_TOKEN`、PR 用トークン、App の秘密鍵）、導入する側の準備の step が置いた認証情報（クラウドの認証など）、main に入るもの、非公開のリポジトリのコード
- 想定する攻撃: 外から来る文面（Issue の本文、コメント、コード、テストの出力、CI のログ）に埋め込まれた指示に Claude Code が従うこと ── 従うと認証情報を漏らす、ゲートを外す、関係ない人に通知する、余計な変更をマージする
- 想定しないもの: 導入する側のリポジトリに書き込み権限を持つ人の悪意 ── その人はこの仕組みを使わなくても main を変えられる

守らないもの ── 次のものはこの仕組みの守りの外にある。導入する側が判断する

- self-hosted runner ── GitHub ホストの Ubuntu の runner（ジョブごとに新しいマシン）を前提に作った。self-hosted runner では作業のジョブで置かれたものが次のジョブに残りうる。使ったときの守りは確かめていない
- 導入する側の準備の step（言語の準備、依存のインストール）── 認証情報を持ったまま、sandbox（Claude Code が Bash で起動したコマンドの、読める場所、書ける場所、外への通信先を絞る Claude Code の機能）にもゲートの隔離にも入らずに動く。動かす内容は基準コミット（人がマージしたもの）で、Claude Code が書いたものではない（[run.md の「再実行」](run.md#再実行)）
- カーネル、bubblewrap、Claude Code の sandbox そのものの脆弱性 ── 破られるとゲートの隔離と sandbox の守りは無効になる。最後に決めるのは提出のジョブと CI で、提出のジョブで確かめ直せないものもある（[提出を別のジョブにする](#提出を別のジョブにする)の制約）
- GitHub、Anthropic、npm の側の侵害 ── 防げるのは配布物のすり替えまで（[供給元を固定する](#供給元を固定する)）
- App の秘密鍵の漏洩 ── 秘密鍵に期限は無く、漏れると App をインストールした全部のリポジトリで App の権限の範囲のトークンを発行できる（[PR 用トークンの種類](#pr-用トークンの種類)）。秘密鍵を渡すのは事前確認と提出のジョブだけで、どちらも Claude Code と対象プロジェクトのコードを実行しない。App は使うリポジトリだけにインストールする

| 守り | 塞ぐもの |
|---|---|
| 外から来る文面 | 埋め込まれた指示が完了条件と作業に入る |
| ゲートのコマンドを隔離する | Claude Code が書いたコードがゲートの中で認証情報を読む、外に送る、runner を書き換える |
| Claude Code に認証情報を読ませない | Claude Code が認証情報を読む、外に送る、自分の決まりを緩める |
| 提出を別のジョブにする | 作業のジョブで置かれたものが PR 用トークンを持つ処理に到達する |
| 自動マージの範囲 | ゲートやワークフローを書き換えた変更がそのままマージされる |
| 供給元を固定する | この action と Claude Code が知らないうちに別の内容に変わる |

### 外から来る文面

- Issue の本文とコメントは外部の投稿者から来ることがある ── 本文に Claude Code への指示を埋め込まれるとそのまま下書きの材料になる
- 下書きを始めるのは、権限のある人が下書きラベルを付けた Issue だけ（[draft.md の「下書きの開始条件」](draft.md#下書きの開始条件)）── 外部の投稿者が書いた Issue は triage 以上の権限を持つ人が読んで下書きラベルを付けるまで動かない
- 承認した完了条件での実行は書き込み権限以上の人が起動ラベルを付けたときだけ始める（[adoption.md の「起動方法」](adoption.md#起動方法)）
- 下書きの工程で人が答えるたびに実行が起きる（`issue_comment` イベント）── 公開リポジトリでは誰でもコメントできるので、反応するのは triage 以上の権限を持つ人のコメントだけ。外部の投稿者のコメントは Claude Code に渡さない
- ラベルとコメントで動くのは、人のアカウントからのイベントだけ（`sender.type` が `User`）
- Issue の本文とコメントは画面に表示されない文字を除き、信頼できないデータとして Claude Code に渡す（[run.md の「指示文と Claude Code に渡すもの」](run.md#指示文と-claude-code-に渡すもの)）
- 承認のあとの工程には、承認の記録だけを渡す（[draft.md の「承認の記録」](draft.md#承認の記録)）

### ゲートのコマンドを隔離する

判断: work.mjs はゲートのコマンド（テスト、lint、型検査、ミューテーションテスト）を [bubblewrap](https://github.com/containers/bubblewrap) の中で実行する

- 外への通信なし
- 環境変数は決めた名前だけ
- 見せるファイルはシステムと言語の道具のディレクトリと作業ディレクトリだけ。ホームディレクトリと runner の一時ディレクトリは見せない
- 書き込めるのは作業ディレクトリと、隔離の中に新しく作る一時ディレクトリ（`/tmp` と空のホームディレクトリ）だけ。作業ディレクトリの中でも Claude Code と git が読み込むファイルは読み取りだけにする

なぜ必要か

- ゲートが実行するのは、Claude Code が書いたコード（実装とテスト）── 埋め込まれた指示に従って書いたコードもゲートで実行される
- Claude Code の sandbox が適用されるのは Claude Code が Bash で起動したコマンドだけ ── work.mjs が起動するゲートのコマンドには適用されない
- GitHub ホストの runner では sudo がパスワードなしで使える ── GitHub Docs の [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) に「The Linux and macOS virtual machines both run using passwordless `sudo`.」。隔離しないとテストのコードが root になり、runner の上の何でも読み書きできる

隔離の内容

- 外への通信を切る ── ネットワークの名前空間を分ける
- 環境変数は決めた名前だけを渡す（既定: `PATH`、`HOME`、`LANG`、`LC_ALL`、`TERM`、`CI`、`JAVA_HOME`、`GOROOT`、`GOPATH`、`pythonLocation`、`PKG_CONFIG_PATH`。入力 `pass_env` で追加できる）── 名前で選んで消す形だと、導入する側の準備の step が後の step に渡した認証情報を消し漏らす。例: [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials) の README に「By default, this action exports credentials as environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, etc.)」
- 次の環境変数は `pass_env` に書いても渡さない ── action の入力（GitHub は入力を `INPUT_<名前>` の環境変数で action に渡す。GitHub Docs の [Metadata syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax)。秘密の入力もここに入る）、runner の内部のトークン（`ACTIONS_` で始まる変数）、`GITHUB_TOKEN`、`GH_TOKEN`、`CLAUDE_CODE_OAUTH_TOKEN`
- ゲートに見せるファイル
  - 見せるもの ── 次の3つと、隔離の中に新しく作る `/proc`、`/dev`、`/tmp`、空のホームディレクトリだけ
    - システムのディレクトリ（`/usr`、`/bin`、`/sbin`、`/lib`、`/lib64`、`/etc`）── 読み取りだけ
    - 作業ディレクトリ ── 書き込める。中の Claude Code と git が読み込むファイルは読み取りだけ（下の項目）
    - 言語の道具とキャッシュのディレクトリ ── 読み取りだけ（既定: `/opt/hostedtoolcache`、`~/.cache/pip`、`~/.cache/uv`、`~/.cache/go-build`、`~/.cache/yarn`、`~/.cache/ms-playwright`、`~/.local/bin`、`~/.local/lib`、`~/go`、`~/.cargo/bin`、`~/.cargo/registry`、`~/.cargo/git`、`~/.rustup`、`~/.npm`。入力 `gate_read_paths` で追加できる）
  - 見せないもの ── ホームディレクトリ、`RUNNER_TEMP`、`GITHUB_ENV` と `GITHUB_PATH` が指すファイルのディレクトリ、`/run`、`/var`、`/tmp`。準備の step が置いた認証情報のファイル（例: コンテナのレジストリにログインした設定）を読ませない
  - 下の階層だけ見せる理由 ── 道具のディレクトリは全体ではなく下の階層を見せる。道具のディレクトリの直下に認証情報を置く道具がある。Hugging Face のトークンは `$HF_HOME/token` に置かれる（huggingface_hub の [Environment variables](https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables) のページ）。Cargo の [Configuration](https://doc.rust-lang.org/cargo/reference/config.html) に「Configuration values with sensitive information are stored in the `$CARGO_HOME/credentials.toml` file.」
  - `/run` を見せない理由 ── `/run` には特権を持つ常駐プロセスのソケットがある。GitHub ホストの runner では docker のソケットが `root:docker 0770`（[actions/runner-images](https://github.com/actions/runner-images) の images/ubuntu/scripts/build/install-docker.sh）で、接続すると docker を通じて runner の上の何でも読み書きできる
  - `GITHUB_ENV` と `GITHUB_PATH` を見せない理由 ── そのファイルに書けると同じジョブの後の step に環境変数と PATH を設定できる
- 一時ディレクトリは隔離の中に新しく作る（tmpfs）── runner の一時ディレクトリを書き込める形で見せない
- 作業の最初に作業ディレクトリにあった、git の管理の外のファイルは、`workspace_keep` のディレクトリを除いて、work.mjs が作業ディレクトリの外へ移してあるので、ゲートからも参照できない（[Claude Code に認証情報を読ませない](#claude-code-に認証情報を読ませない)の「読ませない」）── 準備の step は作業ディレクトリにも認証情報のファイルを置く。例: [google-github-actions/auth](https://github.com/google-github-actions/auth) の README に「The credentials file is exported into `$GITHUB_WORKSPACE`」、`create_credentials_file` は「The default is true.」
- プロセスの名前空間を分け、`/proc` から外のプロセスを見せない
- 作業ディレクトリの中の次のものは読み取りだけにする: `.git/`、どの階層の `.claude/` と `.github/` も、`.mcp.json`、CLAUDE.md、CLAUDE.local.md、AGENTS.md、`CODEOWNERS`、CLAUDE.md が `@` で読み込むファイル、入力 `workspace_keep` のディレクトリ（`node_modules` など）
  - 書き込めるとゲートのコードが `.claude/settings.local.json` に hooks や `env` を書き、次に呼び出す Claude Code が sandbox の外でそれを使う（[Permissions](https://code.claude.com/docs/en/permissions) のページの表で `claude -p` では設定のファイルの hooks と `env` は「Used」）
  - `.git/hooks` に書けば work.mjs の git のコマンドがそれを実行する
  - 読み取りだけにできるのは、すでにあるパスだけ ── ゲートのコードが下の階層に新しく作った `.claude/` などはゲートのあとに作業ツリーを戻すことと、Claude Code を呼び出す前の照合で止める（[gates.md の「ゲート」](gates.md#ゲート)）
- 新しい特権を得られない状態で起動する ── bubblewrap の README に「bubblewrap uses `PR_SET_NO_NEW_PRIVS` to turn off setuid binaries」。この状態では Linux の no_new_privs の文書に「the setuid and setgid bits will no longer change the uid or gid」とあり、sudo で root になれない
- bubblewrap が起動できないときは隔離なしでゲートを実行せずに止める
- action のコードが自分で git を呼び出すときの決まり
  - フックと外部の道具を使わない（`-c core.hooksPath=/dev/null`、`-c core.fsmonitor=false`、`--no-ext-diff`）── action のプロセスは認証情報を持っているので、作業ディレクトリに置かれたものを実行しない
  - 置き換えの参照も使わない（`GIT_NO_REPLACE_OBJECTS=1`）── [git-replace の文書](https://git-scm.com/docs/git-replace) に「Replacement references will be used by default by all Git commands except those doing reachability traversal (prune, pack transfer and fsck).」。使うとゲートとレビューが見る差分と、bundle で渡す内容が食い違いうる
  - 工程ごとのコミットはブランチやタグではなく work.mjs の変数に SHA で持つ

制約

- 外部と通信するテスト（例: サービスのコンテナに接続する DB のテスト）は作業のジョブの中で失敗する
  - 入力 `gate_network` で通信を許せる。許しても認証情報を含む環境変数は渡さない
  - 許すとゲートの中のコードがリポジトリのコードを外に送れるようになる（非公開のリポジトリではコードそのものが守る対象）
  - 許さなくても新しいマシンで動く CI が確かめる
- テストが使う環境変数は入力 `pass_env` に名前を書いて追加する ── Secrets の入った変数を追加するとゲートと Claude Code から読める。templates/ のワークフローは Secrets を action の入力（`with`）でだけ渡す。[README の「ワークフローに step を追加するときの注意」](../../README.md#ワークフローに-step-を追加するときの注意)に `pass_env` に Secrets の入った変数を書かないことを入れる
- bubblewrap を起動するために action が sudo で `kernel.apparmor_restrict_unprivileged_userns` を 0 にする ── Ubuntu 24.04 は権限の無い user namespace を AppArmor で止める
  - 変わるのは runner 全体で、同じジョブのあとの step にも適用される。GitHub ホストの runner はジョブが終わると破棄される前提で受け入れる
  - [claude-code-action](https://github.com/anthropics/claude-code-action) も同じ設定を変えている

確認結果（GitHub ホストの runner `ubuntu-24.04`、Claude Code 2.1.319。回数は各項目に書く）

- bubblewrap がゲートのコマンドを起動できる ── `kernel.apparmor_restrict_unprivileged_userns` を 0 にしたうえでゲートの実行が終わった（試験用のリポジトリでゲートを動かした実行のすべて。[measurements/](../../measurements/) の e2e-runs を含む）
- ゲートのコマンドから `/run/docker.sock` に接続できない ── ゲートの中では `/run` を見せないので、ソケットが無い。ホストにはある（3回）
- 依存のディレクトリと `.git` はゲートの中で読めて、書けない（3回）
- npm と python は、読み取りだけのファイル、隠したホームディレクトリ、通信なしで動く ── 一時ディレクトリの中で `npm test` と python3 の標準ライブラリの読み込みが成功した（3回）
- 依存のディレクトリを読み取りだけにしても vitest 3.2.4 の `npm test` が成功した。書ける形でも `node_modules/.vite` を作らなかった（1回）。ほかの道具がキャッシュを書けずに失敗するとゲートのテストが失敗して人に引き継ぐので、検出されないまま成功として扱われることはない
- go と cargo は既定で見せるディレクトリで動く ── `/usr/bin/go` の先は `/opt/hostedtoolcache` の下にあり、既定の一覧に入っている。`go build` と `cargo build --offline` が成功した（各1回）。既定の一覧を渡さない形では go は動かなかった

### Claude Code に認証情報を読ませない

作業のジョブにある認証情報

- `CLAUDE_CODE_OAUTH_TOKEN` ── Claude Code の認証に使う、導入した人のサブスクの認証情報。[Authentication](https://code.claude.com/docs/en/authentication) のページに「generate a one-year OAuth token with `claude setup-token`」とあり、1年有効
- `GITHUB_TOKEN`
- 導入する側の準備の step が置いた認証情報（ファイルと環境変数）

Claude Code が埋め込まれた指示に従ってしまったとき認証情報が漏れる経路は4つ

- 外への通信で送る
- Issue へのコメントに書く（work.mjs がレポートを貼るので公開される）
- コミットに混ぜる（PR として公開される）
- Actions のログと artifact（ワークフローの実行に付けて保存するファイル。ジョブの間とワークフローの間の受け渡しに使う）に残す（公開リポジトリでは誰でも読める前提で扱う）

判断: 3段で塞ぐ。加えて Claude Code に許す操作を work.mjs が決める

| 段 | すること |
|---|---|
| 読ませない | Claude Code と、Claude Code が起動するコマンドに認証情報の入った環境変数とファイルを見せない |
| 外に送らせない | Bash を sandbox で動かし、外への通信を許可したドメインだけに限る |
| 出口で消す | Issue へのコメント、PR の本文、差分、ログから、認証情報の文字列と、外部への取得を引き起こす書き方を除く |

読ませない

- 環境変数 ── 下書きと作業の action は Claude Code のプロセスに、ゲートと同じ決めた名前の環境変数と `CLAUDE_CODE_OAUTH_TOKEN` だけを渡す。ほかに渡すのは action が決めた値の5つ（一時ディレクトリを指す `TMPDIR` と `CLAUDE_CODE_TMPDIR`、設定のディレクトリを指す `CLAUDE_CONFIG_DIR`、`DISABLE_UPDATES=1`、`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`）で、どれも認証情報ではない。Claude Code が起動するコマンドからは `CLAUDE_CODE_OAUTH_TOKEN` も消す（`sandbox.credentials` の deny。Claude Code の [Sandboxing](https://code.claude.com/docs/en/sandboxing) に「environment variables are unset before each sandboxed command runs」）
- sandbox の中のコマンドが読める場所 ── ゲートと同じ場所だけにする
  - `sandbox.filesystem.denyRead` にルートの `/` を書き、ゲートの隔離で見せるディレクトリ、作業ディレクトリ、`/proc`、`/dev`、sandbox の一時ディレクトリを `allowRead` で戻す
  - ホームディレクトリ、`RUNNER_TEMP`、準備の step が `/tmp` や `/opt` に置いた認証情報を読ませない ── Sandboxing に既定は「read access to the entire computer, except certain denied directories. This default still allows reading credential files」
  - `denyRead` と `allowRead` が重なると「the rule with the narrower path applies」。末尾の `/**` は Linux でも有効になる
- sandbox の一時ディレクトリは `allowWrite` でも戻す ── 戻さないと読み取りだけになり、Claude Code が作業の記録を書けずにコマンドが失敗する（runner で確かめた）
- ファイルを読み書きするツール ── 作業ディレクトリの外を使わせない（`permissions.blockReadsOutsideWorkingDirectories` と `permissions.blockWritesOutsideWorkingDirectories`。[Settings reference](https://code.claude.com/docs/en/settings-reference) に「Make Claude's file tools refuse reads outside your working directories in every permission mode, including `bypassPermissions`」）
  - 基準コミットのスキル（基準コミットにあるスキル）の `allowed-tools` が作業ディレクトリの外を許していても止める ── [Skills](https://code.claude.com/docs/en/skills) に `allowed-tools` は「Workspace trust doesn't gate this field.」で、`-p` でも適用される
- ファイルを読むツールで `/proc` を読ませない（permission の deny ルール `Read(//proc/**)`）── `/proc` と書くと `--settings` に渡したファイルの場所が起点になる（Permissions のページの表に `--settings` のファイルでは `/path` は「`<directory of file>/path`」）
- ファイルを読むツールに `RUNNER_TEMP` を読ませない（deny ルール `Read(//<RUNNER_TEMP のパス>/**)`）── 作業ディレクトリの中のシンボリックリンクが外を指しても止める。Permissions に deny ルールは「apply when either the requested path or the file it resolves to matches」
- 作業ディレクトリに置かれた認証情報のファイル ── 作業の最初に作業ディレクトリにあった、git の管理の外のファイル（ignore されたものを含む）は、`workspace_keep` のディレクトリを除いて、Claude Code を呼び出す前に work.mjs が作業ディレクトリの外（`RUNNER_TEMP` の下）へ移す
  - deny ルールに頼らないのは Read の deny ルールが Grep と Glob には「best-effort」だから（Permissions に「Claude makes a best-effort attempt to apply `Read(path)` deny rules to all built-in tools that read files like Grep and Glob.」）
- checkout は `persist-credentials: false`
- 守りの環境変数（`DISABLE_UPDATES`、`CLAUDE_CODE_DISABLE_AUTO_MEMORY`）はプロセスの環境変数に加えて `--settings` の `env` でも渡す
  - 導入先の `.claude/settings.json` の `env` は `claude -p` でも使われる（Permissions のページの表）
  - Settings reference の `env` に「A value here overwrites the same variable exported in your shell, and when more than one settings file sets a variable, the highest-precedence one applies.」
  - `--settings` は導入先の設定より上に置かれる

外に送らせない

- Bash を sandbox で動かし、外への通信を許可したドメインだけに限る ── Sandboxing に外への通信は「allowed domains, which start empty」
- sandbox で失敗したコマンドを sandbox の外でやり直させない（`sandbox.allowUnsandboxedCommands: false`。同じページに「Claude Code ignores the `dangerouslyDisableSandbox` parameter」）。sandbox が使えないときは sandbox なしで動かさずに止める（`sandbox.failIfUnavailable: true`）
- Unix ソケットへの接続を seccomp フィルタ（Linux で、プロセスが使えるシステムコールを絞る仕組み）で止め、フィルタが無ければ始められないとして止める
- WebFetch と WebSearch は deny ルールで使わせない ── ファイルを読むツールと WebFetch は sandbox の外で動く（同じページに「Claude's file tools, MCP servers, and hooks run outside it.」）

出口で消す

- Issue に書くコメントと PR の本文から認証情報の文字列を消し、Claude Code が書いた部分の画像、HTML、リンクを除く（リンクは URL を文字のまま残す）
- 作業のジョブの最後に差分とコミットのメッセージに認証情報の文字列があれば、提出に渡さずに人に引き継ぐ
- 消す認証情報の文字列は action が値を知っているものだけ
  - 作業のジョブ ── action の入力（`INPUT_` で始まる環境変数）、`ACTIONS_` で始まる環境変数、名前に `TOKEN`、`SECRET`、`KEY`、`PASSWORD`、`CREDENTIAL`、`PRIVATE` を含む環境変数のうち、16文字以上の値
  - 作業のジョブで外す値 ── `true`、`false`、数だけの値と、認証情報でない入力（`approval`、`resume`、`base_commit`、名前が `_command` で終わるもの）
  - 提出のジョブ ── action の入力の認証情報
  - 対象の外 ── 準備の step がファイルにだけ置いた認証情報と、形を変えた認証情報（base64 など）。漏れを防ぐ本体は読ませないことと外に送らせないこと
- Actions のログには Claude Code の出力もゲートの出力も出力しない。出力するのは工程の名前、ゲートの終了コード、コスト、トークンの量と、止まった理由の説明（許さないスキルのパス、変わった変更禁止ファイルのパス、作業のジョブが予期せずに失敗したときのエラーの文）。成功したときの出力は出力しないので、Claude Code が読んだファイルの内容はログに出力されない
  - 例外は Claude Code の呼び出しが失敗したとき ── Claude Code が返すエラーの項目（`api_error_status`、`subtype`、`terminal_reason`）と、エラーの文と標準エラーの先頭200文字を、下の「消す認証情報の文字列」と `CLAUDE_CODE_OAUTH_TOKEN` の値を消し、1行にまとめて出力する。出力しないと公開の runner で失敗の理由を確かめる手段が無い
- 標準出力に出力された行はワークフローのコマンド（`::` で始まる行）として解釈されうる。ゲートのコマンドの標準出力と標準エラーは work.mjs が受け取り、ファイルにだけ書く
- step の出力は work.mjs が `GITHUB_OUTPUT` のファイルに書く。Claude Code が書いた文と Issue の文面が入る値は JSON にして1行で書く ── 複数行の書き方は値の中に区切りの行があると、ほかの出力を書き換えられる（GitHub Docs の Workflow commands に「If the value is completely arbitrary then you shouldn't use this format.」）
- bundle の artifact は保持期間を1日にし、提出のジョブがどの終わり方でも最後に消す（[submit.md の「提出のジョブの決まり」](submit.md#提出のジョブの決まり)）
- GitHub が自動で伏せるのはログだけ ── GitHub Docs の [Using secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) で伏せる対象として書かれているのはログ。コメントは伏せられない前提で作る

Claude Code に許す操作

- 下書きと作業の action が Claude Code に `--settings` で設定を渡す
  - permission のモードは `dontAsk` ── Permissions に `dontAsk` は「Auto-denies every call that would otherwise prompt」。人が見ていないので、確認を求める操作はすべて拒否する形にする
  - 使えるツールは `--tools` で絞り、`Skill` のほかの同じツールを `--allowedTools` で確認なしに許す
  - スキルの本文の `` !`command` `` の行は実行しない（`disableSkillShellExecution: true`）── Skills にこの書き方は「runs shell commands before the skill content is sent to Claude」。sandbox の中で動くかは書かれていないので、止める
  - 導入先の hooks は動かさない（`disableAllHooks: true`）── 同じページに自分が書いていないリポジトリで `claude -p` を動かすときの手段として「Pass `--settings '{"disableAllHooks": true}'`」
  - `bypassPermissions` は使わない ── 同じページに「skips permission prompts, including for writes to protected paths such as `.git` and `.claude`」
- 組み込みのツールは `--tools` で名前を並べて許す。工程で分ける
  - テスト作成、実装、修正、競合の解消: `Read,Grep,Glob,Edit,Write,Bash`。sandbox で動く。入力 `allow_tools` で組み込みのツールを追加できる。基準コミットのスキルがあれば `Skill` を追加する（下の項目）
  - 計画、レビュー、下書き: `Read,Grep,Glob` だけ。Bash が無いので sandbox を使わない。`allow_tools` も `Skill` も追加しない ── 追加すると sandbox の外で動く
  - 名前を並べる形にするのは `dontAsk` が承認の不要なツールを止めないため（Permissions に「File reads in your working directories and other actions that need no approval still run」）。名前を並べる形なら Claude Code の版が上がってツールが増えても許さない
  - 承認の不要なツールには claude.ai のクラウドの定期タスクを作る `RemoteTrigger` もある（[Tools reference](https://code.claude.com/docs/en/tools-reference) の表）── クラウドのタスクは sandbox もゲートも提出のジョブも経由しない
- Claude Code の呼び出しごとに設定のディレクトリを新しく作り（`CLAUDE_CONFIG_DIR` を新しい一時ディレクトリに向ける）、auto memory を切る（`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`）── 前の工程の Claude Code が書いたメモを、レビューの工程が読む経路を塞ぐ
  - [Memory](https://code.claude.com/docs/en/memory) のページに「Auto memory is on by default in local sessions.」。メモは作業ディレクトリの外に書かれ、次の呼び出しの起動時に文脈に入る
  - Claude Code を呼び出す前の照合は、作業ディレクトリしか見ない
- ホームディレクトリの隠しファイルは deny ルールにしない ── ファイルを読むツールは `blockReadsOutsideWorkingDirectories` が、sandbox の中のコマンドはルートの `/` の `denyRead` が止める（下の比較した案）
- 許すのは作業ディレクトリのファイルの読み書き、sandbox の中の Bash、基準コミットのスキルだけ
  - スキルは名前ごとに許す ── work.mjs が作業の最初に集めた名前を `Skill(<名前>)` の allow ルールにする（Skills のページの「Restrict Claude's skill access」の書き方）
    - 集めるもの ── 基準コミットの `.claude/skills/<名前>/SKILL.md`（下の階層のものも）と、ルートの `.claude/commands/` の下のファイル。名前はディレクトリの名前と frontmatter の `name` の両方
    - 外すもの ── frontmatter に `hooks` の語があるもの（引用符で囲んだキーや 1行に書く形も含めて、語があれば外す）、frontmatter が閉じていないもの、名前に英数字と `_`、`.`、`:`、`-` のほかの文字があるもの
    - 外したスキルと同じ名前はほかのファイルで許していても許さない ── allow ルールは名前だけで照合するので、同じ名前のスキルにも適用される
    - 続きから進めるとき ── PR の先頭でも同じく集め、両方で許せる名前だけにする。Claude Code が読むのは、PR の先頭の SKILL.md
    - Skill の渡し方 ── `Skill` は `--tools` にだけ入れ、`--allowedTools` には入れない。入れるとどのスキルも確認なしに許す。基準コミットに許すスキルが無ければ `Skill` を `--tools` にも入れない
  - 権限の確認を求めるのは `allowed-tools`、`disallowed-tools`、`hooks` を書いたスキルを呼び出すときだけ（Tools reference の表の `Skill` の行に「Can prompt for skills that set `allowed-tools`, `disallowed-tools`, or `hooks`」）。確認を求めるスキルは allow ルールに名前が無ければ `dontAsk` で拒否される
  - どれも書いていないスキルは確認なしに呼び出せる ── 内容は Claude Code に渡る文面だけで、shell の行は `disableSkillShellExecution` で実行されない。Claude Code がファイルを読むのと変わらないので、受け入れる
  - 作業の中で基準コミットのスキルと同じ名前のスキルが新しく作られると、allow ルールはスキル自身の名前で照合するので（同じページに「Claude Code matches an `allow` rule only against the skill's own name and the name in Claude's invocation」）、許されうる。そのときほかの守り（`--tools`、deny ルール、`disableSkillShellExecution`、sandbox）で止まらないのは frontmatter の hooks だけで、それは `disableAllHooks` が止める（確認結果）
  - 下の階層の `.claude/skills` のスキルはそこのファイルを読んだ時点で読み込まれ（同じページに「They load the first time Claude reads or edits a file in that subdirectory」）、frontmatter の `hooks` は呼び出した時点で登録されて sandbox の外で動く（同じページに「registers when the skill is invoked and keeps running for the rest of the session」）
- MCP のツールは許さない（`--disallowedTools "mcp__*"`）── 入力 `allow_tools` で追加できるのは組み込みのツールだけ。導入先の `.mcp.json` のサーバーは起動しない（`--strict-mcp-config`。[CLI reference](https://code.claude.com/docs/en/cli-reference) に「Only use MCP servers from `--mcp-config`, ignoring all other MCP configurations.」）
- 導入先の設定のファイルに helper のコマンド（Claude Code が認証などのために設定のファイルに書かれたとおりに実行するコマンド。`apiKeyHelper`、`awsAuthRefresh`、`awsCredentialExport`、`gcpAuthRefresh`、`otelHeadersHelper`）があれば、始められないとして止める
  - 確かめ方 ── work.mjs が作業の最初に基準コミットの `.claude/settings.json` と `.claude/settings.local.json`、runner のユーザーの設定を読んで確かめる
  - 続きから進めるとき ── PR の先頭に切り替えたあとにもう一度確かめる。Claude Code が読むのは PR の先頭の設定のファイルで、PR のブランチには人が push できる
  - 作業の中では `.claude/` は変更禁止ファイルなので、それ以上は確かめない
  - 止める理由
    - `disableAllHooks` は helper を止めない（Settings reference に `disableAllHooks` は「Turn off hooks, any custom status line, and any custom file suggestion command」）
    - Permissions のページの表で `claude -p` では helper のコマンドも「Used」
    - helper は sandbox の外で Claude Code の環境変数を持ったまま動き、作業ディレクトリのスクリプトを指せる
    - `apiKeyHelper` は Claude Code の認証に使う値も差し替える
  - `--setting-sources` で導入先の設定を読まない形にはしない ── `project` を外すとスキルとプロジェクトのルールも読まれなくなる（Memory のページに「Project rules are skipped if you exclude `project` from `--setting-sources`」）
- sandbox には seccomp フィルタも入れ、無ければ始められないとして止める ── 今の設定ではルートの `/` の `denyRead` で `/run` ごと参照できないので、seccomp フィルタは2つ目の守り
  - Sandboxing に「The seccomp filter is optional and adds Unix domain socket blocking.」「The sandbox can start without it」
  - Settings reference の `allowAllUnixSockets` に「When the filter is missing, which `/sandbox` reports on its Dependencies tab, the sandbox doesn't block Unix-socket calls.」
  - `failIfUnavailable` がフィルタが無いときにも止まるとは書かれていない
  - GitHub ホストの runner では docker のソケットが `root:docker 0770`（[ゲートのコマンドを隔離する](#ゲートのコマンドを隔離する)）で、runner のユーザーは `docker` グループに入っている（確認結果）
- 導入先の `.claude/settings.json` の allow は適用されず、deny は適用される ── Permissions のページの表で `claude -p` では `.claude/settings.json` の `permissions.allow` は「Not used」。deny は「deny rules from any scope are evaluated before allow rules」
- `--settings` で `allowUnsandboxedCommands: false` を渡すとリポジトリの設定で sandbox を緩める項目は無視される ── Sandboxing に「Claude Code then ignores the settings in a repository's files that loosen the sandbox, `excludedCommands` entries included.」
- 変更禁止ファイルは書き込みを止める
  - sandbox が自分で止めるのは作業ディレクトリとその上の階層の `.claude` の設定、スキル、`.mcp.json` だけ（Sandboxing の Protected paths に「In your working directory and the directories above it」）。`.git` の中で sandbox が自分で止めるのは `hooks` と `config` だけ（Protected paths）
  - それ以外は `--settings` の deny ルールで止める: `Edit(**/.claude/**)`、`Edit(**/.mcp.json)`、`Edit(**/CLAUDE.md)`、`Edit(**/CLAUDE.local.md)`、`Edit(**/AGENTS.md)`、`Edit(**/.github/**)`、`Edit(**/.git/**)`、`Edit(**/CODEOWNERS)`、`workspace_keep` のディレクトリ、work.mjs が集めた `@` の取り込み先
  - `.git` の下を全部止めるのは参照、index、オブジェクトを書き換えると、work.mjs の git の結果を変えられるから。Claude Code が git でコミットする必要は無い（作業用のコミットは work.mjs が作る）
  - Edit の deny ルールは sandbox の設定に統合される（Sandboxing に「Paths and domains from both sandbox settings and permission rules are merged into the final sandbox configuration.」）。ただし Linux では末尾の `/**` のほかのワイルドカードを使ったルールは、sandbox の中のコマンドに適用されない（Settings reference の「Where wildcards work in sandbox paths」に「`Edit` permission rules that contain a wildcard other than a trailing `/**`. Those wildcards don't work for sandboxed commands.」）
  - そこで work.mjs は作業の最初にあるパス（`.git`、`.github`、各階層の `.claude`、CLAUDE.md、CLAUDE.local.md、AGENTS.md、`.mcp.json`、`CODEOWNERS`、`workspace_keep` のディレクトリ、`@` の取り込み先）を1つずつ `sandbox.filesystem.denyWrite` に書く
  - 作業の最初に無いパス（例: 根にまだ無い `.github`、新しく作る `sub/.claude/`）は sandbox の中のコマンドからは止められない ── runner では根にまだ無い `.github` をシンボリックリンクとして作れた（[results.md の「試験結果」](results.md#試験結果)）
  - どれもすり抜けたときのために Claude Code を呼び出す前に毎回作業ディレクトリ全体を探してハッシュで確かめる（[gates.md の「ゲート」](gates.md#ゲート)）。この照合が、作られた `.github` を見つけて止めた
- Claude Code の呼び出しのあと、変更禁止ファイルの照合の前に Claude Code が自分で作業ディレクトリに作るものを消す: `.claude/.cc-writes` と、`.claude` の下に新しくできた空のディレクトリ（それで空になった `.claude` も）
  - sandbox で動く工程のあとに `.claude`、`.claude/.cc-writes`、`.claude/agents`、`.claude/commands` ができていた（runner で Claude Code 2.1.319 で確かめた）。消さないと照合が毎回止める
  - 中にファイルがあるディレクトリは消さず、照合で止める

理由

- 1つの段が破られても次の段で止まる ── 読まれても送れない。送ろうとしても出口で消える
- どれも照合と設定だけで済む ── ツール呼び出しのたびに Claude Code による検査を挟まないので、速度が低下しない
- 画像を除くのは画像の URL にデータを埋め込むと、コメントが表示されるときにその URL へのリクエストが発生し、データが外に出るから ── 非公開のリポジトリのコードもこの経路で漏れうる

比較した案

- 環境変数 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` で Claude Code が起動するコマンドの環境変数を消す ── 使わない。消したい環境変数は `sandbox.credentials` で消す。2.1.319 ではこの変数があると次の2つが起きた（runner で各1回）
  - `sandbox.filesystem.denyRead` が適用されなかった ── ルートの `/` を書いても、`/opt` と `/tmp` を名指ししても、そこに置いた目印を読めた。変数を外すと目印を読めなかった
  - [GitHub Actions](https://docs.github.com/actions) の上では sandbox が `.git` の中の `config.lock` などをマウントの先として作ろうとした。`.git` を書けなくした作業ディレクトリではそれができず、sandbox の中のコマンドが起動しなかった
- ホームディレクトリの隠しファイルを deny ルール（`Read(~/.*)`、`Read(~/.*/**)`）で止める ── 使わない
  - deny ルールの `Read(...)` は sandbox の `denyRead` にも統合され、ファイルを名指しした deny はディレクトリの `allowRead` より強い
  - 書いていたときは既定で見せる `~/.cargo/bin` の `rustup` と `~/.rustup` の内容が sandbox の中で隠れ、cargo が `Permission denied` で動かなかった（runner で1回）
  - 外したあとは cargo が動き、ホームの隠しファイルの目印はファイルを読むツール、Grep、sandbox の中のコマンドのどれでも読めなかった（runner で1回）

制約

- テストが外部と通信するプロジェクトでは Claude Code が Bash で実行したテストが失敗する ── 許可するドメインを入力 `network_allow_domains` で追加できる。`github.com` のような、誰でも書き込める場所のあるドメインを追加するとそこへデータを送れるようになる ── 追加するのは、テストが使う決まった相手だけにする
- sandbox には Linux で bubblewrap と [socat](http://www.dest-unreach.org/socat/) と seccomp フィルタが必要（Sandboxing）── 作業のジョブで入れる
  - 下書きのジョブは sandbox を使わない（読むだけのツールしか許さない）ので入れない
  - seccomp フィルタは `@anthropic-ai/sandbox-runtime`（同じページに「Install it with `npm install -g @anthropic-ai/sandbox-runtime` if it is missing.」）で、版は action が決める
  - claude-code-action もジョブの中で bubblewrap と socat を入れている（claude-code-action の action.yml の Install subprocess isolation dependencies）
- 導入先の hooks は動かない ── hooks は sandbox の外で、通信、ファイルの読み取り、sudo を持ったまま動く（Sandboxing に「Claude's file tools, MCP servers, and hooks run outside it」）
  - hooks そのものは導入した人が書いたものでも、hooks が実行するのは Claude Code が書き換えられる作業ディレクトリの内容（例: ファイルを書いたあとに整形の道具を実行する hook は作業ディレクトリの道具の設定と `node_modules` の中のコードを実行する）
  - 基準コミットのスキルのうち frontmatter に `hooks` を書いたものも許さない ── `disableAllHooks` がスキルの hooks も止めることは runner で確かめたが（確認結果）、Hooks のページには書かれていない。版が上がって変わっても hooks を書いたスキルは呼び出されない

確認結果（GitHub ホストの runner `ubuntu-24.04`、Claude Code 2.1.319。回数は各項目に書く）

回数は `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` を使っていた設定の回を含む。使わない今の設定ではどの項目も1回以上確かめた。生データは [measurements/](../../measurements/) の probe-runs

- sandbox の中のコマンドの環境変数に `CLAUDE_CODE_OAUTH_TOKEN` が無い（1回）
- sandbox の中のコマンドとファイルを読むツールはホーム、`RUNNER_TEMP`、`/tmp`、`/opt` に置いた目印と、作業ディレクトリのシンボリックリンクの先の目印を読めない（今の設定で1回）
- deny ルールの `Read(...)` は、ファイルを名指ししたものだけが sandbox の中のコマンドにも適用され、ディレクトリとグロブの形は適用されなかった（1回）
- `claude -p` の sandbox が有効になる ── sandbox の中のコマンドから参照できるプロセスは6個だけで、外のプロセスは参照できない（3回）
- sandbox の中のコマンドから外のプロセスの環境変数を読めない ── 目印の環境変数を持つプロセスを外で起こし、sandbox の中で `/proc/*/environ` を全部読んでも目印は0件（3回）
- sandbox の中のコマンドは sudo できない ── `/proc/self/status` が `NoNewPrivs: 1` で、`sudo -n true` は「The "no new privileges" flag is set, which prevents sudo from running as root.」で失敗した。グループは `runner` と `nogroup` だけになった。sandbox の外の runner のユーザーは `docker` グループに入っている（各1回）
- `disableAllHooks` はスキルの frontmatter の `hooks` も止める ── 同じスキルで `disableAllHooks: false` の回は設定の hooks もスキルの hooks も動き、`true` の回はどちらも動かなかった（1回）
- スキルを名前ごとに許す形（`Skill` を `--tools` にだけ入れ、`Skill(<名前>)` の allow ルールを渡す）で、基準コミットの `allowed-tools` 付きのスキルは呼び出せ、`hooks` を書いた基準コミットのスキルは「Permission to use Skill has been denied because Claude Code is running in don't ask mode.」で拒否され、hook も動かなかった（3回）
- 1回の呼び出しの中で下の階層に作ったスキルはそこのファイルを読んだあとも「Unknown skill」で呼び出せなかった（2回）
- seccomp フィルタを使う（[供給元を固定する](#供給元を固定する)の確認結果。3回）。work.mjs は `apply-seccomp` のファイルが置けたことを確かめ、置けなければ始められないとして止める
- sandbox の中のコマンドから `/run/docker.sock` は参照できない ── ルートの `/` を `denyRead` に書いたので、`/run` ごと参照できない（今の設定で2回）
- deny ルール `Read(//proc/**)` と `allowRead` の `/proc` が重なると sandbox の中のコマンドは `/proc/self` を読める（`allowRead` が適用される）。ファイルを読むツールで `/proc/<PID>/environ` を読むと deny ルールで拒否される（3回）
- `blockReadsOutsideWorkingDirectories` は作業ディレクトリの中のシンボリックリンクの先を見て止める ── `/tmp` のファイルを指すリンクを Read で読むと「resolves through a symlink to」「which is outside」で拒否された（3回）
- 呼び出しごとの cgroup を sudo で `/sys/fs/cgroup` の下に作れる。`cgroup.kill` で `setsid` で切り離したプロセスも止まる（1回）
- スキルの `allowed-tools` で Read と Bash を許しても作業ディレクトリの外の `/tmp` のファイルを Read で読むと `blockReadsOutsideWorkingDirectories` で拒否された（2回）

### 提出を別のジョブにする

判断: PR 用トークンを使う処理は Claude Code が動くジョブとは別のジョブにする。作業のジョブは変更を git bundle（コミットをまとめた1つのファイル）にして artifact で渡すだけ。提出のジョブは新しいマシンで基準コミットを取得し、bundle から取り込み、確かめ直してから、PR 用トークンを発行して push する

```
ジョブ「事前確認」（PR 用トークンあり。Claude Code も対象プロジェクトのコードも実行しない）
  権限と設定を確かめる → 承認を記録する → 基準コミットを決める
        ↓ 基準コミット
ジョブ「作業」（PR 用トークンなし。Claude Code が動く）
  基準コミットを checkout → 着手前のゲート → 計画 → テスト作成 → 実装 → ゲート → レビュー → 修正 …
  → work.mjs が変更をコミットし、git bundle にする
        ↓ artifact
ジョブ「提出」（新しいマシン。Claude Code も対象プロジェクトのコードも実行しない）
  基準コミットを取得 → bundle から取り込む（checkout しない）→ 確かめ直す
  → PR 用トークンを発行 → push → PR の作成 → 自動マージの予約 → CI を待つ
```

提出のジョブが確かめ直すことは [submit.md の「提出のジョブで確かめ直すこと」](submit.md#提出のジョブで確かめ直すこと)、checkout、push 先、PR の本文、bundle を消すことの決まりは [submit.md の「提出のジョブの決まり」](submit.md#提出のジョブの決まり)

比較した案: 1つのジョブを3つの step（作業、PR 用トークンの発行、提出）に分ける

理由

- 同じジョブの step は同じマシンと同じファイルを使う ── 作業の step で Claude Code が置いたものがあとの step まで残る
  - `.git/hooks` に置いたスクリプトは提出の `git push` のときに PR 用トークンを持った状態で実行され、PATH に置いた偽の `git` や `gh` も同じように実行される
  - 使う action のコードはジョブの最初の「Set up job」でまとめて取得される（runner のログに「Prepare all required actions」「Download action repository」と出る。[actions/checkout#1013](https://github.com/actions/checkout/issues/1013) に貼られたログ。公式の文書には書かれていない）ので、PR 用トークンを発行する action のコードを書き換えられると App の秘密鍵を盗まれる
- ジョブが違えば別のマシンで動く ── 作業のジョブで置かれたものは提出のジョブに持ち込まれない。PR 用トークンと App の秘密鍵があるのは事前確認と提出のジョブだけ
  - 公式の文書で確かめたのは ubuntu-slim の runner の「provisions a new container for that job」と、GitHub Docs の [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) の「each GitHub-hosted runner is a new virtual machine (VM) hosted by GitHub」まで。VM の runner がジョブごとに新しくなると書いた文は見つけていない
- 提出のジョブの確かめ直しは git の結果だけで決まる。作業のジョブの出力では照合を緩めない（続きから進めるときの PR の先頭は事前確認の出力を使う）── 作業のジョブが乗っ取られても確かめ直しの結果は変わらない
- 渡す形を git bundle にするのはマージのコミットも運べるため ── 続きから進めるときに基準コミットを取り込んだコミットがある。差分のファイル（patch）では運べない
- ジョブの権限を分けられる ── 作業のジョブは `contents: read`、`issues: write`、`actions: read`。Claude Code の動作中はどのトークンでも push できない
- PR 用トークンは事前確認と提出の action が App の秘密鍵から、必要になるたびに発行する（発行してから45分を過ぎたら発行し直す）── 1時間の期限を超えて CI を待っても再実行とブランチの更新ができる

制約

- 作業のジョブの中の検査はそのジョブが乗っ取られると信用できない ── [gates.md の「ゲート」](gates.md#ゲート)に書いたとおり、最後に決めるのは提出のジョブと CI
- 提出のジョブで確かめ直せないものがある ── レビューの判定、失敗の確認、テスト作成の工程で書いたテストの凍結、既存のテストだけのツリー（[gates.md の「ゲート」](gates.md#ゲート)）、ミューテーションテスト（既存のテストは提出のジョブが基準コミットとの差分で確かめ直す）。作業のジョブが乗っ取られると飛ばされうる
  - 乗っ取るにはプロンプトインジェクションの成功に加えて、sandbox かゲートの隔離を破る必要がある ── 判定の材料のうち、git の管理の外にあるもの（依存のディレクトリ、`.git`、ignore されたファイル）は書かせないか、ゲートの前に消す（[gates.md の「ゲート」](gates.md#ゲート)）
  - それでも飛ばされたときに通過するのは「自動マージの範囲の中の変更で、既存のテストを変えず、新しいマシンの CI を通過するもの」だけ
  - 新しいマシンでもう1回レビューするジョブは追加しない ── Opus の呼び出しが毎回1回増える割に、防げる範囲が狭い。最小の骨格を優先する
- PR の CI は Claude Code が書いたコードを実行する ── 作業のジョブの守り（認証情報を読ませない、外に送らせない）は CI には無い
  - CI の `GITHUB_TOKEN` に書き込みの権限があると、Claude Code が書いたテストが範囲の外の変更を含む自分の PR の自動マージを有効にできる
  - そこで事前確認がワークフローの `GITHUB_TOKEN` の既定の権限を読み、既定が `write` か、GitHub Actions に PR の作成と承認を許す設定（Allow GitHub Actions to create and approve pull requests）が有効なら、実行を始めない
    - 読み方 ── GitHub Docs の [REST API endpoints for GitHub Actions permissions](https://docs.github.com/en/rest/actions/permissions) の Get default workflow permissions for a repository。`default_workflow_permissions` と `can_approve_pull_request_reviews` を返す。必要な権限は Administration の読み取り
- ワークフローのファイルの `permissions` で既定より広げた CI と、CI に渡した Secrets はこの API では確認できない ── [adoption.md の「導入の前提」](adoption.md#導入の前提)に書く
- ジョブが増え、artifact の受け渡しと checkout の分だけ遅くなる ── 提出のジョブ全体は 52〜109 秒だった（CI を待つ時間を含む。[results.md](results.md#測定結果)）。ジョブを分けたことで増えた分だけは測っていない

### 供給元を固定する

判断: templates/ のワークフローはこのリポジトリの action をコミットの SHA で指定する。下書きと作業の action は確かめた版の Claude Code を入れ、配布物を action に書いた SHA-256 と照合する

理由

- タグとブランチはあとから別のコミットに付け替えられる ── GitHub Docs の [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) に「Pin references to actions to a commit SHA in your workflow files.」。理由は「This helps mitigate the risk of a bad actor adding a backdoor to the action's repository」
- Claude Code の最新の版を毎回入れると動きが実行ごとに変わり、測った値と再現の前提が崩れる ── 版を固定すれば同じ入力で同じ版が動く
- Claude Code のプロセスに `DISABLE_UPDATES=1` を渡す ── [Set up](https://code.claude.com/docs/en/setup) のページに「Native installations automatically update in the background」。[Environment variables](https://code.claude.com/docs/en/env-vars) に `DISABLE_UPDATES` は「block all updates including manual `claude update` and `claude install`」。更新されると照合していない版が動く
- 入れ方: action が版ごとの配布物を直接取得し、action に書いた SHA-256 と照合してから実行する
  - インストール用のスクリプト（`install.sh`）は使わない ── スクリプトは版で固定されておらず、照合の前に実行される
  - seccomp フィルタの `@anthropic-ai/sandbox-runtime` は action に持たせた package-lock.json を使い、`npm ci --ignore-scripts` で入れる。この `npm ci` は認証情報を含まない環境変数で実行する ── `npm install -g` だと依存の版が範囲で決まる
- 版を指定して入れられ、配布物の SHA-256 が公開されている ── Claude Code の Set up のページに版を指定して入れる方法（`bash -s 2.1.89` の形）と「Each release publishes a `manifest.json` containing SHA256 checksums for every platform binary.」

制約

- Claude Code の版を上げるには、この action の版を上げる

確認結果（2026-11-07）

- Claude Code の配布物は版ごとに `https://downloads.claude.ai/claude-code-releases/<版>/<linux-x64 か linux-arm64>/claude` から取得でき、同じ場所の `manifest.json` の `platforms.<プラットフォーム>.checksum` に SHA-256 がある ── インストール用のスクリプト（`https://claude.ai/install.sh`）がこの URL と manifest を使っている
- 固定する版は 2.1.319 ── `permissions.blockWritesOutsideWorkingDirectories` は Settings reference に「Requires Claude Code v2.1.314 or later」。確かめた日の stable は 2.1.311 で、この版に満たない
- Claude Code の配布物は seccomp フィルタを `npm root -g` の結果と、`/usr/local/lib/node_modules` などの決まった場所の下の `@anthropic-ai/sandbox-runtime/vendor/seccomp/<x64 か arm64>/apply-seccomp` で探す（`@anthropic-ai/sandbox-runtime` 0.0.81 の dist/sandbox/generate-seccomp-filter.js）
- action は同梱の package-lock.json で `npm ci --ignore-scripts` を実行し、入れたものを `/usr/local/lib/node_modules/@anthropic-ai/sandbox-runtime` に置く。work.mjs は `apply-seccomp` があるかを確かめ、無ければ始められないとして止める

確認結果（GitHub ホストの runner `ubuntu-24.04`、Claude Code 2.1.319。回数は各項目に書く）

- `@anthropic-ai/sandbox-runtime` を install のスクリプトなしで入れると Claude Code はその seccomp フィルタを使う ── sandbox の中のコマンドで `/proc/self/status` が `Seccomp: 2`（フィルタあり）だった。ゲートの bubblewrap の中は `Seccomp: 0`（3回）

## トークンと権限

| トークン | 使う場面 | 理由 |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code の呼び出し（下書きと作業のジョブ） | サブスク（Pro / Max）の OAuth トークン。手元で `claude setup-token` を実行して発行し、リポジトリの Secrets に登録する |
| `GITHUB_TOKEN` | Issue への進捗コメント、ラベルの付け外し | 次の実行を起こす必要が無い |
| `GITHUB_TOKEN` | CI の結果の読み取り | 読み取りだけで済む |
| PR 用トークン | 事前確認での設定の読み取り | auto-merge の設定、ブランチ保護、ワークフローの `GITHUB_TOKEN` の既定の権限は、`GITHUB_TOKEN` の権限では読めない（App に付ける権限の表） |
| PR 用トークン | 提出 | `GITHUB_TOKEN` で PR を作ると、CI が承認待ちで止まる |
| PR 用トークン | 失敗した CI の再実行 | `GITHUB_TOKEN` に `actions: write` を付けないため |

サブスクの OAuth トークンを使ってよい範囲は Claude Code の [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) の Authentication and credential use に書かれている。この設計はその範囲に収める

- Claude Code の CLI を Anthropic が公開したまま変更せずに実行する ── 同じページに「Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription」
- トークンは導入する本人が `claude setup-token`（Anthropic の認証の流れ）で発行し、本人のリポジトリの Secrets に置く ── このリポジトリは認証情報を集めない、保存しない、仲介しない。同じページに「developers may not collect, store, or intermediate Claude.ai credentials or session tokens」
- 利用は導入する本人のサブスクの利用枠から引かれる ── 他人の利用を肩代わりしない。同じページで禁じているのは「route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users」
- Claude Agent SDK は使わない ── 同じページに Agent SDK を使う製品は API キーで認証するよう書かれている

この範囲で注意すること

- 実行の量によっては利用枠の上限に早く達する ── 同じページに「Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK.」。小さい課題で測った1回の実行の量は [results.md の「測定結果」](results.md#測定結果)
- 製品名に Claude Code や Anthropic の名前を入れない。Anthropic が作った、推薦している、提携していると受け取れる書き方をしない ── 同じページの Using the Claude Code name and logo

自動マージの予約にも PR 用トークンを使う ── `GITHUB_TOKEN` で自動マージを有効にすると、マージ後の main への push でワークフローが起きず、既存の CD が動かないという報告が複数のリポジトリの issue にある（例: [BreakableHoodie/settimesdotca#1209](https://github.com/BreakableHoodie/settimesdotca/issues/1209)）。公式の Docs で確かめたのは「`GITHUB_TOKEN` で起きたイベントは新しい実行を作らない」という一般則まで。予約の決まりは [submit.md の「自動マージの予約」](submit.md#自動マージの予約)

### PR 用トークンの種類

判断: GitHub App のトークンにする。action はトークンの文字列を受け取るだけなので、個人用アクセストークンでも動く。README で勧める手順は GitHub App にする

| 観点 | GitHub App | 個人用アクセストークン（fine-grained） |
|---|---|---|
| 導入の手間 | App を作り、リポジトリにインストールして、client ID と秘密鍵を登録する | トークンを作って、Secrets に登録する |
| 認証情報の有効期限 | トークンは1時間。ジョブの中で必要になるたびに発行し、最後に発行したものをジョブの終わりに取り消す | 最長366日。無期限にもできる |
| 漏れたときの影響 | 最長1時間。発行のときに絞った権限の範囲だけ | 失効させるまで。トークンに付けた権限の範囲 |
| 更新の作業 | なし ── 秘密鍵に期限が無い | 期限が切れるたびに作り直して、Secrets を入れ替える |
| PR の作成者 | App の名前 | 発行した人の名前 ── 人が書いた PR と見分けにくい |
| 発行した人がリポジトリから外れたとき | 動き続ける | 動かなくなる |

理由

- 認証情報の期限が短く、漏れても被害が小さい ── 人が見ていない間に動く仕組みなので、漏れたときの範囲を小さくしておく。トークンの期限は1時間（GitHub Docs の [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)）。発行のときにリポジトリと権限を絞れる（同じページ）
- 運用で更新の作業が無い ── 秘密鍵に期限が無い（GitHub Docs の [Managing private keys for GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps) に「Private keys do not expire and instead need to be manually revoked.」）。個人用アクセストークンは最長366日で、無期限にもできる（GitHub Docs の [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)）
- GitHub が勧めている ── 同じページに「for long-lived integrations, you should use a GitHub App.」

App に付ける権限

| 権限 | 使う場面 |
|---|---|
| Contents の書き込み | push、auto-merge とマージの方法の設定を読む ── GitHub Docs の [Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository) に「To view merge-related settings, you must have the contents:read and contents:write permissions.」 |
| Pull requests の書き込み | PR の作成と更新、自動マージの予約、ブランチを最新にし直す（`PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch`。[Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)） |
| Actions の書き込み | 失敗した CI の再実行、使い終わった bundle の artifact を消す |
| Administration の読み取り | 事前確認でブランチ保護（必須のステータスチェック、署名付きのコミットの必須）と、ワークフローの `GITHUB_TOKEN` の既定の権限を読む |
| Issues の書き込み | マージのあと PR の本文の `Closes #<番号>` で Issue を閉じる ── 発行するトークンには付けない。App のインストールに付いていればよい |

Issues の書き込みは試験用のリポジトリで確かめた（各1回）

- App に付けていないと App が PR を作ってマージしても、PR の本文とマージのコミットのメッセージの両方に `Closes #<番号>` があるのに、Issue は開いたままだった
- App のインストールに付けたあとは提出のジョブが発行したトークンに Issues の権限が無くても、マージと同時に App の名前で Issue が閉じた

Workflows の権限は付けない ── `.github/workflows` の変更を push させない。Metadata の読み取りは GitHub App に必ず付く

トークンの発行

- 事前確認と提出の action が App の秘密鍵で JWT を作り、それでトークンを発行する ── JWT は「Your JWT must be signed using the `RS256` algorithm.」、期限は「no more than 10 minutes into the future.」（GitHub Docs の [Generating a JSON Web Token (JWT) for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)）。署名は Node.js の組み込みの暗号の機能で足りるので、依存は増えない
- 発行はジョブの中で必要になるたびにし（発行してから45分を過ぎたら発行し直す）、最後に発行したトークンをジョブの終わりに取り消す。その前に発行したトークンは 1時間の期限で切れる
- [actions/create-github-app-token](https://github.com/actions/create-github-app-token) を使わない ── step で1回発行すると CI を待つ間に1時間の期限が切れ、再実行とブランチの更新ができなくなる

制約

- 導入の手間が、個人用アクセストークンより多い ── 最初の1回だけ。README の手順で補う
- PR を作るだけなら不要な権限が2つある（Administration の読み取り、Issues の書き込み）── Administration は事前確認で設定を読むためで、読み取りだけなので設定は変えられない。Issues の書き込みはマージで Issue を閉じるためで、発行するトークンには付けない
