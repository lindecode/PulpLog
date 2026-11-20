// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Ctrl+K: type part of a server or log name, Enter opens that saved log in the focused pane.
import React, { useState, useMemo, useEffect, useRef } from "react";
import { useLang } from "../i18n.jsx";
import { envColor, logDisplayName, resolveLog } from "../remoteServers.mjs";
import { useEscapeToClose } from "../hooks.mjs";

/* Every word of the query must appear in "server / log / path" (any order). */
export function quickConnectItems(servers = [], profiles = [], query = "") {
  const byId = new Map(servers.map(server => [server.id, server]));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return profiles.filter(log => byId.has(log.serverId)).map(log => {
    const server = byId.get(log.serverId);
    const name = log.name || logDisplayName(log);
    const haystack = `${server.name} ${server.target} ${name} ${log.filePath || ""} ${log.containerName || ""} ${log.journalUnit || ""}`.toLowerCase();
    return { log, server, name, haystack };
  }).filter(item => words.every(word => item.haystack.includes(word)))
    .sort((a, b) => (a.server.name || "").localeCompare(b.server.name || "") || a.name.localeCompare(b.name))
    .slice(0, 50);
}

export function QuickConnect({ servers, profiles, onOpen, onClose, onManage }) {
  const t = useLang();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);
  const items = useMemo(() => quickConnectItems(servers, profiles, query), [servers, profiles, query]);
  useEscapeToClose(onClose);
  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => { listRef.current?.children[index]?.scrollIntoView({ block:"nearest" }); }, [index]);
  const open = item => { if (item) { onOpen(resolveLog(item.log, item.server)); onClose(); } };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:1100,
                                    display:"flex", justifyContent:"center", alignItems:"flex-start", paddingTop:"12vh" }}>
      <div data-float role="dialog" aria-modal="true" aria-label={t("qc_title")} onClick={e => e.stopPropagation()}
        style={{ width:"min(560px, calc(100vw - 32px))", background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)",
                 borderRadius:10, boxShadow:"0 8px 40px rgba(0,0,0,.8)", overflow:"hidden" }}>
        <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t("qc_placeholder")} aria-label={t("qc_title")}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex(i => Math.min(i + 1, items.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); open(items[index]); }
          }}
          style={{ width:"100%", boxSizing:"border-box", border:0, borderBottom:"0.5px solid var(--pl-border)", outline:"none",
                   background:"var(--pl-bg-input)", color:"var(--pl-text-1)", fontFamily:"inherit", fontSize:13, padding:"12px 14px" }} />
        <div ref={listRef} role="listbox" style={{ maxHeight:"50vh", overflowY:"auto" }}>
          {items.map((item, i) => (
            <div key={item.log.id} role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => open(item)}
              style={{ display:"flex", alignItems:"baseline", gap:8, padding:"8px 14px", cursor:"pointer",
                       background:i === index ? "var(--pl-bg-hover)" : "transparent",
                       boxShadow:envColor(item.server.env) ? `inset 3px 0 0 ${envColor(item.server.env)}` : "none" }}>
              <span style={{ color:"var(--pl-text-4)", fontSize:11 }}>{item.server.name}</span>
              <span style={{ color:"var(--pl-text-6)" }}>/</span>
              <span style={{ color:"var(--pl-text-1)", fontSize:12, fontWeight:600 }}>
                {item.log.source === "docker" ? "🐳 " : item.log.source === "journal" ? "⚙ " : ""}{item.name}
              </span>
              <span style={{ marginLeft:"auto", color:"var(--pl-text-6)", fontSize:10, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:200 }}>
                {item.log.source === "file" || !item.log.source ? item.log.filePath : ""}
              </span>
            </div>
          ))}
          {!items.length && (
            <div style={{ padding:"14px", color:"var(--pl-text-5)", fontSize:11 }}>
              {profiles.length ? t("srv_no_match") : t("qc_empty")}{" "}
              <button type="button" onClick={() => { onClose(); onManage(); }}
                style={{ border:0, background:"none", color:"var(--pl-accent-hover)", cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>
                {t("qc_manage")}
              </button>
            </div>
          )}
        </div>
        <div style={{ borderTop:"0.5px solid var(--pl-border)", padding:"6px 14px", color:"var(--pl-text-6)", fontSize:10 }}>{t("qc_footer")}</div>
      </div>
    </div>
  );
}
