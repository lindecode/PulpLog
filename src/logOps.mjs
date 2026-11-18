// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Log operations for the AI chat: exact answers computed by PulpLog over EVERY
// row in scope, so a small local model only has to interpret them.
// Pure functions (no React, no Electron) → testable in Node.
//
// Every operation returns:
//   { op, title, ok, markdown, text }
//   markdown → shown as-is in the chat (exact; line numbers become links)
//   text     → compact version handed to the model
import { parseTimestampFromText } from "./logProcessing.mjs";
import { messageTemplate, countSources } from "./aiChat.mjs";

export const OPS = ["catalog", "timeline", "search", "count", "context", "compare", "top", "sources"];
const MAX_MESSAGE_CHARS = 160;

/* ─── row helpers ─────────────────────────────────────────────────────── */

const isError = type => type === "error" || type === "exception";
const isWarn = type => type === "warn";
const levelMatches = (type, level) =>
  !level || level === "all" ? true
    : level === "error" ? isError(type)
    : level === "warn" ? isWarn(type)
    : level === "issues" ? isError(type) || isWarn(type)
    : type === level;

const clip = (text, max = MAX_MESSAGE_CHARS) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
// for Markdown table cells
const cell = text => clip(text).replace(/\|/g, "\\|").replace(/`/g, "'");

const fmtCount = n => Number(n).toLocaleString("es");

/* Timestamps per row; continuation lines (stack traces) inherit the previous one.
   Cached per rows array: the same scope is queried several times per question. */
const tsCache = new WeakMap();
export function rowTimestamps(rows) {
  let cached = tsCache.get(rows);
  if (cached) return cached;
  const ts = new Float64Array(rows.length);
  let last = NaN;
  let found = 0;
  for (let i = 0; i < rows.length; i++) {
    const value = parseTimestampFromText(rows[i].raw);
    if (value != null) { last = value; found++; }
    ts[i] = last;
  }
  // leading rows without a timestamp take the first one found
  const firstIndex = ts.findIndex(v => !Number.isNaN(v));
  for (let i = 0; i < firstIndex; i++) ts[i] = ts[firstIndex];
  cached = { ts, found };
  tsCache.set(rows, cached);
  return cached;
}

const pad = n => String(n).padStart(2, "0");
export function fmtTime(ms, withDate = false, withSeconds = true) {
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? `:${pad(d.getSeconds())}` : ""}`;
  return withDate ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}` : time;
}

function spansDays(ts) {
  let min = Infinity, max = -Infinity;
  for (const v of ts) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
  return Number.isFinite(min) && new Date(min).toDateString() !== new Date(max).toDateString();
}

/* "17:18", "17:18:05", "2026-11-17 17:18" → ms, using the log's own date for bare times. */
export function parseWhen(value, refMs) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const full = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (full) return new Date(+full[1], +full[2] - 1, +full[3], +full[4], +full[5], +(full[6] || 0)).getTime();
  const time = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!time || !Number.isFinite(refMs)) return null;
  const ref = new Date(refMs);
  return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), +time[1], +time[2], +(time[3] || 0)).getTime();
}

const firstFinite = ts => { for (const v of ts) if (Number.isFinite(v)) return v; return NaN; };

/* Index of the row with this origLine (rows are in log order). */
export function indexOfLine(rows, line) {
  let lo = 0, hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = rows[mid].origLine;
    if (value === line) return mid;
    if (value < line) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

/* Spread a long list: first, last, then evenly in between. */
function spread(list, limit) {
  if (list.length <= limit) return list.slice();
  const out = [];
  for (let k = 0; k < limit; k++) out.push(list[Math.round(k * (list.length - 1) / (limit - 1))]);
  return [...new Set(out)];
}

const lineRow = row => `${row.origLine}\t${clip(row.raw, 400)}`;

/* ─── catalog ─────────────────────────────────────────────────────────── */

export function groupIssues(rows, level = "issues", from = 0, to = rows.length) {
  const { ts } = rowTimestamps(rows);
  const groups = new Map();
  for (let i = from; i < to; i++) {
    const row = rows[i];
    if (row.separator || !levelMatches(row.type, level) || !(isError(row.type) || isWarn(row.type))) continue;
    const key = `${isWarn(row.type) ? "W" : "E"}|${messageTemplate(row.raw)}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, level: isWarn(row.type) ? "warn" : "error", count: 0, first: i, last: i, sample: row };
      groups.set(key, group);
    }
    group.count++;
    group.last = i;
  }
  return [...groups.values()].map(group => ({
    ...group, firstTs: ts[group.first], lastTs: ts[group.last],
  }));
}

