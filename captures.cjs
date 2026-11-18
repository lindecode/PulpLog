// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Captures: tee a container / remote log stream into a private temp file so the
// merged view can treat it like any local file (read everything, interleave by
// time, then tail). Invisible to the user: files live in the app's own data
// folder, are deleted when the capture stops or the app quits, and stale ones
// are swept on start-up. Content is written exactly as received.
const fs = require("fs");
const path = require("path");

const MAX_CAPTURE_BYTES = 200 * 1024 * 1024; // past this the file is emptied; the view keeps what it already has
const STALE_MS = 12 * 60 * 60 * 1000;
const SETTLE_MS = 700;       // initial history is considered done after this long without lines…
const MAX_WAIT_MS = 10000;   // …or after this long in any case
const RECONNECTABLE = /(timed? ?out|timeout|reset|closed|econn|network|socket|disconnect|terminated|terminó)/i;

function createCaptureManager({ dir, startStream, stopStream, log = () => {}, maxBytes = MAX_CAPTURE_BYTES,
  settleMs = SETTLE_MS, maxWaitMs = MAX_WAIT_MS, now = Date.now }) {
  const captures = new Map(); // captureId → capture

  function sweepStale(maxAgeMs = STALE_MS) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return 0; }
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith(".log")) continue;
      const file = path.join(dir, name);
      if ([...captures.values()].some(c => c.filePath === file)) continue;
      try {
        if (now() - fs.statSync(file).mtimeMs >= maxAgeMs) { fs.unlinkSync(file); removed++; }
      } catch { /* already gone */ }
    }
    return removed;
  }

  function write(capture, text) {
    if (capture.fd == null) return;
    const chunk = text.endsWith("\n") ? text : `${text}\n`;
    const size = Buffer.byteLength(chunk);
    try {
      if (capture.bytes + size > maxBytes) {
        // the file watcher sees the size drop, restarts at 0 and keeps streaming
        fs.truncateSync(capture.filePath, 0); // by path: ftruncate on an append fd fails on Windows
        capture.bytes = 0;
        log("WARN", "capture", `Captura ${capture.id} alcanzó el tope; se vació el temporal`);
      }
      fs.writeSync(capture.fd, chunk);
      capture.bytes += size;
    } catch (error) {
      log("ERROR", "capture", `No se pudo escribir la captura ${capture.id}: ${error.message}`);
    }
  }

  function connect(capture, payload) {
    const streamId = `capture-${capture.id}-${++capture.attempt}`;
    capture.streamId = streamId;
    const prefix = capture.kind === "docker" ? "docker" : "remote";
    const sender = {
      realSender: capture.owner,
      isDestroyed: () => capture.stopped || capture.owner.isDestroyed(),
      send(channel, id, data) {
        if (id !== streamId || capture.stopped) return;
        if (channel === `${prefix}:lines`) {
          capture.lastLineAt = now();
          capture.sawLines = true;
          write(capture, String(data));
        } else if (channel === `${prefix}:spawned`) {
          capture.spawned = true;
        } else if (channel === `${prefix}:progress`) {
          if (data?.percent >= 100) capture.historyDone = true;
        } else if (channel === `${prefix}:error`) {
          capture.error = String(data || "");
          onStreamClosed(capture, capture.error);
        } else if (channel === `${prefix}:end`) {
          onStreamClosed(capture, null);
        }
      },
    };
    Promise.resolve()
      .then(() => startStream(capture.kind, { sender }, { ...payload, streamId }))
      .catch(error => sender.send(`${prefix}:error`, streamId, error?.message || String(error)));
  }

  function onStreamClosed(capture, error) {
    capture.closed = true;
    if (capture.stopped) return;
    // remote connections drop; reconnect with only new lines (as the remote tab does)
    if (error && capture.kind === "remote" && RECONNECTABLE.test(error)) {
      const seconds = Math.min(30, 2 ** Math.min(capture.retries++, 5));
      log("WARN", "capture", `Captura ${capture.id}: ${error}; reintento en ${seconds}s`);
      capture.retryTimer = setTimeout(() => {
        if (capture.stopped) return;
        capture.closed = false;
        connect(capture, { ...capture.payload, resumeOnly: true });
      }, seconds * 1000);
    }
  }

  /* Resolves once the initial history has (probably) landed in the file. */
  function waitForHistory(capture) {
    const started = now();
    return new Promise(resolve => {
      const check = () => {
        if (capture.stopped) return resolve();
        const quiet = capture.sawLines ? now() - capture.lastLineAt >= settleMs : now() - started >= settleMs * 2;
        if (capture.historyDone || capture.closed || (capture.spawned || capture.sawLines) && quiet
            || now() - started >= maxWaitMs) return resolve();
        capture.waitTimer = setTimeout(check, 100);
      };
      check();
    });
  }

  async function start({ captureId, kind, payload, owner }) {
    if (captures.has(captureId)) throw new Error("Capture already active");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${captureId.replace(/[^a-zA-Z0-9_-]/g, "_")}.log`);
    fs.writeFileSync(filePath, "", { mode: 0o600 });
    const capture = {
      id: captureId, kind, payload, owner, filePath,
      // append mode: after emptying the file at the size cap, writes start again at 0
      fd: fs.openSync(filePath, "a", 0o600), bytes: 0,
      attempt: 0, retries: 0, stopped: false, closed: false,
      spawned: false, sawLines: false, historyDone: false, lastLineAt: 0, error: null,
    };
    captures.set(captureId, capture);
    capture.onOwnerGone = () => stop(captureId);
    owner.once?.("destroyed", capture.onOwnerGone);
    log("INFO", "capture", `Captura ${captureId} iniciada (${kind})`);
    connect(capture, payload);
    await waitForHistory(capture);
    // an error before any line means there is nothing to show: report it to the caller
    return { filePath, error: capture.sawLines ? null : capture.error };
  }

  function stop(captureId, owner = null) {
    const capture = captures.get(captureId);
    if (!capture || (owner && capture.owner !== owner)) return false;
    capture.stopped = true;
    captures.delete(captureId);
    clearTimeout(capture.retryTimer);
    clearTimeout(capture.waitTimer);
    capture.owner.removeListener?.("destroyed", capture.onOwnerGone);
    try { stopStream(capture.kind, capture.streamId); } catch { /* already stopped */ }
    try { fs.closeSync(capture.fd); } catch { /* already closed */ }
    capture.fd = null;
    try { fs.unlinkSync(capture.filePath); } catch { /* already gone */ }
    log("INFO", "capture", `Captura ${captureId} detenida`);
    return true;
  }

  function stopAll() {
    [...captures.keys()].forEach(id => stop(id));
  }

  return { start, stop, stopAll, sweepStale, get size() { return captures.size; } };
}

module.exports = { createCaptureManager, MAX_CAPTURE_BYTES, STALE_MS };
