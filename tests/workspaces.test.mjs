// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { entryFromTab, entryKey as rendererKey, withEntries, nextColor, WS_PALETTE, isPatternEntry } from "../src/workspaces.mjs";
import { mergeByTimestamp } from "../src/mergedSource.mjs";

const main = createRequire(import.meta.url)("../workspaces.cjs");

test("normalizeWorkspaces tolerates garbage and empty input", () => {
  assert.deepEqual(main.normalizeWorkspaces(null), { workspaces:[], activeIds:[] });
  assert.deepEqual(main.normalizeWorkspaces({ workspaces:"x", activeIds:7 }), { workspaces:[], activeIds:[] });
});

test("normalizeWorkspaces sanitizes fields, dedupes entries and ids, drops unknown active ids", () => {
  const out = main.normalizeWorkspaces({
    workspaces:[
      { id:"a", name:"  Prod  ", color:"#abcdef", entries:[
        { type:"file", filePath:"C:\\logs\\api.log" },
        { type:"file", filePath:"C:\\logs\\api.log" },
        { type:"file", filePath:"bad\u0000path" },
        { type:"docker", name:"/web" },
        { type:"nope" },
      ] },
      { id:"a", name:"", color:"red", entries:[] },
    ],
    activeIds:["a", "ghost", "a"],
  });
  assert.equal(out.workspaces.length, 2);
  const [first, second] = out.workspaces;
  assert.equal(first.name, "Prod");
  assert.equal(first.color, "#ABCDEF");
  assert.deepEqual(first.entries.map(e => e.type), ["file", "docker"]);
  assert.equal(first.entries[0].label, "api.log");
  assert.equal(first.entries[1].name, "web");
  assert.notEqual(second.id, "a");
  assert.equal(second.name, "Workspace 2");
  assert.equal(second.color, main.PALETTE[1]);
  assert.deepEqual(out.activeIds, ["a"]);
});

test("remote entries never keep secrets and clamp history limits", () => {
  const out = main.normalizeWorkspaces({ workspaces:[{ id:"r", entries:[{ type:"remote", remote:{
    mode:"ssh-native", target:"srv", user:"ops", filePath:"/var/log/app.log",
    password:"hunter2", passphrase:"x", trustHostForSession:true, tailLines:999999, maxInitialMb:-4,
  } }] }] });
  const remote = out.workspaces[0].entries[0].remote;
  assert.equal(remote.password, undefined);
  assert.equal(remote.passphrase, undefined);
  assert.equal(remote.trustHostForSession, undefined);
  assert.equal(remote.tailLines, 10000);
  assert.equal(remote.maxInitialMb, 1);
});

test("renderer entryFromTab strips secrets and maps tab kinds", () => {
  assert.equal(entryFromTab({ label:"$welcome", filePath:null }), null);
  assert.equal(entryFromTab({ filePath:"__web__" }), null);
  assert.equal(entryFromTab({ filePath:"/a.log", label:"a" }).type, "file");
  assert.equal(entryFromTab({ docker:{ containerId:"abc", name:"web" } }).name, "web");
  const remote = entryFromTab({ remote:{ mode:"ssh", target:"h", password:"p", passphrase:"q" } }).remote;
  assert.equal(remote.password, undefined);
  assert.equal(remote.passphrase, undefined);
});

test("entryKey matches between main and renderer for normalized entries", () => {
  const isWin = process.platform === "win32";
  const raw = [
    { type:"file", filePath:"/var/Log/A.log" },
    { type:"docker", containerId:"0123456789ab", name:"web" },
    { type:"remote", remote:{ mode:"ssh", target:"host", user:"u", filePath:"/x.log" } },
    { type:"remote", remote:{ mode:"wsl", distro:"Ubuntu", source:"docker", containerName:"db" } },
  ];
  for (const entry of raw) {
    const normalized = main.normalizeEntry(entry);
    assert.equal(rendererKey(normalized, isWin), main.entryKey(normalized));
  }
});

test("withEntries skips duplicates; nextColor avoids used colors", () => {
  const ws = { id:"w", entries:[{ type:"file", filePath:"/a" }] };
  const same = withEntries(ws, [{ type:"file", filePath:"/a" }]);
  assert.equal(same, ws);
  const more = withEntries(ws, [{ type:"file", filePath:"/b" }, { type:"file", filePath:"/b" }]);
  assert.equal(more.entries.length, 2);
  assert.equal(nextColor([{ color:WS_PALETTE[0] }]), WS_PALETTE[1]);
});

