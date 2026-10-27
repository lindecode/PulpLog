// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
const fs = require("fs");
const path = require("path");

function validateKey(value) {
  if (typeof value !== "string" || value.length > 8192 || (value && /[^\x21-\x7e]/.test(value)))
    throw new Error("Invalid API key");
  return value;
}

function redactError(value, key) {
  let text = String(value || "");
  if (key) {
    for (const secret of [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)])
      text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/(authorization\s*[:=]\s*bearer\s+)\S+/gi, "$1[REDACTED]");
}

function authHeaders(key) {
  return key ? { Authorization:`Bearer ${validateKey(key)}` } : {};
}

function createCredentialStore({ filename, safeStorage, platform = process.platform }) {
  const session = new Map();
  let queue = Promise.resolve();
  const canPersist = () => {
    try {
      return safeStorage.isEncryptionAvailable() && (platform !== "linux"
        || ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(safeStorage.getSelectedStorageBackend()));
    } catch { return false; }
  };
  const read = async () => {
    try { return JSON.parse(await fs.promises.readFile(filename, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return {}; throw new Error("Cannot read AI credentials"); }
  };
  const validate = provider => {
    if (!["ollama", "vllm"].includes(provider)) throw new Error("Invalid AI provider");
  };
  const get = async (provider, url) => {
    validate(provider);
    await queue;
    const temporary = session.get(provider);
    if (temporary) return temporary.url === url ? temporary.key : "";
    const record = (await read())[provider];
    if (!record || record.url !== url) return "";
    try {
      if (!canPersist()) throw new Error();
      const decoded = JSON.parse(safeStorage.decryptString(Buffer.from(record.encrypted, "base64")));
      if (decoded.url !== url || decoded.provider !== provider) throw new Error();
      return validateKey(decoded.key);
    } catch { throw new Error("AI credential unavailable; enter it again"); }
  };
  const state = async (provider, url) => {
    validate(provider);
    await queue;
    const temporary = session.get(provider);
    const record = temporary || (await read())[provider];
    return { configured:Boolean(record && record.url === url), persisted:Boolean(!temporary && record && record.url === url), canPersist:canPersist() };
  };
  const set = (provider, url, key, remember) => {
    validate(provider); validateKey(key);
    const operation = queue.then(async () => {
      const records = await read();
      const hadRecord = Boolean(records[provider]);
      delete records[provider];
      let persist = Boolean(key && remember && canPersist());
      if (persist) {
        // Bind the endpoint inside the encrypted payload as well as in metadata.
        try { records[provider] = { url, encrypted:safeStorage.encryptString(JSON.stringify({ provider, url, key })).toString("base64") }; }
        catch { persist = false; }
      }
      if (persist || hadRecord) {
        await fs.promises.mkdir(path.dirname(filename), { recursive:true });
        const temporary = `${filename}.${process.pid}.tmp`;
        await fs.promises.writeFile(temporary, JSON.stringify(records), { mode:0o600 });
        await fs.promises.rename(temporary, filename);
      }
      session.delete(provider);
      if (key && !persist) session.set(provider, { url, key });
    });
    queue = operation.catch(() => {});
    return operation.then(() => state(provider, url));
  };
  return { get, state, set };
}

module.exports = { authHeaders, redactError, validateKey, createCredentialStore };
