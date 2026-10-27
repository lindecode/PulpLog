// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
const http = require("http");
const https = require("https");
const { authHeaders, redactError } = require("./aiCredentials.cjs");
const DEFAULT_URL = "http://127.0.0.1:8000/v1";
const LIMIT = 4 * 1024 * 1024;

function normalizeUrl(value) {
  const url = new URL(String(value || DEFAULT_URL).trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid vLLM server URL");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  return url.toString().replace(/\/+$/, "");
}

function errorText(status, body) {
  try {
    const data = JSON.parse(body);
    const message = data.error?.message || data.message || data.detail || data.error;
    if (typeof message === "string") return message.slice(0, 1000);
  } catch {}
  return `HTTP ${status}: ${String(body).slice(0, 300)}`;
}

async function status(rawUrl, { apiKey = "" } = {}) {
  let baseUrl = rawUrl || DEFAULT_URL;
  try {
    baseUrl = normalizeUrl(baseUrl);
    const data = await new Promise((resolve, reject) => {
      const target = new URL(`${baseUrl}/models`);
      const req = (target.protocol === "https:" ? https : http).get(target, { timeout:5000, headers:{ Accept:"application/json", ...authHeaders(apiKey) } }, res => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { body += chunk; if (body.length > LIMIT) req.destroy(new Error("Response too large")); });
        res.on("error", reject);
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(errorText(res.statusCode, redactError(body, apiKey))));
          try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON from vLLM")); }
        });
      });
      req.on("timeout", () => req.destroy(new Error("vLLM request timed out")));
      req.on("error", reject);
    });
    if (!Array.isArray(data.data)) throw new Error("Invalid model list from vLLM");
    const models = data.data.filter(model => typeof model?.id === "string" && model.id).slice(0, 50).map(model => ({
      name:model.id, model:model.id, capabilities:["completion"], details:{},
      contextLength:Math.max(0, Number(model.max_model_len) || 0),
    }));
    return { available:true, models, url:baseUrl, provider:"vllm" };
  } catch (error) {
    return { available:false, models:[], url:baseUrl, provider:"vllm", error:redactError(error.message, apiKey) };
  }
}

function stream(rawUrl, request, { onChunk, onDone, onError }) {
  const target = new URL(`${normalizeUrl(rawUrl)}/chat/completions`);
  const body = JSON.stringify({ model:request.model, messages:request.messages, stream:true,
    temperature:0.2, stream_options:{ include_usage:true } });
  let finished = false;
  let response;
  let buffer = "";
  let doneReason = "";
  let usage = {};
  const finish = (error) => {
    if (finished) return;
    finished = true;
    if (error) onError(redactError(error.message, request.apiKey));
    else onDone({ numCtx:request.numCtx, doneReason, promptEvalCount:usage.prompt_tokens || 0, evalCount:usage.completion_tokens || 0 });
    response?.destroy();
    req.destroy();
  };
  const event = raw => {
    const data = raw.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") return finish();
    const value = JSON.parse(data);
    if (value.error) throw new Error(value.error.message || String(value.error));
    if (value.usage) usage = value.usage;
    const choice = value.choices?.[0];
    if (typeof choice?.delta?.content === "string") onChunk(choice.delta.content);
    if (choice?.finish_reason) doneReason = choice.finish_reason;
  };
  const req = (target.protocol === "https:" ? https : http).request(target, {
    method:"POST", timeout:300000,
    headers:{ "Content-Type":"application/json", Accept:"text/event-stream", "Content-Length":Buffer.byteLength(body), ...authHeaders(request.apiKey) },
  }, res => {
    response = res;
    res.setEncoding("utf8");
    res.on("error", error => finish(error));
    res.on("aborted", () => finish(new Error("vLLM stream interrupted")));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      let errorBody = "";
      res.on("data", chunk => { errorBody += chunk; if (errorBody.length > LIMIT) req.destroy(new Error("Response too large")); });
      res.on("end", () => finish(new Error(errorText(res.statusCode, redactError(errorBody, request.apiKey)))));
      return;
    }
    res.on("data", chunk => {
      if (finished) return;
      buffer += chunk;
      // CRLF can be split between network chunks; normalize only complete pairs.
      buffer = buffer.replace(/\r\n/g, "\n");
      try {
        let boundary;
        while (!finished && (boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          event(block);
        }
        if (buffer.length > LIMIT) throw new Error("vLLM event too large");
      } catch (error) { finish(error); req.destroy(); }
    });
    res.on("end", () => {
      if (finished) return;
      try { if (buffer.trim()) event(buffer); } catch (error) { return finish(error); }
      if (!finished) finish(new Error("vLLM stream ended without [DONE]"));
    });
  });
  req.on("timeout", () => req.destroy(new Error("vLLM request timed out")));
  req.on("error", error => finish(error));
  req.end(body);
  return { destroy() { finished = true; response?.destroy(); req.destroy(); } };
}

module.exports = { DEFAULT_URL, normalizeUrl, status, stream };
