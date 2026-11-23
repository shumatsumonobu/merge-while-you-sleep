#!/bin/sh
# 測る: Issue をテンプレートの形で1本作って起動し、マージまで待って、生のログと時刻を残す
#   sh measure.sh <関数の名前> <記録の名前>
set -u
FN="$1"; NAME="$2"
R=shumatsumonobu/merge-while-you-sleep-trial
OUT="$(dirname "$0")/measure/$NAME"; mkdir -p "$OUT"
export GH_TOKEN=$(gh auth token -u shumatsumonobu)
BODY=$(printf '### やりたいこと\n\nsrc/strings.js に %s(s, width) を足したい。文字列を、幅 width 以下の行に折り返す\n\n### 完了条件\n\n%s("the quick brown fox", 10) は "the quick\\nbrown fox" を返す（空白の位置で折り返し、行の区切りは \\n）\n%s("a b c", 1) は "a\\nb\\nc" を返す\n%s("abcdefghij", 4) は "abcd\\nefgh\\nij" を返す（width より長い語は width ごとに切る）\n%s("a   b", 10) は "a b" を返す（続く空白は1つにまとめる）\n%s("  a  ", 10) は "a" を返す（前後の空白は除く）\n%s("", 5) は "" を返す\nwidth が 1 より小さいか整数でないとき（0、-1、1.5、NaN）は RangeError を投げる\n新しいテストのファイルに node:test のテストがあり、npm test で既存のテストも含めて全部通る\n\n### 今回やらないこと\n\n既存の関数の変更、既存のテストのファイルの変更、全角文字の幅の扱い、s が文字列以外のときの扱い\n' "$FN" "$FN" "$FN" "$FN" "$FN" "$FN" "$FN")
T0=$(date -u +%s)
u=$(gh issue create -R $R --title "$FN 関数を足したい（測定 $NAME）" --label "merge-while-you-sleep: run" --body "$BODY")
N=${u##*/}; echo "issue=$N"
ID=""
for i in $(seq 1 120); do sleep 5
  for c in $(gh run list -R $R --workflow merge-while-you-sleep-run.yml -L 6 --json databaseId,displayTitle --jq ".[]|select(.displayTitle|test(\"測定 $NAME\"))|.databaseId"); do
    w=$(gh run view $c -R $R --json jobs --jq '.jobs[]|select(.name=="work")|.conclusion // .status' 2>/dev/null)
    [ -n "$w" ] && [ "$w" != "skipped" ] && ID=$c && break
  done; [ -n "$ID" ] && break; done
echo "run=$ID"
gh run watch $ID -R $R >/dev/null 2>&1
for i in $(seq 1 60); do st=$(gh api repos/$R/issues/$N --jq .state); [ "$st" = closed ] && break; sleep 10; done
T1=$(date -u +%s)
gh run view $ID -R $R --log > "$OUT/run.log" 2>&1
gh run view $ID -R $R --json jobs > "$OUT/jobs.json"
# 検索は語の一致なので、別の番号の PR も返る。本文の「Closes #<番号>」が完全に一致する PR を選ぶ
PR=$(gh pr list -R $R --state all -L 50 --json number,body --jq "[.[]|select(.body|test(\"Closes #$N([^0-9]|\$)\"))][0].number")
gh pr view $PR -R $R --json number,createdAt,mergedAt,files,commits > "$OUT/pr.json" 2>/dev/null
gh api "repos/$R/issues/$N" > "$OUT/issue.json"
gh api "repos/$R/issues/$N/comments" > "$OUT/comments.json"
HEAD=$(gh pr view $PR -R $R --json headRefOid --jq .headRefOid 2>/dev/null)
gh api "repos/$R/commits/$HEAD/check-runs" > "$OUT/checks.json" 2>/dev/null
echo "pr=$PR state=$st wall_seconds=$((T1-T0))" | tee "$OUT/summary.txt"
sed -E 's/^[^\t]*\t[^\t]*\t[0-9TZ:.-]+ //' "$OUT/run.log" | grep -E '工程|ゲート|止まった|引き継ぎ' | tee -a "$OUT/summary.txt"
jq -r '.jobs[]|"\(.name) \(.conclusion) \(.startedAt) \(.completedAt)"' "$OUT/jobs.json" | tee -a "$OUT/summary.txt"
