// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Prompt budgeting for the local-AI chat. Pure functions so they can be tested
// without React or Ollama.

export const DEFAULT_CONTEXT_TOKENS = 16384;
export const ANSWER_RESERVE_TOKENS = 2048;
export const HISTORY_SHARE = 0.25;
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
export const escapeLogBlock = text => String(text).replace(/<(\/?log_data)/gi, "‹$1");

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

export function buildContextSnapshot({ instructions, metadata, rows, contextTokens, describeRows = null }) {
  const fixedChars = instructions.length + metadata.length + 300;
  const budgetTokens = Math.max(512, Math.floor(contextTokens * (1 - HISTORY_SHARE)) - ANSWER_RESERVE_TOKENS);
  const charBudget = Math.max(2000, Math.floor(budgetTokens * CHARS_PER_TOKEN) - fixedChars);
  const { lines, included, truncated } = selectTailRows(rows, charBudget);
  const system = [
    instructions,
    "",
    describeRows ? `${metadata}\n${describeRows(included, rows.length)}` : metadata,
    "",
    "<log_data>",
    escapeLogBlock(lines.join("\n")),
    "</log_data>",
  ].join("\n");
  return { system, included, total: rows.length, truncated, tokens: estimateTokens(system), contextTokens };
}

// Drops the oldest turns until the history fits; the latest user message is always kept.
export function trimHistory(history, contextTokens) {
  const budget = Math.floor(contextTokens * HISTORY_SHARE * CHARS_PER_TOKEN);
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

export function buildChatMessages(snapshot, history) {
  return [
    { role: "system", content: snapshot.system },
    ...trimHistory(history, snapshot.contextTokens).map(({ role, content }) => ({ role, content })),
  ];
}
