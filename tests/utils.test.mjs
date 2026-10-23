// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { isGzipFilePath, getModelName, getModelLabel, isChatModel } from "../src/utils.mjs";

test("detects gzip log paths case-insensitively", () => {
  assert.equal(isGzipFilePath("app.log.gz"), true);
  assert.equal(isGzipFilePath("/var/log/app.GZ"), true);
  assert.equal(isGzipFilePath("archive.gz.old"), false);
  assert.equal(isGzipFilePath("app.log"), false);
  assert.equal(isGzipFilePath(""), false);
});

test("extracts Ollama model name and label with details or size", () => {
  assert.equal(getModelName("qwen3.5:4b"), "qwen3.5:4b");
  assert.equal(getModelName({ name: "qwen3.5:4b" }), "qwen3.5:4b");
  assert.equal(getModelName({ model: "granite4.1:3b" }), "granite4.1:3b");

  assert.equal(
    getModelLabel({ name: "qwen3.5:4b", details: { parameter_size: "4.7B" }, size: 3397841620 }),
    "qwen3.5:4b (4.7B)"
  );
  assert.equal(
    getModelLabel({ name: "custom:latest", size: 1073741824 }),
    "custom:latest (1.00 GB)"
  );
  assert.equal(getModelLabel("qwen3.5:0.8b"), "qwen3.5:0.8b");
});

test("distinguishes chat/completion models from embedding-only models", () => {
  assert.equal(isChatModel({ name: "qwen3.5:4b", capabilities: ["completion", "vision"] }), true);
  assert.equal(isChatModel({ name: "embeddinggemma:latest", capabilities: ["embedding"] }), false);
  assert.equal(isChatModel("all-minilm:latest"), false);
  assert.equal(isChatModel("qwen3.5:0.8b"), true);
});