export function catalog(rows, { level = "error", limit = 40 } = {}) {
  const lvl = ["error", "warn", "issues"].includes(level) ? level : "error";
  const groups = groupIssues(rows, lvl).sort((a, b) => b.count - a.count || a.first - b.first);
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const label = lvl === "warn" ? "avisos" : lvl === "issues" ? "errores y avisos" : "errores";
  const title = `Catálogo de ${label}`;
  if (!groups.length) {
    return { op: "catalog", title, ok: true, markdown: `**${title}:** no hay ${label} en las ${fmtCount(rows.length)} filas analizadas.`,
             text: `CATALOG ${lvl}: none in ${rows.length} rows.` };
  }
  const withDate = spansDays(rowTimestamps(rows).ts);
  const shown = groups.slice(0, limit);
  const header = `**${title}:** ${fmtCount(total)} filas, ${fmtCount(groups.length)} mensajes distintos (mismo mensaje con IDs, números u horas diferentes cuenta como uno).`;
  const table = [
    `| Veces | ${lvl === "issues" ? "Nivel | " : ""}Primera | Última | Línea | Mensaje |`,
    `|---:|${lvl === "issues" ? "---|" : ""}---|---|---:|---|`,
    ...shown.map(g => `| ${fmtCount(g.count)} | ${lvl === "issues" ? `${g.level === "warn" ? "WARN" : "ERROR"} | ` : ""}${fmtTime(g.firstTs, withDate)} | ${fmtTime(g.lastTs, withDate)} | ${g.sample.origLine} | ${cell(g.sample.raw)} |`),
  ];
  const more = groups.length > shown.length
    ? `\n\n…y ${fmtCount(groups.length - shown.length)} mensajes distintos más (${fmtCount(groups.slice(limit).reduce((s, g) => s + g.count, 0))} filas). Filtra por nivel en PulpLog para verlos todos.`
    : "";
  const text = [
    `CATALOG ${lvl}: ${total} rows, ${groups.length} distinct messages (variable parts grouped). count | first | last | example line`,
    ...groups.slice(0, Math.max(limit, 60)).map(g => `×${g.count} | ${fmtTime(g.firstTs, withDate)} | ${fmtTime(g.lastTs, withDate)} | ${lineRow(g.sample)}`),
    groups.length > Math.max(limit, 60) ? `(+${groups.length - Math.max(limit, 60)} more distinct messages)` : null,
  ].filter(Boolean).join("\n");
  return { op: "catalog", title, ok: true, markdown: `${header}\n\n${table.join("\n")}${more}`, text };
}

/* ─── timeline ────────────────────────────────────────────────────────── */

const BUCKETS = [60e3, 5 * 60e3, 15 * 60e3, 30 * 60e3, 3600e3, 3 * 3600e3, 6 * 3600e3, 86400e3];
const MAX_BUCKETS = 48;

function bucketSizeFor(span) {
  return BUCKETS.find(size => span / size <= MAX_BUCKETS) || BUCKETS.at(-1);
}

const bar = (value, max, width = 16) => max > 0 ? "█".repeat(Math.max(value > 0 ? 1 : 0, Math.round(value / max * width))) : "";

