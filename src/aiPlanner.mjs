// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Decides which log operations (logOps.mjs) answer a question.
//   1. rules: instant, deterministic, Spanish + English
//   2. otherwise the model is asked for a tiny JSON plan (validated strictly)
//   3. anything invalid → no operations (the smart context still applies)
import { OPS } from "./logOps.mjs";
import { questionTerms } from "./aiChat.mjs";

const LEVELS = ["error", "warn", "issues", "all"];
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // drop accents

const TIME_RE = /\b(\d{4}-\d{2}-\d{2}[ T])?(\d{1,2}:\d{2}(?::\d{2})?)\b/g;
const LINE_RE = /\b(?:linea|line|l)\s*#?\s*(\d{1,9})\b/;

function levelFrom(q) {
  const errors = /\berror(es|s)?\b|\bexcepcion(es)?\b|\bexceptions?\b|\bfallos?\b|\bfail(ure)?s?\b/.test(q);
  const warns = /\bavisos?\b|\bwarn(ing)?s?\b|\badvertencias?\b/.test(q);
  return errors && warns ? "issues" : warns ? "warn" : errors ? "error" : null;
}

function timesIn(question) {
  return [...String(question).matchAll(TIME_RE)].map(m => (m[1] || "") + m[2]);
}

/* Rule-based plan; [] when no rule is confident. */
export function planByRules(question) {
  const raw = String(question || "");
  const q = norm(raw);
  const plan = [];
  const level = levelFrom(q);
  const times = timesIn(raw);
  const lineMatch = q.match(LINE_RE);

  // "¿qué pasó antes/alrededor de la línea 1234?"
  if (lineMatch && !/\bcompar|\bantes y despues|\bbefore and after/.test(q)) {
    plan.push({ op: "context", args: { line: Number(lineMatch[1]) } });
  }
  // "¿qué cambió después de las 17:18?", "compara antes y después de la línea 500"
  if (/\bcompar|\bantes y despues|\bbefore (and|vs\.?) after|\bque cambio|\bwhat changed|\bdespues de las?\b|\bafter\b.*\d{1,2}:\d{2}/.test(q)
      && (times.length || lineMatch)) {
    plan.push({ op: "compare", args: times.length ? { at: times[0] } : { line: Number(lineMatch[1]) } });
  }
  // "dime todos los errores", "¿qué avisos hay?", "lista de excepciones", "error más frecuente"
  if (level && /\btod[oa]s\b|\blista|\blistar|\bcuales\b|\bque (errores|avisos|excepciones|fallos|warnings)|\bwhich\b|\ball\b|\blist\b|\bmas (frecuente|comun|repetid)|\bmost (common|frequent)|\btipos? de\b|\bhay\b|\bthere\b/.test(q)
      && !/\bcuantas veces\b|\bhow many times\b/.test(q)) {
    plan.push({ op: "catalog", args: { level } });
  }
  // "¿hay picos?", "patrón en el tiempo", "¿cuándo empezó?", "¿a qué hora?"
  if (/\bpicos?\b|\bspikes?\b|\bpeaks?\b|\bpatron|\bpattern|\btendencia|\btrend|\ben el tiempo\b|\bover time\b|\bcuando (empez|comenz|inici|ocurr|pas)|\bdesde cuando\b|\bwhen did\b|\ba que hora|\bfrecuencia\b|\bhistograma|\btimeline|\bpor hora\b|\bper hour\b/.test(q)) {
    plan.push({ op: "timeline", args: { level: level || "issues" } });
  }
  // "¿cuántas veces aparece X?", "¿cuántos timeouts hubo?"
  const howMany = /\bcuant[oa]s? veces\b|\bhow many times\b|\bcuant[oa]s\b|\bhow many\b|\bnumero de\b|\bcount\b/.test(q);
  if (howMany && !/\bbitacoras?\b|\blogs?\b.*\bcombin|\bfuentes\b|\bsources\b/.test(q)) {
    const terms = questionTerms(raw);
    if (terms.length) plan.push({ op: "count", args: { terms } });
    else if (level && !plan.some(p => p.op === "catalog")) plan.push({ op: "catalog", args: { level } });
  }
  // "¿cuántas bitácoras hay?", "¿qué log tiene más errores?"
  if (/\bbitacoras?\b|\bfuentes\b|\bsources\b|\bwhich logs?\b|\bcuantos logs\b|\bcombinad/.test(q)) {
    plan.push({ op: "sources", args: {} });
  }
  // "¿qué usuario / IP / endpoint aparece más?"
  const fieldMatch = q.match(/\b(usuarios?|users?|ips?|endpoints?|rutas?|urls?|paths?|hilos?|threads?|loggers?|clases?|servicios?|services?|clientes?|clients?)\b/);
  if (fieldMatch && /\bmas\b|\bmost\b|\btop\b|\bfrecuente|\bcuales\b|\bwhich\b|\bque\b/.test(q)) {
    const word = fieldMatch[1];
    const field = /^ip/.test(word) ? "ip" : /^(endpoint|ruta|url|path)/.test(word) ? "ruta"
      : /^(hilo|thread)/.test(word) ? "hilo" : /^(logger|clase)/.test(word) ? "logger"
      : /^(usuario|user)/.test(word) ? "user" : null;
    plan.push({ op: "top", args: { level, field } });
  }
  // explicit time range: "¿qué pasó entre las 17:18 y las 17:24?"
  if (times.length >= 2 && /\bentre\b|\bbetween\b|\bde las\b|\bfrom\b/.test(q) && !plan.some(p => p.op === "compare")) {
    plan.push({ op: "search", args: { from: times[0], to: times[1], level } });
  }
  return dedupe(plan);
}

