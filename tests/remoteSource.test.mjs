// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { normalizeEncoding, normalizeJournalUnit, journalScript, withSudo, sudoSecret, sudoError } = require("../remoteSource.cjs");
const { createLineDecoder } = require("../streamLimits.cjs");

test("encodings: latin1 aliases go to windows-1252, unknown falls back to utf-8", () => {
  assert.equal(normalizeEncoding("Latin-1"), "windows-1252");
  assert.equal(normalizeEncoding("ISO-8859-15"), "iso-8859-15");
  assert.equal(normalizeEncoding("ebcdic"), "utf-8");
});

test("line decoder decodes windows-1252 across chunk boundaries", () => {
  const decoder = createLineDecoder("windows-1252");
  assert.deepEqual(decoder.write(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x80])), ["café"]);
  assert.deepEqual(decoder.write(Buffer.from([0x0a])), ["€"]);
  const utf8 = createLineDecoder();
  assert.deepEqual(utf8.write(Buffer.from([0x63, 0xc3])), []);
  assert.deepEqual(utf8.write(Buffer.from([0xa9, 0x0a])), ["cé"]);
});

test("journal units are validated", () => {
  assert.equal(normalizeJournalUnit(" nginx.service "), "nginx.service");
  assert.equal(normalizeJournalUnit("getty@tty1.service"), "getty@tty1.service");
  assert.equal(normalizeJournalUnit(""), "");
  for (const bad of ["-f", "nginx; rm -rf /", "a b", "$(id)", "x'y"]) assert.throws(() => normalizeJournalUnit(bad), bad);
});

test("journal script follows with ISO dates and the requested history", () => {
  const script = journalScript({ journalUnit:"nginx", tailLines:5000 }, "READY");
  assert.match(script, /journalctl --no-pager -o short-iso -u 'nginx' -n 5000 --show-cursor/);
  assert.match(script, /-f --after-cursor="\$C"; else exec .* -n 0 -f; fi$/);
  assert.match(journalScript({ resumeOnly:true }, "READY"), /-o short-iso -n 0 -f$/);
});

test("sudo wraps the script so it is a single quoted argument", () => {
  assert.equal(withSudo("tail -F /x", {}), "tail -F /x");
  assert.match(withSudo("tail -F /x", { sudo:"nopasswd" }), /exec sudo -n -- sh -c 'tail -F \/x'$/);
  const wrapped = withSudo("printf 'R\\n'; exec tail -F '/var/log/it''s.log'", { sudo:"password" });
  assert.match(wrapped, /exec sudo -S -p '' -- sh -c '/);
  assert.equal(sudoSecret({ sudo:"password", password:"ssh" }), "ssh");
  assert.equal(sudoSecret({ sudo:"password", password:"ssh", sudoPassword:"own" }), "own");
  assert.equal(sudoSecret({ sudo:"nopasswd", password:"ssh" }), "");
});

test("sudo-wrapped script still parses and runs the original in sh", { skip: process.platform === "win32" && "needs a POSIX sh" }, () => {
  const script = withSudo("printf '%s\\n' \"it's ok\"", { sudo:"nopasswd" }).replace("exec sudo -n -- ", "exec ");
  assert.equal(execFileSync("sh", ["-c", script.replace(/^if .*?fi; /, "")]).toString(), "it's ok\n");
});

test("sudo errors are explained", () => {
  assert.match(sudoError("sudo: a password is required"), /pide contraseña/);
  assert.match(sudoError("Sorry, try again.\nsudo: 1 incorrect password attempt"), /rechazó/);
  assert.match(sudoError("deploy is not in the sudoers file."), /permiso de sudo/);
  assert.equal(sudoError("tail: cannot open"), "");
});

test("time zones: wall clock in a zone becomes the right instant; explicit offsets win", async () => {
  const { wallClockInZone, lineInstant, zoneOffsetMs } = await import("../src/logTime.mjs");
  const { mergeByTimestamp } = await import("../src/mergedSource.mjs");
  const local = new Date(2026, 6, 1, 12, 0, 0).getTime();       // 12:00 local wall clock
  assert.equal(wallClockInZone(local, "UTC"), Date.UTC(2026, 6, 1, 12, 0, 0));
  assert.equal(wallClockInZone(local, "Europe/Madrid"), Date.UTC(2026, 6, 1, 10, 0, 0)); // CEST = UTC+2
  assert.equal(zoneOffsetMs("America/Mexico_City", Date.UTC(2026, 0, 1)), -6 * 3600_000);
  assert.equal(lineInstant("2026-07-01T12:00:00+05:00 x", "UTC"), Date.UTC(2026, 6, 1, 7, 0, 0));
  assert.equal(lineInstant("2026-07-01 12:00:00 x", ""), local, "no zone: historic behaviour");
  // Madrid 12:15 is 10:15 UTC, so it goes before the UTC server's 10:30 even though 12:15 > 10:30
  const merged = mergeByTimestamp([
    { label:"utc", lines:["2026-07-01 10:30:00 b"], timeZone:"UTC" },
    { label:"mad", lines:["2026-07-01 12:15:00 a"], timeZone:"Europe/Madrid" },
  ]);
  assert.deepEqual(merged, ["[mad] 2026-07-01 12:15:00 a", "[utc] 2026-07-01 10:30:00 b"]);
});
