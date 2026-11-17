// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { combineTabFiles, isCombinableTab } from "../src/mergedSource.mjs";

test("isCombinableTab accepts local files and merged tabs only", () => {
  assert.equal(isCombinableTab({ filePath: "C:/a/app.log" }), true);
  assert.equal(isCombinableTab({ merged: { files: [{ filePath: "x", label: "x" }] } }), true);
  assert.equal(isCombinableTab({ filePath: "__web__" }), false);
  assert.equal(isCombinableTab({ docker: {} }), false);
  assert.equal(isCombinableTab({ remote: {} }), false);
  assert.equal(isCombinableTab({ label: "$welcome", filePath: null }), false);
});

test("combineTabFiles flattens merged tabs, drops duplicate paths, disambiguates labels", () => {
  const files = combineTabFiles([
    { filePath: "C:/a/app.log" },
    { filePath: "C:/b/app.log" },
    { docker: { name: "db" } },
    { merged: { files: [{ filePath: "C:/a/app.log", label: "app.log" }, { filePath: "/var/log/syslog", label: "syslog" }] } },
  ]);
  assert.deepEqual(files, [
    { filePath: "C:/a/app.log", label: "app.log" },
    { filePath: "C:/b/app.log", label: "app.log (2)" },
    { filePath: "/var/log/syslog", label: "syslog" },
  ]);
});
