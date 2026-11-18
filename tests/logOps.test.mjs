// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/logProcessing.mjs";
import { catalog, timeline, search, count, context, compare, topValues, sources, runOps, parseWhen, indexOfLine } from "../src/logOps.mjs";
import { planByRules, parsePlan } from "../src/aiPlanner.mjs";

/* 2 hours of a Spring-like log: steady INFO, a burst of timeouts 17:18–17:24,
   a LockTimeOut every 20 minutes, and a stack trace after one of them. */
function buildLog() {
  const lines = [];
  const at = (h, m, s) => `2026-11-17 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},001`;
  for (let minute = 0; minute < 120; minute++) {
    const h = 16 + Math.floor(minute / 60), m = minute % 60;
    for (let s = 0; s < 60; s += 10) {
      lines.push(`${at(h, m, s)} INFO o.m.w.d.DynamicsUtils [scheduling-1] Consultando ecommerce_productoUbicacion user=u${(minute + s) % 7} ip=10.0.0.${minute % 3}`);
    }
    if (minute % 20 === 5) {
      lines.push(`${at(h, m, 30)} ERROR o.m.w.DataAccess [http-nio-8080-exec-${minute % 4}] LockTimeOutException: tabla CarritoDatos bloqueada tx=${minute * 7919}`);
      lines.push("\tat org.m.w.DataAccess.reserveAndWait(DataAccess.java:120)");
    }
    if (h === 17 && m >= 18 && m <= 24) {
      for (let k = 0; k < 4; k++) lines.push(`${at(h, m, 40 + k)} WARN o.s.w.s.AsyncRequestTimeoutException [http-nio-8080-exec-1] GET /api/carrito/${minute + k} timeout`);
    }
  }
  return lines.map((raw, i) => ({ raw, origLine: i + 1, type: classify(raw) }));
}
const rows = buildLog();

test("catalog groups every error with exact counts, times and a clickable line", () => {
  const result = catalog(rows, { level: "error" });
  assert.equal(result.ok, true);
  assert.match(result.markdown, /6 filas, 1 mensajes distintos/);
  assert.match(result.markdown, /\| 6 \| 16:05:30 \| 17:45:30 \| \d+ \| .*LockTimeOutException/);
  assert.match(result.text, /^CATALOG error: 6 rows, 1 distinct/);
  const both = catalog(rows, { level: "issues" });
  assert.match(both.markdown, /34 filas, 2 mensajes distintos/);
});

test("catalog says so when there is nothing", () => {
  const clean = rows.filter(r => r.type === "info");
  assert.match(catalog(clean, { level: "error" }).markdown, /no hay errores/);
});

test("timeline finds the 17:18–17:24 burst as a peak", () => {
  const result = timeline(rows, { level: "issues" });
  assert.equal(result.ok, true);
  assert.ok(result.peaks.length >= 1);
  const peakHours = result.peaks.map(ms => new Date(ms).getHours() * 60 + new Date(ms).getMinutes());
  assert.ok(peakHours.every(m => m >= 17 * 60 + 15 && m <= 17 * 60 + 25), `peaks at ${peakHours}`);
  assert.match(result.markdown, /Picos/);
});

test("timeline reports missing timestamps instead of inventing", () => {
  const plain = [{ raw: "hello", origLine: 1, type: "plain" }];
  assert.equal(timeline(plain).ok, false);
});

test("search counts exactly, honours time ranges and levels", () => {
  const all = search(rows, { terms: ["AsyncRequestTimeout"] });
  assert.equal(all.count, 28);
  const range = search(rows, { from: "17:20", to: "17:21", level: "warn" });
  assert.equal(range.count, 8);
  const none = search(rows, { terms: ["no-such-thing"] });
  assert.equal(none.count, 0);
  assert.match(none.markdown, /sin coincidencias/);
});

test("count adds when it happened", () => {
  const result = count(rows, { terms: ["LockTimeOut"] });
  assert.equal(result.count, 6);
  assert.match(result.text, /TIMELINE/);
});

test("context shows the rows around a line, marking it", () => {
  const errorLine = rows.find(r => r.type === "error").origLine;
  const result = context(rows, { line: errorLine, before: 2, after: 2 });
  assert.match(result.markdown, new RegExp(`\\| ${errorLine} ◀ \\|`));
  assert.match(result.text, /reserveAndWait/);
  assert.equal(indexOfLine(rows, errorLine), errorLine - 1);
});

