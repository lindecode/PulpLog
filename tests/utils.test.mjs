import test from "node:test";
import assert from "node:assert/strict";
import { isGzipFilePath } from "../src/utils.mjs";

test("detects gzip log paths case-insensitively", () => {
  assert.equal(isGzipFilePath("app.log.gz"), true);
  assert.equal(isGzipFilePath("/var/log/app.GZ"), true);
  assert.equal(isGzipFilePath("archive.gz.old"), false);
  assert.equal(isGzipFilePath("app.log"), false);
  assert.equal(isGzipFilePath(""), false);
});
