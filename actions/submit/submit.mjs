// actions/submit/submit.mjs — 提出の action の本体
//
// bundle を取り込んで確かめ直し、push、PR の作成、自動マージの予約、CI を待つ
// App の秘密鍵を扱う。Claude Code も、対象プロジェクトのコードも実行しない（docs/design/README.md の構成）
// 取り込んだコミットを checkout しない ── 確かめ直しは作業ツリーを使わない git のコマンドだけで済む

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { input, inputBool, log, setOutput, splitList } from "../../lib/actions.mjs";
import { DEFAULT_DELETED_PATTERNS, DEFAULT_DENY_PATTERNS, scanDiffText } from "../../lib/diff-scan.mjs";
import { comment, escalate, Halt, marker, REASONS, removeLabel } from "../../lib/escalation.mjs";
import { diffEntries, fetchRef, makeGit } from "../../lib/git.mjs";
import { labels, makeGitHub, repoFromEnv, runUrl, triggerLabelIfOurs } from "../../lib/github.mjs";
import { extractImports, FIXED_DENY_PATHS, matcher, PROTECTED_PATHS, resolveImport, testPaths } from "../../lib/paths.mjs";
import { tokenSourceFromInputs } from "../../lib/pr-token.mjs";
import { codeBlock, hasClosingOrMention, sanitizeOutbound, scrubSecrets } from "../../lib/sanitize.mjs";

const SUBMIT_PERMISSIONS = { contents: "write", pull_requests: "write", actions: "write" };

const CI_WAIT_MINUTES = 90;

const MAX_UPDATE_BRANCH = 3;

// ---------- 提出 ----------


/** 自動マージの範囲を確かめる。範囲の外にする理由の一覧を返す（空なら範囲の中） */
export async function checkAllowlist(git, { base, head, allowPaths, denyPaths, testPatterns, imports, denyTextPatterns = [] }) {
  const reasons = [];
  const allow = matcher(allowPaths);
  const deny = matcher([...FIXED_DENY_PATHS, ...denyPaths], { nocase: true });
  const isTest = matcher(testPatterns);
  const entries = await diffEntries(git, base, head);
  for (const e of entries) {
    const p = e.path;
    if (["120000", "160000"].includes(e.oldMode) || ["120000", "160000"].includes(e.newMode)) reasons.push(`${p}: シンボリックリンクか gitlink`);
    else if (deny(p) || imports.has(p)) reasons.push(`${p}: 固定の除外ファイル`);
    else if (isTest(p) && e.status !== "A") reasons.push(`${p}: 既存のテストの変更`);
    else if (!allow(p)) reasons.push(`${p}: MERGE_WHILE_YOU_SLEEP_ALLOW_PATHS の外`);
  }
  const numstat = (await git(["diff", "--numstat", "--no-renames", "--no-ext-diff", "--no-textconv", "-z", base, head])).out;
  for (const rec of numstat.split("\0").filter(Boolean)) {
    const [a, d, p] = rec.split("\t");
    if (a === "-" && d === "-") reasons.push(`${p}: git がバイナリとみなしたファイル`);
  }
  const text = (await git(["diff", "--text", "-U0", "--no-renames", "--no-ext-diff", "--no-textconv", base, head])).out;
  const add = [...DEFAULT_DENY_PATTERNS, ...denyTextPatterns];
  reasons.push(...scanDiffText(text, { addPatterns: add, deletePatterns: [...add, ...DEFAULT_DELETED_PATTERNS] }));
  return [...new Set(reasons)];
}

/** 基準コミットの CLAUDE.md と AGENTS.md から、@ の取り込み先をたどる */
export async function importsAtRev(git, rev) {
  const files = (await git(["ls-tree", "-r", "-z", "--name-only", rev])).out.split("\0").filter(Boolean);
  let frontier = files.filter((p) => /(^|\/)(CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md)$/i.test(p));
  const found = new Set();
  const seen = new Set();
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const next = [];
    for (const f of frontier) {
      if (seen.has(f)) continue;
      seen.add(f);
      const r = await git(["show", `${rev}:${f}`], { allowFail: true });
      if (r.code !== 0) continue;
      for (const t of extractImports(r.out)) {
        const p = resolveImport(f, t);
        if (p && !found.has(p)) {
          found.add(p);
          next.push(p);
        }
      }
    }
    frontier = next;
  }
  return found;
}

