// actions/submit/submit.mjs のテスト（node --test）
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { readMarker } from "../lib/escalation.mjs";
import { makeGit } from "../lib/git.mjs";
import { DEFAULT_TEST_PATHS } from "../lib/paths.mjs";
import { exec } from "../lib/process.mjs";
import { checkAllowlist, checkProtectedFiles, failedRequiredNames, importsAtRev, prBody, requiredState } from "../actions/submit/submit.mjs";

const put = (ws, p, s) => {
  mkdirSync(dirname(join(ws, p)), { recursive: true });
  writeFileSync(join(ws, p), s);
};

async function repoWith(change, { addAll = true } = {}) {
  const ws = mkdtempSync(join(tmpdir(), "merge-while-you-sleep-submit-"));
  const git = makeGit(ws);
  put(ws, "src/index.js", "export const x = 1;\n");
  put(ws, "tests/index.test.js", "// 既存のテスト\n");
  put(ws, "CLAUDE.md", "@docs/rules.md\n");
  put(ws, "docs/rules.md", "決まり\n");
  put(ws, "package.json", "{}\n");
  await git(["init", "-q"]);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "base"]);
  const base = (await git(["rev-parse", "HEAD"])).out.trim();
  await change(ws, git);
  if (addAll) await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "change", "--allow-empty"]);
  const head = (await git(["rev-parse", "HEAD"])).out.trim();
  return { ws, git, base, head };
}

const check = async (r) =>
  checkAllowlist(r.git, {
    base: r.base, head: r.head, allowPaths: ["src/**", "tests/**"], denyPaths: [], testPatterns: DEFAULT_TEST_PATHS,
    imports: await importsAtRev(r.git, r.base),
  });

test("範囲の中の変更と、範囲の中に新しく追加したテストは、自動マージの範囲に入る", async () => {
  const r = await repoWith((ws) => {
    put(ws, "src/index.js", "export const x = 42;\n");
    put(ws, "tests/new.test.js", "// new\n");
  });
  assert.deepEqual(await check(r), []);
  rmSync(r.ws, { recursive: true, force: true });
});

test("範囲の外にするもの", async () => {
  const cases = [
    ["既存のテスト", (ws) => put(ws, "tests/index.test.js", "expect(true).toBe(true)\n"), /既存のテスト/],
    ["依存の定義", (ws) => put(ws, "package.json", '{"dependencies":{"x":"1"}}\n'), /固定の除外/],
    ["範囲の外の新しいテスト", (ws) => put(ws, "public/fixtures/x.json", "{}\n"), /MERGE_WHILE_YOU_SLEEP_ALLOW_PATHS の外/],
    ["範囲の外のファイル", (ws) => put(ws, "deploy.sh", "echo\n"), /MERGE_WHILE_YOU_SLEEP_ALLOW_PATHS の外/],
    ["下の階層の設定", (ws) => put(ws, "src/tsconfig.json", "{}\n"), /固定の除外/],
    ["取り込み先", (ws) => put(ws, "docs/rules.md", "緩めた\n"), /固定の除外/],
    ["無効化のコメント", (ws) => put(ws, "src/index.js", "// Stryker disable all\nexport const x = 42;\n"), /stryker/],
    ["バイナリに見せたソース", (ws) => put(ws, "src/index.js", "export const x = 42;\0\n"), /バイナリ/],
    ["外の画像", (ws) => put(ws, "src/README.md", "![a](https://e.example/x.png)\n"), /外の画像/],
  ];
  for (const [name, change, pattern] of cases) {
    const r = await repoWith(change);
    const reasons = await check(r);
    assert.ok(reasons.some((x) => pattern.test(x)), `${name}: ${JSON.stringify(reasons)}`);
    rmSync(r.ws, { recursive: true, force: true });
  }
});

test("シンボリックリンクと gitlink は、パスによらず範囲の外", async () => {
  const r = await repoWith(async (ws, git) => {
    const blob = (await exec("git", ["hash-object", "-w", "--stdin"], { cwd: ws, env: { PATH: process.env.PATH }, input: "../.github/workflows/ci.yml" })).out.trim();
    await git(["update-index", "--add", "--cacheinfo", `120000,${blob},src/link.js`]);
    const base = (await git(["rev-parse", "HEAD"])).out.trim();
    await git(["update-index", "--add", "--cacheinfo", `160000,${base},src/sub`]);
  }, { addAll: false });
  const reasons = await check(r);
  assert.ok(reasons.some((x) => x.startsWith("src/link.js") && /シンボリックリンク/.test(x)), JSON.stringify(reasons));
  assert.ok(reasons.some((x) => x.startsWith("src/sub") && /gitlink/.test(x)), JSON.stringify(reasons));
  rmSync(r.ws, { recursive: true, force: true });
});

