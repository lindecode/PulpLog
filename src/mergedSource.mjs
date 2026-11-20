// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Merged view: reads several local log files, interleaves their lines by
// timestamp, prefixes each line with "[label] ", then keeps tailing all of them
// (live lines are appended in arrival order). Lines without a timestamp
// (stack traces, continuations) inherit the previous line's timestamp so they
// stay glued to their parent entry.
import { lineInstant } from "./logTime.mjs";

const EMIT_CHUNK = 20_000;

/* Pure: [{ label, lines:[string], timeZone? }] → merged string[] ordered by time.
   timeZone (IANA) says in which zone the log writes its times; without it, local time.
   Within one file the original order is preserved (stable sort). */
export function mergeByTimestamp(sources, maxLines = Infinity) {
  const rows = [];
  sources.forEach((source, sourceIndex) => {
    let lastTs = null;
    const firstTs = source.lines.map(line => lineInstant(line, source.timeZone)).find(ts => ts != null) ?? null;
    source.lines.forEach((line, lineIndex) => {
      const ts = lineInstant(line, source.timeZone);
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

/* Stream-like source with the same handler shape as streamDockerLogs.
   entries: [{ filePath, label }] for local files, or [{ stream:{ kind, payload }, label }]
   for containers / remote logs: those are first captured by the main process
   into private temp files (captures.cjs) and then read like any other file. */
export function createMergedStream(entries, { onSpawned, onLines, onEnd, onError }, { maxLines = Infinity } = {}) {
  let disposed = false;
  const cleanups = [];
  const failures = [];

  const emit = (lines) => {
    for (let i = 0; i < lines.length && !disposed; i += EMIT_CHUNK) {
      onLines?.(lines.slice(i, i + EMIT_CHUNK).join("\n"));
    }
  };

  if (!entries.length) { queueMicrotask(() => onEnd?.()); return () => {}; }
  queueMicrotask(() => { if (!disposed) onSpawned?.(); });

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
      // a capture that hit its size cap is emptied and refilled: start over without a partial line
      onTruncated() { carry = ""; },
    });
    cleanups.push(stop);
  };

  const captureFile = async (entry) => {
    const captureId = `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    cleanups.push(() => window.electronAPI.stopCapture(captureId));
    try {
      const { filePath, error } = await window.electronAPI.startCapture(captureId, entry.stream.kind, entry.stream.payload);
      if (error) failures.push(`${entry.label}: ${error}`);
      return { filePath, label: entry.label, timeZone: entry.stream.payload?.timeZone || "" };
    } catch (err) {
      failures.push(`${entry.label}: ${err?.message || err}`);
      return null;
    }
  };

  const readOne = file => new Promise(resolve => {
    const chunks = [];
    const cancel = window.electronAPI.readFile(file.filePath, {
      onChunk(chunk) { chunks.push(chunk); },
      onDone(bytes) { resolve({ lines: splitLines(chunks.join("")), bytes }); },
      onError(message) { failures.push(`${file.label}: ${message}`); resolve(null); },
    });
    cleanups.push(cancel);
  });

  (async () => {
    const files = (await Promise.all(entries.map(entry => entry.stream ? captureFile(entry) : entry))).filter(Boolean);
    if (disposed) return;
    const results = await Promise.all(files.map(readOne));
    if (disposed) return;
    const sources = files.map((file, index) => ({ label: file.label, lines: results[index]?.lines || [], timeZone: file.timeZone || "" }));
    emit(mergeByTimestamp(sources, maxLines));
    if (failures.length) onError?.(failures.join("\n"));
    files.forEach((file, index) => { if (results[index]) startTail(file, results[index].bytes); });
    if (!results.some(Boolean)) onEnd?.();
  })();

  return () => {
    disposed = true;
    cleanups.forEach(fn => { try { fn?.(); } catch { /* already closed */ } });
  };
}

const baseName = filePath => String(filePath).split(/[\\/]/).pop();
const isLocalFileTab = tab => !!(tab.filePath && tab.filePath !== "__web__" && !tab.docker && !tab.remote);

/* Pure: open tabs → entries for a merged tab. Local files contribute their
   path, containers and remote logs a stream spec, merged tabs all of theirs.
   Duplicates are dropped and repeated labels get a " (2)", " (3)"… suffix so
   every line stays traceable. */
export const isCombinableTab = tab =>
  !!(tab && (tab.merged?.files?.length || isLocalFileTab(tab) || tab.docker || tab.remote));

export function entryIdentity(entry) {
  return entry.stream ? `stream:${JSON.stringify(entry.stream)}` : `file:${entry.filePath}`;
}

export function combineTabFiles(tabs, { containerSource = docker => ({ source: docker }) } = {}) {
  const seen = new Set();
  const labelCount = new Map();
  const entries = [];
  const add = (entry, rawLabel) => {
    const identity = entryIdentity(entry);
    if (seen.has(identity)) return;
    seen.add(identity);
    const base = rawLabel || (entry.filePath ? baseName(entry.filePath) : "log");
    const n = (labelCount.get(base) || 0) + 1;
    labelCount.set(base, n);
    entries.push({ ...entry, label: n === 1 ? base : `${base} (${n})` });
  };
  tabs.filter(isCombinableTab).forEach(tab => {
    if (tab.merged) tab.merged.files.forEach(({ label, ...entry }) => add(entry, label));
    else if (tab.docker) add({ stream: { kind: "docker", payload: containerSource(tab.docker) } }, tab.label);
    else if (tab.remote) add({ stream: { kind: "remote", payload: { ...tab.remote } } }, tab.label);
    else add({ filePath: tab.filePath }, baseName(tab.filePath));
  });
  return entries;
}
