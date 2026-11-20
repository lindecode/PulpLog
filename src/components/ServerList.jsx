// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// First screen of the SSH dialog: servers grouped by environment, each with its saved logs.
// Click a log to open it; "+ log" / "edit" go to the form with the server loaded.
import React, { useState } from "react";
import { useLang } from "../i18n.jsx";
import { groupServers, envColor, logDisplayName } from "../remoteServers.mjs";
import { chainSummary, initialJumps } from "../jumpChain.mjs";

const linkBtn = {
  border:0, background:"none", color:"var(--pl-accent-hover)", cursor:"pointer", fontSize:10,
  fontFamily:"inherit", padding:"2px 4px",
};

function statusText(t, status) {
  if (!status) return { text:t("srv_never"), color:"var(--pl-text-6)" };
  const when = new Date(status.at).toLocaleString();
  return status.ok
    ? { text:`✓ ${when}`, color:"var(--pl-status-live)", title:t("srv_last_ok") }
    : { text:`✗ ${when}`, color:"var(--pl-error-text)", title:status.error };
}

export function ServerList({ servers, profiles, inputStyle, onOpenLog, onAddLog, onEditServer, onNewServer,
                             onDeleteServer, onDeleteLog, legacyWsl = [], onOpenLegacyWsl }) {
  const t = useLang();
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const groups = groupServers(servers, profiles, query);

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:12 }}>
        <input style={inputStyle} value={query} onChange={e => setQuery(e.target.value)} autoFocus
          placeholder={t("srv_search")} aria-label={t("srv_search")} />
        <button type="button" onClick={onNewServer}
          style={{ ...inputStyle, width:"auto", whiteSpace:"nowrap", cursor:"pointer", color:"var(--pl-accent-hover)" }}>
          + {t("srv_new")}
        </button>
      </div>

      {!groups.length && (
        <div style={{ color:"var(--pl-text-5)", fontSize:11, padding:"14px 4px" }}>
          {query ? t("srv_no_match") : t("srv_empty")}
        </div>
      )}

      {groups.map(group => (
        <section key={group.env || "none"} style={{ marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, color:"var(--pl-text-4)", fontSize:10,
                        fontWeight:700, textTransform:"uppercase", letterSpacing:".04em", marginBottom:6 }}>
            {group.env && <span aria-hidden="true" style={{ width:8, height:8, borderRadius:2, background:envColor(group.env) }} />}
            {group.env ? t(`env_${group.env}`) : t("env_none")}
          </div>
          {group.servers.map(({ server, logs }) => {
            const status = statusText(t, server.lastStatus);
            const color = envColor(server.env);
            const destination = `${server.user ? `${server.user}@` : ""}${server.target}`;
            return (
              <div key={server.id} style={{ border:"0.5px solid var(--pl-border)", borderRadius:6, marginBottom:8,
                                             background:"var(--pl-bg-input)", boxShadow: color ? `inset 3px 0 0 ${color}` : "none",
                                             padding:"8px 10px 8px 12px" }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:8, flexWrap:"wrap" }}>
                  <span style={{ color:"var(--pl-text-1)", fontSize:12, fontWeight:700 }}>{server.name}</span>
                  <span style={{ color:"var(--pl-text-5)", fontSize:10, overflow:"hidden", textOverflow:"ellipsis" }}
                    title={chainSummary(initialJumps(server), destination, t("jump_origin"))}>
                    {server.mode === "ssh-wsl" ? `WSL ${server.distro} · ` : server.mode === "ssh-native" ? `${t("srv_direct")} · ` : ""}
                    {destination}{initialJumps(server).length ? ` · ${t("srv_hops", initialJumps(server).length)}` : ""}
                  </span>
                  <span title={status.title} style={{ color:status.color, fontSize:10, marginLeft:"auto" }}>{status.text}</span>
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:7 }}>
                  {logs.map(log => (
                    <span key={log.id} style={{ display:"inline-flex", alignItems:"center", border:"0.5px solid var(--pl-border)",
                                                borderRadius:5, background:"var(--pl-bg-panel)" }}>
                      <button type="button" onClick={() => onOpenLog(log, server)}
                        title={log.source === "docker" ? `Docker · ${log.containerName || log.containerId}` : log.filePath}
                        style={{ border:0, background:"none", color:"var(--pl-text-2)", cursor:"pointer", fontSize:11,
                                 fontFamily:"inherit", padding:"4px 8px" }}>
                        {log.source === "docker" ? "🐳 " : ""}{log.name || logDisplayName(log)}
                      </button>
                      <button type="button" onClick={() => onDeleteLog(log)} title={t("srv_delete_log")} aria-label={t("srv_delete_log")}
                        style={{ border:0, background:"none", color:"var(--pl-text-6)", cursor:"pointer", fontSize:10, padding:"4px 6px 4px 0" }}>✕</button>
                    </span>
                  ))}
                  <button type="button" style={linkBtn} onClick={() => onAddLog(server)}>+ {t("srv_add_log")}</button>
                  <span style={{ marginLeft:"auto", display:"flex", gap:2 }}>
                    <button type="button" style={linkBtn} onClick={() => onEditServer(server)}>{t("srv_edit")}</button>
                    {confirmDelete === server.id ? (
                      <>
                        <button type="button" style={{ ...linkBtn, color:"var(--pl-error-text)", fontWeight:700 }}
                          onClick={() => { onDeleteServer(server); setConfirmDelete(""); }}>
                          {t("srv_delete_confirm", logs.length)}
                        </button>
                        <button type="button" style={linkBtn} onClick={() => setConfirmDelete("")}>{t("cancel")}</button>
                      </>
                    ) : (
                      <button type="button" style={{ ...linkBtn, color:"var(--pl-error-text)" }}
                        onClick={() => setConfirmDelete(server.id)}>{t("remote_profile_delete")}</button>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      ))}

      {legacyWsl.length > 0 && !query && (
        <section style={{ marginBottom:8 }}>
          <div style={{ color:"var(--pl-text-4)", fontSize:10, fontWeight:700, marginBottom:6 }}>WSL</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {legacyWsl.map(profile => (
              <button key={profile.id} type="button" onClick={() => onOpenLegacyWsl(profile)}
                style={{ ...inputStyle, width:"auto", cursor:"pointer", fontSize:11 }}>
                🐧 {profile.name || profile.filePath}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
