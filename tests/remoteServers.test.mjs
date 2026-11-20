// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { migrateRemote, resolveLog, groupServers, saveServerAndLog, deleteServer, recordServerStatus,
  serverKey, envColor, logDisplayName } from "../src/remoteServers.mjs";

const prof = (id, extra = {}) => ({ id, name:id, mode:"ssh", target:"prod-api", user:"deploy", port:"", identityFile:"",
  jumps:[{ type:"tunnel", host:"bastion", user:"diego", port:"", identityFile:"" }], filePath:`/var/log/${id}.log`, source:"file", ...extra });

test("migration groups profiles with the same connection into one server", () => {
  const { servers, profiles, changed } = migrateRemote({ profiles:[
    prof("app"), prof("nginx", { vaultCredentialId:"v1" }), prof("other", { target:"staging-api" }),
    { id:"w", mode:"wsl", distro:"Ubuntu", filePath:"/var/log/syslog" },
  ] });
  assert.equal(changed, true);
  assert.equal(servers.length, 2);
  assert.equal(profiles[0].serverId, profiles[1].serverId);
  assert.notEqual(profiles[0].serverId, profiles[2].serverId);
  assert.equal(profiles[3].serverId, undefined);
  assert.equal(servers.find(s => s.id === profiles[0].serverId).vaultCredentialId, "v1");
  assert.equal(servers[0].name, "deploy@prod-api");
  // second run is stable
  assert.equal(migrateRemote({ servers, profiles }).changed, false);
});

test("different jumps, ports or WSL distros mean different servers", () => {
  const a = prof("a");
  assert.notEqual(serverKey(a), serverKey({ ...a, jumps:[] }));
  assert.notEqual(serverKey(a), serverKey({ ...a, port:"2222" }));
  assert.notEqual(serverKey({ ...a, mode:"ssh-wsl", distro:"Ubuntu" }), serverKey({ ...a, mode:"ssh-wsl", distro:"Debian" }));
  assert.equal(serverKey({ ...a, mode:"ssh", distro:"Ubuntu" }), serverKey(a), "distro only matters for ssh-wsl");
  assert.equal(serverKey({ ...a, target:"PROD-API " }), serverKey(a));
});

test("resolveLog puts the server connection over the log and adds env/name", () => {
  const log = prof("app", { target:"stale", serverId:"s1" });
  const out = resolveLog(log, { id:"s1", name:"API prod", env:"prod", mode:"ssh", target:"prod-api.new", user:"deploy", jumps:[] });
  assert.equal(out.target, "prod-api.new");
  assert.deepEqual(out.jumps, []);
  assert.equal(out.filePath, "/var/log/app.log");
  assert.equal(out.env, "prod");
  assert.equal(out.serverName, "API prod");
});

test("saveServerAndLog never stores secrets and reuses the server", () => {
  const config = { ...prof("x"), id:undefined, name:undefined, password:"pw", passphrase:"pp", trustHostForSession:true,
    jumps:[{ type:"tunnel", host:"bastion", user:"diego", password:"hop", rememberPassword:true }] };
  const first = saveServerAndLog({ servers:[], profiles:[] }, config, { serverName:"API", env:"prod", logName:"app" });
  assert.equal(first.servers.length, 1);
  const stored = JSON.stringify(first);
  assert.ok(!stored.includes("\"pw\"") && !stored.includes("\"pp\"") && !stored.includes("\"hop\""), stored);
  assert.ok(!stored.includes("trustHostForSession"));
  assert.equal(first.profiles[0].name, "app");
  assert.equal(first.servers[0].env, "prod");

  // a second log with the same connection lands on the same server
  const second = saveServerAndLog(first, { ...config, filePath:"/var/log/nginx/error.log" }, {});
  assert.equal(second.servers.length, 1);
  assert.equal(second.profiles.length, 2);
  assert.equal(second.profiles[1].name, "error.log");

  // editing the server updates every log's connection
  const third = saveServerAndLog(second, { ...config, target:"new-host", filePath:"" }, { serverId:first.serverId, env:"staging" });
  assert.equal(third.servers[0].target, "new-host");
  assert.equal(third.servers[0].name, "API");
  assert.ok(third.profiles.every(p => p.target === "new-host"));
  assert.equal(third.logId, "", "no source → server only");
});

test("groupServers orders by environment and filters by server or log", () => {
  const servers = [{ id:"a", name:"zeta", env:"" }, { id:"b", name:"api", env:"prod" }, { id:"c", name:"web", env:"dev" }];
  const profiles = [{ id:"l1", serverId:"b", name:"app", filePath:"/var/log/app.log" }, { id:"l2", serverId:"c", name:"nginx", filePath:"/x" }];
  assert.deepEqual(groupServers(servers, profiles).map(g => g.env), ["prod", "dev", ""]);
  const found = groupServers(servers, profiles, "NGINX");
  assert.equal(found.length, 1);
  assert.equal(found[0].servers[0].server.id, "c");
  assert.deepEqual(groupServers(servers, profiles, "api")[0].servers[0].logs.map(l => l.id), ["l1"]);
});

test("delete server removes its logs; status is recorded", () => {
  const state = { servers:[{ id:"a" }, { id:"b" }], profiles:[{ id:"1", serverId:"a" }, { id:"2", serverId:"b" }] };
  assert.deepEqual(deleteServer(state, "a").profiles.map(p => p.id), ["2"]);
  const servers = recordServerStatus(state.servers, "b", false, "Connection refused", 5);
  assert.deepEqual(servers[1].lastStatus, { ok:false, at:5, error:"Connection refused" });
  assert.equal(recordServerStatus(state.servers, "zz", true), state.servers);
  assert.equal(envColor("prod"), "#e5484d");
  assert.equal(envColor(""), "");
  assert.equal(logDisplayName({ source:"docker", containerName:"web-1" }), "web-1");
});
