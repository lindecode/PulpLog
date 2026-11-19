// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { parseJumpHosts, validateProxyJump, buildJumpConfig, buildSshArgs } = createRequire(import.meta.url)("../sshInvocation.cjs");

test("parseJumpHosts extracts the host of every hop", () => {
  assert.deepEqual(parseJumpHosts("bastion"), ["bastion"]);
  assert.deepEqual(parseJumpHosts("diego@bastion.empresa.com:2222,deploy@10.0.3.12"), ["bastion.empresa.com", "10.0.3.12"]);
  assert.deepEqual(parseJumpHosts("[fe80::1]:22,ssh://u@h:22"), ["fe80::1", "h"]);
  assert.deepEqual(parseJumpHosts(""), []);
});

test("validateProxyJump rejects options, spaces, wildcards and shell/config metacharacters", () => {
  assert.equal(validateProxyJump(" bastion "), "bastion");
  for (const bad of ["-oProxyCommand=x", "a b", "a,,b", "host*", "a;b", 'a"b', "a`b", "$(x)", "a\\b"]) {
    assert.throws(() => validateProxyJump(bad), /intermedio/, bad);
  }
});

test("buildJumpConfig gives every jump host the session options, then includes the user's config", () => {
  const text = buildJumpConfig(["bastion", "inner", "bastion"], { includes: ["C:/Users/x/.ssh/config"] });
  assert.equal(text.match(/^Host bastion$/gm).length, 1);
  assert.match(text, /^Host inner\n {2}BatchMode yes\n {2}ConnectTimeout 10\n {2}StrictHostKeyChecking accept-new\n {2}ServerAliveInterval 15\n {2}ServerAliveCountMax 3$/m);
  assert.match(text, /Match all\n {2}Include "C:\/Users\/x\/\.ssh\/config"\n$/);
  // our blocks come first: in ssh_config the first value obtained wins
  assert.ok(text.indexOf("Host bastion") < text.indexOf("Include"));
});

test("buildSshArgs: same base options everywhere, keepalive for streams, -F only with jumps", () => {
  assert.deepEqual(buildSshArgs({}), ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"]);
  const stream = buildSshArgs({ port: "2222", identityFile: "k", proxyJump: "bastion" }, { keepalive: true, jumpConfigFile: "/tmp/j.conf" });
  assert.deepEqual(stream.slice(6), ["-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-p", "2222", "-i", "k", "-o", "IdentitiesOnly=yes", "-F", "/tmp/j.conf", "-J", "bastion"]);
  assert.ok(!buildSshArgs({ proxyJump: "" }).includes("-F"));
  // a command-only chain has no -J but still needs its config (ProxyCommand)
  assert.deepEqual(buildSshArgs({ proxyJump: "" }, { jumpConfigFile: "/tmp/j.conf" }).slice(-2), ["-F", "/tmp/j.conf"]);
  assert.throws(() => buildSshArgs({ proxyJump: "-oProxyCommand=calc" }), /intermedio/);
});

test("interactive mode drops BatchMode and limits password prompts", () => {
  const args = buildSshArgs({}, { interactive: true });
  assert.ok(!args.includes("BatchMode=yes"));
  assert.ok(args.includes("NumberOfPasswordPrompts=1"));
  assert.ok(args.includes("StrictHostKeyChecking=accept-new"));
});

test("interactive jump blocks let the jump host ask too", () => {
  const text = buildJumpConfig(["bastion"], { interactive: true });
  assert.match(text, /Host bastion\n {2}BatchMode no\n/);
  assert.match(text, /NumberOfPasswordPrompts 1/);
});

const { normalizeHop, parseHopSpec, jumpsFromConfig, chainPlan, buildChainConfig } = createRequire(import.meta.url)("../sshInvocation.cjs");

test("hops are validated; a command hop only as the first one", () => {
  assert.deepEqual(normalizeHop({ host: "bastion", user: "diego", port: "2222" }, 0),
    { type: "tunnel", host: "bastion", user: "diego", port: "2222", identityFile: "" });
  assert.deepEqual(normalizeHop({ type: "command", command: "aws ssm start-session --target %h" }, 0),
    { type: "command", command: "aws ssm start-session --target %h" });
  assert.throws(() => normalizeHop({ type: "command", command: "x" }, 1), /solo el primer salto/);
  for (const bad of [{ host: "-oProxyCommand=x" }, { host: "a b" }, { host: "h;rm" }, { host: "h", user: "a b" }, { host: "h", port: "99999" }])
    assert.throws(() => normalizeHop(bad, 0), /inválido/, JSON.stringify(bad));
  assert.throws(() => normalizeHop({ type: "command", command: "a\nb" }, 0), /inválido/);
  // secrets ride along in memory only when present
  assert.equal(normalizeHop({ host: "h", password: "p" }, 0).password, "p");
});

test("old text ProxyJump becomes structured hops", () => {
  assert.deepEqual(jumpsFromConfig({ proxyJump: "diego@bastion:2222,[fe80::1]:22" }), [
    { type: "tunnel", host: "bastion", user: "diego", port: "2222", identityFile: "" },
    { type: "tunnel", host: "[fe80::1]", user: "", port: "22", identityFile: "" },
  ]);
  assert.deepEqual(jumpsFromConfig({}), []);
  assert.deepEqual(parseHopSpec("ssh://u@h"), { host: "h", user: "u", port: "" });
  // jumps win over the legacy text
  assert.equal(jumpsFromConfig({ jumps: [{ host: "new" }], proxyJump: "old" })[0].host, "new");
});

test("chain config: per-hop key, session options, and ProxyCommand on the host after a command hop", () => {
  const hops = jumpsFromConfig({ jumps: [
    { type: "command", command: "cloudflared access ssh --hostname %h" },
    { host: "bastion", user: "diego", identityFile: String.raw`C:\keys\bastion` },
    { host: "inner" },
  ] });
  const plan = chainPlan(hops, "prod-api");
  assert.equal(plan.jumpSpec, "diego@bastion,inner");
  const text = buildChainConfig(plan, { includes: ["C:/Users/x/.ssh/config"], destHost: "prod-api" });
  assert.match(text, /Host bastion\n {2}BatchMode yes\n(.|\n)*?IdentityFile "C:\/keys\/bastion"\n {2}IdentitiesOnly yes\n {2}ProxyCommand cloudflared access ssh --hostname %h\n/);
  assert.match(text, /Host inner\n {2}BatchMode yes/);
  assert.doesNotMatch(text, /Host prod-api/);
  // only a command hop: the ProxyCommand goes on the destination
  const direct = buildChainConfig(chainPlan(jumpsFromConfig({ jumps: [{ type: "command", command: "tsh proxy ssh %r@%h:%p" }] }), "db"), { destHost: "db" });
  assert.match(direct, /^Host db\n {2}ProxyCommand tsh proxy ssh %r@%h:%p$/m);
});

test("publicJumps keeps what may be stored and drops secrets and invalid hops", () => {
  const { publicJumps } = createRequire(import.meta.url)("../sshInvocation.cjs");
  assert.deepEqual(publicJumps([
    { host: "bastion", user: "diego", password: "secret", passphrase: "pp", vaultCredentialId: "v1" },
    { host: "bad host" },
    { type: "command", command: "aws ssm start-session --target %h", password: "x" },
  ]), [
    { type: "tunnel", host: "bastion", user: "diego", port: "", identityFile: "", vaultCredentialId: "v1" },
  ]);
  assert.deepEqual(publicJumps("nope"), []);
});
