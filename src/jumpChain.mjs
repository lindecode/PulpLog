// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Renderer helpers for the jump chain (the main process validates again in sshInvocation.cjs).

export const MAX_HOPS = 6;

export const emptyHop = () => ({ type: "tunnel", host: "", user: "", port: "", identityFile: "", password: "", rememberPassword: false });

/* Older profiles keep the chain as ProxyJump text: "diego@bastion:2222,inner" */
export function legacyJumps(proxyJump) {
  return String(proxyJump || "").split(",").map(part => part.trim()).filter(Boolean).map(spec => {
    let rest = spec.replace(/^ssh:\/\//i, "");
    let user = "";
    const at = rest.lastIndexOf("@");
    if (at >= 0) { user = rest.slice(0, at); rest = rest.slice(at + 1); }
    const bracket = rest.match(/^(\[[^\]]+\])(?::(\d+))?$/);
    const plain = rest.match(/^([^:]+):(\d+)$/);
    const host = bracket ? bracket[1] : plain ? plain[1] : rest;
    const port = bracket ? (bracket[2] || "") : plain ? plain[2] : "";
    return { ...emptyHop(), host, user, port };
  });
}

export const initialJumps = config =>
  Array.isArray(config?.jumps) && config.jumps.length ? config.jumps.map(hop => ({ ...emptyHop(), ...hop })) : legacyJumps(config?.proxyJump);

/* What travels to the main process (secrets in memory only; UI flags dropped; empty rows ignored). */
export const jumpsForConnection = jumps => jumps
  .filter(hop => hop.type === "command" ? String(hop.command || "").trim() : String(hop.host || "").trim())
  .map(({ rememberPassword, ...hop }) => hop.type === "command"
    ? { type: "command", command: String(hop.command).trim() }
    : { type: "tunnel", host: hop.host.trim(), user: String(hop.user || "").trim(), port: String(hop.port || "").trim(),
        identityFile: String(hop.identityFile || "").trim(),
        ...(hop.password ? { password: hop.password } : {}),
        ...(hop.vaultCredentialId ? { vaultCredentialId: hop.vaultCredentialId } : {}) });

const hopLabel = hop => hop.type === "command"
  ? `⚙ ${String(hop.command || "").trim().split(/\s+/)[0] || "comando"}`
  : `${hop.user ? `${hop.user}@` : ""}${hop.host || "?"}${hop.port ? `:${hop.port}` : ""}`;

/* "Tu equipo → bastion → inner → deploy@prod-api" */
export function chainSummary(jumps, destination, origin = "Tu equipo") {
  return [origin, ...jumpsForConnection(jumps).map(hopLabel), destination || "?"].join(" → ");
}

/* Problems the user can fix before connecting (null when fine). */
export function chainProblem(jumps) {
  const active = jumpsForConnection(jumps);
  if (active.length > MAX_HOPS) return `max:${MAX_HOPS}`;
  const commandAt = active.findIndex(hop => hop.type === "command");
  if (commandAt > 0) return "command-first";
  return null;
}