test("store round-trips through disk atomically", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulplog-ws-"));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const store = main.createStore(path.join(dir, "workspaces.json"));
  assert.deepEqual(await store.get(), { workspaces:[], activeIds:[] });
  await store.save({ workspaces:[{ id:"x", name:"X", entries:[{ type:"file", filePath:"/a.log" }] }], activeIds:["x"] });
  const loaded = await store.get();
  assert.equal(loaded.workspaces[0].name, "X");
  assert.deepEqual(loaded.activeIds, ["x"]);
  assert.deepEqual(fs.readdirSync(dir), ["workspaces.json"]);
});

test("view mode and pattern entries normalize; wildcards in folders are rejected", () => {
  const out = main.normalizeWorkspaces({ workspaces:[{ id:"p", view:"merged", entries:[
    { type:"file", filePath:path.join("logs", "app-*.log"), latestOnly:false },
    { type:"file", filePath:path.join("lo*s", "app.log") },
    { type:"file", filePath:path.join("logs", "x?.log") },
  ] }, { id:"q", view:"weird" }] });
  assert.equal(out.workspaces[0].view, "merged");
  assert.equal(out.workspaces[1].view, "tabs");
  const entries = out.workspaces[0].entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].latestOnly, false);
  assert.equal(entries[1].latestOnly, true);
  assert.equal(isPatternEntry(entries[0]), true);
  assert.equal(isPatternEntry({ type:"file", filePath:"/a/b.log" }), false);
});

test("resolvePattern matches file names only, newest first, escaping regex characters", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulplog-glob-"));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  ["app-1.log", "app-2.log", "app-3.txt", "app.(1).log"].forEach((name, index) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "x");
    fs.utimesSync(file, 1000 + index, 1000 + index);
  });
  fs.mkdirSync(path.join(dir, "app-dir.log"));
  const all = await main.resolvePattern(path.join(dir, "app-*.log"), { latestOnly:false });
  assert.deepEqual(all.map(f => path.basename(f.filePath)), ["app-2.log", "app-1.log"]);
  const latest = await main.resolvePattern(path.join(dir, "app-*.log"));
  assert.deepEqual(latest.map(f => path.basename(f.filePath)), ["app-2.log"]);
  const special = await main.resolvePattern(path.join(dir, "app.(?).log"));
  assert.deepEqual(special.map(f => path.basename(f.filePath)), ["app.(1).log"]);
  assert.deepEqual(await main.resolvePattern(path.join(dir, "missing", "*.log")), []);
});

test("export/import round-trips and rejects foreign files", () => {
  const text = main.serializeExport([{ id:"e", name:"Prod", color:"#123456", view:"merged",
    entries:[{ type:"remote", remote:{ mode:"ssh", target:"h", password:"secret" } }] }]);
  assert.ok(!text.includes("secret"));
  const list = main.parseImport(text);
  assert.equal(list[0].name, "Prod");
  assert.equal(list[0].view, "merged");
  assert.throws(() => main.parseImport("{}"));
  assert.throws(() => main.parseImport("not json"));
  assert.throws(() => main.parseImport(JSON.stringify({ format:"other", workspaces:[] })));
});

test("mergeByTimestamp interleaves files and keeps continuation lines with their parent", () => {
  const merged = mergeByTimestamp([
    { label:"api", lines:["2026-01-01 10:00:00 INFO a1", "2026-01-01 10:00:02 ERROR a2", "    at Foo.bar", "2026-01-01 10:00:04 INFO a3"] },
    { label:"web", lines:["2026-01-01 10:00:01 INFO w1", "2026-01-01 10:00:03 INFO w2"] },
  ]);
  assert.deepEqual(merged, [
    "[api] 2026-01-01 10:00:00 INFO a1",
    "[web] 2026-01-01 10:00:01 INFO w1",
    "[api] 2026-01-01 10:00:02 ERROR a2",
    "[api]     at Foo.bar",
    "[web] 2026-01-01 10:00:03 INFO w2",
    "[api] 2026-01-01 10:00:04 INFO a3",
  ]);
  assert.deepEqual(mergeByTimestamp([{ label:"x", lines:["a", "b", "c"] }], 2), ["[x] b", "[x] c"]);
});