export function timeline(rows, { level = "issues", terms = [], regex = null } = {}) {
  const { ts, found } = rowTimestamps(rows);
  const title = "Línea de tiempo";
  if (!found) {
    return { op: "timeline", title, ok: false, markdown: `**${title}:** las filas no tienen marcas de tiempo reconocibles.`,
             text: "TIMELINE: no timestamps in these rows." };
  }
  const matcher = buildMatcher(terms, regex);
  let min = Infinity, max = -Infinity;
  for (const v of ts) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
  const size = bucketSizeFor(Math.max(1, max - min));
  const start = Math.floor(min / size) * size;
  const n = Math.floor((max - start) / size) + 1;
  const buckets = Array.from({ length: n }, (_, k) => ({ at: start + k * size, rows: 0, error: 0, warn: 0, match: 0, firstLine: null }));
  for (let i = 0; i < rows.length; i++) {
    if (!Number.isFinite(ts[i]) || rows[i].separator) continue;
    const b = buckets[Math.floor((ts[i] - start) / size)];
    b.rows++;
    if (isError(rows[i].type)) b.error++;
    else if (isWarn(rows[i].type)) b.warn++;
    if (matcher && matcher(rows[i].raw)) { b.match++; if (b.firstLine == null) b.firstLine = rows[i].origLine; }
    else if (!matcher && b.firstLine == null && levelMatches(rows[i].type, level) && (isError(rows[i].type) || isWarn(rows[i].type))) b.firstLine = rows[i].origLine;
  }
  const metric = matcher ? (b => b.match)
    : level === "error" ? (b => b.error) : level === "warn" ? (b => b.warn)
    : level === "all" ? (b => b.rows) : (b => b.error + b.warn);
  const values = buckets.map(metric);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  const threshold = Math.max(3, mean + 2 * sd);
  const peaks = buckets.filter((b, k) => values[k] >= threshold);
  const peak = Math.max(...values);
  const total = values.reduce((a, b) => a + b, 0);
  const withDate = spansDays(ts);
  const sizeLabel = size >= 3600e3 ? `${size / 3600e3} h` : `${size / 60e3} min`;
  const what = matcher ? `coincidencias de ${describeMatch(terms, regex)}` : level === "error" ? "errores" : level === "warn" ? "avisos" : level === "all" ? "filas" : "errores + avisos";
  // keep the table readable: all buckets when few, otherwise only non-empty ones
  const visible = buckets.map((b, k) => ({ b, v: values[k] })).filter(({ v }, _k, all) => all.length <= 24 || v > 0);
  const table = [
    `| Desde | ${matcher ? "Coinc." : "Errores | Avisos"} | Filas | | Línea |`,
    `|---|${matcher ? "---:|" : "---:|---:|"}---:|---|---:|`,
    ...visible.map(({ b, v }) => `| ${fmtTime(b.at, withDate, false)}${values.length && v >= threshold ? " ⚠" : ""} | ${matcher ? b.match : `${b.error} | ${b.warn}`} | ${b.rows} | ${bar(v, peak)} | ${b.firstLine ?? ""} |`),
  ];
  const peakText = peaks.length
    ? `Picos (≥ ${Math.ceil(threshold)} por tramo, media ${mean.toFixed(1)}): ${peaks.map(b => `${fmtTime(b.at, withDate, false)} (${metric(b)})`).join(", ")}.`
    : `Sin picos: ningún tramo supera claramente la media (${mean.toFixed(1)} por tramo).`;
  const markdown = `**${title}** (${what}, tramos de ${sizeLabel}, ${fmtTime(min, withDate)} → ${fmtTime(max, withDate)}): ${fmtCount(total)} en total. ${peakText}\n\n${table.join("\n")}`;
  const text = [
    `TIMELINE of ${what} in ${sizeLabel} buckets, ${fmtTime(min, withDate)} → ${fmtTime(max, withDate)}; total ${total}. ${peakText}`,
    "bucket start | " + (matcher ? "matches" : "errors | warnings") + " | rows | first relevant line",
    ...buckets.map((b, k) => values[k] || b.rows ? `${fmtTime(b.at, withDate, false)} | ${matcher ? b.match : `${b.error} | ${b.warn}`} | ${b.rows} | ${b.firstLine ?? "-"}` : null).filter(Boolean),
  ].join("\n");
  return { op: "timeline", title, ok: true, markdown, text, peaks: peaks.map(b => b.at) };
}

