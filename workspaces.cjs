// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Workspaces store: named collections of log sources (local files, Docker
// containers, remote SSH/WSL logs) kept in their own workspaces.json, separate
// from settings.json. Secrets (password/passphrase) are never persisted.
"use strict";
const fs = require("fs");
const path = require("path");

const MAX_WORKSPACES = 50;
const MAX_ENTRIES = 60;
const PALETTE = ["#E5534B", "#57AB5A", "#539BF5", "#C69026", "#B083F0", "#39C5CF", "#E275AD", "#DB6D28"];
const REMOTE_MODES = ["ssh", "ssh-wsl", "ssh-native", "wsl"];
const EXPORT_FORMAT = "pulplog-workspaces";
const MAX_PATTERN_MATCHES = 20;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/* A file entry is a pattern when its file name (not its folder) has * or ? */
const isPattern = filePath => /[*?]/.test(path.basename(String(filePath || "")));

const str = (value, max, fallback = "") => typeof value === "string" ? value.slice(0, max) : fallback;
const hasControl = value => /[\x00-\x1f]/.test(value);

function normalizeColor(value, index) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : PALETTE[index % PALETTE.length];
}

function normalizeRemote(value) {
  if (!value || typeof value !== "object") return null;
  const target = str(value.target, 255).trim();
  const mode = REMOTE_MODES.includes(value.mode) ? value.mode : "ssh";
  if (!target && mode !== "wsl") return null;
  const tailNum = Number.parseInt(value.tailLines, 10);
  const tail = Number.isFinite(tailNum) ? Math.min(Math.max(tailNum, 1), 10000) : 500;
  const mbNum = Number.parseInt(value.maxInitialMb, 10);
  return {
    mode,
    target,
    user: str(value.user, 128),
    port: str(value.port, 5),
    identityFile: str(value.identityFile, 32767),
    fingerprint: str(value.fingerprint, 160),
    proxyJump: str(value.proxyJump, 255),
    distro: str(value.distro, 160),
    filePath: str(value.filePath, 4096),
    source: value.source === "docker" ? "docker" : "file",
    containerId: str(value.containerId, 128),
    containerName: str(value.containerName, 128),
    tailLines: tail,
    historyMode: ["lines", "bytes", "full"].includes(value.historyMode) ? value.historyMode : "lines",
    maxInitialMb: Number.isFinite(mbNum) ? Math.min(Math.max(mbNum, 1), 200) : 100,
  };
}

