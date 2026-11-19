// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { classifyPrompt, createAskpassBroker, askpassEnv, HELPER_SOURCE, windowsWrapper, wslWrapper } =
  createRequire(import.meta.url)("../askpass.cjs");

const pipeFor = name => process.platform === "win32"
  ? `\\\\.\\pipe\\pulplog-test-${name}-${process.pid}`
  : path.join(os.tmpdir(), `pulplog-test-${name}-${process.pid}.sock`);

test("classifyPrompt recognises OpenSSH prompts", () => {
  assert.deepEqual(classifyPrompt("deploy@prod-api's password: "), { kind: "password", user: "deploy", host: "prod-api", prompt: "deploy@prod-api's password: " });
  assert.equal(classifyPrompt("(diego@bastion.empresa.com) Password: ").host, "bastion.empresa.com");
  assert.equal(classifyPrompt("Password:").kind, "password");
  assert.equal(classifyPrompt("Enter passphrase for key 'C:\\Users\\x\\.ssh\\id_ed25519': ").kind, "passphrase");
  assert.equal(classifyPrompt("Are you sure you want to continue connecting (yes/no/[fingerprint])? ").kind, "hostkey");
  assert.equal(classifyPrompt("Verification code: ").kind, "other");
});

test("the saved password only goes to its own host, once", async () => {
  const asked = [];
  const broker = createAskpassBroker({ askUser: async req => { asked.push(req); return "123456"; } });
  const { token, dispose } = broker.register({ password: "s3cret", user: "deploy", host: "prod-api", hasJumps: true });
  // the jump host asks for ITS password: never give it the destination's secret
  assert.equal(await broker.answer({ token, prompt: "diego@bastion's password: " }), "123456");
  assert.equal(asked[0].host, "bastion");
  // the destination gets it
  assert.equal(await broker.answer({ token, prompt: "deploy@prod-api's password: " }), "s3cret");
  // asked again → it was rejected: stop instead of retrying
  assert.equal(await broker.answer({ token, prompt: "deploy@prod-api's password: " }), null);
  // a bare "Password:" with jumps is ambiguous → the user decides
  assert.equal(await broker.answer({ token, prompt: "Password:" }), "123456");
  dispose();
  assert.equal(await broker.answer({ token, prompt: "deploy@prod-api's password: " }), null, "disposed token");
});

test("host keys are never accepted automatically; 2FA goes to the user; unknown tokens get nothing", async () => {
  const broker = createAskpassBroker({ askUser: async req => (req.kind === "other" ? "654321" : "yes") });
  const { token } = broker.register({ password: "x", host: "h" });
  assert.equal(await broker.answer({ token, prompt: "Are you sure you want to continue connecting (yes/no)? " }), "no");
  assert.equal(await broker.answer({ token, prompt: "Verification code: " }), "654321");
  assert.equal(await broker.answer({ token: "forged", prompt: "Password:" }), null);
  assert.equal(await broker.answer({ token, prompt: "Password:" }), "x", "no jumps: a bare prompt is the destination's");
});

test("passphrase is given once", async () => {
  const broker = createAskpassBroker();
  const { token } = broker.register({ passphrase: "pp", host: "h" });
  const prompt = "Enter passphrase for key 'k': ";
  assert.equal(await broker.answer({ token, prompt }), "pp");
  assert.equal(await broker.answer({ token, prompt }), null);
});

