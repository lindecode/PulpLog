// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const { createCredentialStore, authHeaders, redactError } = createRequire(import.meta.url)("../aiCredentials.cjs");

function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pulplog-keys-"));
  t.after(() => rmSync(directory, { recursive:true, force:true }));
  const filename = join(directory, "credentials.json");
  const cipherKey = randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable:() => true,
    getSelectedStorageBackend:() => "gnome_libsecret",
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", cipherKey, iv);
      const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const cipher = createDecipheriv("aes-256-gcm", cipherKey, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString();
    },
    ...overrides,
  };
  const create = () => createCredentialStore({ filename, safeStorage, platform:"linux" });
  return { filename, store:create(), create };
}

test("persists encrypted credentials without returning keys to settings", async t => {
  const { filename, store, create } = fixture(t);
  const state = await store.set("ollama", "https://server/ollama", "test-key-secret", true);
  assert.equal(state.persisted, true);
  assert.doesNotMatch(JSON.stringify(state), /test-key-secret/);
  assert.doesNotMatch(readFileSync(filename, "utf8"), /test-key-secret/);
  assert.equal(await create().get("ollama", "https://server/ollama"), "test-key-secret");
  assert.equal(await store.get("ollama", "https://different/ollama"), "");
  assert.equal(await store.get("vllm", "https://server/ollama"), "");
});

test("does not persist keys on Linux basic_text or unavailable encryption", async t => {
  for (const overrides of [{ getSelectedStorageBackend:() => "basic_text" }, { isEncryptionAvailable:() => false }]) {
    const { filename, store, create } = fixture(t, overrides);
    const state = await store.set("vllm", "https://server/v1", "session-secret", true);
    assert.equal(state.persisted, false);
    assert.equal(state.canPersist, false);
    assert.equal(await store.get("vllm", "https://server/v1"), "session-secret");
    assert.equal(existsSync(filename), false);
    assert.equal(await create().get("vllm", "https://server/v1"), "");
  }
});

test("falls back to session storage when encryption fails", async t => {
  const { store, filename } = fixture(t, { encryptString() { throw new Error("Locked keyring"); } });
  assert.equal((await store.set("ollama", "http://localhost", "temporary", true)).persisted, false);
  assert.equal(await store.get("ollama", "http://localhost"), "temporary");
  assert.equal(existsSync(filename), false);
});

test("removes persisted keys and supports explicit session-only replacement", async t => {
  const { store, create } = fixture(t);
  await store.set("vllm", "https://server/v1", "old-secret", true);
  await store.set("vllm", "https://server/v1", "new-secret", false);
  assert.equal(await store.get("vllm", "https://server/v1"), "new-secret");
  assert.equal(await create().get("vllm", "https://server/v1"), "");
  assert.equal((await store.set("vllm", "https://server/v1", "", false)).configured, false);
  assert.equal(await store.get("vllm", "https://server/v1"), "");
});

test("does not forward encrypted credentials if endpoint metadata is tampered with", async t => {
  const { filename, store, create } = fixture(t);
  await store.set("ollama", "https://original", "secret", true);
  const data = JSON.parse(readFileSync(filename, "utf8"));
  data.ollama.url = "https://different";
  writeFileSync(filename, JSON.stringify(data));
  await assert.rejects(create().get("ollama", "https://different"), /credential unavailable/);
});

test("rejects header injection and redacts raw and encoded keys in errors", () => {
  assert.throws(() => authHeaders("secret\r\nInjected: yes"), /Invalid API key/);
  assert.deepEqual(authHeaders(""), {});
  assert.deepEqual(authHeaders("test-key"), { Authorization:"Bearer test-key" });
  assert.equal(redactError("Rejected test+key and test%2Bkey", "test+key"), "Rejected [REDACTED] and [REDACTED]");
});
