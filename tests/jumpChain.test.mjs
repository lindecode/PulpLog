// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { legacyJumps, initialJumps, jumpsForConnection, chainSummary, chainProblem, emptyHop } from "../src/jumpChain.mjs";

test("legacy ProxyJump text becomes editable hops", () => {
  const hops = legacyJumps("diego@bastion:2222, inner ,[fe80::1]:22");
  assert.deepEqual(hops.map(h => [h.user, h.host, h.port]), [["diego", "bastion", "2222"], ["", "inner", ""], ["", "[fe80::1]", "22"]]);
  assert.deepEqual(initialJumps({ jumps: [{ host: "x" }], proxyJump: "old" }).map(h => h.host), ["x"]);
  assert.deepEqual(initialJumps({}), []);
});

test("jumpsForConnection drops empty rows and UI flags, keeps in-memory secrets", () => {
  const out = jumpsForConnection([
    { ...emptyHop(), host: " bastion ", user: "diego", password: "pw", rememberPassword: true },
    emptyHop(),
    { type: "command", command: "  aws ssm start-session --target %h " },
  ]);
  assert.deepEqual(out, [
    { type: "tunnel", host: "bastion", user: "diego", port: "", identityFile: "", password: "pw" },
    { type: "command", command: "aws ssm start-session --target %h" },
  ]);
});

test("summary and problems", () => {
  const hops = [{ type: "command", command: "cloudflared access ssh --hostname %h" }, { ...emptyHop(), host: "bastion", user: "diego" }];
  assert.equal(chainSummary(hops, "deploy@prod-api"), "Tu equipo → ⚙ cloudflared → diego@bastion → deploy@prod-api");
  assert.equal(chainProblem(hops), null);
  assert.equal(chainProblem([{ ...emptyHop(), host: "a" }, { type: "command", command: "x" }]), "command-first");
});