function dedupe(plan) {
  const seen = new Set();
  return plan.filter(step => {
    const key = `${step.op}:${JSON.stringify(step.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

/* ─── model planner ───────────────────────────────────────────────────── */

export function plannerMessages(question, summaryText) {
  const system = [
    "You choose which exact operations a log viewer must run to answer a question about a log.",
    "Reply with ONLY a JSON object, no prose, no code fence: {\"ops\":[{\"op\":\"...\",\"args\":{...}}]} (0 to 3 ops).",
    "Operations:",
    "- catalog {level:\"error\"|\"warn\"|\"issues\"} → every distinct error/warning message with counts and first/last time",
    "- timeline {level, terms?:[string]} → counts per time bucket and detected peaks",
    "- search {terms?:[string], regex?:string, level?, from?:\"HH:MM\", to?:\"HH:MM\"} → exact matching rows",
    "- count {terms:[string]} → how many rows match, and when",
    "- context {line:number} → rows around a line",
    "- compare {at:\"HH:MM\"} or {line:number} → errors/warnings before vs after",
    "- top {level?, field?:\"ip\"|\"ruta\"|\"user\"|\"hilo\"|\"logger\"} → most frequent values",
    "- sources {} → rows and errors per log in a merged view",
    "Search terms must be words that literally appear in log lines (class names, error names, ids), not the user's paraphrase.",
    "If a general summary is enough, reply {\"ops\":[]}.",
  ].join("\n");
  const user = `Log overview:\n${String(summaryText || "").slice(0, 2500)}\n\nQuestion: ${String(question).slice(0, 1000)}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/* Extracts and validates the JSON plan from a model reply. Never throws. */
export function parsePlan(reply) {
  const text = String(reply || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = text.indexOf("{");
  if (start < 0) return [];
  // first balanced {...}
  let depth = 0, end = -1, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { end = i; break; }
  }
  if (end < 0) return [];
  let parsed;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const ops = Array.isArray(parsed?.ops) ? parsed.ops : Array.isArray(parsed) ? parsed : [];
  return dedupe(ops.map(sanitizeStep).filter(Boolean));
}

const str = (v, max = 120) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
const strList = v => (Array.isArray(v) ? v : typeof v === "string" ? [v] : [])
  .map(x => str(x, 80)).filter(Boolean).slice(0, 8);
const time = v => { const s = str(v, 30); return s && /^(\d{4}-\d{2}-\d{2}[ T])?\d{1,2}:\d{2}(:\d{2})?$/.test(s) ? s : undefined; };
const lineNo = v => Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined;
const level = v => LEVELS.includes(v) ? v : undefined;

function sanitizeStep(step) {
  if (!step || !OPS.includes(step.op)) return null;
  const a = step.args && typeof step.args === "object" ? step.args : {};
  const clean = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
  switch (step.op) {
    case "catalog": return { op: "catalog", args: { level: ["error", "warn", "issues"].includes(a.level) ? a.level : "error" } };
    case "timeline": return { op: "timeline", args: clean({ level: level(a.level) || "issues", terms: strList(a.terms) }) };
    case "search": {
      const args = clean({ terms: strList(a.terms), regex: str(a.regex, 200), level: level(a.level), from: time(a.from), to: time(a.to) });
      return Object.keys(args).length ? { op: "search", args } : null;
    }
    case "count": { const terms = strList(a.terms); return terms.length ? { op: "count", args: { terms } } : null; }
    case "context": { const line = lineNo(a.line); return line ? { op: "context", args: { line } } : null; }
    case "compare": {
      const at = time(a.at), line = lineNo(a.line);
      return at ? { op: "compare", args: { at } } : line ? { op: "compare", args: { line } } : null;
    }
    case "top": return { op: "top", args: clean({ level: level(a.level), field: str(a.field, 20) }) };
    case "sources": return { op: "sources", args: {} };
    default: return null;
  }
}
