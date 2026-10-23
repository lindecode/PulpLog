// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseInline } from "../src/markdown.mjs";

test("parses headings, paragraphs, rules and quotes", () => {
  const blocks = parseMarkdown("## Hallazgos\nLínea uno\nlínea dos\n\n---\n> cita **fuerte**");
  assert.deepEqual(blocks.map(block => block.type), ["heading", "paragraph", "hr", "blockquote"]);
  assert.equal(blocks[0].level, 2);
  assert.deepEqual(blocks[1].children.map(node => node.type), ["text", "br", "text"]);
  assert.equal(blocks[3].children[0].children[1].type, "strong");
});

test("parses nested, ordered and task lists", () => {
  const [list] = parseMarkdown("1. primero\n2. segundo\n   - anidado\n   - otro\n\n3. tercero");
  assert.equal(list.type, "list");
  assert.equal(list.ordered, true);
  assert.equal(list.items.length, 3);
  assert.equal(list.items[1].children[1].type, "list");
  assert.equal(list.items[1].children[1].items.length, 2);

  const [tasks] = parseMarkdown("- [x] hecho\n- [ ] pendiente");
  assert.deepEqual(tasks.items.map(item => item.checked), [true, false]);
  assert.equal(tasks.items[0].children[0].children[0].text, "hecho");
});

test("keeps fenced code verbatim, even while unclosed during streaming", () => {
  const [closed] = parseMarkdown("```bash\ngrep -E 'a|b' **x**\n```");
  assert.deepEqual(closed, { type:"code", lang:"bash", text:"grep -E 'a|b' **x**", closed:true });
  const [open] = parseMarkdown("texto\n```regex\n^ERROR");
  assert.equal(open.type, "paragraph");
  const blocks = parseMarkdown("```regex\n^ERROR");
  assert.deepEqual(blocks[0], { type:"code", lang:"regex", text:"^ERROR", closed:false });
});

test("parses GFM tables with alignment and escaped pipes", () => {
  const [table] = parseMarkdown("| Línea | Mensaje |\n|---:|:---|\n| 12 | `a|b` |\n| 13 | x \\| y |");
  assert.equal(table.type, "table");
  assert.deepEqual(table.align, ["right", "left"]);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0][1], [{ type:"code", text:"a|b" }]);
  assert.equal(table.rows[1][1][0].text, "x | y");
});

test("parses inline emphasis, code, links and leaves identifiers alone", () => {
  const nodes = parseInline("**bold** *it* `code` ~~del~~ [doc](https://example.com) snake_case_name http://host/x.");
  assert.deepEqual(nodes.filter(node => node.type !== "text").map(node => node.type),
    ["strong", "em", "code", "del", "link", "link"]);
  assert.ok(nodes.some(node => node.type === "text" && node.text.includes("snake_case_name")));
  assert.equal(nodes.at(-2).href, "http://host/x");
  assert.equal(parseInline("[x](javascript:alert(1))").some(node => node.type === "link"), false);
});