test("変更禁止ファイル: 最初からなら変わったら止める。続きからなら、前の PR の先頭と同じなら通す", async () => {
  const r = await repoWith((ws) => put(ws, "CLAUDE.md", "書き換えた\n"));
  const imports = await importsAtRev(r.git, r.base);
  assert.deepEqual(await checkProtectedFiles(r.git, { base: r.base, head: r.head, prevHead: null, imports }), ["CLAUDE.md"]);
  assert.deepEqual(await checkProtectedFiles(r.git, { base: r.base, head: r.head, prevHead: r.head, imports }), []);
  assert.deepEqual(await checkProtectedFiles(r.git, { base: r.base, head: r.head, prevHead: r.base, imports }), ["CLAUDE.md"]);
  rmSync(r.ws, { recursive: true, force: true });
});

/** 格納と deflate の zip を作る（テスト用） */

test("PR の本文: Claude Code が書いた部分は消毒し、Issue を閉じるのは決まった1行だけ", () => {
  process.env.GITHUB_RUN_ID = "5";
  const body = prBody({
    approval: { issue: 3, hash: "h", criteria: ["x が 42 を返す", "@carol fixes #7"] },
    report: { resume: false, stages: ["plan"], cost_usd: 1.234, tests: [{ path: "tests/a.test.js", criteria: [1] }], suggestions: [{ location: "a", description: "@bob closes #9 ![x](https://e/x.png)" }], notes: [], findings: [{ id: "R1" }], escalation: null },
    automerge: true, outsideReasons: [], secrets: [],
  });
  assert.ok(!body.includes("@bob"));
  assert.ok(!body.includes("@carol"));
  assert.ok(!/fixes #7/i.test(body));
  assert.ok(!/closes #9/i.test(body));
  assert.ok(!body.includes("!["));
  assert.equal((body.match(/Closes #3/g) || []).length, 1);
  const m = readMarker(body);
  assert.equal(m.approval_hash, "h");
  assert.deepEqual(m.findings, [{ id: "R1" }]);
});

test("提出のジョブ: .claude をシンボリックリンクにした変更を、変更禁止ファイルの変化として拾う", async () => {
  const ws = mkdtempSync(join(tmpdir(), "merge-while-you-sleep-prot2-"));
  const git = makeGit(ws);
  put(ws, "src/a.js", "x\n");
  await git(["init", "-q"]);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "base"]);
  const base = (await git(["rev-parse", "HEAD"])).out.trim();
  const blob = (await exec("git", ["hash-object", "-w", "--stdin"], { cwd: ws, env: { PATH: process.env.PATH }, input: "src" })).out.trim();
  await git(["update-index", "--add", "--cacheinfo", `120000,${blob},.claude`]);
  await git(["commit", "-q", "-m", "link"]);
  const head = (await git(["rev-parse", "HEAD"])).out.trim();
  assert.deepEqual(await checkProtectedFiles(git, { base, head, prevHead: null, imports: new Set() }), [".claude"]);
  rmSync(ws, { recursive: true, force: true });
});

test("必須のステータスチェックだけで、通過した、失敗した、待っている、を決める", () => {
  const run = (conclusion, isRequired, status = "COMPLETED") => ({ __typename: "CheckRun", status, conclusion, isRequired });
  const st = (state, isRequired) => ({ __typename: "StatusContext", state, isRequired });
  assert.equal(requiredState([]), "PENDING");
  assert.equal(requiredState([run("FAILURE", false), run("SUCCESS", true)]), "SUCCESS");
  assert.equal(requiredState([run("SUCCESS", true), st("ERROR", true)]), "FAILURE");
  assert.equal(requiredState([run(null, true, "IN_PROGRESS"), run("SUCCESS", true)]), "PENDING");
  assert.equal(requiredState([run("SKIPPED", true), st("SUCCESS", true)]), "SUCCESS");
});

test("失敗した必須のステータスチェックの名前だけを返す", () => {
  const nodes = [
    { __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "FAILURE", isRequired: true },
    { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE", isRequired: false },
    { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", isRequired: true },
    { __typename: "StatusContext", context: "deploy/preview", state: "ERROR", isRequired: true },
  ];
  assert.deepEqual(failedRequiredNames(nodes), ["ci", "deploy/preview"]);
});
