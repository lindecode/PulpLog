// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { parseWslUncPath, wslUncPath, isPermissionError } from "../src/wslPaths.mjs";

test("parseWslUncPath understands both UNC forms and slashes", () => {
  assert.deepEqual(parseWslUncPath("\\\\wsl.localhost\\Ubuntu\\var\\log\\syslog"), { distro: "Ubuntu", linuxPath: "/var/log/syslog" });
  assert.deepEqual(parseWslUncPath("\\\\wsl$\\Debian\\home\\me\\app.log"), { distro: "Debian", linuxPath: "/home/me/app.log" });
  assert.deepEqual(parseWslUncPath("//wsl.localhost/Ubuntu-22.04/tmp/x.log"), { distro: "Ubuntu-22.04", linuxPath: "/tmp/x.log" });
  assert.deepEqual(parseWslUncPath("\\\\wsl.localhost\\Ubuntu"), { distro: "Ubuntu", linuxPath: "/" });
  assert.equal(parseWslUncPath("C:\\logs\\app.log"), null);
  assert.equal(parseWslUncPath("\\\\server\\share\\app.log"), null);
});

test("wslUncPath builds the Windows path back", () => {
  assert.equal(wslUncPath("Ubuntu", "/var/log/syslog"), "\\\\wsl.localhost\\Ubuntu\\var\\log\\syslog");
  assert.equal(wslUncPath("Ubuntu", "/"), "\\\\wsl.localhost\\Ubuntu");
  const round = parseWslUncPath(wslUncPath("Debian", "/a/b.log"));
  assert.deepEqual(round, { distro: "Debian", linuxPath: "/a/b.log" });
});

test("isPermissionError", () => {
  assert.equal(isPermissionError("EPERM: operation not permitted, open '\\\\wsl.localhost\\Ubuntu\\var\\log\\btmp.1'"), true);
  assert.equal(isPermissionError("EACCES"), true);
  assert.equal(isPermissionError("ENOENT: no such file"), false);
});
