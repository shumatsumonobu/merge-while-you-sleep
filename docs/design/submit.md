# 提出

提出のジョブが確かめ直すこと、push と PR の作成の決まり、自動マージの予約と、PR を作成してから自動マージまでに起きることの扱い。提出を別のジョブにする理由とジョブの流れは [security.md の「提出を別のジョブにする」](security.md#提出を別のジョブにする)、検査の順番は [gates.md の「検査のタイミング」](gates.md#検査のタイミング)。設計書の入口は [README.md](README.md)

提出のジョブは作業のジョブが作った bundle（コミットをまとめた git bundle のファイル）を artifact（ワークフローの実行に付けて保存するファイル。ジョブの間とワークフローの間の受け渡しに使う）で受け取る。新しいマシンで基準コミットを取得し、bundle から取り込み、確かめ直してから PR 用トークンを発行して push する

## 提出のジョブで確かめ直すこと

- 取り込んだコミットが基準コミットの子孫であること（続きから進めるときは PR のブランチの今の先頭の子孫でもあること）── 子孫でないか、bundle を取り込めなければ、守りが働いたとして止める
- 変更禁止ファイルが変わっていないこと（続きから進めるときの見方は [run.md の「再実行」](run.md#再実行)）
- 自動マージの範囲と、既存のテスト（範囲の外なら PR は作るが自動マージを予約しない）── シンボリックリンク（モード `120000`）と、ほかのリポジトリのコミットを指すエントリ（gitlink、モード `160000`）は、パスによらず範囲の外にする。パスだけで見ると範囲の中のパスに、範囲の外を指すリンクを置ける
- 基準コミットとの差分で追加した行に検査を無効にする書き方と、外の画像が無いこと（範囲の外なら PR は作るが自動マージを予約しない）── 内容は[検査を無効にする書き方と外の画像](#検査を無効にする書き方と外の画像)
- コミットのメッセージに Issue を閉じるキーワードと `@` が無いこと（続きから進めるときに見るコミットは [run.md の「再実行」](run.md#再実行)）── マージの方法が merge か rebase だとコミットのメッセージがそのまま main に入る

### 検査を無効にする書き方と外の画像

判断: 基準コミットとの差分で追加した行に検査を無効にする書き方か外の画像があれば、範囲の外にする（PR は作るが自動マージを予約しない）。削除した行に無効化の書き方、無効化を戻す書き方、検査を強める書き方があっても範囲の外にする

なぜ必要か

- パスの検査では範囲の中のソースのファイルに書いた無効化のコメントを見つけられない
- 例: StrykerJS の [Disable mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/) の `// Stryker disable` のコメントで変異をソースのファイルから外せる
- [loop-engineering-playbook](https://github.com/shumatsumonobu/loop-engineering-playbook) の proof/README.md の28番は設定のファイルに除外を追加した例で、同じことがソースのファイルでもできる

追加した行で探す既定の書き方 ── 変数 `MERGE_WHILE_YOU_SLEEP_DENY_PATTERNS` で追加できる

| 書き方 | 補足 |
|---|---|
| `eslint-disable` | ─ |
| `/* eslint` | ESLint の設定のコメント |
| `/*eslint` | ESLint の設定のコメント |
| `@ts-nocheck` | ─ |
| `@ts-ignore` | ─ |
| `@ts-expect-error` | ─ |
| `Stryker disable` | ─ |
| `istanbul ignore` | ─ |
| `c8 ignore` | ─ |
| `noqa` | `# ruff: noqa`、`# flake8: noqa` を含む |
| `type: ignore` | ─ |
| `# mypy:` | ─ |
| `pragma: no cover` | ─ |
| `pylint: disable` | ─ |
| `nolint` | ─ |
| `#[allow(` | ─ |
| `#![allow(` | ─ |
| `#[expect(` | ─ |
| `#![expect(` | ─ |
| `#[mutants::skip]` | ─ |
| `cfg_attr(` | ─ |
| `pragma: no mutate` | ─ |
| `@SuppressWarnings` | ─ |
| `@DoNotMutate` | PIT の書き方 |
| `rubocop:disable` | ─ |
| `@codeCoverageIgnore` | ─ |
| `phpcs:ignore` | ─ |
| `phpcs:disable` | ─ |
| `@Suppress(` | ─ |
| `swiftlint:disable` | ─ |
| `deno-lint-ignore` | ─ |
| `biome-ignore` | ─ |

一覧に入れた書き方の出典

- Rust の [Conditional compilation](https://doc.rust-lang.org/reference/conditional-compilation.html) に「When the configuration predicate is true, `cfg_attr` expands out to the attributes listed after the predicate.」
- [mutmut](https://mutmut.readthedocs.io/en/latest/) に `# pragma: no mutate` がある
- 次の書き方もファイルの中から検査を外せる
  - ESLint の [Configure Rules](https://eslint.org/docs/latest/use/configure/rules) の設定のコメント
  - mypy の [Inline configuration](https://mypy.readthedocs.io/en/stable/inline_config.html) の `# mypy:` のコメント
  - Ruff の [Linter](https://docs.astral.sh/ruff/linter/) の `# ruff: noqa`
  - Rust の [Diagnostic attributes](https://doc.rust-lang.org/reference/attributes/diagnostics.html) の `#![allow(...)]` と `#[expect(...)]`

照合のしかた

- 照合の前に続けて追加した行を1つにつなぎ、改行と空白を取り除き、大文字小文字の違いを同じとみなす ── 属性を2行に分ける書き方も検出する
- 文字列の照合なのでどの言語の書き方もすべて検出できるわけではない ── 検出できなかった書き方はレビューと人が PR を読むことに任せ、見つけたら既定の一覧に追加する
- 照合だけなので安く、結果が変わらないので提出のジョブで1回だけ

削除した行

- 削除した行に次のどれかがあっても範囲の外にする
  - 無効化の書き方（追加した行で探す既定の書き方）
  - 無効化を戻す書き方: `Stryker restore`、`eslint-enable`、`c8 ignore stop`、`pragma: no mutate end`、`pylint: enable`、`NOLINTEND`、`rubocop:enable`、`phpcs:enable`、`swiftlint:enable`
  - 検査を強める書き方: `@ts-check`、`#![deny(`、`#![forbid(`
- 戻す行を消すと、そこから後ろがすべて検査から外れる ── [c8](https://github.com/bcoe/c8) の README に `/* c8 ignore start */` から `/* c8 ignore stop */` までを外す書き方がある。StrykerJS の Disable mutants に `next-line` を付けない無効化は「all lines from this point on」に適用される

バイナリとみなす変更

- 差分は `git diff --text` で取り、範囲の中のファイルを git がバイナリとみなす変更は範囲の外にする ── バイナリとみなしたファイルは差分に行が出ず、照合から漏れる（[gitattributes の文書](https://git-scm.com/docs/gitattributes) に git はバイナリかを「examining the beginning of the contents」で決める）

外の画像

- 外の画像は Markdown と HTML の画像で URL が `http` で始まるもの ── 表示したときにその URL へ取得の要求が送られる

## 提出のジョブの決まり

- 取り込んだコミットを checkout しない ── 確かめ直しは作業ツリーを使わない git のコマンド（`git diff --raw --no-renames -z` など）だけで済む
  - `--raw` でモードが、`--no-renames` で名前を変える前のパスも出力される
  - `.gitattributes` のような、checkout と差分の表示で適用される設定を、取り込んだ内容から読まない
- push 先はイベントから決めたブランチだけ
  - 新しく作るとき ── `merge-while-you-sleep/issue-<Issue の番号>-<github.run_id>`。実行ごとに名前が違うので、最初からやり直すときに前のブランチと衝突しない
  - 続きから進めるとき ── 開いている PR のブランチ
  - refspec を明示し、タグは送らない（`--no-tags`）。bundle の中のブランチ名とタグは使わない
- PR のタイトルと本文、マージのコミットのメッセージは、提出のジョブが組み立てる ── 承認の記録、作業のレポートの要約、`Closes #<番号>`
  - 決まった文字列のほか（[Claude Code](https://code.claude.com/docs) が書いた部分と、承認の記録の Issue のタイトルと完了条件）は、`@` を `＠` に変え、Issue を閉じるキーワード（`close`、`fixes`、`resolved` など。GitHub Docs の [Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)）を無効な形にし、画像、HTML、リンクを除く
  - 関係ない Issue を閉じたり、関係ない人に通知したりさせない
- マージの方法は入力 `merge_method`（既定: squash）。マージのコミットのメッセージは、予約の API（GraphQL の `enablePullRequestAutoMerge`）の `commitHeadline` と `commitBody` で渡す ── GitHub Docs の [GraphQL の Pull requests のリファレンス](https://docs.github.com/en/graphql/reference/pulls) の `EnablePullRequestAutoMergeInput` に「Commit headline to use for the commit when the PR is mergable」とある
- 使い終わった bundle の artifact は、提出のジョブがどの終わり方でも最後に PR 用トークンで消す（Actions の書き込み。[Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) の `DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}`）── 守りが働いて PR を作らなかった内容も artifact として残さない

## 自動マージの予約

自動マージの予約には PR 用トークンを使う（理由は [security.md の「トークンと権限」](security.md#トークンと権限)）。予約は GraphQL API の `enablePullRequestAutoMerge` でする

- 必要な条件（必須のステータスチェック、必須のレビュー）を満たしたあとでマージされる
- 予約できなかったときは PR の状態（GraphQL の `mergeStateStatus`）が `CLEAN` か `HAS_HOOKS` で、PR の先頭が変わっていないときだけ、`mergePullRequest` に `expectedHeadOid` を付けてその場でマージする
  - ほかの状態ではマージせずに「提出のあと自動マージまで進めない」で止める ── 必須のチェックを待たずにマージする道を作らない
  - 2つの状態の意味は GitHub の GraphQL のスキーマの説明（`CLEAN` は「Mergeable and passing commit status.」、`HAS_HOOKS` は「Mergeable with passing commit status and pre-receive hooks.」）で確かめた
  - どの状態のときに予約が断られるかは未確認
- `expectedHeadOid` にゲートとレビューを通過したコミットを指定する。マージの時点では照合されない（[提出のあとに CI が失敗したとき](#提出のあとに-ci-が失敗した場合)の確認結果）── CI を待つ間、提出のジョブが PR の先頭の変化を見る

## 提出のあとに CI が失敗した場合

判断: 提出のジョブが必須のステータスチェックの結果を待つ。失敗したら失敗したジョブだけを1回再実行する。それでも失敗したら人に引き継ぐ。Claude Code は呼び出さない

- 必須かどうかは GraphQL API の `CheckRun.isRequired` と `StatusContext.isRequired` で見分け、必須でないチェックの結果では決めない
- 再実行は REST API の Re-run failed jobs for a workflow run（GitHub Docs の [REST API endpoints for workflow runs](https://docs.github.com/en/rest/actions/workflow-runs)）

CI が失敗する理由は2種類ある

- 外部の要因 ── たまたま失敗するテスト、ネットワークや CI 側の不調。もう一度実行すれば成功することがある
- コードの欠陥 ── 作業のジョブのゲートで見つからなかった問題（例: CI でだけ動く DB のテスト）。コードを修正しないと成功しない

比較した案

| 観点 | 1回だけ再実行して、失敗したら人に引き継ぐ | すぐ人に引き継ぐ | 新しい実行を起こして Claude Code に修正させる |
|---|---|---|---|
| 外部の要因で失敗したとき | 再実行で成功すれば人は不要 | 人が必要 | 人は不要 |
| コードの欠陥で失敗したとき | 人が必要 | 人が必要 | 上限までは人は不要 |
| 仕組みの複雑さ | 小さい ── コマンドだけ | 最も小さい | 大きい ── 実行をまたいで回数を数え、開いている PR を引き継ぐ |

理由

- 外部の要因なら人の手を使わずに済む。しかも Claude Code を呼び出さず、コマンドだけで済む
- すぐ人に引き継ぐ案も、失敗したことに気づくには CI を待つ必要がある ── 選んだ案はそこに1回の再実行を追加しただけ
- 新しい実行を起こす案は実行をまたいで回数と状態を持つことになる ── 修正の反復を1つのジョブで繰り返す形にした理由と食い違う。人が起動ラベルを付け直せば、続きから進めて Claude Code が修正する（[run.md の「再実行」](run.md#再実行)）
- [TAKT](https://github.com/nrslib/takt) の `merge-review-fix` も外部の要因による失敗は1回だけ再実行する（TAKT の src/infra/workflow/system/system-pr-ci.ts に「CI rerun budget is exhausted」）。コードの欠陥は最大2回まで修正する（docs/workflows.ja.md）

制約

- 再実行には PR 用トークンを使う ── ジョブの `GITHUB_TOKEN` に `actions: write` を付けると同じジョブの中から、デプロイなど別のワークフローを起動できる権限が広がる
- 再実行の API（Re-run failed jobs）に必要なのは Actions の書き込み ── GitHub Docs の [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)。[security.md の「PR 用トークンの種類」](security.md#pr-用トークンの種類)の「App に付ける権限」の表にある
- CI の結果は提出のジョブの `GITHUB_TOKEN`（`checks: read`、`statuses: read`、`actions: read`）で読む
- 提出のジョブは CI が終わるまで待つ ── その分 runner の時間を使う。待つ時間の合計に上限がある（[gates.md の「上限と繰り返しの検知」](gates.md#上限と繰り返しの検知)）
- 人が修正して push しても、書き込み権限があれば自動マージの予約は残る ── GitHub Docs の [Automatically merging a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request) に解除されるのは「someone without write permissions pushes new changes to the head branch」のとき

確認結果（GitHub ホストの runner `ubuntu-24.04`、Claude Code 2.1.319。回数は各項目に書く）

- CI の結果は GraphQL の `statusCheckRollup` で読む。提出のジョブの `GITHUB_TOKEN` の権限で読めた（3回）
- `expectedHeadOid`（`gh pr merge` の `--match-head-commit`）は、マージの時点では照合されない ── 先頭のコミット A で予約したあと B を push すると予約は外れず、B が自動マージされた（1回）
  - 予約のあとに PR のブランチへ push できるのは書き込み権限のある人だけで、想定する攻撃の外
  - CI の `GITHUB_TOKEN` に書き込みが無いことは、事前確認が確かめる
  - 提出のジョブは CI を待つ間、PR の先頭が提出したコミットのままかを見て、変わっていたら人に引き継ぐ

## CI が成功してもマージできない場合

判断: ブランチが古いだけなら提出のジョブがブランチを最新にし直す。競合と、承認が必要ときは人に引き継ぐ。どちらも Claude Code は呼び出さない

| 状態 | 例 | 扱い | 理由 |
|---|---|---|---|
| ブランチが古い | ブランチ保護で「マージの前にブランチを最新にする」を有効にしていて、夜のうちに main が進んだ | ブランチを最新にし直し（REST API の `PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch`）、CI の結果をもう一度待つ | main を取り込むだけで、コードの判断は不要。新しくなった内容は CI がもう一度確かめる |
| 競合 | 夜のうちに別の PR が同じ箇所を変えて main に入った | 人に引き継ぐ | どちらの変更を残すかの判断が必要。提出のジョブで Claude Code に修正させると、PR 用トークンがある状態で動く。人が起動ラベルを付け直せば、続きから進めて Claude Code が解消する（[run.md の「再実行」](run.md#再実行)） |
| 承認が必要 | ブランチ保護で PR の承認を必須にしている | 人に引き継ぐ。次にやることは「承認する」だけ | 自動マージの予約は残っているので、承認されればそのままマージされる。auto-merge は「after all required reviews and status checks pass」にマージする（GitHub Docs の Automatically merging a pull request） |
| 必須のステータスチェックが結果を返さない | ブランチ保護に書いたステータスチェックの名前が違う。CI が PR では動かない設定になっている | 待つ時間の上限で人に引き継ぐ | 待ち続けることになる |

制約

- ブランチを最新にし直すとマージされるのは「ゲートとレビューを通過した差分 + main の新しい変更」になり、後者は CI だけが確かめる ── 最新にし直さなければマージされるのはゲートとレビューを通過したコミットのまま。人が開発するときと同じ形なので受け入れる
- 最新にし直す回数に上限を設ける ── 夜のうちに main が何度も進むと繰り返しになる
- 最新にし直すにも PR 用トークンを使う ── 事前確認と提出の action が発行し、45分ごとに発行し直す。使い終わったら発行し直した分も含めて全部を取り消す
- 最新にし直したら予約を外し、新しい先頭のコミットで予約し直す ── 予約に書く先頭のコミット（`expectedHeadOid`）を、提出のジョブが確かめ続ける先頭と揃える。`expectedHeadOid` がマージの時点で照合されないことは [提出のあとに CI が失敗したとき](#提出のあとに-ci-が失敗した場合)の確認結果に書いた
- 最新にし直せなかったら（拒否された、競合した）、人に引き継ぐ
- マージキュー（GitHub が PR を順番にマージする仕組み）と、署名付きのコミットの必須には対応しない ── どちらもマージまでの手順が変わり、最小の骨格から外れる。事前確認で見つけたら実行せずに知らせる
  - ルールセットの設定は「Get rules for a branch」（Metadata の読み取り）、ブランチ保護の設定は「Get branch protection」（Administration の読み取り）で読む（GitHub Docs の [REST API endpoints for rules](https://docs.github.com/en/rest/repos/rules) と [REST API endpoints for protected branches](https://docs.github.com/en/rest/branches/branch-protection) の、fine-grained のトークンに必要な権限）
  - ブランチ保護の側のマージキューは、GraphQL API の `Repository.mergeQueue(branch:)` で見つける（GitHub Docs の [GraphQL の Repositories のリファレンス](https://docs.github.com/en/graphql/reference/repos) に「The merge queue for a specified branch」）。型は null を許す `MergeQueue` なので、null ならマージキューは無いとみなす

確認結果（GitHub ホストの runner `ubuntu-24.04`、Claude Code 2.1.319。回数は各項目に書く）

- main に `.github/workflows` の変更が入ったあとも、Workflows の権限の無い PR 用トークン（App のトークン）で `update-branch` ができる。main を取り込んだマージのコミット（`.github/workflows` の変更を含む）も push できる（各1回）
