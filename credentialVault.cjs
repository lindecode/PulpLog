// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const VERSION = 1;
const MAX_AUTH_FAILURES = 3;
const SCRYPT = { N:32768, r:8, p:1, maxmem:64 * 1024 * 1024 };
const b64 = value => Buffer.from(value).toString("base64");
const unb64 = value => Buffer.from(String(value || ""), "base64");
const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

function derive(password, salt, params = SCRYPT) {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024)
    return Promise.reject(new Error("La contraseña maestra debe tener al menos 12 caracteres"));
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 32, params,
    (error, key) => error ? reject(error) : resolve(key)));
}

function validatedKdf(value) {
  if (value?.name !== "scrypt" || value.N !== SCRYPT.N || value.r !== SCRYPT.r
    || value.p !== SCRYPT.p || value.maxmem !== SCRYPT.maxmem)
    throw new Error("Parámetros de bóveda no compatibles");
  return SCRYPT;
}

function encrypt(key, value, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { iv:b64(iv), tag:b64(cipher.getAuthTag()), data:b64(data) };
}

function decrypt(key, record, aad) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, unb64(record.iv));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(unb64(record.tag));
  return JSON.parse(Buffer.concat([decipher.update(unb64(record.data)), decipher.final()]).toString("utf8"));
}