test("end to end: the helper gets the answer through the pipe and prints it", async () => {
  const pipePath = pipeFor("e2e");
  const broker = createAskpassBroker({ pipePath });
  await broker.start();
  const { token } = broker.register({ password: "pa$$ 'w\"ord", user: "deploy", host: "prod-api" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulplog-askpass-"));
  const helper = path.join(dir, "askpass-helper.cjs");
  fs.writeFileSync(helper, HELPER_SOURCE);
  const run = (prompt, envToken = token) => new Promise(resolve => {
    const child = spawn(process.execPath, [helper, prompt], {
      env: { ...process.env, PULPLOG_ASKPASS_PIPE: pipePath, PULPLOG_ASKPASS_TOKEN: envToken },
    });
    let out = "";
    child.stdout.on("data", d => { out += d; });
    child.on("close", code => resolve({ code, out }));
  });
  assert.deepEqual(await run("deploy@prod-api's password: "), { code: 0, out: "pa$$ 'w\"ord\n" });
  assert.equal((await run("deploy@prod-api's password: ")).code, 1, "rejected secret is not re-sent");
  assert.equal((await run("Password:", "bad-token")).code, 1);
  broker.close();
  // without the env the helper refuses
  assert.equal(spawnSync(process.execPath, [helper, "x"], { env: {} }).status, 1);
});

test("env and wrappers", () => {
  const win = askpassEnv({ askpassPath: "C:\\a\\askpass.cmd", pipePath: "\\\\.\\pipe\\p", token: "t", baseEnv: { PATH: "x" } });
  assert.equal(win.SSH_ASKPASS_REQUIRE, "force");
  assert.equal(win.PATH, "x");
  assert.equal(win.WSLENV, undefined);
  const wsl = askpassEnv({ askpassPath: "C:\\a\\askpass.sh", pipePath: "p", token: "t", viaWsl: true, baseEnv: { WSLENV: "FOO/u" } });
  assert.equal(wsl.WSLENV, "FOO/u:SSH_ASKPASS/p:SSH_ASKPASS_REQUIRE:DISPLAY:ELECTRON_RUN_AS_NODE:PULPLOG_ASKPASS_PIPE:PULPLOG_ASKPASS_TOKEN");
  assert.equal(windowsWrapper("C:\\P\\PulpLog.exe", "C:\\d\\h.cjs"), '@echo off\r\n"C:\\P\\PulpLog.exe" "C:\\d\\h.cjs" %*\r\n');
  assert.match(wslWrapper("/mnt/c/P/Pulp'Log.exe", "C:\\d\\h.cjs"), /exec '\/mnt\/c\/P\/Pulp'\\''Log\.exe' 'C:\\d\\h\.cjs' "\$@"/);
});

test("each jump host gets its own password and each key its own passphrase", async () => {
  const asked = [];
  const broker = createAskpassBroker({ askUser: async req => { asked.push(req.prompt); return null; } });
  const { token, session } = broker.register({
    password: "dest-pw", user: "deploy", host: "prod-api", identityFile: "C:/keys/dest",
    passphrase: "dest-pp",
    hops: [
      { host: "bastion", user: "diego", password: "bastion-pw", identityFile: String.raw`C:\keys\bastion`, passphrase: "bastion-pp" },
      { host: "inner", user: "ops" },
    ],
  });
  assert.equal(await broker.answer({ token, prompt: "diego@bastion's password: " }), "bastion-pw");
  assert.equal(await broker.answer({ token, prompt: "deploy@prod-api's password: " }), "dest-pw");
  // a hop without a saved password → the user is asked; never another host's secret
  assert.equal(await broker.answer({ token, prompt: "ops@inner's password: " }), null);
  assert.deepEqual(asked, ["ops@inner's password: "]);
  // passphrases by key path (slashes and case don't matter)
  assert.equal(await broker.answer({ token, prompt: "Enter passphrase for key 'c:/KEYS/bastion': " }), "bastion-pp");
  assert.equal(await broker.answer({ token, prompt: "Enter passphrase for key 'C:/keys/dest': " }), "dest-pp");
  // asked again for the bastion password → refused, not re-sent
  assert.equal(await broker.answer({ token, prompt: "diego@bastion's password: " }), null);
  assert.equal(session.rejected, true);
});

test("a key that belongs to a hop without passphrase never gets the destination's passphrase", async () => {
  const broker = createAskpassBroker({ askUser: async () => "typed" });
  const { token } = broker.register({ passphrase: "dest-pp", host: "d", hops: [{ host: "b", identityFile: "/k/b" }] });
  assert.equal(await broker.answer({ token, prompt: "Enter passphrase for key '/k/b': " }), "typed");
  assert.equal(await broker.answer({ token, prompt: "Enter passphrase for key '/k/other': " }), "dest-pp");
});

test("truncated key paths (OpenSSH for Windows cuts long prompts): prefix if unique, otherwise ask", async () => {
  const asked = [];
  const broker = createAskpassBroker({ askUser: async req => { asked.push(req.prompt); return "typed"; } });
  const dir = "C:/Users/someone/AppData/Local/Temp/very/long/folder/with/many/levels/keys";
  const { token } = broker.register({ host: "d", identityFile: `${dir}/dest_key`, passphrase: "dest-pp",
    hops: [{ host: "b", identityFile: `${dir}/hop_key`, passphrase: "hop-pp" }] });
  // unique prefix
  assert.equal(await broker.answer({ token, prompt: `Enter passphrase for key '${dir}/hop_k': ` }), "hop-pp");
  // ambiguous prefix (both keys live there) → the user decides, no secret guessed
  assert.equal(await broker.answer({ token, prompt: `Enter passphrase for key '${dir}/': ` }), "typed");
  // a key nobody declared while the destination declares its own → ask
  assert.equal(await broker.answer({ token, prompt: "Enter passphrase for key 'C:/elsewhere/k': " }), "typed");
  assert.equal(asked.length, 2);
});
