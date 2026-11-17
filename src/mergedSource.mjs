// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Merged view: reads several local log files, interleaves their lines by
// timestamp, prefixes each line with "[label] ", then keeps tailing all of them
// (live lines are appended in arrival order). Lines without a timestamp
// (stack traces, continuations) inherit the previous line's timestamp so they
// stay glued to their parent entry.
import { parseTimestampFromText } from "./logProcessing.mjs";

const EMIT_CHUNK = 20_000;

/* Pure: [{ label, lines:[string] }] → merged string[] ordered by time.
   Within one file the original order is preserved (stable sort). */
export function mergeByTimestamp(sources, maxLines = Infinity) {
  const rows = [];
  sources.forEach((source, sourceIndex) => {
    let lastTs = null;
    const firstTs = source.lines.map(line => parseTimestampFromText(line)).find(ts => ts != null) ?? null;
    source.lines.forEach((line, lineIndex) => {
      const ts = parseTimestampFromText(line);
      if (ts != null) lastTs = ts;
      rows.push({ ts: lastTs ?? firstTs ?? -Infinity, sourceIndex, lineIndex, text: `[${source.label}] ${line}` });
    });
  });
  rows.sort((a, b) => (a.ts - b.ts) || (a.sourceIndex - b.sourceIndex) || (a.lineIndex - b.lineIndex));
  const merged = rows.map(row => row.text);
  return merged.length > maxLines ? merged.slice(merged.length - maxLines) : merged;
}

const splitLines = text => {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/* Stream-like source with the same handler shape as streamDockerLogs. */
export function createMergedStream(files, { onSpawned, onLines, onEnd, onError }, { maxLines = Infinity } = {}) {
  let disposed = false;
  const cleanups = [];
  const results = files.map(() => null);
  let pending = files.length;
  const failures = [];

  const emit = (lines) => {
    for (let i = 0; i < lines.length && !disposed; i += EMIT_CHUNK) {
      onLines?.(lines.slice(i, i + EMIT_CHUNK).join("\n"));
    }
  };

  const startTail = (file, offset) => {
    if (/\.gz$/i.test(file.filePath)) return;
    let carry = "";
    const stop = window.electronAPI.watchFile(file.filePath, {
      startOffset: offset,
      onNewLines(text) {
        if (disposed) return;
        const lines = (carry + text).split(/\r?\n/);
        carry = lines.pop() ?? "";
        if (lines.length) emit(lines.map(line => `[${file.label}] ${line}`));
      },
    });
    cleanups.push(stop);
  };

  const finishOne = () => {
    pending -= 1;
    if (pending > 0 || disposed) return;
    const sources = files.map((file, index) => ({ label: file.label, lines: results[index]?.lines || [] }));
    emit(mergeByTimestamp(sources, maxLines));
    if (failures.length) onError?.(failures.join("\n"));
    files.forEach((file, index) => { if (results[index]) startTail(file, results[index].bytes); });
    if (!files.some((_, index) => results[index])) onEnd?.();
  };

  if (!files.length) { queueMicrotask(() => onEnd?.()); return () => {}; }
  queueMicrotask(() => { if (!disposed) onSpawned?.(); });

  files.forEach((file, index) => {
    const chunks = [];
    const cancel = window.electronAPI.readFile(file.filePath, {
      onChunk(chunk) { chunks.push(chunk); },
      onDone(bytes) {
        if (disposed) return;
        results[index] = { lines: splitLines(chunks.join("")), bytes };
        finishOne();
      },
      onError(message) {
        if (disposed) return;
        failures.push(`${file.label}: ${message}`);
        finishOne();
      },
    });
    cleanups.push(cancel);
  });

  return () => {
    disposed = true;
    cleanups.forEach(fn => { try { fn?.(); } catch { /* already closed */ } });
  };
}

/* Pure: open tabs → files for a merged tab. Local file tabs contribute their
   path; merged tabs contribute all of theirs. Duplicate paths are dropped and
   repeated labels get a " (2)", " (3)"… suffix so every line stays traceable. */
export const isCombinableTab = tab =>
  !!(tab && (tab.merged?.files?.length || (tab.filePath && tab.filePath !== "__web__" && !tab.docker && !tab.remote)));

export function combineTabFiles(tabs) {
  const seen = new Set();
  const labelCount = new Map();
  const files = [];
  const add = (filePath, rawLabel) => {
    if (!filePath || seen.has(filePath)) return;
    seen.add(filePath);
    const base = rawLabel || filePath.split(/[\/]/).pop();
    const n = (labelCount.get(base) || 0) + 1;
    labelCount.set(base, n);
    files.push({ filePath, label: n === 1 ? base : `${base} (${n})` });
  };
  tabs.filter(isCombinableTab).forEach(tab => {
    if (tab.merged) tab.merged.files.forEach(f => add(f.filePath, f.label));
    else add(tab.filePath, tab.filePath.split(/[\/]/).pop());
  });
  return files;
}
