// actions/work/work.mjs の、続きから進めるときの流れのテスト（node --test）
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { Stop } from "../lib/escalation.mjs";
import { makeGit } from "../lib/git.mjs";
import { DEFAULT_TEST_PATHS, matcher } from "../lib/paths.mjs";
import { compareSnapshots, makeInAllowlist, protectedSnapshot, workFlow } from "../actions/work/work.mjs";

const put = (ws, p, s) => {
  mkdirSync(dirname(join(ws, p)), { recursive: true });
  writeFileSync(join(ws, p), s);
};

/** 基準コミット、前の実行の PR のブランチ、そのあと進んだ main を作る */
async function makeResumeRepo({ mainChange = ["src/other.js", "export const y = 1;\n"], prChange = null } = {}) {
  const ws = mkdtempSync(join(tmpdir(), "merge-while-you-sleep-resume-"));
  const git = makeGit(ws);
  put(ws, "src/index.js", "export const x = 1;\n");
  put(ws, "tests/index.test.js", "// 既存のテスト\n");
  put(ws, "CLAUDE.md", "# 決まり\n");
  await git(["init", "-q", "-b", "main"]);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "base0"]);
  await git(["checkout", "-q", "-b", "merge-while-you-sleep/issue-1-100"]);
  put(ws, "tests/new.test.js", "// x が 42 を返す\n");
  put(ws, "src/index.js", "export const x = 42;\n");
  if (prChange) put(ws, prChange[0], prChange[1]);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "merge-while-you-sleep: implement"]);
  const prHead = (await git(["rev-parse", "HEAD"])).out.trim();
  await git(["checkout", "-q", "main"]);
  put(ws, mainChange[0], mainChange[1]);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "main が進んだ"]);
  const base = (await git(["rev-parse", "HEAD"])).out.trim();
  return { ws, git, base, prHead };
}

async function makeResumeCtx({ ws, git, base, prHead }, stages, gate) {
  const isTest = matcher(DEFAULT_TEST_PATHS, { nocase: true });
  const files = (await git(["ls-files", "-z"])).out.split("\0").filter(Boolean);
  const baseTests = new Set(files.filter(isTest));
  await git(["checkout", "-q", "--detach", prHead]);
  const imports = new Set();
  const keep = [];
  const calls = [];
  const counts = {};
  const ctx = {
    ws, git, base, start: prHead, reviewBase: base, keep, imports, baseTests,
    resume: { pr_number: 7, head_ref: "merge-while-you-sleep/issue-1-100", head_sha: prHead, findings: [], ci_log: "失敗した CI のログ" },
    approval: { issue: 1, title: "x を 42 にする", criteria: ["x が 42 を返す"], out_of_scope: [] },
    cfg: {
      limits: { max_rounds: 3, max_same_finding: 2, max_gate_failures: 3, max_test_returns: 1, max_cost_usd: 100, max_work_minutes: 60 },
      models: {}, commands: { test: "npm test", lint: "", typecheck: "", mutation: "", testFile: "" }, testPaths: DEFAULT_TEST_PATHS, denyPaths: [],
    },
    now: () => Date.now(),
    inAllowlist: makeInAllowlist({ allowPaths: ["src/**", "tests/**"], denyPaths: [], imports, baseTests }),
  };
  let snap = protectedSnapshot(ws, { keep, imports });
  ctx.checkProtected = async () => {
    if (compareSnapshots(snap, protectedSnapshot(ws, { keep, imports })).length) throw new Stop("guard_tripped", "x");
  };
  ctx.refreshProtected = () => {
    snap = protectedSnapshot(ws, { keep, imports });
  };
  ctx.deps = {
    progress: async () => {},
    gate: async (name, cmd, opts) => {
      calls.push(`gate:${name}`);
      return gate ? gate(ws, name, cmd, opts) : { code: 0, tail: "" };
    },
    claude: async (stage, opts) => {
      calls.push(stage);
      counts[stage] = (counts[stage] || 0) + 1;
      const h = stages[stage];
      const f = Array.isArray(h) ? h[counts[stage] - 1] : h;
      return { output: typeof f === "function" ? f(ws, opts) : f, cost: 0.1, failure: null };
    },
  };
  return { ctx, calls };
}

const approve = { conclusion: "approve", findings: [] };
const must = { conclusion: "request_changes", findings: [{ id: "R1", status: "new", severity: "must_fix", location: "src/index.js:1", evidence: "-", criteria: [1], description: "-" }] };
const fixed = { conclusion: "approve", findings: [{ id: "R1", status: "resolved", severity: "must_fix", location: "src/index.js:1", evidence: "-", criteria: [1], description: "-" }] };

