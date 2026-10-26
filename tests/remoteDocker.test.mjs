// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { dockerContainer, dockerListScript, dockerReadCheck, dockerLogsScript, parseDockerContainers } = require("../remoteDocker.cjs");

test("rejects Docker identifiers that could inject commands or options", () => {
  for (const id of ["", "-a", "$(whoami)", "abc;id", "a b", "a\nb", "a'", "a".repeat(129)]) {
    assert.throws(() => dockerContainer(id));
    assert.throws(() => dockerLogsScript({ containerId:id }, "READY"));
  }
  assert.equal(dockerContainer("stack-api_1.2"), "stack-api_1.2");
});

test("parses running and stopped containers from Docker JSON lines", () => {
  const output = [
    { ID:"abc123", Names:"api", Image:"api:1", Status:"Up 3 hours", State:"running" },
    { ID:"def456", Names:"worker", Image:"worker:1", Status:"Exited (0)", State:"exited" },
  ].map(JSON.stringify).join("\r\n");
  assert.deepEqual(parseDockerContainers(output).map(item => [item.id, item.name, item.state]),
    [["abc123", "api", "running"], ["def456", "worker", "exited"]]);
  assert.deepEqual(parseDockerContainers("\n"), []);
  assert.throws(() => parseDockerContainers("not JSON"));
});

test("resuming Docker logs skips old lines and bounds initial history", () => {
  assert.match(dockerLogsScript({ containerId:"api", resumeOnly:true }, "READY"), /--tail=0/);
  assert.match(dockerLogsScript({ containerId:"api", tailLines:5000 }, "READY"), /--tail=5000/);
  assert.match(dockerLogsScript({ containerId:"api", tailLines:Infinity }, "READY"), /--tail=500/);
  assert.match(dockerLogsScript({ containerId:"api", tailLines:9999999 }, "READY"), /--tail=100000/);
  assert.match(dockerReadCheck({ containerId:"api" }), /inspect --type container 'api'/);
});

const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/sh.exe" : "/bin/sh";
test("remote scripts validate access, list containers and preserve both log streams", { skip:!existsSync(shell) }, t => {
  const dir = mkdtempSync(join(tmpdir(), "pulplog-docker-"));
  t.after(() => rmSync(dir, { recursive:true, force:true }));
  writeFileSync(join(dir, "docker"), `#!/bin/sh
case "$1" in
  info) if [ "$DENY" = 1 ]; then echo 'permission denied' >&2; exit 1; fi ;;
  inspect) if [ "$MISSING" = 1 ]; then echo 'No such container' >&2; exit 1; fi ;;
  ps) printf '%s\\n' '{"ID":"abc123","Names":"api","State":"running"}' ;;
  logs) echo 'INFO stdout'; echo 'ERROR stderr' >&2 ;;
  *) exit 2 ;;
esac
`, { mode:0o755 });
  const run = (script, env = {}) => spawnSync(shell, ["-c", script], {
    encoding:"utf8", env:{ ...process.env, PATH:dir.replace(/\\/g, "/"), ...env }, timeout:5000, windowsHide:true,
  });
  const listed = run(dockerListScript());
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(parseDockerContainers(listed.stdout)[0].name, "api");
  const logs = run(dockerLogsScript({ containerId:"api" }, "READY"));
  assert.equal(logs.status, 0, logs.stderr);
  assert.equal(logs.stdout, "READY\nINFO stdout\nERROR stderr\n");
  for (const env of [{ DENY:"1" }, { MISSING:"1" }]) {
    const failed = run(dockerLogsScript({ containerId:"api" }, "READY"), env);
    assert.notEqual(failed.status, 0);
    assert.doesNotMatch(failed.stdout, /READY|INFO stdout/);
  }
  const missing = spawnSync(shell, ["-c", dockerListScript("Docker unavailable")], {
    encoding:"utf8", env:{ ...process.env, PATH:"" }, timeout:5000, windowsHide:true,
  });
  assert.equal(missing.status, 127);
  assert.match(missing.stderr, /Docker unavailable/);
});
