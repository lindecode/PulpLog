// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
const { StringDecoder } = require("string_decoder");
const MAX_LINE_CHARS = 256 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_AI_BYTES = 4 * 1024 * 1024;

/* A line longer than the limit becomes several limit-sized rows: memory stays bounded and the read goes on. */
function chunkLong(line, limit) {
  if (line.length <= limit) return [line];
  const out = [];
  for (let i = 0; i < line.length; i += limit) out.push(line.slice(i, i + limit));
  return out;
}

function splitLines(carry, text, limit = MAX_LINE_CHARS) {
  const parts = (carry + text).split("\n");
  const tail = chunkLong(parts.pop() || "", limit);
  const lines = parts.flatMap(line => chunkLong(line, limit));
  lines.push(...tail.slice(0, -1)); // an open line keeps only its last partial chunk as carry
  return { lines, carry:tail.at(-1) || "" };
}

/* encoding: "utf-8" (default) or any WHATWG label such as "windows-1252" for Latin-1 logs.
   onSplit({ line, row, chars, rows }) is called once per line cut into several rows:
   1-based original line number, 1-based first row, its total length and how many rows it became. */
function createLineDecoder(encoding = "utf-8", { onSplit } = {}) {
  const utf8 = !encoding || /^utf-?8$/i.test(encoding);
  const decoder = utf8 ? new StringDecoder("utf8") : (() => {
    const text = new TextDecoder(encoding);
    return { write: chunk => text.decode(chunk, { stream:true }), end: () => text.decode() };
  })();
  let carry = "";
  let lineNo = 0, rowNo = 0;               // completed original lines / emitted rows
  let openRows = 0, openChars = 0, openStart = 0; // rows already emitted for the line still open

  const take = text => {
    const rows = chunkLong(text, MAX_LINE_CHARS);
    if (!openRows) openStart = rowNo;
    return rows;
  };
  const close = rows => {
    const total = openRows + rows.length;
    if (total > 1 && onSplit) {
      const chars = openChars + rows.reduce((sum, row) => sum + row.length, 0);
      try { onSplit({ line:lineNo + 1, row:openStart + 1, chars, rows:total }); } catch {}
    }
    rowNo += rows.length; lineNo++;
    openRows = 0; openChars = 0;
  };
  return {
    write(chunk) {
      const parts = (carry + decoder.write(chunk)).split("\n");
      const last = parts.pop() || "";
      const lines = [];
      for (const part of parts) { const rows = take(part); lines.push(...rows); close(rows); }
      const rows = take(last);
      const done = rows.slice(0, -1); // an open line keeps only its last partial chunk as carry
      lines.push(...done);
      rowNo += done.length; openRows += done.length; openChars += done.reduce((sum, row) => sum + row.length, 0);
      carry = rows.at(-1) || "";
      return lines;
    },
    end() {
      const text = carry + decoder.end();
      carry = "";
      if (!text) return "";
      const rows = take(text);
      close(rows);
      return rows.join("\n");
    },
  };
}

module.exports = { createLineDecoder, splitLines, MAX_LINE_CHARS, MAX_FILE_BYTES, MAX_AI_BYTES };
