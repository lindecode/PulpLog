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
  assert.ok(!buildSshArgs({ proxyJump: "" }, { jumpConfigFile: "/tmp/j.conf" }).includes("-F"));
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
