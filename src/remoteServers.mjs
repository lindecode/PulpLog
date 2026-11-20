// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Servers and their logs: a server is defined once (destination, jumps, auth, ssh config source,
// environment); each saved log (file or remote container) points at it with `serverId`.
// Older settings only had flat profiles: migrateRemote() groups them into servers.

export const ENVIRONMENTS = ["prod", "staging", "dev", ""];
export const ENV_COLORS = { prod:"#e5484d", staging:"#f5a524", dev:"#30a46c", "":"" };

// connection fields owned by the server; everything else belongs to the log
export const SERVER_FIELDS = ["mode", "target", "user", "port", "identityFile", "jumps", "proxyJump",
  "distro", "fingerprint", "vaultCredentialId", "interactiveAuth"];

const newId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function envColor(env) { return ENV_COLORS[env] || ""; }

function hopKey(hop) {
  return hop?.type === "command" ? ["command", hop.command || ""]
    : [hop?.host || "", hop?.user || "", String(hop?.port || ""), hop?.identityFile || ""];
}

/** Identity of a connection: two profiles with the same key belong to the same server. */
export function serverKey(config = {}) {
  const jumps = Array.isArray(config.jumps) && config.jumps.length ? config.jumps.map(hopKey)
    : config.proxyJump ? [config.proxyJump] : [];
  const sshDistro = config.mode === "ssh-wsl" ? config.distro || "" : "";
  return JSON.stringify([config.mode || "ssh", (config.target || "").trim().toLowerCase(), (config.user || "").trim(),
    String(config.port || "").trim(), (config.identityFile || "").trim(), sshDistro, jumps]);
}

export function pickServerFields(config = {}) {
  const out = {};
  for (const field of SERVER_FIELDS) if (config[field] !== undefined) out[field] = config[field];
  if (Array.isArray(out.jumps)) out.jumps = out.jumps.map(({ password, passphrase, rememberPassword, ...hop }) => hop);
  return out;
}

export function defaultServerName(config = {}) {
  const target = (config.target || "").trim();
  return config.user && target && !target.includes("@") ? `${config.user}@${target}` : target || "SSH";
}

export function logDisplayName(profile = {}) {
  if (profile.source === "docker") return profile.containerName || profile.containerId || "Docker";
  if (profile.source === "journal") return `journalctl${profile.journalUnit ? ` -u ${profile.journalUnit}` : ""}`;
  const path = profile.filePath || "";
  return path.split("/").filter(Boolean).pop() || path || "log";
}

/**
 * Groups flat profiles into servers. Profiles that already have a valid serverId are left alone;
 * WSL-local profiles (now plain \\wsl.localhost files) get no server.
 * Returns { servers, profiles, changed }.
 */
export function migrateRemote({ servers = [], profiles = [] } = {}) {
  const nextServers = [...servers];
  const byId = new Map(nextServers.map(server => [server.id, server]));
  const byKey = new Map(nextServers.map(server => [serverKey(server), server]));
  let changed = false;
  const nextProfiles = profiles.map(profile => {
    if (profile.mode === "wsl") return profile;
    if (profile.serverId && byId.has(profile.serverId)) return profile;
    changed = true;
    const key = serverKey(profile);
    let server = byKey.get(key);
    if (!server) {
      server = { id:newId("srv"), name:defaultServerName(profile), env:"", ...pickServerFields(profile) };
      nextServers.push(server); byId.set(server.id, server); byKey.set(key, server);
    } else if (!server.vaultCredentialId && profile.vaultCredentialId) {
      // keep the saved password of any profile in the group
      server = { ...server, vaultCredentialId:profile.vaultCredentialId };
      nextServers[nextServers.findIndex(item => item.id === server.id)] = server;
      byId.set(server.id, server); byKey.set(key, server);
    }
    return { ...profile, serverId:server.id };
  });
  return { servers:nextServers, profiles:nextProfiles, changed };
}

