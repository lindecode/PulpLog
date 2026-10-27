// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
const { DEFAULT_URL, normalizeUrl, status, stream } = createRequire(import.meta.url)("../vllm.cjs");

async function server(t, handler) {
  const instance = createServer(handler);
  await new Promise(resolve => instance.listen(0, "127.0.0.1", resolve));
  t.after(() => { instance.closeAllConnections(); instance.close(); });
  return `http://127.0.0.1:${instance.address().port}`;
}

function chat(url, onChunk = () => {}) {
  return new Promise((resolve, reject) => stream(url, { model:"test", messages:[{ role:"user", content:"Hello" }], numCtx:4096 },
    { onChunk, onDone:resolve, onError:error => reject(new Error(error)) }));
}

test("vLLM URLs default locally and preserve reverse proxy API paths", () => {
  assert.equal(normalizeUrl(""), DEFAULT_URL);
  assert.equal(normalizeUrl("http://localhost:8000/"), "http://localhost:8000/v1");
  assert.equal(normalizeUrl("https://example.org/inference/v1/"), "https://example.org/inference/v1");
  for (const value of ["file:///models", "http://user:secret@localhost", "http://localhost?key=secret", "not a url"])
    assert.throws(() => normalizeUrl(value));
});

test("lists vLLM models and their advertised context limits", async t => {
  const url = await server(t, (req, res) => {
    assert.equal(req.url, "/proxy/v1/models");
    res.end(JSON.stringify({ data:[{ id:"test", max_model_len:8192 }, null] }));
  });
  const result = await status(`${url}/proxy/v1`);
  assert.equal(result.available, true);
  assert.equal(result.models[0].name, "test");
  assert.equal(result.models[0].contextLength, 8192);
  assert.deepEqual(result.models[0].capabilities, ["completion"]);
});

test("streams fragmented SSE and UTF-8, keeps usage, and sends no Ollama parameters", async t => {
  const url = await server(t, (req, res) => {
    assert.equal(req.url, "/v1/chat/completions");
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const payload = JSON.parse(body);
      assert.equal(payload.model, "test");
      assert.equal(payload.stream, true);
      assert.equal(payload.options, undefined);
      assert.equal(payload.think, undefined);
      res.setHeader("Content-Type", "text/event-stream");
      const data = Buffer.from(': keepalive\r\n\r\ndata: {"choices":[{"delta":{"content":"Hola ñ"}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
      let offset = 0;
      const timer = setInterval(() => {
        if (offset >= data.length) { clearInterval(timer); res.end(); return; }
        res.write(data.subarray(offset, offset + 3)); offset += 3;
      }, 1);
      res.on("close", () => clearInterval(timer));
    });
  });
  let text = "";
  const meta = await chat(url, chunk => { text += chunk; });
  assert.equal(text, "Hola ñ");
  assert.equal(meta.promptEvalCount, 12);
  assert.equal(meta.evalCount, 3);
  assert.equal(meta.doneReason, "stop");
});

test("reports unavailable servers, API errors, and incomplete streams", async t => {
  const url = await server(t, (req, res) => {
    if (req.url.endsWith("models")) { res.writeHead(401); res.end('{"error":{"message":"Unauthorized"}}'); }
    else { res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); }
  });
  assert.equal((await status(url)).error, "Unauthorized");
  await assert.rejects(chat(url), /without \[DONE\]/);
  const unavailable = await status("file:///wrong");
  assert.equal(unavailable.available, false);
  assert.deepEqual(unavailable.models, []);
});

test("cancels an active vLLM stream without late callbacks", async t => {
  let released;
  const closed = new Promise(resolve => { released = resolve; });
  const url = await server(t, (_req, res) => {
    res.writeHead(200, { "Content-Type":"text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
    res.on("close", released);
  });
  let callbacks = 0;
  await new Promise(resolve => {
    const request = stream(url, { model:"test", messages:[], numCtx:4096 }, {
      onChunk() { request.destroy(); resolve(); },
      onDone() { callbacks++; }, onError() { callbacks++; },
    });
  });
  await closed;
  assert.equal(callbacks, 0);
});

test("authenticates model and chat requests and redacts rejected credentials", async t => {
  const apiKey = "test-auth-secret";
  const url = await server(t, (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${apiKey}`);
    if (req.url.endsWith("models")) { res.end('{"data":[{"id":"test"}]}'); return; }
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      assert.equal(body.includes(apiKey), false);
      res.writeHead(401); res.end(JSON.stringify({ error:{ message:`Rejected ${apiKey}` } }));
    });
  });
  assert.equal((await status(url, { apiKey })).available, true);
  await assert.rejects(new Promise((resolve, reject) => stream(url,
    { model:"test", messages:[], numCtx:4096, apiKey },
    { onChunk() {}, onDone:resolve, onError:message => reject(new Error(message)) })), /Rejected \[REDACTED\]/);
});

test("redacts long API keys before truncating server errors", async t => {
  const apiKey = "test-" + "x".repeat(1500);
  const url = await server(t, (_req, res) => {
    res.writeHead(401); res.end(JSON.stringify({ error:{ message:`Rejected ${apiKey}` } }));
  });
  const result = await status(url, { apiKey });
  assert.equal(result.error, "Rejected [REDACTED]");
});

test("stops oversized AI output before delivering an unlimited response", async t => {
  const url = await server(t, (_req, res) => {
    const body = JSON.stringify({ choices:[{ delta:{ content:"a".repeat(5 * 1024 * 1024) } }] });
    res.end(`data: ${body}\n\ndata: [DONE]\n\n`);
  });
  await assert.rejects(chat(url), /exceeds 4 MB/);
});
