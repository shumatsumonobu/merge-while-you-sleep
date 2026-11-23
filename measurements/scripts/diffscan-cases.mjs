// 無効化の書き方を、提出のジョブと同じ git diff の出力で照合する（手元で実行）
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
const { scanDiffText } = await import(pathToFileURL(process.env.DS_PATH).href);

const NUL = "\u0000";
// [名前, ファイル, 変更前, 変更後]
const CASES = [
  ["js stryker disable", "src/a.js", "export const a = 1;\n", "// Stryker disable next-line all\nexport const a = 1;\n"],
  ["js stryker restore を消す", "src/a.js", "// Stryker disable all\nexport const a = 1;\n// Stryker restore all\n", "// Stryker disable all\nexport const a = 1;\n"],
  ["js NUL でバイナリに見せる", "src/a.js", "export const a = 1;\n", `export const a = 1;${NUL}\n// Stryker disable all\n`],
  ["js c8 ignore stop を消す", "src/a.js", "/* c8 ignore start */\nconst x = 1;\n/* c8 ignore stop */\n", "/* c8 ignore start */\nconst x = 1;\n"],
  ["js @ts-check を消す", "src/a.js", "// @ts-check\nconst x = 1;\n", "const x = 1;\n"],
  ["js istanbul ignore", "src/a.js", "const x = 1;\n", "/* istanbul ignore next */\nconst x = 1;\n"],
  ["js eslint-disable-line", "src/a.js", "const x = 1;\n", "const x = 1; // eslint-disable-line\n"],
  ["js 空白を挟んだ eslint - disable", "src/a.js", "const x = 1;\n", "/* eslint\n   -disable */\nconst x = 1;\n"],
  ["rust 属性を2行に分ける", "src/lib.rs", "fn a() {}\n", "#[\nallow(dead_code)]\nfn a() {}\n"],
  ["rust cfg_attr で包む", "src/lib.rs", "fn a() {}\n", "#[cfg_attr(test, allow(dead_code))]\nfn a() {}\n"],
  ["rust mutants::skip", "src/lib.rs", "fn a() {}\n", "#[mutants::skip]\nfn a() {}\n"],
  ["rust #![deny( を消す", "src/lib.rs", "#![deny(warnings)]\nfn a() {}\n", "fn a() {}\n"],
  ["python pragma: no mutate", "src/a.py", "x = 1\n", "x = 1  # pragma: no mutate\n"],
  ["python noqa", "src/a.py", "x = 1\n", "x = 1  # noqa: E501\n"],
  ["python pragma: no cover", "src/a.py", "x = 1\n", "x = 1  # pragma: no cover\n"],
  ["go nolint", "src/a.go", "package a\n", "package a //nolint\n"],
  ["java @SuppressWarnings", "src/A.java", "class A {}\n", "@SuppressWarnings(\"all\")\nclass A {}\n"],
  ["java PIT @DoNotMutate", "src/A.java", "class A {}\n", "@DoNotMutate\nclass A {}\n"],
  ["csharp Stryker.NET", "src/A.cs", "class A {}\n", "// Stryker disable all\nclass A {}\n"],
  ["ruby rubocop:disable", "src/a.rb", "x = 1\n", "x = 1 # rubocop:disable all\n"],
  ["php @codeCoverageIgnore", "src/a.php", "<?php\n", "<?php\n/** @codeCoverageIgnore */\n"],
  ["php phpcs:ignore", "src/a.php", "<?php\n", "<?php // phpcs:ignore\n"],
  ["kotlin @Suppress", "src/A.kt", "class A\n", "@Suppress(\"UNUSED\")\nclass A\n"],
  ["swift swiftlint:disable", "src/A.swift", "let a = 1\n", "// swiftlint:disable all\nlet a = 1\n"],
  ["deno-lint-ignore", "src/a.ts", "const a = 1;\n", "// deno-lint-ignore no-explicit-any\nconst a = 1;\n"],
  ["biome-ignore", "src/a.ts", "const a = 1;\n", "// biome-ignore lint: x\nconst a = 1;\n"],
];

const git = (cwd, ...a) => execFileSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=p", "-c", "user.email=p@example.invalid", ...a], { cwd, encoding: "utf8" });
for (const [name, file, before, after] of CASES) {
  const d = mkdtempSync(join(tmpdir(), "ds-"));
  git(d, "init", "-q");
  mkdirSync(join(d, dirname(file)), { recursive: true });
  writeFileSync(join(d, file), before);
  git(d, "add", "-A"); git(d, "commit", "-qm", "b");
  const base = git(d, "rev-parse", "HEAD").trim();
  writeFileSync(join(d, file), after);
  git(d, "add", "-A"); git(d, "commit", "-qm", "h");
  const head = git(d, "rev-parse", "HEAD").trim();
  const text = git(d, "diff", "--text", "-U0", "--no-renames", "--no-ext-diff", "--no-textconv", base, head);
  const found = scanDiffText(text);
  console.log(`${found.length ? "拾えた  " : "拾えない"} | ${name} | ${found.join(" ; ")}`);
}
