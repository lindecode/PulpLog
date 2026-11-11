// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vaultModule from "../credentialVault.cjs";

const { createCredentialVault } = vaultModule;
const master = "correct horse battery staple";
const fixture = t => {
  const dir = mkdtempSync(join(tmpdir(), "pulplog-vault-"));
  t.after(() => rmSync(dir, { recursive:true, force:true }));
  const filename = join(dir, "vault.json");
  return { filename, vault:createCredentialVault({ filename }) };
};

test("encrypts, locks and unlocks SSH credentials", async t => {
  const { filename, vault } = fixture(t);
  await vault.create(master);
  const entry = await vault.save({ label:"Prod", target:"prod.test", username:"dev", secret:"server-secret" });
  assert.doesNotMatch(readFileSync(filename, "utf8"), /server-secret|correct horse/);
  assert.equal(await vault.getSecret(entry.id, { target:"prod.test", username:"dev" }), "server-secret");
  await vault.lock();
  await assert.rejects(vault.getSecret(entry.id, { target:"prod.test", username:"dev" }), /bloqueada/);
  await assert.rejects(vault.unlock("this is the wrong password"), /incorrecta/);
  await vault.unlock(master);
  assert.equal(await vault.getSecret(entry.id, { target:"prod.test", username:"dev" }), "server-secret");
  await assert.rejects(vault.getSecret(entry.id, { target:"other.test", username:"dev" }), /no corresponde/);
});

test("forgot-password reset deletes the vault irreversibly", async t => {
  const { filename, vault } = fixture(t);
  await vault.create(master);
  await vault.save({ label:"Prod", secret:"server-secret" });
  await vault.reset();
  assert.equal((await vault.state()).configured, false);
  assert.throws(() => readFileSync(filename), /ENOENT/);
});