test("続きから進める: 基準コミットを取り込み、計画とテスト作成を飛ばして、ゲート → レビュー → 修正", async () => {
  const r0 = await makeResumeRepo();
  const fix = (w) => {
    put(w, "src/index.js", "export const x = 42; // 修正した\n");
    return { status: "done", reason_kind: "none", reason: "", summary: "" };
  };
  const { ctx, calls } = await makeResumeCtx(r0, { review: [must, fixed], fix });
  const r = await workFlow(ctx);
  assert.equal(r.stop, null);
  assert.deepEqual(calls.filter((c) => !c.startsWith("gate:")), ["review", "fix", "review"]);
  const anc = await r0.git(["merge-base", "--is-ancestor", r0.base, r.head], { allowFail: true });
  assert.equal(anc.code, 0, "基準コミットを取り込んでいる");
  const anc2 = await r0.git(["merge-base", "--is-ancestor", r0.prHead, r.head], { allowFail: true });
  assert.equal(anc2.code, 0, "PR のブランチの先頭の子孫");
  assert.ok(ctx.state.newTests.has("tests/new.test.js"), "前の実行が追加したテストも、この実行の新しいテストとして扱う");
  rmSync(r0.ws, { recursive: true, force: true });
});

test("続きから進めて Claude Code が何も変えなかったら、変更が無いとして止まる", async () => {
  const r0 = await makeResumeRepo();
  const { ctx } = await makeResumeCtx(r0, { review: approve });
  const r = await workFlow(ctx);
  assert.equal(r.stop?.reason, "no_change");
  assert.equal(r.stop.keepChanges, false);
  rmSync(r0.ws, { recursive: true, force: true });
});

test("競合したら、競合の解消の工程で解き、変更範囲が競合したファイルだけかを確かめる", async () => {
  const r0 = await makeResumeRepo({ mainChange: ["src/index.js", "export const x = 2;\n"] });
  const resolve = (w) => {
    put(w, "src/index.js", "export const x = 42;\n");
    return { status: "resolved", reason: "" };
  };
  const { ctx, calls } = await makeResumeCtx(r0, { resolve_conflicts: resolve, review: approve });
  const r = await workFlow(ctx);
  assert.equal(r.stop, null);
  assert.equal(calls[0], "resolve_conflicts");
  rmSync(r0.ws, { recursive: true, force: true });
});

test("競合の解消の工程がほかのファイルも変えたら、自動マージまで進めないとして止まる", async () => {
  const r0 = await makeResumeRepo({ mainChange: ["src/index.js", "export const x = 2;\n"] });
  const resolve = (w) => {
    put(w, "src/index.js", "export const x = 42;\n");
    put(w, "src/extra.js", "// ついでに追加した\n");
    return { status: "resolved", reason: "" };
  };
  const { ctx } = await makeResumeCtx(r0, { resolve_conflicts: resolve });
  const r = await workFlow(ctx);
  assert.equal(r.stop?.reason, "not_merged");
  rmSync(r0.ws, { recursive: true, force: true });
});

test("テストのファイルで競合したら、Claude Code に解かせずに止まる", async () => {
  const r0 = await makeResumeRepo({ mainChange: ["tests/new.test.js", "// main が追加した同じ名前のテスト\n"] });
  const { ctx, calls } = await makeResumeCtx(r0, {});
  const r = await workFlow(ctx);
  assert.equal(r.stop?.reason, "not_merged");
  assert.deepEqual(calls, []);
  rmSync(r0.ws, { recursive: true, force: true });
});

test("続きから進めてテスト作成に戻ったとき、失敗の確認は基準コミットにテストだけを追加したツリーで実行する", async () => {
  const r0 = await makeResumeRepo();
  const seen = [];
  const gate = (w, name) => {
    if (name === "失敗の確認") {
      seen.push(readFileSync(join(w, "src/index.js"), "utf8"));
      return { code: 1, tail: "" };
    }
    return { code: 0, tail: "" };
  };
  const wrong = { status: "cannot_proceed", reason_kind: "tests_wrong", reason: "-", summary: "" };
  const fixImpl = (w) => {
    put(w, "src/index.js", "export const x = 42; // 修正した\n");
    return { status: "done", reason_kind: "none", reason: "", summary: "" };
  };
  const rewrite = (w) => {
    put(w, "tests/new.test.js", "// 修正したテスト\n");
    return { status: "done", reason_kind: "none", reason: "", tests: [{ path: "tests/new.test.js", criteria: [1] }] };
  };
  const { ctx } = await makeResumeCtx(r0, { review: [must, fixed], fix: [wrong, fixImpl], write_tests: rewrite }, gate);
  const r = await workFlow(ctx);
  assert.equal(r.stop, null);
  assert.deepEqual(seen, ["export const x = 1;\n"], "実装の無い、基準コミットの src/index.js");
  rmSync(r0.ws, { recursive: true, force: true });
});