/** 変更禁止ファイル: 新しい先頭の内容が、基準コミットか前の PR の先頭の内容と同じか */
export async function checkProtectedFiles(git, { base, head, prevHead, imports }) {
  const isProtected = matcher(PROTECTED_PATHS, { nocase: true });
  const changed = (await diffEntries(git, base, head)).filter((e) => isProtected(e.path) || isProtected(`${e.path}/`) || imports.has(e.path));
  if (!prevHead) return changed.map((e) => e.path);
  const bad = [];
  for (const e of changed) {
    const atHead = await git(["rev-parse", "-q", "--verify", `${head}:${e.path}`], { allowFail: true });
    const atPrev = await git(["rev-parse", "-q", "--verify", `${prevHead}:${e.path}`], { allowFail: true });
    if (atHead.out.trim() !== atPrev.out.trim()) bad.push(e.path);
  }
  return bad;
}

async function pushWithToken(git, token, sha, branch) {
  const { full } = repoFromEnv();
  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
  const g = makeGit(git.cwd, { env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `http.${server}/.extraheader`, GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}` } });
  const r = await g(["push", "-q", "--no-tags", `${server}/${full}.git`, `${sha}:refs/heads/${branch}`], { allowFail: true });
  return r.code === 0;
}

export function prBody({ approval, report, automerge, outsideReasons, secrets }) {
  const s = (x) => sanitizeOutbound(x, secrets);
  const lines = [
    "## 承認の記録",
    "",
    codeBlock(s(approval.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n"))),
    "",
    "## 作業のレポート",
    "",
    `- ${report.resume ? "続きから進めました" : "最初から作業しました"}`,
    `- 工程: ${report.stages.map(s).join(" → ") || "なし"}`,
    `- コスト（Claude Code の推定）: ${Number(report.cost_usd || 0).toFixed(2)} USD`,
  ];
  if (report.tests?.length) {
    lines.push("", "### 完了条件とテスト", "");
    for (const t of report.tests) lines.push(`- ${s(t.path)}: 完了条件 ${(t.criteria || []).map(Number).join("、")}`);
  }
  if (report.suggestions?.length) {
    lines.push("", "### レビューの提案（修正には進めていません）", "");
    for (const f of report.suggestions) lines.push(`- ${s(f.location)}: ${s(f.description)}`);
  }
  if (report.notes?.length) lines.push("", ...report.notes.map((n) => `- ${s(n)}`));
  lines.push("", "## 自動マージ", "", automerge ? "自動マージの範囲の中で、ゲートとレビューを通過しました。自動マージを予約します。" : "自動マージは予約しません。PR を読んでマージしてください。");
  if (outsideReasons.length) lines.push("", ...outsideReasons.map((r) => `- ${s(r)}`));
  if (report.escalation) lines.push("", `止まった理由: ${REASONS[report.escalation.reason]?.title || "不明"}`);
  // 本文の大きさを抑える ── 指摘は目印に入れる件数と長さを絞る。本文は GitHub の上限より短く切る
  const cut = (x, n) => (String(x ?? "").length > n ? `${String(x).slice(0, n)}…` : String(x ?? ""));
  const findings = (report.findings || []).slice(0, 30).map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? cut(v, 400) : v])));
  let text = lines.join("\n");
  if (text.length > 50000) text = `${text.slice(0, 50000)}\n\n…（長いため省略しました）`;
  return [text, "", `Closes #${approval.issue}`, "", `実行のログ: ${runUrl()}`, "", marker("pr", { approval_hash: approval.hash, findings })].join("\n");
}

async function modeSubmit() {
  const ws = process.env.GITHUB_WORKSPACE;
  const gh = makeGitHub(input("github_token"));
  const L = labels();
  const { owner, repo, full } = repoFromEnv();
  const approval = JSON.parse(input("approval"));
  const report = JSON.parse(input("work_report"));
  const base = input("base_commit");
  const head = input("bundle_head");
  const resume = input("resume") ? JSON.parse(input("resume")) : null;
  // 続きから進めるときの PR の先頭は、事前確認が記録した値を使う。作業のジョブの出力は信じない
  const prevHead = resume ? resume.head_sha : "";
  const automergeIn = inputBool("automerge", false);
  const bundle = input("bundle_path", join(process.env.RUNNER_TEMP || "/tmp", "merge-while-you-sleep-bundle", "work.bundle"));
  const issueN = approval.issue;
  const git = makeGit(ws);
  const secrets = [input("github_token"), input("token"), input("app_private_key")].filter(Boolean);
  let tokens = null;
  let prNumber = null;
  const finish = async (reason, details) => {
    const link = prNumber ? `\n\nPR: #${prNumber}` : "";
    await escalate(gh, { issue: issueN, reason, mention: approval.labeled_by, details: `${sanitizeOutbound(details, secrets)}${link}`, removeLabels: await triggerLabelIfOurs(gh, issueN, L) });
    setOutput("done", "true");
  };
  try {
    // bundle を取り込む（checkout しない）
    if (resume) {
      const now = await fetchRef(git, gh, input("github_token"), resume.head_ref);
      if (now !== prevHead) return await finish("not_merged", "作業の間に、人が PR のブランチへ push しました");
    }
    if (!existsSync(bundle)) throw new Halt("guard_tripped", "bundle がありません");
    const v = await git(["bundle", "verify", "-q", bundle], { allowFail: true });
    if (v.code !== 0) throw new Halt("guard_tripped", "bundle を取り込めません");
    await git(["fetch", "-q", "--no-tags", bundle, "refs/merge-while-you-sleep/bundle:refs/merge-while-you-sleep/incoming"]);
    const got = (await git(["rev-parse", "refs/merge-while-you-sleep/incoming"])).out.trim();
    if (got !== head) throw new Halt("guard_tripped", "bundle の先頭が作業のジョブの出力と異なります");
    const anc = await git(["merge-base", "--is-ancestor", base, head], { allowFail: true });
    if (anc.code !== 0) throw new Halt("guard_tripped", "取り込んだコミットが基準コミットの子孫ではありません");
    if (prevHead) {
      const anc2 = await git(["merge-base", "--is-ancestor", prevHead, head], { allowFail: true });
      if (anc2.code !== 0) throw new Halt("guard_tripped", "取り込んだコミットが PR のブランチの現在の先頭の子孫ではありません");
    }

    // 確かめ直す
    const imports = await importsAtRev(git, base);
    const prot = await checkProtectedFiles(git, { base, head, prevHead: prevHead || null, imports });
    if (prot.length) throw new Halt("guard_tripped", "変更禁止ファイルが変更されました");
    const revs = ["rev-list", head, `^${base}`];
    if (prevHead) revs.push(`^${prevHead}`);
    const ours = (await git(revs)).out.split("\n").filter(Boolean);
    for (const c of ours) {
      const msg = (await git(["log", "-1", "--format=%B", c])).out;
      if (hasClosingOrMention(msg)) throw new Halt("guard_tripped", "この実行が追加したコミットのメッセージに、Issue を閉じるキーワードか @ があります");
    }
    const outside = await checkAllowlist(git, {
      base, head, allowPaths: splitList(process.env.MERGE_WHILE_YOU_SLEEP_ALLOW_PATHS), denyPaths: splitList(process.env.MERGE_WHILE_YOU_SLEEP_DENY_PATHS),
      testPatterns: testPaths(), imports, denyTextPatterns: splitList(process.env.MERGE_WHILE_YOU_SLEEP_DENY_PATTERNS),
    });
    const automerge = automergeIn && outside.length === 0 && !report.escalation;

    // ここから PR 用トークンを使う
    tokens = tokenSourceFromInputs(SUBMIT_PERMISSIONS);
    let pr = await tokens.gh();
    let prNode;
    if (resume) {
      prNumber = resume.pr_number;
      const cur = await pr.get(`/repos/${full}/pulls/${prNumber}`);
      if (cur.auto_merge) {
        try {
          await pr.graphql(`mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){clientMutationId}}`, { id: cur.node_id });
        } catch {
          return await finish("not_merged", "前の実行が予約した自動マージを解除できません。push はしていません");
        }
      }
      if (!(await pushWithToken(git, await tokens.get(), head, resume.head_ref))) return await finish("not_merged", "作業の間に、人が PR のブランチへ push しました（push が拒否されました）");
      await pr.patch(`/repos/${full}/pulls/${prNumber}`, { body: prBody({ approval, report, automerge, outsideReasons: outside, secrets }) });
      prNode = cur.node_id;
    } else {
      const branch = `merge-while-you-sleep/issue-${issueN}-${process.env.GITHUB_RUN_ID}`;
      if (!(await pushWithToken(git, await tokens.get(), head, branch))) throw new Halt("not_merged", "push できません");
      const repoInfo = await pr.get(`/repos/${full}`);
      let created;
      try {
        created = await pr.post(`/repos/${full}/pulls`, {
          title: `${sanitizeOutbound(approval.title, secrets).slice(0, 200)} (#${issueN})`,
          head: branch, base: repoInfo.default_branch,
          body: prBody({ approval, report, automerge, outsideReasons: outside, secrets }),
        });
      } catch {
        throw new Halt("not_merged", `ブランチ ${branch} を push しましたが、PR を作成できません`);
      }
      prNumber = created.number;
      prNode = created.node_id;
    }
    setOutput("pr_number", String(prNumber));
    await deleteBundleArtifact(pr, full);

    if (report.escalation) return await finish(report.escalation.reason, report.escalation.details);
    if (outside.length) return await finish("outside_allowlist", `範囲の外にした理由:\n${outside.map((r) => `- ${r}`).join("\n")}`);
    if (!automergeIn) return await finish("outside_allowlist", "作業のジョブが、自動マージを予約しないと決めました（計画の工程が範囲の外の変更を見込みました）");
    if (!automerge) return await finish("undecidable", "自動マージを予約してよいかが決まりません");

    await enableAutoMerge(pr, prNode, head, approval);
    const r = await waitForMerge({ tokens, gh, full, owner, repo, prNumber, head, approval });
    if (r.merged) {
      await comment(gh, issueN, `PR #${prNumber} がマージされました。\n\n${marker("merged")}`);
      for (const l of await triggerLabelIfOurs(gh, issueN, L)) await removeLabel(gh, issueN, l);
      setOutput("done", "true");
      return;
    }
    pr = await tokens.gh();
    return await finish("not_merged", r.why);
  } catch (e) {
    if (e instanceof Halt) return await finish(e.reason, e.details);
    throw e;
  } finally {
    // どの終わり方でも bundle の artifact を消す ── PR 用トークンを発行する前に止まったときも
    try {
      tokens ??= tokenSourceFromInputs(SUBMIT_PERMISSIONS);
      await deleteBundleArtifact(await tokens.gh(), full);
    } catch {}
    await tokens?.revoke();
  }
}

async function deleteBundleArtifact(pr, full) {
  try {
    const arts = await pr.get(`/repos/${full}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts?per_page=100`);
    for (const a of (arts.artifacts || []).filter((x) => x.name === "merge-while-you-sleep-bundle")) await pr.del(`/repos/${full}/actions/artifacts/${a.id}`);
  } catch {}
}

const MERGE_METHODS = { squash: "SQUASH", merge: "MERGE", rebase: "REBASE" };

async function enableAutoMerge(pr, prNode, head, approval) {
  const method = MERGE_METHODS[input("merge_method", "squash")] || "SQUASH";
  const headline = `merge-while-you-sleep: Issue #${approval.issue} の完了条件を満たす変更`;
  const body = `承認の記録の完了条件を、ゲートとレビューで確かめた。\n\nCloses #${approval.issue}`;
  try {
    await pr.graphql(
      `mutation($id:ID!,$m:PullRequestMergeMethod!,$h:GitObjectID!,$t:String!,$b:String!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$m,expectedHeadOid:$h,commitHeadline:$t,commitBody:$b}){clientMutationId}}`,
      { id: prNode, m: method, h: head, t: headline, b: body },
    );
  } catch (e) {
    // 必須のステータスチェックが全部通過してマージできる状態（CLEAN か HAS_HOOKS）だと、予約できない。そのときだけ、同じ先頭のコミットでマージする
    // ほかの理由で予約できないときは、マージせずに止める ── 必須のチェックを待たずにマージする道を作らない
    const st = await pr.graphql(
      `query($id:ID!){node(id:$id){... on PullRequest{mergeStateStatus headRefOid}}}`,
      { id: prNode },
    ).catch(() => null);
    if (!["CLEAN", "HAS_HOOKS"].includes(st?.node?.mergeStateStatus) || st.node.headRefOid !== head) {
      throw new Halt("not_merged", `自動マージを予約できません（${String(e?.message || e).slice(0, 200)}）`);
    }
    await pr.graphql(
      `mutation($id:ID!,$m:PullRequestMergeMethod!,$h:GitObjectID!,$t:String!,$b:String!){mergePullRequest(input:{pullRequestId:$id,mergeMethod:$m,expectedHeadOid:$h,commitHeadline:$t,commitBody:$b}){clientMutationId}}`,
      { id: prNode, m: method, h: head, t: headline, b: body },
    ).catch(() => {
      throw new Halt("not_merged", "自動マージを予約できません");
    });
  }
}

/** 必須のステータスチェックの結果を待つ。失敗したら1回だけ再実行し、古ければ最新にし直す */
async function waitForMerge({ tokens, gh, full, owner, repo, prNumber, head, approval }) {
  const deadline = Date.now() + CI_WAIT_MINUTES * 60000;
  let expected = head;
  let reruns = 0;
  let updates = 0;
  const q = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){id merged state mergeStateStatus reviewDecision headRefOid autoMergeRequest{enabledAt}
    commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100){nodes{__typename
      ... on CheckRun{name status conclusion isRequired(pullRequestNumber:$n)}
      ... on StatusContext{context state isRequired(pullRequestNumber:$n)}}}}}}}}}}`;
  let quietUntil = 0;
  while (Date.now() < deadline) {
    const p = (await gh.graphql(q, { o: owner, r: repo, n: prNumber })).repository.pullRequest;
    if (p.merged) return { merged: true };
    if (p.state !== "OPEN") return { why: "PR が閉じられました" };
    if (p.headRefOid !== expected) return { why: "提出のあとに PR のブランチへ push されました" };
    const nodes = p.commits.nodes[0]?.commit?.statusCheckRollup?.contexts?.nodes || [];
    const state = requiredState(nodes);
    if (state === "FAILURE" && Date.now() >= quietUntil) {
      if (reruns >= 1) return { why: `再実行しても CI が失敗しました（失敗した必須のステータスチェック: ${failedRequiredNames(nodes).join("、")}）` };
      reruns++;
      await rerunFailed(await tokens.gh(), full, expected);
      quietUntil = Date.now() + 120000; // 再実行が始まるまで、前の失敗を読まない
    } else if (p.mergeStateStatus === "DIRTY") {
      return { why: "競合しました" };
    } else if (p.mergeStateStatus === "BEHIND") {
      if (updates >= MAX_UPDATE_BRANCH) return { why: "ブランチを最新にし直す回数が上限に達しました" };
      updates++;
      const pr = await tokens.gh();
      try {
        await pr.put(`/repos/${full}/pulls/${prNumber}/update-branch`, { expected_head_sha: expected });
      } catch {
        return { why: "ブランチを最新にできません" };
      }
      const newHead = await waitHeadChange(gh, { owner, repo, prNumber, from: expected });
      if (!newHead) return { why: "ブランチを最新にできません（先頭が変わりません）" };
      expected = newHead;
      try {
        await pr.graphql(`mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){clientMutationId}}`, { id: p.id });
      } catch {}
      await enableAutoMerge(pr, p.id, expected, approval);
    } else if (state === "SUCCESS" && p.reviewDecision === "REVIEW_REQUIRED") {
      return { why: "承認が必要です（自動マージの予約は残っています。承認されるとマージされます）" };
    } else if (state === "SUCCESS" && !p.autoMergeRequest && p.mergeStateStatus !== "CLEAN") {
      return { why: "自動マージの予約が解除されました" };
    }
    await new Promise((r) => setTimeout(r, 30000));
  }
  return { why: "必須のステータスチェックが、待機時間の上限までに結果を返しませんでした" };
}

const failedCheck = (n) => (n.__typename === "CheckRun" ? n.status === "COMPLETED" && !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(n.conclusion) : ["FAILURE", "ERROR"].includes(n.state));

/** 失敗した必須のステータスチェックの名前 */
export function failedRequiredNames(nodes) {
  return nodes.filter((n) => n.isRequired && failedCheck(n)).map((n) => n.name || n.context || "（名前なし）");
}

/** 必須のステータスチェックだけで、通過した、失敗した、待っている、を決める */
export function requiredState(nodes) {
  const req = nodes.filter((n) => n.isRequired);
  if (req.length === 0) return "PENDING";
  const failed = (n) => (n.__typename === "CheckRun" ? n.status === "COMPLETED" && !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(n.conclusion) : ["FAILURE", "ERROR"].includes(n.state));
  const passed = (n) => (n.__typename === "CheckRun" ? n.status === "COMPLETED" && ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(n.conclusion) : n.state === "SUCCESS");
  if (req.some(failed)) return "FAILURE";
  if (req.every(passed)) return "SUCCESS";
  return "PENDING";
}

async function waitHeadChange(gh, { owner, repo, prNumber, from }) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const d = await gh.graphql(`query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){headRefOid}}}`, { o: owner, r: repo, n: prNumber });
    if (d.repository.pullRequest.headRefOid !== from) return d.repository.pullRequest.headRefOid;
  }
  return null;
}

async function rerunFailed(pr, full, sha) {
  const runs = await pr.get(`/repos/${full}/actions/runs?head_sha=${sha}&per_page=50`);
  for (const r of (runs.workflow_runs || []).filter((x) => x.conclusion === "failure" && String(x.id) !== process.env.GITHUB_RUN_ID)) {
    try {
      await pr.post(`/repos/${full}/actions/runs/${r.id}/rerun-failed-jobs`, {});
    } catch {}
  }
}

// ---------- 入り口 ----------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  modeSubmit().catch((e) => {
    log(`止まった: ${e instanceof Halt ? REASONS[e.reason].title : "予期しない失敗"}`);
    process.exitCode = 1;
  });
}
