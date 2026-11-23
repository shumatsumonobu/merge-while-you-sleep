// リポジトリの中の Markdown の相対リンクと見出しへのリンク（#...）が切れていないかを調べる
//   node tools/check-links.mjs   （リポジトリのルートで実行）
//
// 切れたリンクを1行ずつ出力し、1本でもあれば exit 1。外部の URL は調べない
// 見出しのアンカーは GitHub と同じ規則で作る: 小文字にし、記号を除き、空白を - にし、同じ見出しの2つ目からは -1、-2 を付ける
import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const SKIP_FILES = new Set(["WIP.md"]); // gitignore の対象で公開しない

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".md") && !SKIP_FILES.has(name)) out.push(p);
  }
  return out;
}

function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function anchorsOf(text) {
  const anchors = new Set();
  const seen = {};
  let inCode = false;
  for (const line of text.split("\n")) {
    if (/^```/.test(line)) inCode = !inCode;
    if (inCode) continue;
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (!m) continue;
    let s = slug(m[1]);
    if (seen[s] !== undefined) s = `${s}-${++seen[s]}`;
    else seen[s] = 0;
    anchors.add(s);
  }
  return anchors;
}

const files = walk(".", []);
const anchors = new Map(files.map((f) => [path.resolve(f), anchorsOf(fs.readFileSync(f, "utf8"))]));

let links = 0;
let broken = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const [, url, anchor] of text.matchAll(/\]\(([^)\s#]*)(?:#([^)\s]+))?\)/g)) {
    if (/^[a-z]+:/.test(url)) continue;
    links++;
    const target = url ? path.resolve(path.dirname(file), decodeURIComponent(url)) : path.resolve(file);
    if (!fs.existsSync(target)) {
      broken++;
      console.log(`ファイルが無い: ${file} → ${url}`);
      continue;
    }
    const set = anchors.get(target);
    if (anchor && set && !set.has(decodeURIComponent(anchor).toLowerCase())) {
      broken++;
      console.log(`見出しが無い: ${file} → ${url}#${anchor}`);
    }
  }
}
console.log(`リンク ${links} 本、切れているもの ${broken} 本`);
process.exit(broken ? 1 : 0);
