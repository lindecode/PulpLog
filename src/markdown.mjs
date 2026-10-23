// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Minimal Markdown parser for LLM answers. Produces a plain AST that the
// renderer turns into React elements (never HTML strings), and tolerates
// partial input while a response is still streaming (e.g. an unclosed fence).

const FENCE_RE   = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE      = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE_RE   = /^ {0,3}>\s?(.*)$/;
const LIST_RE    = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const isBlank = line => !line.trim();
const indentOf = line => line.match(/^\s*/)[0].replace(/\t/g, "    ").length;

function splitTableRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === "\\" && row[i + 1] === "|") { current += "|"; i++; continue; }
    if (ch === "`") inCode = !inCode;
    if (ch === "|" && !inCode) { cells.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function isTableStart(lines, i) {
  return lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes("-");
}

function startsBlock(lines, i) {
  const line = lines[i];
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line)
    || LIST_RE.test(line) || isTableStart(lines, i);
}

export function parseMarkdown(text) {
  return parseBlocks(String(text ?? "").replace(/\r\n?/g, "\n").split("\n"));
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[1];
      const body = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim().startsWith(marker[0].repeat(marker.length)) && !lines[i].trim().slice(marker.length).trim()) {
          closed = true;
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ type:"code", lang:fence[2] || "", text:body.join("\n"), closed });
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({ type:"heading", level:heading[1].length, children:parseInline(heading[2]) });
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type:"hr" });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body = [];
      while (i < lines.length && !isBlank(lines[i]) && (QUOTE_RE.test(lines[i]) || !startsBlock(lines, i))) {
        const quoted = lines[i].match(QUOTE_RE);
        body.push(quoted ? quoted[1] : lines[i]);
        i++;
      }
      blocks.push({ type:"blockquote", children:parseBlocks(body) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitTableRow(line);
      const align = splitTableRow(lines[i + 1]).map(cell => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      i += 2;
      const rows = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ type:"table", header:header.map(parseInline), align, rows });
      continue;
    }

    const listMatch = line.match(LIST_RE);
    if (listMatch) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines, i))) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type:"paragraph", children:parseInline(para.join("\n")) });
  }
  return blocks;
}

function parseList(lines, start) {
  const first = lines[start].match(LIST_RE);
  const baseIndent = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const startNumber = ordered ? parseInt(first[2], 10) : null;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const match = lines[i].match(LIST_RE);
    if (!match || indentOf(match[1]) !== baseIndent || /\d/.test(match[2]) !== ordered) break;
    const contentIndent = baseIndent + match[2].length + 1;
    const body = [match[3]];
    i++;
    while (i < lines.length) {
      const current = lines[i];
      if (isBlank(current)) {
        // A blank line keeps the item open only if indented content follows.
        let j = i + 1;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) > baseIndent) {
          for (; i < j; i++) body.push("");
          continue;
        }
        break;
      }
      const sub = current.match(LIST_RE);
      if (sub && indentOf(sub[1]) <= baseIndent) break;
      if (!sub && indentOf(current) <= baseIndent && startsBlock(lines, i)) break;
      body.push(indentOf(current) >= contentIndent ? current.slice(Math.min(contentIndent, indentOf(current))) : current.trimStart());
      i++;
    }
    const children = parseBlocks(body);
    const task = children[0]?.type === "paragraph" ? extractTask(children[0]) : null;
    items.push({ children, checked:task });
    // Blank lines between sibling items do not end the list.
    let j = i;
    while (j < lines.length && isBlank(lines[j])) j++;
    const nextItem = j < lines.length ? lines[j].match(LIST_RE) : null;
    if (nextItem && indentOf(nextItem[1]) === baseIndent && /\d/.test(nextItem[2]) === ordered) i = j;
    else break;
  }
  return { block:{ type:"list", ordered, start:startNumber, items }, next:i };
}

function extractTask(paragraph) {
  const first = paragraph.children[0];
  if (first?.type !== "text") return null;
  const match = first.text.match(/^\[([ xX])\]\s+/);
  if (!match) return null;
  first.text = first.text.slice(match[0].length);
  return match[1] !== " ";
}

/* ── inline ── */
const INLINE_RE = new RegExp([
  "(`+)([\\s\\S]*?[^`])\\1(?!`)",                       // 1,2 code span
  "\\*\\*(?=\\S)([\\s\\S]*?\\S)\\*\\*",                   // 3 bold **
  "(?<![\\w])__(?=\\S)([\\s\\S]*?\\S)__(?![\\w])",        // 4 bold __
  "~~(?=\\S)([\\s\\S]*?\\S)~~",                           // 5 strike
  "\\*(?=[^\\s*])([\\s\\S]*?[^\\s*])\\*(?!\\*)",          // 6 italic *
  "(?<![\\w])_(?=[^\\s_])([\\s\\S]*?[^\\s_])_(?![\\w])",  // 7 italic _
  "\\[([^\\]\\n]+)\\]\\(\\s*(https?:\\/\\/[^\\s)]+)\\s*\\)", // 8,9 link
  "(https?:\\/\\/[^\\s<>()\\[\\]`]+[^\\s<>()\\[\\]`.,;:!?'\"])", // 10 autolink
  "(\\n)",                                                // 11 line break
].join("|"), "g");

export function parseInline(text) {
  const source = String(text ?? "");
  const out = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  const pushText = value => {
    if (!value) return;
    const prev = out[out.length - 1];
    if (prev?.type === "text") prev.text += value;
    else out.push({ type:"text", text:value });
  };
  for (const match of source.matchAll(INLINE_RE)) {
    pushText(unescape(source.slice(last, match.index)));
    last = match.index + match[0].length;
    if (match[1] != null) out.push({ type:"code", text:match[2].replace(/^ (.*) $/, "$1") });
    else if (match[3] != null) out.push({ type:"strong", children:parseInline(match[3]) });
    else if (match[4] != null) out.push({ type:"strong", children:parseInline(match[4]) });
    else if (match[5] != null) out.push({ type:"del", children:parseInline(match[5]) });
    else if (match[6] != null) out.push({ type:"em", children:parseInline(match[6]) });
    else if (match[7] != null) out.push({ type:"em", children:parseInline(match[7]) });
    else if (match[8] != null) out.push({ type:"link", href:match[9], children:parseInline(match[8]) });
    else if (match[10] != null) out.push({ type:"link", href:match[10], children:[{ type:"text", text:match[10] }] });
    else if (match[11] != null) out.push({ type:"br" });
  }
  pushText(unescape(source.slice(last)));
  return out;
}

function unescape(text) {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, "$1");
}
