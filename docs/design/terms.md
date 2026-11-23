# 用語

設計書の用語の正本。同じものを2つの言い方で呼ばない。設計書の入口は [README.md](README.md)

この文書と、コード、コメント、Issue へのコメントで同じ語を使う

| 用語 | 英語（コードでの名前） | 意味 |
|---|---|---|
| 完了条件 | acceptance criteria | 合否の基準。[Claude Code](https://code.claude.com/docs) が下書きし、人が承認する |
| 下書き | draft | 完了条件を具体化する工程。Claude Code がコードを読み、完了条件の案と質問を Issue にコメントする。そのコメントを下書きのコメントと呼ぶ |
| 承認 | approval | 人が完了条件の案を読んで受け入れること。起動ラベルを付ける操作で示す |
| 承認の記録 | approval record | 事前確認が承認された完了条件を Issue にコメントして残したもの。承認のあとの工程はこれだけを採点の基準にする |
| 実行 | run | 起動ラベルが付いてから終了処理が終わるまでの1回。事前確認、作業、提出、終了処理（実行用）の4つのジョブからなる。下書き用のワークフローのジョブ（下書き、実行待ちの通知、終了処理（下書き用）の3つ）は、実行に入らない |
| 実行待ち | queue | 承認のあとの実行が、同じリポジトリの前の実行が終わるまで待つこと |
| 事前確認 | preflight | 実行の最初のジョブ。Claude Code を呼び出す前に、設定、権限、承認を確かめる |
| 作業 | work | 実行の2つ目のジョブ。Claude Code が計画から修正までをする |
| 終了処理 | cleanup | ワークフローの最後に動くジョブ。ほかのジョブが決めた終わり方をせずに終わったとき、「途中で終わった」として人に引き継ぐ |
| 基準コミット | base commit | 作業を始める、default ブランチ（多くは main）のコミット。事前確認が決める。設計書の「main」は default ブランチを指す |
| 基準コミットのスキル | base skills | 基準コミットにあるスキル。作業の工程で Claude Code に呼び出させてよいスキルはこれだけで、名前ごとの allow ルールで許す。hooks を書いたスキルは動かさない |
| 下書きラベル | draft label | 下書きを始めるラベル。下書き用の Issue のテンプレートが自動で付ける。テンプレートを使わない Issue と、triage 以上の権限の無い人が書いた Issue には、triage 以上の権限を持つ人が付ける（triage 以上の権限の無い人が付けたラベルでは始めない） |
| 起動ラベル | trigger label | 完了条件を承認し、実行を始めるために人が Issue に付けるラベル |
| 引き継ぎラベル | escalation label | 人の判断待ちを示すために実行が Issue に付けるラベル |
| 工程 | stage | 下書き、計画、テスト作成、実装、レビュー、修正、競合の解消、提出の1つ1つ ── [GitHub Actions](https://docs.github.com/actions) の step と区別するため、ステップとは呼ばない |
| 反復 | round | レビュー → 修正の1回 |
| ゲート | gate | コマンドの終了コードで合否を決める検査 |
| 着手前のゲート | base gate | 作業のジョブの最初、Claude Code を呼び出す前のゲート。基準コミットで、テスト、lint、型検査のコマンドが成功することを確かめる。失敗したら Claude Code を呼び出さずに人に引き継ぐ |
| 失敗の確認 | red first（`redFirst`） | テスト作成のあとのゲート。基準コミットにこの実行で書いたテストのファイルだけを追加したツリーで、テストのコマンドが失敗することを確かめる ── 実装が無いのに成功するテストは採点の基準にならない |
| テストの凍結 | test freeze | 実装と修正のあとのゲート。実装と修正の工程がテストのファイルを変更も追加も削除もしていないことを、工程の前後のコミットの差分で確かめる |
| 検査 | check | ゲートに、Claude Code によるレビューなど、コマンドで決まらないものを加えた全体 |
| ミューテーションテスト | mutation testing | 実装をわざと壊してテストが気づくかを確かめる検査。入力でコマンドを渡したときだけ実行する |
| ツリー | tree | git の tree オブジェクト。ある時点のファイルの一式（例: 既存のテストだけのツリー） |
| レポート | report | 各工程で Claude Code が JSON で返す結果 |
| 生データ | raw data | Claude Code が書いたものではない記録（テストの出力、diff） |
| 判定 | judge | レポートと生データから次の工程を選ぶこと |
| 自動マージの範囲 | allowlist | 自動でマージしてよいパスの一覧 |
| 固定の除外ファイル | fixed deny list | 設定によらず自動マージの範囲から外すファイル |
| 変更禁止ファイル | protected files | 固定の除外ファイルのうち、ワークフローを決めるもの（`.github/` の下、`CODEOWNERS`）と、Claude Code の振る舞いを決めるもの（CLAUDE.md、AGENTS.md、`.claude/` の下など）。作業の中で変わったらその場で止める |
| 上限 | limit | 反復の回数、コスト、時間の上限 |
| 繰り返しの検知 | loop detection | 同じ指摘と修正が続いていることを見つけること |
| 人への引き継ぎ | escalation | 実行を止めて判断を人に渡すこと |
| 提出 | submit | 最後の工程。確かめ直し、push、PR の作成、自動マージの予約、CI を待つ、失敗した CI の再実行、ブランチを最新にし直す |
| sandbox | sandbox | Claude Code が Bash で起動したコマンドの、読める場所、書ける場所、外への通信先を絞る Claude Code の機能（[Sandboxing](https://code.claude.com/docs/en/sandboxing)）。ファイルを読むツールと、work.mjs が起動するゲートのコマンドには適用されない ── ゲートのコマンドは別に [bubblewrap](https://github.com/containers/bubblewrap) で隔離する |
| artifact | artifact | ワークフローの実行に付けて保存するファイル。ジョブの間とワークフローの間の受け渡しに使う（GitHub Actions の用語） |
| bundle | bundle | 作業のジョブが変更を提出のジョブへ渡すファイル（git bundle）|
| 続きから進める | resume | 開いている PR のブランチの上で実行をやり直すこと |
| PR 用トークン | PR token | 事前確認と提出に使う GitHub App のトークン ── 個人用アクセストークン（PAT。GitHub のアカウントで発行する個人の認証情報）でも動く |
| 認証情報 | credential | 認証に使う秘密の値とファイル（`CLAUDE_CODE_OAUTH_TOKEN`、`GITHUB_TOKEN`、PR 用トークン、GitHub App の秘密鍵、導入する側の準備の step が置いたもの） |
| 外部の投稿者 | ─ | Issue やコメントを書いた人のうち、リポジトリの `OWNER`、`MEMBER`、`COLLABORATOR` のどれでもない人（GitHub の `author_association`） |
