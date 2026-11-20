// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// First screen of the SSH dialog: servers grouped by environment, each with its saved logs.
// Click a log to open it; "+ log" / "edit" go to the form with the server loaded.
import React, { useState, useEffect } from "react";
import { useLang } from "../i18n.jsx";
import { groupServers, envColor, logDisplayName, serversFromSshConfig, ENVIRONMENTS } from "../remoteServers.mjs";
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

/* Import from ~/.ssh/config (Windows or a WSL distro): pick aliases, they become servers. */
function SshConfigImport({ sources, servers, inputStyle, onImport, onClose }) {
  const t = useLang();
  const [from, setFrom] = useState(sources[0]?.value || "windows");
  const [candidates, setCandidates] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [env, setEnv] = useState("");
  useEffect(() => {
    let alive = true;
    setCandidates(null);
    window.electronAPI.readSshConfig(from).then(entries => {
      if (!alive) return;
      const mode = from.startsWith("wsl:") ? "ssh-wsl" : "ssh";
      const list = serversFromSshConfig(entries || [], { mode, distro:from.startsWith("wsl:") ? from.slice(4) : "" }, servers);
      setCandidates(list);
      setSelected(new Set(list.filter(item => !item.exists).map(item => item.entry.alias)));
    }).catch(() => alive && setCandidates([]));
    return () => { alive = false; };
  }, [from]);
  const chosen = (candidates || []).filter(item => !item.exists && selected.has(item.entry.alias));
  const toggle = alias => setSelected(prev => { const next = new Set(prev); next.has(alias) ? next.delete(alias) : next.add(alias); return next; });

  return (
    <div style={{ border:"0.5px solid var(--pl-border-focus)", borderRadius:6, padding:10, marginBottom:12, background:"var(--pl-bg-input)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:8 }}>
        <span style={{ color:"var(--pl-text-2)", fontSize:11, fontWeight:700 }}>{t("srv_import_config")}</span>
        <select style={{ ...inputStyle, width:"auto", padding:"4px 6px", fontSize:11 }} value={from} onChange={e => setFrom(e.target.value)}
          aria-label={t("remote_ssh_config_from")}>
          {sources.map(source => <option key={source.value} value={source.value}>{source.label}</option>)}
        </select>
        <button type="button" onClick={onClose} style={{ ...linkBtn, marginLeft:"auto" }}>✕</button>
      </div>
      {candidates === null ? <div style={{ color:"var(--pl-text-5)", fontSize:10 }}>{t("remote_testing")}</div>
        : !candidates.length ? <div style={{ color:"var(--pl-text-5)", fontSize:10 }}>{t("srv_import_none")}</div>
        : <div style={{ maxHeight:220, overflowY:"auto", display:"grid", gap:2 }}>
          {candidates.map(({ entry, exists }) => (
            <label key={entry.alias} style={{ display:"flex", gap:7, alignItems:"baseline", fontSize:11,
              color:exists ? "var(--pl-text-6)" : "var(--pl-text-2)" }}>
              <input type="checkbox" disabled={exists} checked={!exists && selected.has(entry.alias)} onChange={() => toggle(entry.alias)} />
              <b>{entry.alias}</b>
              <span style={{ color:"var(--pl-text-5)", fontSize:10 }}>
                {[entry.user && `${entry.user}@`, entry.hostName, entry.port && `:${entry.port}`].filter(Boolean).join("")}
                {entry.proxyJump ? ` · ${t("srv_via")} ${entry.proxyJump}` : ""}
                {exists ? ` · ${t("srv_import_exists")}` : ""}
              </span>
            </label>
          ))}
        </div>}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, flexWrap:"wrap" }}>
        <select style={{ ...inputStyle, width:"auto", padding:"4px 6px", fontSize:11 }} value={env} onChange={e => setEnv(e.target.value)} aria-label={t("srv_env")}>
          {ENVIRONMENTS.map(item => <option key={item || "none"} value={item}>{item ? t(`env_${item}`) : t("env_none")}</option>)}
        </select>
        <span style={{ color:"var(--pl-text-6)", fontSize:10, flex:1 }}>{t("srv_import_hint")}</span>
        <button type="button" disabled={!chosen.length} onClick={() => onImport(chosen.map(item => ({ ...item.server, env })))}
          style={{ ...inputStyle, width:"auto", cursor:chosen.length ? "pointer" : "not-allowed", color:"var(--pl-accent-hover)" }}>
          {t("srv_import_add", chosen.length)}
        </button>
      </div>
    </div>
  );
}

export function ServerList({ servers, profiles, inputStyle, onOpenLog, onAddLog, onEditServer, onNewServer,
                             onDeleteServer, onDeleteLog, legacyWsl = [], onOpenLegacyWsl,
                             configSources = [], onImportConfig, onExport, onImportFile, notice = "" }) {
  const t = useLang();
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
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
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:-6, marginBottom:10 }}>
        {configSources.length > 0 && <button type="button" style={linkBtn} onClick={() => setImporting(value => !value)}>⇣ {t("srv_import_config")}</button>}
        <button type="button" style={linkBtn} onClick={onImportFile}>⇣ {t("srv_import_file")}</button>
        {servers.length > 0 && <button type="button" style={linkBtn} onClick={onExport} title={t("srv_export_title")}>⇡ {t("srv_export")}</button>}
        {notice && <span style={{ color:"var(--pl-status-live)", fontSize:10, alignSelf:"center", marginLeft:"auto" }}>{notice}</span>}
      </div>
      {importing && <SshConfigImport sources={configSources} servers={servers} inputStyle={inputStyle}
        onClose={() => setImporting(false)} onImport={list => { onImportConfig(list); setImporting(false); }} />}

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
                        title={log.source === "docker" ? `Docker · ${log.containerName || log.containerId}` : log.source === "journal" ? logDisplayName(log) : log.filePath}
                        style={{ border:0, background:"none", color:"var(--pl-text-2)", cursor:"pointer", fontSize:11,
                                 fontFamily:"inherit", padding:"4px 8px" }}>
                        {log.source === "docker" ? "🐳 " : log.source === "journal" ? "⚙ " : ""}{log.sudo ? "# " : ""}{log.name || logDisplayName(log)}
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
