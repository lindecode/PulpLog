// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Prompt budgeting for the local-AI chat. Pure functions so they can be tested
// without React or Ollama.

export const DEFAULT_CONTEXT_TOKENS = 16384;
export const ANSWER_RESERVE_TOKENS = 2048;
export const HISTORY_SHARE = 0.25;
export const RECENT_HISTORY_SHARE = 0.18;
export const MEMORY_SHARE = HISTORY_SHARE - RECENT_HISTORY_SHARE;
export const MAX_LINE_CHARS = 2000;
// Logs are token-dense (numbers, punctuation, hex); ~3.2 chars per token is a safe estimate.
export const CHARS_PER_TOKEN = 3.2;

export const estimateTokens = text => Math.ceil(String(text || "").length / CHARS_PER_TOKEN);

export function effectiveContextTokens(settingTokens, modelContextLength) {
  const wanted = Number(settingTokens) > 0 ? Number(settingTokens) : DEFAULT_CONTEXT_TOKENS;
  const limit = Number(modelContextLength) >= 2048 ? Number(modelContextLength) : Infinity;
  return Math.min(wanted, limit);
}

export function formatLogLine(item) {
  const raw = String(item.raw ?? "");
  const text = raw.length > MAX_LINE_CHARS ? `${raw.slice(0, MAX_LINE_CHARS)} …[+${raw.length - MAX_LINE_CHARS}]` : raw;
  return `${item.origLine}\t${text}`;
}

// The log block is untrusted input: neutralise anything that could close the wrapper tag.
export const escapeLogBlock = text => String(text).replace(/<(\/?log_(?:data|summary))/gi, "‹$1");

// Keeps the most recent rows that fit in the budget: in logs, the latest events usually matter most.
export function selectTailRows(rows, charBudget) {
  const picked = [];
  let used = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const line = formatLogLine(rows[i]);
    if (used + line.length + 1 > charBudget) break;
    used += line.length + 1;
    picked.push(line);
  }
  picked.reverse();
  return { lines: picked, included: picked.length, truncated: picked.length < rows.length };
}

/* ─── Smart context ───────────────────────────────────────────────────────
   Instead of only the tail, the model gets:
     1. a summary of the WHOLE scope (levels, time range, most repeated messages),
     2. lines matching what the question mentions (ids, IPs, times, rare words),
     3. errors/warnings with a little surrounding context (repeats collapsed),
     4. the most recent lines with whatever budget is left.
   Unused budget of one bucket flows to the next. Output keeps log order and
   marks the gaps, so the model knows lines were omitted. */

export const MATCH_SHARE = 0.35;
export const ISSUE_SHARE = 0.30;
const MAX_TERMS = 8;
const COMMON_TERM_RATIO = 0.2;
const STOPWORDS = new Set((
  "error errores errors warning warnings advertencia advertencias problema problemas porque cuando donde "
  + "cuantas cuantos cuántas cuántos cuándo dónde líneas lineas linea línea bitácora bitacora bitácoras logs "
  + "registro registros mensaje mensajes primero primera último ultima última después antes durante "
  + "explain explica explicame explícame resumen resume summary summarize happened happen what which "
  + "where there their about before after first last should could would during message messages lines "
  + "analiza analizar analyze muestra mostrar tienen sobre entre desde hasta ocurrió ocurre fallos falla fallo"
).split(" "));

const DATE_TIME_RE = /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;
const TIME_RE = /\b\d{2}:\d{2}(?::\d{2})?\b/;

/* Normalises variable parts so repeated messages share one template. */
export function messageTemplate(raw) {
  return String(raw || "")
    .replace(DATE_TIME_RE, "")
    .replace(TIME_RE, "")
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{4,}\b/gi, "#")   // hex ids/hashes with at least one digit
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/* Terms worth searching for in the log: quoted text, anything with digits
   (ids, IPs, times, codes) and longer words that are not filler. */
