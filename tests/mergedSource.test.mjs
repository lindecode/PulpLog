// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { combineTabFiles, isCombinableTab } from "../src/mergedSource.mjs";

test("isCombinableTab accepts local files, containers, remote logs and merged tabs", () => {
  assert.equal(isCombinableTab({ filePath: "C:/a/app.log" }), true);
  assert.equal(isCombinableTab({ merged: { files: [{ filePath: "x", label: "x" }] } }), true);
  assert.equal(isCombinableTab({ docker: { name: "db" } }), true);
  assert.equal(isCombinableTab({ remote: { mode: "ssh" } }), true);
  assert.equal(isCombinableTab({ filePath: "__web__" }), false);
  assert.equal(isCombinableTab({ label: "$welcome", filePath: null }), false);
});

test("combineTabFiles flattens merged tabs, drops duplicates, disambiguates labels", () => {
  const entries = combineTabFiles([
    { filePath: "C:\\a\\app.log" },
    { filePath: "C:\\b\\app.log" },
    { merged: { files: [{ filePath: "C:\\a\\app.log", label: "app.log" }, { filePath: "/var/log/syslog", label: "syslog" }] } },
  ]);
  assert.deepEqual(entries, [
    { filePath: "C:\\a\\app.log", label: "app.log" },
    { filePath: "C:\\b\\app.log", label: "app.log (2)" },
    { filePath: "/var/log/syslog", label: "syslog" },
  ]);
});

test("containers and remote logs become stream entries", () => {
  const remote = { mode: "ssh", target: "dev", source: "docker", containerId: "web-1", containerName: "web-1" };
  const entries = combineTabFiles([
    { label: "🐳 db", docker: { runtime: "docker", name: "db", containerId: "abc" } },
    { label: "Docker web-1 · dev", remote },
    { label: "Docker web-1 · dev", remote: { ...remote } },   // same source twice → once
  ], { containerSource: docker => ({ source: { runtime: docker.runtime, id: docker.containerId } }) });
  assert.deepEqual(entries, [
    { stream: { kind: "docker", payload: { source: { runtime: "docker", id: "abc" } } }, label: "🐳 db" },
    { stream: { kind: "remote", payload: remote }, label: "Docker web-1 · dev" },
  ]);
});
