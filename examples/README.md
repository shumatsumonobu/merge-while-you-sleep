# 導入した例

merge-while-you-sleep を導入した、小さい [Node.js](https://nodejs.org/) のライブラリ。導入する人が、導入したあとのリポジトリの形を見るためのもの。GitHub の runner で骨格を試したリポジトリの内容から、merge-while-you-sleep のワークフロー、Issue のテンプレート、試験のためだけに置いたものを除いて置いた

- `src/strings.js`、`test/`: 最初に置いたのは `slugify` と `truncate` と `test/strings.test.js` だけ。ほかの関数とテストのファイルは Issue から [Claude Code](https://code.claude.com/docs) が書き、自動でマージされたもの
- `CLAUDE.md`: 導入先の決まり。merge-while-you-sleep は導入先の CLAUDE.md をそのまま使う
- `.github/workflows/ci.yml`: 必須のステータスチェックにしたテスト（ジョブ `ci`）
- `package.json`: `npm test` は `node --test test/*.test.js`。依存は無い

merge-while-you-sleep のワークフローと Issue のテンプレートは、[templates/](../templates/) と同じ内容なのでここには置いていない。違うのは `uses:` の参照先だけ。試験用のリポジトリでは action をそのリポジトリの中（`.github/actions/merge-while-you-sleep/`）にコピーして呼び出した

| 実行 | `uses:` の形 |
|---|---|
| 測定の6本（このリポジトリのディレクトリを並べ替える前の版） | `<試験用のリポジトリ>/.github/actions/merge-while-you-sleep/<ジョブ>@<コミットの SHA>` |
| [measurements/](../measurements/) の reorg1 からあと（並べ替えたあとの版） | `<試験用のリポジトリ>/.github/actions/merge-while-you-sleep/actions/<ジョブ>@<コミットの SHA>` |
| measurements/ の direct1 と direct2 | `<このリポジトリと同じ内容を置いたリポジトリ>/actions/<ジョブ>@<コミットの SHA>` |
| 導入する人が書く形（measurements/ の example1 もこの形。[merge-while-you-sleep-example](https://github.com/shumatsumonobu/merge-while-you-sleep-example) で実行した） | `shumatsumonobu/merge-while-you-sleep/actions/<ジョブ>@<コミットの SHA>` |

direct1 と direct2 は導入する人が書く形とリポジトリの名前だけが違う。どちらもマージまで進んだ（[results.md の「導入の手順の検証」](../docs/design/results.md#導入の手順の検証)）