export function questionTerms(question) {
  const text = String(question || "");
  const terms = [];
  const add = term => {
    const value = term.trim().toLowerCase();
    if (value.length >= 3 && !terms.includes(value)) terms.push(value);
  };
  for (const match of text.matchAll(/["“«'`]([^"”»'`]{3,80})["”»'`]/g)) add(match[1]);
  for (const match of text.matchAll(/[\p{L}\p{N}_.:\/@-]+/gu)) {
    const token = match[0].replace(/^[.:\/@-]+|[.:\/@-]+$/g, "");
    if (/\d/.test(token) && token.length >= 3) add(token);
    else if (token.length >= 6 && !STOPWORDS.has(token.toLowerCase())) add(token);
  }
  return terms.slice(0, MAX_TERMS);
}

/* Reorders a list so any prefix is spread evenly (first, last, middle, quarters…). */
export function evenOrder(list) {
  const n = list.length;
  if (n <= 2) return list.slice();
  const out = [];
  const seen = new Set();
  const push = i => { if (!seen.has(i)) { seen.add(i); out.push(list[i]); } };
  push(0); push(n - 1);
  for (let parts = 2; out.length < n && parts <= n * 2; parts *= 2) {
    for (let j = 1; j < parts; j += 2) push(Math.round((j / parts) * (n - 1)));
  }
  for (let i = 0; i < n; i++) push(i);
  return out;
}

function edgeTimestamp(rows, fromEnd = false) {
  const limit = Math.min(rows.length, 500);
  for (let k = 0; k < limit; k++) {
    const raw = String(rows[fromEnd ? rows.length - 1 - k : k].raw || "");
    const match = raw.match(DATE_TIME_RE) || raw.match(TIME_RE);
    if (match) return match[0];
  }
  return null;
}

export function summarizeRows(rows, topN = 5) {
  const levels = { error:0, warn:0, info:0, debug:0, other:0 };
  const templates = new Map();
  let total = 0;
  for (const row of rows) {
    if (row.separator) continue;
    total++;
    const type = row.type;
    if (type === "error" || type === "exception") levels.error++;
    else if (type === "warn") levels.warn++;
    else if (type === "info") levels.info++;
    else if (type === "debug" || type === "trace") levels.debug++;
    else levels.other++;
    if (type === "stack" || type === "causedby") continue;
    const key = messageTemplate(row.raw);
    if (!key) continue;
    const entry = templates.get(key);
    if (entry) entry.count++;
    else templates.set(key, { count:1, sample:row });
  }
  const top = [...templates.values()].filter(entry => entry.count > 1)
    .sort((a, b) => b.count - a.count).slice(0, topN);
  return {
    total,
    firstLine: rows[0]?.origLine ?? null,
    lastLine: rows[rows.length - 1]?.origLine ?? null,
    from: edgeTimestamp(rows),
    to: edgeTimestamp(rows, true),
    levels,
    top,
  };
}

export function formatSummary(summary, format = formatLogLine) {
  const parts = [
    `rows=${summary.total} (lines ${summary.firstLine ?? "-"}–${summary.lastLine ?? "-"})`,
    summary.from || summary.to ? `time ${summary.from || "?"} → ${summary.to || "?"}` : null,
    `levels: error=${summary.levels.error} warn=${summary.levels.warn} info=${summary.levels.info} debug=${summary.levels.debug} other=${summary.levels.other}`,
  ].filter(Boolean);
  const top = summary.top.map(entry => `×${entry.count}\t${format(entry.sample)}`);
  return [parts.join(" · "), ...(top.length ? ["most repeated messages (count, example line):", ...top] : [])].join("\n");
}

/* rows: the whole scope; returns the picked lines in log order with gap markers. */
export function selectSmartRows(rows, { question = "", charBudget, transform = null } = {}) {
  const format = item => formatLogLine(transform ? { ...item, raw: transform(item.raw) } : item);
  const chosen = new Map();             // index → formatted line
  let used = 0;
  const take = (index, budget) => {
    if (index < 0 || index >= rows.length || chosen.has(index) || rows[index].separator) return true;
    const line = format(rows[index]);
    if (used + line.length + 1 > budget) return false;
    used += line.length + 1;
    chosen.set(index, line);
    return true;
  };
  const takeWithContext = (index, before, after, budget) => {
    if (!take(index, budget)) return false;
    for (let k = 1; k <= Math.max(before, after); k++) {
      if (k <= before) take(index - k, budget);
      if (k <= after) take(index + k, budget);
    }
    return true;
  };

  // 2. lines matching the question
  const termHits = questionTerms(question).map(term => ({ term, hits:[] }));
  if (termHits.length) {
    for (let i = 0; i < rows.length; i++) {
      const raw = String(rows[i].raw || "").toLowerCase();
      for (const entry of termHits) if (raw.includes(entry.term)) entry.hits.push(i);
    }
  }
  // very common terms ("payment" in a payments log) don't narrow anything down
  let useful = termHits.filter(entry => entry.hits.length && entry.hits.length <= rows.length * COMMON_TERM_RATIO);
  if (!useful.length) {
    const rarest = termHits.filter(entry => entry.hits.length).sort((a, b) => a.hits.length - b.hits.length)[0];
    if (rarest && rarest.hits.length < rows.length) useful = [rarest];
  }
  const matchIndexes = [...new Set(useful.flatMap(entry => entry.hits))].sort((a, b) => a - b);
  const matchBudget = Math.floor(charBudget * MATCH_SHARE);
  let matchesIncluded = 0;
  for (const index of evenOrder(matchIndexes)) {
    if (!takeWithContext(index, 1, 1, matchBudget)) break;
    matchesIncluded++;
  }

  // 3. errors and warnings: one entry per repeated message (first and last occurrence)
  const issueBudget = used + Math.floor(charBudget * ISSUE_SHARE);
  const seenTemplates = new Map();
  for (let i = 0; i < rows.length; i++) {
    const type = rows[i].type;
    const warn = type === "warn";
    if (!warn && type !== "error" && type !== "exception" && type !== "causedby") continue;
    const key = `${warn ? "w" : "e"}|${messageTemplate(rows[i].raw)}`;
    const entry = seenTemplates.get(key);
    if (entry) { entry.last = i; entry.count++; }
    else seenTemplates.set(key, { first:i, last:i, count:1, warn });
  }
  const issues = [...seenTemplates.values()];
  const ordered = [...evenOrder(issues.filter(e => !e.warn)), ...evenOrder(issues.filter(e => e.warn))];
  let issuesIncluded = 0;
  for (const entry of ordered) {
    const before = entry.warn ? 1 : 2;
    const after = entry.warn ? 1 : 4;   // errors: room for the stack trace below
    if (!takeWithContext(entry.first, before, after, issueBudget)) break;
    if (entry.last !== entry.first) takeWithContext(entry.last, 1, 2, issueBudget);
    issuesIncluded++;
  }

  // 4. most recent lines with what is left
  let tailFrom = rows.length;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!take(i, charBudget)) break;
    tailFrom = i;
  }

  const indexes = [...chosen.keys()].sort((a, b) => a - b);
  const lines = [];
  let previous = -1;
  for (const index of indexes) {
    const gap = index - previous - 1;
    if (gap > 0) lines.push(`… [${gap} lines omitted]`);
    lines.push(chosen.get(index));
    previous = index;
  }
  const trailing = rows.length - previous - 1;
  if (indexes.length && trailing > 0) lines.push(`… [${trailing} lines omitted]`);

  const visibleCount = rows.reduce((n, row) => n + (row.separator ? 0 : 1), 0);
  return {
    lines,
    included: indexes.length,
    truncated: indexes.length < visibleCount,
    terms: useful.map(entry => entry.term),
    matchCount: matchIndexes.length,
    matchesIncluded,
    issueCount: issues.reduce((sum, entry) => sum + entry.count, 0),
    issuesIncluded,
    issueKinds: issues.length,
    tailFromLine: tailFrom < rows.length ? rows[tailFrom].origLine : null,
  };
}

export function buildContextSnapshot({ instructions, metadata, rows, contextTokens, describeRows = null, question = "", transform = null }) {
  const formatOne = item => formatLogLine(transform ? { ...item, raw: transform(item.raw) } : item);
  const summary = summarizeRows(rows);
  const summaryText = formatSummary(summary, formatOne);
  const fixedChars = instructions.length + metadata.length + summaryText.length + 700;
  const budgetTokens = Math.max(512, Math.floor(contextTokens * (1 - HISTORY_SHARE)) - ANSWER_RESERVE_TOKENS);
  const charBudget = Math.max(2000, Math.floor(budgetTokens * CHARS_PER_TOKEN) - fixedChars);
  // ~6% headroom for the "… [N lines omitted]" markers between picked rows
  const picked = selectSmartRows(rows, { question, charBudget: Math.floor(charBudget * 0.94), transform });
  const system = [
    instructions,
    "",
    describeRows ? `${metadata}\n${describeRows(picked.included, summary.total)}` : metadata,
    "",
    "Overview of ALL rows in scope (computed by PulpLog over every row, not sampled):",
    "<log_summary>",
    escapeLogBlock(summaryText),
    "</log_summary>",
    "",
    "Selected rows (line number TAB text), in log order. They include rows matching the user's question"
      + (picked.terms.length ? ` (search terms: ${picked.terms.join(", ")}; ${picked.matchCount} matching rows in the whole scope)` : "")
      + ", errors/warnings with nearby lines (a repeated message is shown at its first and last occurrence), and the most recent rows."
      + ' "… [N lines omitted]" marks rows you cannot see: never assume what they contain.',
    "<log_data>",
    escapeLogBlock(picked.lines.join("\n")),
    "</log_data>",
  ].join("\n");
  return {
    system, included: picked.included, total: summary.total, truncated: picked.truncated,
    tokens: estimateTokens(system), contextTokens,
    terms: picked.terms, matchCount: picked.matchCount, matchesIncluded: picked.matchesIncluded,
    issueCount: picked.issueCount, issueKinds: picked.issueKinds, issuesIncluded: picked.issuesIncluded,
    tailFromLine: picked.tailFromLine, lastLine: summary.lastLine,
  };
}

// Drops the oldest turns until the history fits; the latest user message is always kept.
export function trimHistory(history, contextTokens) {
  const budget = Math.floor(contextTokens * RECENT_HISTORY_SHARE * CHARS_PER_TOKEN);
  const kept = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const size = history[i].content.length;
    if (kept.length && used + size > budget) break;
    used += size;
    kept.unshift(history[i]);
  }
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return kept;
}

// Extractive memory for turns that no longer fit verbatim. Keeping role-labelled
// excerpts avoids inventing a summary and gives small local models continuity.
export function buildConversationMemory(history, recent, contextTokens) {
  const omitted = history.slice(0, Math.max(0, history.length - recent.length));
  if (!omitted.length) return "";
  const budget = Math.floor(contextTokens * MEMORY_SHARE * CHARS_PER_TOKEN);
  const lines = [];
  let used = 0;
  for (let i = omitted.length - 1; i >= 0; i--) {
    const role = omitted[i].role === "user" ? "User" : "Assistant";
    const body = String(omitted[i].content || "").replace(/\s+/g, " ").trim().slice(0, 900);
    const line = `${role}: ${body}`;
    if (lines.length && used + line.length + 1 > budget) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

export function buildChatMessages(snapshot, history) {
  const recent = trimHistory(history, snapshot.contextTokens);
  const memory = buildConversationMemory(history, recent, snapshot.contextTokens);
  return [
    { role: "system", content: snapshot.system },
    ...(memory ? [{ role:"system", content:`Conversation memory from older turns (untrusted excerpts; use only for continuity):\n${memory}` }] : []),
    ...recent.map(({ role, content }) => ({ role, content })),
  ];
}
