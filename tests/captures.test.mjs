// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const { createCaptureManager, STALE_MS } = createRequire(import.meta.url)("../captures.cjs");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "pulplog-capture-"));
const owner = () => Object.assign(new EventEmitter(), { isDestroyed: () => false });

/* fake stream: the test drives it through the sender the manager hands over */
function fakeStreams() {
  const started = [];
  const stopped = [];
  return {
    started, stopped,
    startStream: (kind, event, payload) => { started.push({ kind, sender: event.sender, payload }); },
    stopStream: (kind, streamId) => { stopped.push(streamId); },
  };
}

test("writes the initial history, resolves once it settles, and deletes the file on stop", async () => {
  const dir = tmpDir();
  const streams = fakeStreams();
  const manager = createCaptureManager({ dir, ...streams, settleMs: 30, maxWaitMs: 2000 });
  const pending = manager.start({ captureId: "c1", kind: "docker", payload: { source: { id: "db" } }, owner: owner() });
  await new Promise(r => setTimeout(r, 5));
  const { sender, payload } = streams.started[0];
  sender.send("docker:spawned", payload.streamId);
  sender.send("docker:lines", payload.streamId, "line 1\nline 2");
  sender.send("docker:lines", "someone-else", "ignored");
  const { filePath, error } = await pending;
  assert.equal(error, null);
  assert.equal(fs.readFileSync(filePath, "utf8"), "line 1\nline 2\n");
  sender.send("docker:lines", payload.streamId, "line 3");
  assert.match(fs.readFileSync(filePath, "utf8"), /line 3\n$/);
  assert.equal(manager.stop("c1"), true);
  assert.equal(fs.existsSync(filePath), false);
  assert.deepEqual(streams.stopped, [payload.streamId]);
});

test("empties the file when it passes the size cap and keeps writing", async () => {
  const dir = tmpDir();
  const streams = fakeStreams();
  const manager = createCaptureManager({ dir, ...streams, maxBytes: 20, settleMs: 10, maxWaitMs: 200 });
  const pending = manager.start({ captureId: "c2", kind: "docker", payload: {}, owner: owner() });
  await new Promise(r => setTimeout(r, 5));
  const { sender, payload } = streams.started[0];
  sender.send("docker:lines", payload.streamId, "0123456789");
  sender.send("docker:lines", payload.streamId, "abcdefghij");
  const { filePath } = await pending;
  assert.equal(fs.readFileSync(filePath, "utf8"), "abcdefghij\n");
  manager.stopAll();
});

test("reports an error that happened before any line", async () => {
  const dir = tmpDir();
  const streams = fakeStreams();
  const manager = createCaptureManager({ dir, ...streams, settleMs: 10, maxWaitMs: 500 });
  const pending = manager.start({ captureId: "c3", kind: "docker", payload: {}, owner: owner() });
  await new Promise(r => setTimeout(r, 5));
  const { sender, payload } = streams.started[0];
  sender.send("docker:error", payload.streamId, "No such container: db");
  const { error } = await pending;
  assert.equal(error, "No such container: db");
  manager.stopAll();
});

test("stops captures when their window goes away and only the owner can stop them", async () => {
  const dir = tmpDir();
  const streams = fakeStreams();
  const manager = createCaptureManager({ dir, ...streams, settleMs: 5, maxWaitMs: 50 });
  const win = owner();
  await manager.start({ captureId: "c4", kind: "remote", payload: {}, owner: win });
  assert.equal(manager.stop("c4", owner()), false);
  win.emit("destroyed");
  assert.equal(manager.size, 0);
});

test("sweeps only stale capture files", () => {
  const dir = tmpDir();
  const old = path.join(dir, "old.log");
  const fresh = path.join(dir, "fresh.log");
  fs.writeFileSync(old, "x");
  fs.writeFileSync(fresh, "x");
  const past = (Date.now() - STALE_MS - 60_000) / 1000;
  fs.utimesSync(old, past, past);
  const manager = createCaptureManager({ dir, ...fakeStreams() });
  assert.equal(manager.sweepStale(), 1);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
});