/* ─── search / count ──────────────────────────────────────────────────── */

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildMatcher(terms = [], regex = null) {
  const list = (Array.isArray(terms) ? terms : [terms]).map(t => String(t || "").trim()).filter(Boolean);
  let re = null;
  if (regex) { try { re = new RegExp(String(regex), "i"); } catch { re = null; } }
  if (!re && !list.length) return null;
  const lowered = list.map(t => t.toLowerCase());
  return raw => {
    const text = String(raw || "");
    if (re && re.test(text)) return true;
    if (!lowered.length) return false;
    const lower = text.toLowerCase();
    return lowered.some(t => lower.includes(t));
  };
}

function describeMatch(terms, regex) {
  const list = (Array.isArray(terms) ? terms : [terms]).filter(Boolean);
  return [regex ? `/${regex}/` : null, ...list.map(t => `«${t}»`)].filter(Boolean).join(" o ") || "todo";
}

function rangeFilter(rows, from, to) {
  const { ts } = rowTimestamps(rows);
  const ref = firstFinite(ts);
  const lo = parseWhen(from, ref);
  let hi = parseWhen(to, ref);
  if (hi != null && /^\d{1,2}:\d{2}$/.test(String(to).trim())) hi += 59_999; // "17:24" includes the whole minute
  if (lo == null && hi == null) return null;
  return i => {
    const v = ts[i];
    if (!Number.isFinite(v)) return false;
    return (lo == null || v >= lo) && (hi == null || v <= hi);
  };
}

export function search(rows, { terms = [], regex = null, level = null, from = null, to = null, limit = 60 } = {}) {
  const matcher = buildMatcher(terms, regex);
  const inRange = rangeFilter(rows, from, to);
  const title = "Búsqueda";
  if (!matcher && !inRange && !level) {
    return { op: "search", title, ok: false, markdown: "", text: "SEARCH: nothing to search for." };
  }
  const hits = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.separator) continue;
    if (level && !levelMatches(row.type, level)) continue;
    if (inRange && !inRange(i)) continue;
    if (matcher && !matcher(row.raw)) continue;
    hits.push(i);
  }
  const what = [matcher ? describeMatch(terms, regex) : null, level ? `nivel ${level}` : null,
                from || to ? `entre ${from || "el inicio"} y ${to || "el final"}` : null].filter(Boolean).join(", ");
  if (!hits.length) {
    return { op: "search", title, ok: true, count: 0, markdown: `**${title}** (${what}): sin coincidencias en ${fmtCount(rows.length)} filas.`,
             text: `SEARCH ${what}: 0 matches in ${rows.length} rows.` };
  }
  const sample = spread(hits, limit);
  const shownInChat = spread(hits, Math.min(limit, 25));
  const { ts } = rowTimestamps(rows);
  const withDate = spansDays(ts);
  const markdown = [
    `**${title}** (${what}): **${fmtCount(hits.length)}** filas de ${fmtCount(rows.length)}, de ${fmtTime(ts[hits[0]], withDate)} a ${fmtTime(ts[hits.at(-1)], withDate)}.`
      + (hits.length > shownInChat.length ? ` Se muestran ${shownInChat.length} repartidas.` : ""),
    "",
    "| Línea | Hora | Texto |",
    "|---:|---|---|",
    ...shownInChat.map(i => `| ${rows[i].origLine} | ${fmtTime(ts[i], withDate)} | ${cell(rows[i].raw)} |`),
  ].join("\n");
  const text = [
    `SEARCH ${what}: ${hits.length} matching rows of ${rows.length}, first line ${rows[hits[0]].origLine} (${fmtTime(ts[hits[0]], withDate)}), last line ${rows[hits.at(-1)].origLine} (${fmtTime(ts[hits.at(-1)], withDate)}).`
      + (hits.length > sample.length ? ` ${sample.length} shown, spread evenly:` : ""),
    ...sample.map(i => lineRow(rows[i])),
  ].join("\n");
  return { op: "search", title, ok: true, count: hits.length, markdown, text };
}

