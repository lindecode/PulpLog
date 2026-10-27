// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
const { StringDecoder } = require("string_decoder");
const MAX_LINE_CHARS = 256 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_AI_BYTES = 4 * 1024 * 1024;

function splitLines(carry, text, limit = MAX_LINE_CHARS) {
  const parts = (carry + text).split("\n");
  if (parts.some(line => line.length > limit)) throw new Error("Log line exceeds the 256K character limit");
  return { lines:parts.slice(0, -1), carry:parts.at(-1) || "" };
}

function createLineDecoder() {
  const decoder = new StringDecoder("utf8");
  let carry = "";
  return {
    write(chunk) { const result = splitLines(carry, decoder.write(chunk)); carry = result.carry; return result.lines; },
    end() { const text = carry + decoder.end(); carry = ""; if (text.length > MAX_LINE_CHARS) throw new Error("Log line exceeds the 256K character limit"); return text; },
  };
}

module.exports = { createLineDecoder, splitLines, MAX_LINE_CHARS, MAX_FILE_BYTES, MAX_AI_BYTES };
