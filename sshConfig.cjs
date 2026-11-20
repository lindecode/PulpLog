// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Reads the Host blocks of an OpenSSH config (~/.ssh/config) to import them as PulpLog servers,
// and serialises servers for export. Pure: no I/O, no secrets.
"use strict";

const FIELDS = { hostname:"hostName", user:"user", port:"port", identityfile:"identityFile", proxyjump:"proxyJump" };

/**
 * [{ alias, hostName, user, port, identityFile, proxyJump }] for every concrete alias
 * (patterns like * or !x are skipped; "Host a b" gives two entries with the same options).
 * Options in `Host *` / `Match` blocks are not applied: the alias still works because ssh reads
 * the config itself; these fields are only shown in the import list.
 */
function parseSshConfig(contents) {
  const entries = [];
  const seen = new Set();
  let current = [];
  for (const rawLine of String(contents || "").split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const match = line.match(/^(\S+)\s*(?:=\s*|\s+)(.+)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim().replace(/^"(.*)"$/, "$1");
    if (key === "host") {
      current = [];
      for (const alias of value.split(/\s+/)) {
        if (!alias || alias.startsWith("!") || /[*?]/.test(alias) || seen.has(alias)) continue;
        if (alias.startsWith("-") || alias.length > 255) continue;
        seen.add(alias);
        const entry = { alias, hostName:"", user:"", port:"", identityFile:"", proxyJump:"" };
        entries.push(entry); current.push(entry);
      }
    } else if (key === "match") {
      current = [];
    } else if (FIELDS[key]) {
      // first value wins, as in OpenSSH
      for (const entry of current) if (!entry[FIELDS[key]]) entry[FIELDS[key]] = value.slice(0, 1024);
    }
  }
  return entries.slice(0, 500);
}

const EXPORT_FORMAT = "pulplog-servers";

/** Export file: servers and their logs, without passwords, vault ids or connection results. */
function serializeServersExport(servers, profiles) {
  const strip = ({ password, passphrase, sudoPassword, vaultCredentialId, vaultCredentialKind, lastStatus,
    trustHostForSession, ...rest }) => rest;
  const stripHop = hop => { const { password, passphrase, vaultCredentialId, rememberPassword, ...rest } = hop || {}; return rest; };
  const clean = item => { const out = strip(item || {}); if (Array.isArray(out.jumps)) out.jumps = out.jumps.map(stripHop); return out; };
  const serverIds = new Set((servers || []).map(server => server.id));
  return JSON.stringify({
    format:EXPORT_FORMAT, version:1, exportedAt:new Date().toISOString(),
    servers:(servers || []).map(clean),
    logs:(profiles || []).filter(profile => serverIds.has(profile.serverId)).map(clean),
  }, null, 2);
}

function parseServersExport(text) {
  let data;
  try { data = JSON.parse(String(text || "")); } catch { throw new Error("El archivo no es JSON válido"); }
  if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.servers)) throw new Error("No es un archivo de servidores de PulpLog");
  return { servers:data.servers.slice(0, 100), logs:Array.isArray(data.logs) ? data.logs.slice(0, 200) : [] };
}

module.exports = { parseSshConfig, serializeServersExport, parseServersExport, EXPORT_FORMAT };
