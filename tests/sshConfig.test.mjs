// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseSshConfig, serializeServersExport, parseServersExport } = require("../sshConfig.cjs");

const CONFIG = `
# comment
Host *
  User nobody
  ServerAliveInterval 30

Host prod-api api   # two aliases
  HostName 10.0.3.12
  User deploy
  Port 2222
  IdentityFile "~/.ssh/id prod"
  ProxyJump diego@bastion.empresa.com

Host bastion
  HostName=bastion.empresa.com
  user diego
  User ignored-second-value

Match host foo
  User matched

Host *.internal !secret -evil
  User x
`;

test("parses concrete Host blocks with their main options", () => {
  const entries = parseSshConfig(CONFIG);
  assert.deepEqual(entries.map(e => e.alias), ["prod-api", "api", "bastion"]);
  assert.deepEqual(entries[0], { alias:"prod-api", hostName:"10.0.3.12", user:"deploy", port:"2222",
    identityFile:"~/.ssh/id prod", proxyJump:"diego@bastion.empresa.com" });
  assert.equal(entries[1].hostName, "10.0.3.12", "both aliases share the block");
  assert.equal(entries[2].hostName, "bastion.empresa.com", "Key=value syntax");
  assert.equal(entries[2].user, "diego", "first value wins");
});

test("export drops secrets, vault ids and status; import validates the format", () => {
  const text = serializeServersExport(
    [{ id:"s1", name:"API", vaultCredentialId:"v1", lastStatus:{ ok:true }, password:"pw",
       jumps:[{ host:"b", password:"hop", vaultCredentialId:"v2" }] }],
    [{ id:"l1", serverId:"s1", filePath:"/x", sudoPassword:"root" }, { id:"orphan", serverId:"zz" }]);
  for (const secret of ["pw", "hop", "v1", "v2", "root", "lastStatus"]) assert.ok(!text.includes(`"${secret}"`) && !text.includes(`${secret}"`), secret);
  const back = parseServersExport(text);
  assert.equal(back.servers[0].name, "API");
  assert.deepEqual(back.logs.map(l => l.id), ["l1"]);
  assert.throws(() => parseServersExport("{}"), /No es un archivo/);
  assert.throws(() => parseServersExport("nope"), /JSON/);
});
