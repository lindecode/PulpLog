import test from "node:test";
import assert from "node:assert/strict";
import { StringDecoder } from "node:string_decoder";
import { appendRecentItems, applyContext, classify, classifyLines, countLevels, filterLogs, findAdjacentLineIndex, findLineRange, splitTextChunk } from "../src/logProcessing.mjs";

test("classifies supported log levels and stack traces", () => {
  assert.equal(classify("2026 INFO ready"), "info");
  assert.equal(classify("WARN slow"), "warn");
  assert.equal(classify("java.lang.Error: failed"), "exception");
  assert.equal(classify("  at app.Main.run(Main.java:1)"), "stack");
  assert.equal(classify("Caused by: IOException"), "causedby");
});

test("preserves lines split across text chunks and a final partial line", () => {
  let carry = "";
  const lines = [];
  for (const chunk of ["first\nsec", "ond\nthird", " without newline"]) {
    const split = splitTextChunk(carry, chunk);
    carry = split.carry;
    lines.push(...split.lines);
  }
  if (carry) lines.push(carry);
  assert.deepEqual(lines, ["first", "second", "third without newline"]);
});

test("preserves UTF-8 characters split between byte chunks", () => {
  const expected = "línea 😀 final";
  const bytes = Buffer.from(expected, "utf8");
  const decoder = new StringDecoder("utf8");
  let actual = "";
  for (let i = 0; i < bytes.length; i += 3) actual += decoder.write(bytes.subarray(i, i + 3));
  actual += decoder.end();
  assert.equal(actual, expected);
});

test("keeps absolute line numbers when live history is trimmed", () => {
  const first = classifyLines(["INFO one", "WARN two"], 41);
  const second = classifyLines(["ERROR three", "plain four"], 43);
  const retained = appendRecentItems(first, second, 3);
  assert.deepEqual(retained.map(x => x.origLine), [42, 43, 44]);
  assert.deepEqual(countLevels(retained), { error:1, warn:1, info:0, debug:0 });
});

test("merges overlapping context ranges and marks separate gaps", () => {
  const items = classifyLines(["a", "ERROR b", "c", "d", "e", "ERROR f", "g"]);
  const result = applyContext(items, item => item.type === "error", 1);
  assert.deepEqual(result.filter(x => !x.separator).map(x => x.origLine), [1, 2, 3, 5, 6, 7]);
  assert.equal(result.find(x => x.separator)?.skipped, 1);
});

test("filtering preserves levels, context, and invalid-regex behavior", () => {
  const items = classifyLines(["INFO alpha", "plain", "ERROR beta", "WARN beta"]);
  const levels = { error:true, warn:false, info:true, debug:true, trace:true, stack:true, plain:true };
  const textResult = filterLogs(items, "beta", false, levels, 1);
  assert.deepEqual(textResult.filtered.filter(x => !x.separator).map(x => x.origLine), [2, 3, 4]);
  assert.equal(filterLogs(items, "[", true, levels, 0).regexValid, false);
});
test("navigates selectable log rows and skips context separators", () => {
  const items = [
    { origLine:10 },
    { separator:true, key:"gap" },
    { origLine:20 },
    { origLine:30 },
  ];
  assert.equal(findAdjacentLineIndex(items, null, 1), 0);
  assert.equal(findAdjacentLineIndex(items, null, -1), 3);
  assert.equal(findAdjacentLineIndex(items, 10, 1), 2);
  assert.equal(findAdjacentLineIndex(items, 20, -1), 0);
  assert.equal(findAdjacentLineIndex(items, 30, 1), -1);
});
test("builds shift-selection ranges in visible order and ignores separators", () => {
  const items = [
    { origLine:10 },
    { separator:true, key:"gap" },
    { origLine:20 },
    { origLine:30 },
  ];
  assert.deepEqual(findLineRange(items, 10, 30), [10, 20, 30]);
  assert.deepEqual(findLineRange(items, 30, 10), [10, 20, 30]);
  assert.deepEqual(findLineRange(items, 999, 20), [20]);
  assert.deepEqual(findLineRange(items, 10, 999), []);
});