test("compare marks warnings that only appear after a time as NEW", () => {
  const result = compare(rows, { at: "17:10" });
  assert.equal(result.ok, true);
  assert.match(result.markdown, /\| 0 \| 28 \| NUEVO \| WARN/);
  assert.match(result.markdown, /\| 4 \| 2 \| {2}\| ERROR/); // 16:05 16:25 16:45 17:05 | 17:25 17:45
});

test("top values finds users, IPs, threads and HTTP routes; ignores unique ids", () => {
  const result = topValues(rows, {});
  assert.match(result.markdown, /\*\*user\*\* \(7 distintos\)/);
  assert.match(result.markdown, /\*\*IP\*\*/);
  assert.doesNotMatch(result.markdown, /\*\*tx\*\*/); // one value per row → not useful
  const inErrors = topValues(rows, { level: "error" });
  assert.match(inErrors.markdown, /Hilo/);
});

test("sources splits a merged tab per log", () => {
  const merged = rows.slice(0, 10).map((r, i) => ({ ...r, raw: `[${i % 2 ? "b.log" : "a.log"}] ${r.raw}` }));
  assert.match(sources(merged).markdown, /\| a\.log \| 5 \|/);
  assert.match(sources(rows).markdown, /una sola bitácora/);
});

test("runOps ignores unknown operations and survives bad arguments", () => {
  const results = runOps(rows, [{ op: "rm -rf" }, { op: "context", args: { line: "x" } }, { op: "sources" }]);
  assert.deepEqual(results.map(r => r.op), ["context", "sources"]);
  assert.equal(results[0].ok, false);
});

test("parseWhen uses the log's own date for bare times", () => {
  const ref = new Date(2026, 10, 17, 9, 0).getTime();
  assert.equal(new Date(parseWhen("17:18", ref)).getHours(), 17);
  assert.equal(new Date(parseWhen("17:18", ref)).getDate(), 17);
  assert.equal(parseWhen("tomorrow", ref), null);
});

/* ─── planner ─── */

const ops = q => planByRules(q).map(p => p.op);

test("rules: everyday questions map to the right operations", () => {
  assert.deepEqual(planByRules("dime todos los errores"), [{ op: "catalog", args: { level: "error" } }]);
  assert.deepEqual(planByRules("¿Qué avisos hay?"), [{ op: "catalog", args: { level: "warn" } }]);
  assert.deepEqual(ops("¿Hay picos de errores o un patrón en el tiempo?"), ["catalog", "timeline"]);
  assert.deepEqual(planByRules("¿qué pasó antes de la línea 33972?"), [{ op: "context", args: { line: 33972 } }]);
  assert.deepEqual(planByRules("¿qué cambió después de las 17:18?"), [{ op: "compare", args: { at: "17:18" } }]);
  assert.deepEqual(planByRules("¿cuántas veces aparece LockTimeOutException?"), [{ op: "count", args: { terms: ["locktimeoutexception"] } }]);
  assert.deepEqual(ops("cuantas bitácoras hay?"), ["sources"]);
  assert.deepEqual(planByRules("¿qué usuario genera más errores?"), [{ op: "top", args: { level: "error", field: "user" } }]);
  assert.deepEqual(planByRules("¿qué pasó entre las 17:18 y las 17:24?"), [{ op: "search", args: { from: "17:18", to: "17:24", level: null } }]);
  assert.deepEqual(planByRules("show me all errors"), [{ op: "catalog", args: { level: "error" } }]);
  assert.deepEqual(planByRules("resume qué está ocurriendo"), []);
});

test("model plans are parsed strictly: junk, prose and invalid args are dropped", () => {
  assert.deepEqual(parsePlan('Claro: {"ops":[{"op":"catalog","args":{"level":"warn"}}]} espero que sirva'),
    [{ op: "catalog", args: { level: "warn" } }]);
  assert.deepEqual(parsePlan('<think>hmm {x}</think>{"ops":[{"op":"search","args":{"terms":["Dynamics"],"from":"17:00","to":"mañana"}}]}'),
    [{ op: "search", args: { terms: ["Dynamics"], from: "17:00" } }]);
  assert.deepEqual(parsePlan('{"ops":[{"op":"exec","args":{}},{"op":"context","args":{"line":-3}},{"op":"count","args":{}}]}'), []);
  assert.deepEqual(parsePlan("no json here"), []);
  assert.deepEqual(parsePlan('{"ops": [ {"op":"sources"} '), []);
  assert.deepEqual(parsePlan('{"ops":[{"op":"search","args":{"regex":"a\\"}b"}}]}'), [{ op: "search", args: { regex: 'a"}b' } }]);
});