export function count(rows, options = {}) {
  const result = search(rows, { ...options, limit: 12 });
  if (!result.count) return { ...result, op: "count", title: "Conteo" };
  const tl = timeline(rows, { terms: options.terms, regex: options.regex });
  return {
    ...result, op: "count", title: "Conteo",
    markdown: result.markdown.split("\n")[0] + (tl.ok ? `\n\n${tl.markdown.split("\n\n").slice(1).join("\n\n")}` : ""),
    text: `${result.text}\n${tl.ok ? tl.text : ""}`,
  };
}

/* ─── context around a line ───────────────────────────────────────────── */

export function context(rows, { line, before = 15, after = 15 } = {}) {
  const target = Number(line);
  const title = `Contexto de la línea ${target}`;
  let index = indexOfLine(rows, target);
  if (index < 0) {
    // the line may be hidden by a filter: use the nearest visible one
    let best = -1;
    for (let i = 0; i < rows.length; i++) if (rows[i].origLine <= target) best = i; else break;
    if (best < 0) return { op: "context", title, ok: false, markdown: `**${title}:** no está en las filas analizadas.`, text: `CONTEXT line ${target}: not in scope.` };
    index = best;
  }
  const lo = Math.max(0, index - Math.max(0, Math.min(200, before)));
  const hi = Math.min(rows.length - 1, index + Math.max(0, Math.min(200, after)));
  const slice = rows.slice(lo, hi + 1).filter(row => !row.separator);
  const markdown = [
    `**${title}** (${slice.length} filas, de la ${slice[0].origLine} a la ${slice.at(-1).origLine}):`,
    "",
    "| Línea | Texto |",
    "|---:|---|",
    ...slice.map(row => `| ${row.origLine}${row.origLine === target ? " ◀" : ""} | ${cell(row.raw)} |`),
  ].join("\n");
  const text = [`CONTEXT around line ${target} (rows ${slice[0].origLine}–${slice.at(-1).origLine}):`, ...slice.map(lineRow)].join("\n");
  return { op: "context", title, ok: true, markdown, text };
}

/* ─── compare before / after ──────────────────────────────────────────── */

