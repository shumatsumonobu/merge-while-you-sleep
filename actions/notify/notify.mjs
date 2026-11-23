// actions/notify/notify.mjs — 実行待ちの通知の action の本体
//
// 起動ラベルが付いたら、すぐ「実行待ちに入りました」とコメントする

import { pathToFileURL } from "node:url";
import { input, log } from "../../lib/actions.mjs";
import { comment, marker } from "../../lib/escalation.mjs";
import { labels, makeGitHub, permissionOf, readEvent, repoFromEnv } from "../../lib/github.mjs";

// ---------- 実行待ちの通知 ----------


async function modeNotify() {
  const ev = readEvent();
  const gh = makeGitHub(input("github_token"));
  const L = labels();
  const issueN = ev.issue?.number;
  if (!issueN || ev.sender?.type !== "User") return;
  const has = ev.action === "labeled" ? ev.label?.name === L.trigger : (ev.issue.labels || []).some((l) => l.name === L.trigger);
  if (!has) return;
  if ((await permissionOf(gh, ev.sender.login)) !== "write") return; // 事前確認が理由をコメントする
  const { full } = repoFromEnv();
  const wf = input("run_workflow", "merge-while-you-sleep-run.yml");
  let waiting = 0;
  let counted = true;
  try {
    for (const status of ["queued", "pending", "waiting", "requested"]) {
      const d = await gh.get(`/repos/${full}/actions/workflows/${encodeURIComponent(wf)}/runs?status=${status}&per_page=100`);
      waiting += d.total_count || 0;
    }
  } catch {
    counted = false;
  }
  const lines = ["実行待ちに入りました。前の実行が終わると作業を始めます。"];
  if (counted) lines.push("", `実行用のワークフローで開始待ちの実行の数: ${waiting}`);
  if (counted && waiting >= 100) lines.push("", "実行待ちが上限（100件）に達しているため、この起動は取り消される見込みです。実行待ちが減ってから起動ラベルを付け直してください。");
  lines.push("", "取り消す場合は、開始前に起動ラベルを外してください。", "", marker("queued"));
  await comment(gh, issueN, lines.join("\n"));
}

// ---------- 入り口 ----------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  modeNotify().catch(() => {
    log("止まった: 予期しない失敗");
    process.exitCode = 1;
  });
}