function normalizeEntry(value) {
  if (!value || typeof value !== "object") return null;
  const label = str(value.label, 200).trim();
  if (value.type === "file") {
    const filePath = str(value.filePath, 32767);
    if (!filePath || hasControl(filePath)) return null;
    if (/[*?]/.test(path.dirname(filePath))) return null; // wildcards only in the file name
    if (isPattern(filePath)) {
      return { type:"file", filePath, label: label || path.basename(filePath), latestOnly: value.latestOnly !== false };
    }
    return { type:"file", filePath, label: label || path.basename(filePath) };
  }
  if (value.type === "docker") {
    const name = str(value.name, 160).replace(/^\//, "");
    const containerId = str(value.containerId, 160);
    if (!(name || containerId) || hasControl(name + containerId)) return null;
    return { type:"docker", containerId, name: name || containerId.slice(0, 12), label };
  }
  if (value.type === "remote") {
    const remote = normalizeRemote(value.remote);
    return remote ? { type:"remote", remote, label } : null;
  }
  return null;
}

function entryKey(entry) {
  if (entry.type === "file") return `file:${process.platform === "win32" ? entry.filePath.toLowerCase() : entry.filePath}`;
  if (entry.type === "docker") return `docker:${entry.name || entry.containerId}`;
  const r = entry.remote;
  return `remote:${[r.mode, r.user, r.target, r.port, r.distro, r.source, r.filePath, r.containerName || r.containerId].join("|")}`;
}

function normalizeWorkspaces(value) {
  const s = value && typeof value === "object" ? value : {};
  const seenIds = new Set();
  const workspaces = (Array.isArray(s.workspaces) ? s.workspaces : [])
    .filter(ws => ws && typeof ws === "object")
    .slice(0, MAX_WORKSPACES)
    .map((ws, index) => {
      let id = str(ws.id, 80).replace(/[^\w-]/g, "") || `ws-${index}`;
      while (seenIds.has(id)) id = `${id}-${index}`;
      seenIds.add(id);
      const seenKeys = new Set();
      const entries = (Array.isArray(ws.entries) ? ws.entries : [])
        .map(normalizeEntry)
        .filter(entry => {
          if (!entry) return false;
          const key = entryKey(entry);
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        })
        .slice(0, MAX_ENTRIES);
      return {
        id,
        name: str(ws.name, 80).trim() || `Workspace ${index + 1}`,
        color: normalizeColor(ws.color, index),
        view: ws.view === "merged" ? "merged" : "tabs",
        entries,
      };
    });
  const activeIds = (Array.isArray(s.activeIds) ? s.activeIds : []).filter(id => seenIds.has(id));
  return { workspaces, activeIds: [...new Set(activeIds)] };
}

/* Resolves "C:\logs\app-*.log" to matching files, newest first. */
async function resolvePattern(pattern, { latestOnly = true, platform = process.platform } = {}) {
  if (!isPattern(pattern)) return [];
  const dir = path.dirname(pattern);
  if (/[*?]/.test(dir)) return [];
  const source = path.basename(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/\?/g, "[^/\\\\]");
  const matcher = new RegExp(`^${source}$`, platform === "win32" ? "i" : "");
  let dirents;
  try { dirents = await fs.promises.readdir(dir, { withFileTypes:true }); }
  catch { return []; }
  const files = await Promise.all(dirents
    .filter(d => d.isFile() && matcher.test(d.name))
    .map(async d => {
      const filePath = path.join(dir, d.name);
      try {
        const stat = await fs.promises.stat(filePath);
        return { filePath, size:stat.size, mtimeMs:stat.mtimeMs };
      } catch { return null; }
    }));
  const sorted = files.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath));
  return sorted.slice(0, latestOnly ? 1 : MAX_PATTERN_MATCHES);
}

function serializeExport(workspaces) {
  const { workspaces: list } = normalizeWorkspaces({ workspaces });
  return JSON.stringify({ format:EXPORT_FORMAT, version:1, workspaces:list }, null, 2);
}

/* Returns normalized workspaces from an export file, or throws on invalid input. */
function parseImport(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) throw new Error("Invalid workspace file");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Invalid workspace file"); }
  if (!data || data.format !== EXPORT_FORMAT || !Array.isArray(data.workspaces)) throw new Error("Invalid workspace file");
  return normalizeWorkspaces({ workspaces:data.workspaces }).workspaces;
}

function createStore(filePath, onError = () => {}) {
  let queue = Promise.resolve();
  async function load() {
    try { return normalizeWorkspaces(JSON.parse(await fs.promises.readFile(filePath, "utf8"))); }
    catch { return normalizeWorkspaces({}); }
  }
  function save(value) {
    const operation = queue.then(async () => {
      const next = normalizeWorkspaces(value);
      const temporary = `${filePath}.${process.pid}.tmp`;
      await fs.promises.mkdir(path.dirname(filePath), { recursive:true });
      await fs.promises.writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
      await fs.promises.rename(temporary, filePath);
      return next;
    });
    queue = operation.catch(err => onError(err));
    return operation;
  }
  async function get() { await queue; return load(); }
  return { get, save };
}

module.exports = {
  PALETTE, normalizeWorkspaces, normalizeEntry, entryKey, createStore,
  isPattern, resolvePattern, serializeExport, parseImport,
};