export function compare(rows, { at = null, line = null } = {}) {
  const title = "Comparación antes / después";
  const { ts } = rowTimestamps(rows);
  let split = -1;
  let label = "";
  if (line != null && Number.isFinite(Number(line))) {
    split = rows.findIndex(row => row.origLine >= Number(line));
    label = `la línea ${line}`;
  } else if (at) {
    const when = parseWhen(at, firstFinite(ts));
    if (when != null) { split = ts.findIndex(v => Number.isFinite(v) && v >= when); label = `las ${at}`; }
  }
  if (split <= 0 || split >= rows.length) {
    return { op: "compare", title, ok: false, markdown: `**${title}:** no se pudo partir el alcance en ${label || "ese punto"}.`,
             text: `COMPARE: could not split at ${at ?? line}.` };
  }
  const before = groupIssues(rows, "issues", 0, split);
  const after = groupIssues(rows, "issues", split, rows.length);
  const keys = new Set([...before.map(g => g.key), ...after.map(g => g.key)]);
  const byKey = list => new Map(list.map(g => [g.key, g]));
  const b = byKey(before), a = byKey(after);
  const spanBefore = Math.max(1, (ts[split - 1] - firstFinite(ts)) / 60e3 || split);
  const spanAfter = Math.max(1, (ts[rows.length - 1] - ts[split]) / 60e3 || rows.length - split);
  const rowsCmp = [...keys].map(key => {
    const gb = b.get(key), ga = a.get(key);
    const status = !gb ? "NUEVO" : !ga ? "desaparece" : "";
    return { key, sample: (ga || gb).sample, level: (ga || gb).level, before: gb?.count || 0, after: ga?.count || 0, status };
  }).sort((x, y) => (y.status === "NUEVO") - (x.status === "NUEVO") || Math.abs(y.after - y.before) - Math.abs(x.after - x.before));
  const shown = rowsCmp.slice(0, 30);
  const markdown = [
    `**${title}** de ${label}: antes ${fmtCount(split)} filas (${spanBefore.toFixed(0)} min), después ${fmtCount(rows.length - split)} filas (${spanAfter.toFixed(0)} min). `
      + `${rowsCmp.filter(r => r.status === "NUEVO").length} mensajes nuevos, ${rowsCmp.filter(r => r.status === "desaparece").length} que desaparecen.`,
    "",
    "| Antes | Después | | Nivel | Línea | Mensaje |",
    "|---:|---:|---|---|---:|---|",
    ...shown.map(r => `| ${r.before} | ${r.after} | ${r.status} | ${r.level === "warn" ? "WARN" : "ERROR"} | ${r.sample.origLine} | ${cell(r.sample.raw)} |`),
  ].join("\n");
  const text = [
    `COMPARE errors/warnings before vs after ${label} (before: ${split} rows over ~${spanBefore.toFixed(0)} min; after: ${rows.length - split} rows over ~${spanAfter.toFixed(0)} min). before | after | status | example line`,
    ...rowsCmp.slice(0, 50).map(r => `${r.before} | ${r.after} | ${r.status || "-"} | ${lineRow(r.sample)}`),
  ].join("\n");
  return { op: "compare", title, ok: true, markdown: rowsCmp.length ? markdown : `**${title}:** no hay errores ni avisos a ningún lado de ${label}.`, text };
}

/* ─── most frequent values ────────────────────────────────────────────── */

