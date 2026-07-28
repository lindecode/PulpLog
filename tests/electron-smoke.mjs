import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const smokeDir = mkdtempSync(join(tmpdir(), "pulplog-smoke-"));
const smokeFile = join(smokeDir, "sample.log");
writeFileSync(smokeFile, "INFO ready\n", "utf8");
const electronEnv = {
  ...process.env,
  PULPLOG_SMOKE_TEST:"1",
  PULPLOG_SMOKE_FILE:smokeFile,
};
delete electronEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, [".", `--user-data-dir=${smokeDir}`], {
  cwd: new URL("..", import.meta.url),
  env:electronEnv,
  windowsHide:true,
  stdio:["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", chunk => { output += chunk.toString(); });
child.stderr.on("data", chunk => { output += chunk.toString(); });
const timeout = setTimeout(() => {
  child.kill();
  console.error(output);
  process.exitCode = 1;
}, 15000);
child.on("exit", code => {
  clearTimeout(timeout);
  rmSync(smokeDir, { recursive:true, force:true });
  if (code !== 0 || !output.includes("PULPLOG_SMOKE_OK")) {
    console.error(output);
    process.exitCode = 1;
    return;
  }
  console.log("Electron smoke test: OK");
});