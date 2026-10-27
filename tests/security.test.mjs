// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import { redactSecrets } from "../src/redaction.mjs";
import { cacheFile, getCachedFile } from "../src/utils.mjs";
const require = createRequire(import.meta.url);
const { isTrustedSender, assertStreamOwner } = require("../ipcSecurity.cjs");
const { createLineDecoder, MAX_LINE_CHARS } = require("../streamLimits.cjs");
const { authHeaders } = require("../aiCredentials.cjs");

test("redacts JSON values, escaped secrets, auth headers and connection strings", () => {
  const json = '{"password":"secret-value","api_key":"api-value","token":"escaped\\\"value"}';
  const sanitized = JSON.parse(redactSecrets(json));
  assert.deepEqual(sanitized, { password:"[REDACTED]", api_key:"[REDACTED]", token:"[REDACTED]" });
  for (const input of ['password=secret-value', 'Authorization: Basic dGVzdDpzZWNyZXQ=', 'postgres://user:secret-value@host/db']) {
    const redacted = redactSecrets(input);
    assert.doesNotMatch(redacted, /secret-value|dGVzdDpzZWNyZXQ=/);
  }
  assert.doesNotMatch(redactSecrets('Filter: password=secret-value\nSearch: {"api_key":"api-value"}'), /secret-value|api-value/);
  const oauth = JSON.parse(redactSecrets('{"access_token":"value-1","refreshToken":"value-2","client_secret":"value-3"}'));
  assert.deepEqual(Object.values(oauth), ["[REDACTED]", "[REDACTED]", "[REDACTED]"]);
});

test("only registered application main frames may invoke IPC", () => {
  const url = "file:///app/dist/index.html";
  const frame = { url };
  const sender = { mainFrame:frame, isDestroyed:() => false };
  const allowed = new WeakSet([sender]);
  assert.equal(isTrustedSender({ sender, senderFrame:frame }, allowed, url), true);
  assert.equal(isTrustedSender({ sender, senderFrame:{ url } }, allowed, url), false);
  frame.url = "file:///app/other.html";
  assert.equal(isTrustedSender({ sender, senderFrame:frame }, allowed, url), false);
  frame.url = url;
  assert.equal(isTrustedSender({ sender, senderFrame:frame }, new WeakSet(), url), false);
  assert.throws(() => assertStreamOwner({ sender }, {}), /another window/);
  assert.doesNotThrow(() => assertStreamOwner({ sender }, sender));
});

test("bounds unterminated and complete log lines while preserving UTF-8 chunks", () => {
  const reader = createLineDecoder();
  const bytes = Buffer.from("INFO ñ\nsecond");
  const lines = [];
  for (const byte of bytes) lines.push(...reader.write(Buffer.from([byte])));
  assert.deepEqual(lines, ["INFO ñ"]);
  assert.equal(reader.end(), "second");
  const malicious = createLineDecoder();
  malicious.write(Buffer.alloc(MAX_LINE_CHARS, 97));
  assert.throws(() => malicious.write(Buffer.from("x")), /256K/);
  assert.throws(() => createLineDecoder().write(Buffer.alloc(MAX_LINE_CHARS + 1, 97)), /256K/);
});

test("requires HTTPS for API keys except on loopback", () => {
  for (const url of ["http://remote.invalid/v1", "http://192.168.1.10", "http://localhost.attacker.invalid"])
    assert.throws(() => authHeaders("test-key", url), /require HTTPS/);
  for (const url of ["https://remote.invalid/v1", "http://127.0.0.1:8000", "http://localhost:11434", "http://[::1]:8000"])
    assert.equal(authHeaders("test-key", url).Authorization, "Bearer test-key");
  assert.deepEqual(authHeaders("", "http://remote.invalid"), {});
});

test("compressed file cache accounts for decoded text size", () => {
  const stat = { size:100, mtime:1 };
  cacheFile("large-test.log.gz", stat, [{ raw:"a".repeat(33 * 1024 * 1024) }], {});
  assert.equal(getCachedFile("large-test.log.gz", stat), null);
  cacheFile("small-test.log.gz", stat, [{ raw:"INFO ready" }], {});
  assert.equal(getCachedFile("small-test.log.gz", stat).items[0].raw, "INFO ready");
  assert.equal(getCachedFile("small-test.log.gz", null), null);
});

test("SFTP operation deadline closes a server that never finishes readdir", async () => {
  const source = readFileSync(new URL("../main.js", import.meta.url), "utf8");
  const start = source.indexOf("function listNativeRemoteDirectory(");
  const end = source.indexOf("function startNativeSshStream(", start);
  let expire;
  let closed = false;
  let timerCleared = false;
  class Client extends EventEmitter {
    connect() { this.emit("ready"); }
    sftp(callback) { callback(null, { realpath:(_path, cb) => cb(null, "/logs"), readdir() {} }); }
    end() { closed = true; this.emit("end"); }
  }
  const list = vm.runInNewContext(`(${source.slice(start, end)})`, {
    SshClient:Client, validateRemoteDirectoryPath:() => "/logs", normalizeFingerprint:value => value,
    validateSshTarget:() => ({ host:"test", username:"user", port:22, identityFile:"" }),
    setTimeout:callback => { expire = callback; return 1; }, clearTimeout:() => { timerCleared = true; },
    mt:() => "SSH request timed out",
  });
  const request = list({ password:"test", fingerprint:"test-hash", trustHostForSession:true });
  expire();
  await assert.rejects(request, /timed out/);
  assert.equal(closed, true);
  assert.equal(timerCleared, true);
});