const VALUE_EXTRACTORS = [
  { name: "IP", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: "Ruta HTTP", re: /(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s?"']*)/g, group: 1 },
  { name: "Logger", re: /\b[a-z][a-z0-9_]*(?:\.[a-zA-Z_][\w$]*){2,}\b/g },
  { name: "Hilo", re: /\[([\w.-]*(?:thread|exec|pool|worker|scheduling|http-nio|main)[\w.-]*)\]/gi, group: 1 },
  { name: "clave=valor", re: /\b([A-Za-z_][\w.-]{1,30})=("[^"]{1,80}"|[^\s,;&)\]}]{1,80})/g, pair: true },
];

export function topValues(rows, { level = null, field = null, limit = 8 } = {}) {
  const title = `Valores más frecuentes${level ? ` (${level === "error" ? "en errores" : level === "warn" ? "en avisos" : "en errores y avisos"})` : ""}`;
  const counters = new Map(); // category → Map(value → count)
  let scanned = 0;
  const wanted = field ? String(field).toLowerCase() : null;
  for (const row of rows) {
    if (row.separator || (level && !levelMatches(row.type, level))) continue;
    scanned++;
    const raw = String(row.raw || "");
    for (const ex of VALUE_EXTRACTORS) {
      ex.re.lastIndex = 0;
      let m;
      const seen = new Set();
      while ((m = ex.re.exec(raw))) {
        const category = ex.pair ? `${m[1]}=` : ex.name;
        if (wanted && !category.toLowerCase().includes(wanted) && !ex.name.toLowerCase().includes(wanted)) continue;
        const value = ex.pair ? m[2].replace(/^"|"$/g, "") : m[ex.group || 0];
        if (seen.has(category + value)) continue;
        seen.add(category + value);
        if (!counters.has(category)) counters.set(category, new Map());
        const map = counters.get(category);
        map.set(value, (map.get(value) || 0) + 1);
      }
    }
  }
  // useful categories: more than one value, and not unique per row (ids, timestamps)
  const categories = [...counters].map(([category, map]) => {
    const values = [...map].sort((x, y) => y[1] - x[1]);
    const total = values.reduce((s, [, n]) => s + n, 0);
    return { category, values, total, distinct: values.length };
    // a single value repeated everywhere is a finding too ("every error comes from thread X")
  }).filter(c => c.total >= 3 && c.distinct < c.total * 0.8)
    .sort((x, y) => y.total - x.total).slice(0, 8);
  if (!categories.length) {
    return { op: "top", title, ok: true, markdown: `**${title}:** no se encontraron valores repetidos (IPs, rutas, loggers, hilos o clave=valor) en ${fmtCount(scanned)} filas.`,
             text: `TOP VALUES: none found in ${scanned} rows.` };
  }
  const markdown = [`**${title}** en ${fmtCount(scanned)} filas:`, ""];
  const text = [`TOP VALUES in ${scanned} rows:`];
  for (const c of categories) {
    const top = c.values.slice(0, limit);
    markdown.push(`- **${c.category.replace(/=$/, "")}** (${fmtCount(c.distinct)} distintos): ${top.map(([v, n]) => `\`${clip(v, 60).replace(/`/g, "'")}\` ×${fmtCount(n)}`).join(", ")}${c.distinct > limit ? ", …" : ""}`);
    text.push(`${c.category} (${c.distinct} distinct): ${top.map(([v, n]) => `${clip(v, 60)}×${n}`).join(", ")}`);
  }
  return { op: "top", title, ok: true, markdown: markdown.join("\n"), text: text.join("\n") };
}

/* ─── sources (merged tabs) ───────────────────────────────────────────── */

export function sources(rows) {
  const title = "Bitácoras combinadas";
  const list = countSources(rows);
  if (!list.length) {
    return { op: "sources", title, ok: true, markdown: `**${title}:** esta pestaña es una sola bitácora (${fmtCount(rows.length)} filas).`,
             text: `SOURCES: a single log (${rows.length} rows), not a merged tab.` };
  }
  const errors = new Map(), warns = new Map();
  for (const row of rows) {
    const m = /^\[([^\]]{1,120})\] /.exec(String(row.raw || ""));
    if (!m) continue;
    if (isError(row.type)) errors.set(m[1], (errors.get(m[1]) || 0) + 1);
    else if (isWarn(row.type)) warns.set(m[1], (warns.get(m[1]) || 0) + 1);
  }
  const markdown = [
    `**${title}:** ${list.length}.`, "",
    "| Bitácora | Filas | Errores | Avisos |", "|---|---:|---:|---:|",
    ...list.map(s => `| ${cell(s.label)} | ${fmtCount(s.count)} | ${fmtCount(errors.get(s.label) || 0)} | ${fmtCount(warns.get(s.label) || 0)} |`),
  ].join("\n");
  const text = [`SOURCES: ${list.length} merged logs. name | rows | errors | warnings`,
    ...list.map(s => `${s.label} | ${s.count} | ${errors.get(s.label) || 0} | ${warns.get(s.label) || 0}`)].join("\n");
  return { op: "sources", title, ok: true, markdown, text };
}

/* ─── dispatcher ──────────────────────────────────────────────────────── */

const RUNNERS = { catalog, timeline, search, count, context, compare, top: topValues, sources };

export function runOps(rows, plan = []) {
  const results = [];
  for (const step of plan.slice(0, 4)) {
    const run = RUNNERS[step?.op];
    if (!run) continue;
    try {
      const result = run(rows, step.args || {});
      if (result && (result.markdown || result.text)) results.push(result);
    } catch (error) {
      results.push({ op: step.op, title: step.op, ok: false, markdown: "", text: `${step.op}: failed (${error.message})` });
    }
  }
  return results;
}
