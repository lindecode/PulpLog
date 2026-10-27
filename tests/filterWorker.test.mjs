// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { createFilterWorkerClient } from "../src/filterWorkerClient.mjs";

function factory() {
  const url = new URL("../src/logProcessing.mjs", import.meta.url).href;
  const thread = new Worker(`const {parentPort}=require('node:worker_threads');
    import(${JSON.stringify(url)}).then(({filterLogs})=>parentPort.on('message',args=>parentPort.postMessage({result:filterLogs(...args)})));`, { eval:true });
  const worker = { postMessage:args => thread.postMessage(args), terminate:() => thread.terminate() };
  thread.on("message", data => worker.onmessage?.({ data }));
  thread.on("error", error => worker.onerror?.(error));
  return worker;
}
const levels = Object.fromEntries(["error", "warn", "info", "debug", "trace", "stack", "plain"].map(key => [key, true]));
const args = (raw, pattern) => [[{ raw, type:"plain", origLine:1 }], pattern, true, levels, 0, "", false, null, [], []];

test("terminates catastrophic regex evaluation and recovers with a fresh worker", async t => {
  const client = createFilterWorkerClient(factory, 500);
  t.after(() => client.terminate());
  await assert.rejects(client.run(args("a".repeat(35) + "!", "(a+)+$")), /timed out/);
  const result = await client.run(args("INFO ready", "ready$"));
  assert.equal(result.filtered.length, 1);
  const invalid = await client.run(args("text", "("));
  assert.equal(invalid.filterRegexValid, false);
});

test("keeps only the latest queued live update and cancels obsolete work", async () => {
  const workers = [];
  const client = createFilterWorkerClient(() => {
    const worker = { jobs:[], postMessage(args) { this.jobs.push(args); }, terminate() {} };
    workers.push(worker); return worker;
  });
  const first = client.run(["first"]);
  const second = client.run(["second"]);
  const latest = client.run(["latest"]);
  assert.equal((await second).superseded, true);
  workers[0].onmessage({ data:{ result:"first" } });
  assert.equal(await first, "first");
  assert.deepEqual(workers[0].jobs, [["first"], ["latest"]]);
  client.reset();
  assert.equal((await latest).superseded, true);
  client.terminate();
});
