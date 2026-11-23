// actions/preflight/preflight.mjs のテスト（node --test）
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";
import { formField, formLines, unzipEntry } from "../actions/preflight/preflight.mjs";

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data, deflate] of entries) {
    const n = Buffer.from(name);
    const body = deflate ? deflateRawSync(data) : data;
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(deflate ? 8 : 0, 8);
    l.writeUInt32LE(body.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(l, n, body);
    centrals.push(c, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(entries.length, 8);
  e.writeUInt16LE(entries.length, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}

test("artifact の zip から1つのファイルを取り出す", () => {
  const z = zip([["other.txt", Buffer.from("x"), false], ["draft.json", Buffer.from('{"comment_id":1}'), true]]);
  assert.equal(unzipEntry(z, "draft.json").toString(), '{"comment_id":1}');
  assert.equal(unzipEntry(z, "other.txt").toString(), "x");
  assert.equal(unzipEntry(z, "none"), null);
});

test("Issue forms の本文から欄を切り出し、1行1項目に分ける", () => {
  const body = "### やりたいこと\n\nx を修正する\n\n### 完了条件\n\n- x が 42 を返す\n2. y が 0 を返す\n\n### 今回やらないこと\n\n_No response_\n";
  assert.deepEqual(formLines(formField(body, "完了条件")), ["x が 42 を返す", "y が 0 を返す"]);
  assert.equal(formField(body, "今回やらないこと"), null);
  assert.equal(formField("本文だけ", "完了条件"), null);
});