/** A log ready to open: the server's connection over the log's own fields. */
export function resolveLog(profile, server) {
  if (!server) return { ...profile };
  return { ...profile, ...pickServerFields(server), serverId:server.id, serverName:server.name || defaultServerName(server),
    env:server.env || "", logName:profile.name || logDisplayName(profile) };
}

const matches = (query, ...values) => values.some(value => String(value || "").toLowerCase().includes(query));

/** [{ env, servers:[{ server, logs }] }] in prod → staging → dev → (none) order, filtered by text. */
export function groupServers(servers = [], profiles = [], query = "") {
  const q = query.trim().toLowerCase();
  const groups = ENVIRONMENTS.map(env => ({ env, servers:[] }));
  for (const server of servers) {
    const logs = profiles.filter(profile => profile.serverId === server.id);
    const serverHit = !q || matches(q, server.name, server.target, server.user, server.distro);
    const visibleLogs = serverHit ? logs : logs.filter(log => matches(q, log.name, log.filePath, log.containerName));
    if (!serverHit && !visibleLogs.length) continue;
    const group = groups.find(item => item.env === (server.env || "")) || groups[groups.length - 1];
    group.servers.push({ server, logs:visibleLogs });
  }
  for (const group of groups) group.servers.sort((a, b) => (a.server.name || "").localeCompare(b.server.name || ""));
  return groups.filter(group => group.servers.length);
}

/**
 * Saves the server (by id, or reusing one with the same connection, or new) and, when the config
 * has a source, the log. Secrets never reach the stored objects.
 * Returns { servers, profiles, serverId, logId }.
 */
export function saveServerAndLog({ servers = [], profiles = [] }, config, { serverId = "", logId = "", serverName = "", env = "", logName = "" } = {}) {
  const fields = pickServerFields(config);
  let server = servers.find(item => item.id === serverId)
    || (!serverId ? servers.find(item => serverKey(item) === serverKey(config)) : null);
  const name = serverName.trim() || server?.name || defaultServerName(config);
  server = { ...(server || { id:newId("srv") }), ...fields, name, env:ENVIRONMENTS.includes(env) ? env : "" };
  const nextServers = [...servers.filter(item => item.id !== server.id), server];

  const hasSource = config.source === "docker" ? !!config.containerId || !!config.containerName
    : config.source === "journal" ? true : !!(config.filePath || "").trim();
  // other logs of this server get the updated connection too (profiles stay openable on their own)
  const synced = profiles.map(item => item.serverId === server.id ? { ...item, ...fields } : item);
  if (!hasSource) return { servers:nextServers, profiles:synced, serverId:server.id, logId:"" };
  const id = logId || newId("log");
  const { password, passphrase, sudoPassword, trustHostForSession, serverName:_s, env:_e, logName:_l, ...rest } = config;
  const log = { ...rest, ...fields, id, serverId:server.id, name:logName.trim() || logDisplayName(config) };
  if (Array.isArray(log.jumps)) log.jumps = fields.jumps;
  const nextProfiles = [...synced.filter(item => item.id !== id), log];
  return { servers:nextServers, profiles:nextProfiles, serverId:server.id, logId:id };
}

export function deleteServer({ servers = [], profiles = [] }, serverId) {
  return { servers:servers.filter(item => item.id !== serverId), profiles:profiles.filter(item => item.serverId !== serverId) };
}

export function deleteLog({ servers = [], profiles = [] }, logId) {
  return { servers, profiles:profiles.filter(item => item.id !== logId) };
}

/** Last connection result shown in the server list. */
export function recordServerStatus(servers = [], serverId, ok, error = "", now = Date.now()) {
  if (!serverId || !servers.some(item => item.id === serverId)) return servers;
  return servers.map(item => item.id === serverId
    ? { ...item, lastStatus:{ ok:!!ok, at:now, error:ok ? "" : String(error || "").slice(0, 300) } } : item);
}