function createCredentialVault({ filename }) {
  let dek = null;
  let queue = Promise.resolve();
  const read = async () => JSON.parse(await fs.promises.readFile(filename, "utf8"));
  const exists = async () => fs.promises.access(filename).then(() => true, () => false);
  const write = async data => {
    await fs.promises.mkdir(path.dirname(filename), { recursive:true });
    const temporary = `${filename}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(data, null, 2), { encoding:"utf8", mode:0o600 });
    await fs.promises.rename(temporary, filename);
  };
  const lockedUpdate = mutator => {
    const operation = queue.then(async () => {
      if (!dek) throw new Error("La bóveda está bloqueada");
      const data = await read();
      const result = await mutator(data);
      await write(data);
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  };
  const metadata = entry => ({
    id:entry.id, label:entry.label, kind:entry.kind, target:entry.target || "", username:entry.username || "",
    createdAt:entry.createdAt, updatedAt:entry.updatedAt,
    authFailures:Number.isInteger(entry.authFailures) ? Math.max(0, entry.authFailures) : 0,
    blocked:Boolean(entry.blockedAt), blockedAt:entry.blockedAt || "",
  });

  async function state() {
    await queue;
    const configured = await exists();
    let count = 0;
    if (configured && dek) count = (await read()).entries?.length || 0;
    return { configured, unlocked:Boolean(dek), count };
  }

  async function create(password) {
    await queue;
    if (await exists()) throw new Error("La bóveda ya existe");
    const salt = crypto.randomBytes(16);
    const kek = await derive(password, salt);
    const nextDek = crypto.randomBytes(32);
    try {
      const data = {
        version:VERSION,
        kdf:{ name:"scrypt", salt:b64(salt), N:SCRYPT.N, r:SCRYPT.r, p:SCRYPT.p, maxmem:SCRYPT.maxmem },
        wrappedKey:encrypt(kek, { dek:b64(nextDek), check:"PulpLog credential vault" }, "pulplog-vault-key-v1"),
        entries:[],
      };
      await write(data);
      dek = nextDek;
      return state();
    } finally { kek.fill(0); }
  }

  async function unlock(password) {
    await queue;
    const data = await read();
    if (data.version !== VERSION || data.kdf?.name !== "scrypt") throw new Error("Formato de bóveda no compatible");
    const kek = await derive(password, unb64(data.kdf.salt), validatedKdf(data.kdf));
    try {
      const payload = decrypt(kek, data.wrappedKey, "pulplog-vault-key-v1");
      if (payload.check !== "PulpLog credential vault") throw new Error();
      if (dek) dek.fill(0);
      dek = unb64(payload.dek);
      return state();
    } catch { throw new Error("Contraseña maestra incorrecta"); }
    finally { kek.fill(0); }
  }

  async function lock() {
    await queue;
    if (dek) dek.fill(0);
    dek = null;
    return state();
  }

  async function list() {
    if (!dek) throw new Error("La bóveda está bloqueada");
    await queue;
    return ((await read()).entries || []).map(metadata).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function save(input) {
    return lockedUpdate(data => {
      const requestedId = text(input?.id, 100);
      if (requestedId && !/^[A-Za-z0-9._-]+$/.test(requestedId)) throw new Error("Identificador de credencial inválido");
      const id = requestedId || crypto.randomUUID();
      const secret = typeof input?.secret === "string" ? input.secret.slice(0, 8192) : "";
      if (!secret) throw new Error("El secreto está vacío");
      const now = new Date().toISOString();
      const previous = data.entries.find(entry => entry.id === id);
      const kind = input?.kind === "ssh-passphrase" ? "ssh-passphrase" : "ssh-password";
      const target = text(input?.target, 255);
      const username = text(input?.username, 128);
      const entry = {
        id, label:text(input?.label, 120) || "SSH", kind, target, username,
        createdAt:previous?.createdAt || now, updatedAt:now,
        authFailures:0, blockedAt:"",
        encrypted:encrypt(dek, { secret, kind, target, username }, `pulplog-vault-entry-v1:${id}`),
      };
      data.entries = [...(data.entries || []).filter(item => item.id !== id), entry];
      return metadata(entry);
    });
  }

  function remove(id) {
    return lockedUpdate(data => {
      const before = data.entries.length;
      data.entries = data.entries.filter(entry => entry.id !== id);
      return data.entries.length !== before;
    });
  }

  async function getSecret(id, context = {}) {
    await queue;
    if (!dek) throw new Error("La bóveda está bloqueada; desbloquéala en Configuración");
    const entry = (await read()).entries.find(item => item.id === id);
    if (!entry) throw new Error("La credencial guardada ya no existe");
    if (entry.blockedAt || Number(entry.authFailures || 0) >= MAX_AUTH_FAILURES)
      throw new Error("La credencial está bloqueada después de 3 rechazos de autenticación. Actualiza la contraseña guardada en la bóveda.");
    const payload = decrypt(dek, entry.encrypted, `pulplog-vault-entry-v1:${entry.id}`);
    const target = text(context.target, 255);
    const username = text(context.username, 128);
    const kind = context.kind === "ssh-passphrase" ? "ssh-passphrase" : "ssh-password";
    if (payload.target !== entry.target || payload.username !== entry.username || payload.kind !== entry.kind
      || (target && payload.target !== target) || (username && payload.username !== username) || payload.kind !== kind)
      throw new Error("La credencial no corresponde a este host y usuario");
    return payload.secret;
  }

  function recordAuthFailure(id) {
    return lockedUpdate(data => {
      const entry = (data.entries || []).find(item => item.id === id);
      if (!entry) throw new Error("La credencial guardada ya no existe");
      if (!entry.blockedAt) {
        entry.authFailures = Math.min(MAX_AUTH_FAILURES, Number(entry.authFailures || 0) + 1);
        if (entry.authFailures >= MAX_AUTH_FAILURES) entry.blockedAt = new Date().toISOString();
      }
      return metadata(entry);
    });
  }

  function recordAuthSuccess(id) {
    return lockedUpdate(data => {
      const entry = (data.entries || []).find(item => item.id === id);
      if (!entry) return false;
      if (!entry.authFailures && !entry.blockedAt) return false;
      entry.authFailures = 0;
      entry.blockedAt = "";
      return true;
    });
  }

  async function reset() {
    await queue;
    if (dek) dek.fill(0);
    dek = null;
    await fs.promises.rm(filename, { force:true });
    return { configured:false, unlocked:false, count:0 };
  }

  return { state, create, unlock, lock, list, save, remove, getSecret, recordAuthFailure, recordAuthSuccess, reset };
}

module.exports = { createCredentialVault, MAX_AUTH_FAILURES };
