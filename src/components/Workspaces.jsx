// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import React, { useState, useEffect, useRef } from "react";
import { useLang } from "../i18n.jsx";
import { useEscapeToClose } from "../hooks.mjs";
import { WS_PALETTE, entryKey, isPatternEntry } from "../workspaces.mjs";
import { RUNTIME_META, runtimeOf, originLabel } from "../containers.mjs";

const dot = (color, size = 9) => ({ width:size, height:size, borderRadius:"50%", background:color, flexShrink:0, display:"inline-block" });
const smallBtn = {
  background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:5,
  color:"var(--pl-text-3)", fontFamily:"inherit", fontSize:11, padding:"4px 10px", cursor:"pointer",
};

function entryDetail(entry) {
  if (entry.type === "file") return entry.filePath;
  if (entry.type === "docker") return `${entry.name || entry.containerId} · ${originLabel(entry)}`;
  const r = entry.remote || {};
  const host = r.mode === "wsl" ? `WSL ${r.distro || ""}` : `${r.user ? `${r.user}@` : ""}${r.target}`;
  return `${host} · ${r.source === "docker" ? (r.containerName || r.containerId) : r.filePath}`;
}

/* ── Chrome-bar selector: click = only this one, Ctrl/Cmd+click = add/remove ── */
export function WorkspaceSelector({ ws, onManage, onSaveOpen }) {
  const t = useLang();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const wsRef = useRef(ws);
  wsRef.current = ws;

  /* Ctrl+Alt+W (Cmd+Alt+W on macOS) toggles the selector from anywhere */
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === "KeyW") {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = e => {
      if (e.key === "Escape") { setOpen(false); return; }
      // 1–9 = activate/deactivate that workspace (others untouched); menu stays open
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (!digit || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = wsRef.current.workspaces[Number(digit[1]) - 1];
      if (!target) return;
      e.preventDefault();
      wsRef.current.select(target.id);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const active = ws.workspaces.filter(w => ws.activeIds.includes(w.id));

  return (
    <div ref={rootRef} style={{ position:"relative", display:"flex", borderRight:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}>
      <button onClick={() => setOpen(o => !o)} title={t("ws_btn_title")} aria-haspopup="menu" aria-expanded={open}
        style={{ display:"flex", alignItems:"center", gap:6, background: open ? "var(--pl-bg-hover)" : "transparent",
                 border:"none", color: active.length ? "var(--pl-text-2)" : "var(--pl-text-6)",
                 padding:"0 12px", cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>
        <span style={{ fontSize:13 }}>▦</span>
        {active.length === 0 && <span>{t("ws_btn")}</span>}
        {active.length === 1 && <><span style={dot(active[0].color)} /><span style={{ maxWidth:140, overflow:"hidden",
          textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{active[0].name}</span></>}
        {active.length > 1 && <>{active.map(w => <span key={w.id} style={dot(w.color)} />)}<span>{active.length}</span></>}
        <span style={{ fontSize:8, color:"var(--pl-text-6)" }}>▼</span>
      </button>

      {open && (
        <div role="menu" data-float
          style={{ position:"absolute", top:"100%", left:0, zIndex:900, minWidth:260, maxWidth:340, marginTop:2,
                   background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:8,
                   boxShadow:"0 8px 28px rgba(0,0,0,.5)", padding:6, fontSize:12 }}>
          {ws.workspaces.length === 0 && (
            <div style={{ padding:"8px 10px", color:"var(--pl-text-6)" }}>{t("ws_none")}</div>
          )}
          {ws.workspaces.map((w, index) => {
            const on = ws.activeIds.includes(w.id);
            return (
              <div key={w.id} role="menuitemcheckbox" aria-checked={on}
                onClick={() => ws.select(w.id)}
                style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", borderRadius:5, cursor:"pointer",
                         background: on ? "var(--pl-bg-hover)" : "transparent", color:"var(--pl-text-2)" }}>
                <input type="checkbox" checked={on} readOnly tabIndex={-1}
                  onClick={e => { e.stopPropagation(); ws.select(w.id); }}
                  style={{ margin:0, accentColor:w.color, cursor:"pointer" }} />
                <span style={dot(w.color)} />
                <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{w.name}</span>
                {ws.pendingIds.includes(w.id) && (
                  <span title={t("ws_pending")} style={{ fontSize:11, color:w.color }}>↻</span>
                )}
                {w.view === "merged" && <span title={t("ws_view_merged")} style={{ fontSize:11, color:"var(--pl-text-6)" }}>⧉</span>}
                <span style={{ fontSize:10, color:"var(--pl-text-6)" }}>{w.entries.length}</span>
                {index < 9 && (
                  <kbd style={{ fontSize:9, color:"var(--pl-text-6)", border:"0.5px solid var(--pl-border)", borderRadius:3,
                                padding:"0 4px", fontFamily:"inherit" }}>{index + 1}</kbd>
                )}
              </div>
            );
          })}
          {ws.workspaces.length > 0 && (
            <div style={{ padding:"4px 8px 0", fontSize:10, color:"var(--pl-text-7)" }}>{t("ws_keys_hint")}</div>
          )}
          <div style={{ height:0.5, background:"var(--pl-border-soft)", margin:"6px 0" }} />
          <MenuLink onClick={() => { setOpen(false); onSaveOpen(); }}>{t("ws_save_open")}</MenuLink>
          <MenuLink onClick={() => { setOpen(false); onManage(); }}>{t("ws_manage")}</MenuLink>
        </div>
      )}
    </div>
  );
}

function MenuLink({ children, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div role="menuitem" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ padding:"6px 8px", borderRadius:5, cursor:"pointer", color:"var(--pl-text-3)",
               background: hover ? "var(--pl-bg-hover)" : "transparent" }}>
      {children}
    </div>
  );
}

/* ── Manager modal ── */
export function WorkspacesModal({ ws, initialId, openTabEntries, onClose }) {
  const t = useLang();
  useEscapeToClose(onClose);
  const [selectedId, setSelectedId] = useState(initialId || ws.workspaces[0]?.id || null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = ws.workspaces.find(w => w.id === selectedId) || null;
  useEffect(() => { setConfirmDelete(false); }, [selectedId]);
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(ws.workspaces[0]?.id || null);
  }, [selectedId, selected, ws.workspaces]);

  const createNew = () => setSelectedId(ws.create({ name:t("ws_new_name") }).id);
  const duplicate = () => {
    if (!selected) return;
    setSelectedId(ws.create({ name:`${selected.name} (${t("ws_copy")})`, entries:selected.entries }).id);
  };
  const addFile = async () => {
    const fp = await window.electronAPI.openFileDialog();
    if (fp && selected) ws.addEntries(selected.id, [{ type:"file", filePath:fp, label:fp.split(/[\\/]/).pop() }]);
  };
  const isActive = selected && ws.activeIds.includes(selected.id);

  /* Pattern entry form */
  const [patternOpen, setPatternOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [latestOnly, setLatestOnly] = useState(true);
  const [preview, setPreview] = useState(null); // null | string[]
  const patternValid = isPatternEntry({ type:"file", filePath:pattern.trim() })
    && !/[*?]/.test(pattern.trim().split(/[\\/]/).slice(0, -1).join("/"));
  useEffect(() => {
    setPreview(null);
    if (!patternValid) return;
    let alive = true;
    const timer = setTimeout(() => {
      window.electronAPI.resolveWorkspacePattern(pattern.trim(), latestOnly)
        .then(files => { if (alive) setPreview(files.map(f => f.filePath.split(/[\\/]/).pop())); })
        .catch(() => { if (alive) setPreview([]); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [pattern, latestOnly, patternValid]);
  const addPattern = () => {
    if (!patternValid || !selected) return;
    const fp = pattern.trim();
    ws.addEntries(selected.id, [{ type:"file", filePath:fp, label:fp.split(/[\\/]/).pop(), latestOnly }]);
    setPattern(""); setPatternOpen(false);
  };

  /* Export / import */
  const [notice, setNotice] = useState(null);
  const flash = text => { setNotice(text); setTimeout(() => setNotice(null), 4000); };
  const exportList = async (list, name) => {
    try {
      const saved = await window.electronAPI.exportWorkspaces(list, name);
      if (saved) flash(t("ws_exported", saved.split(/[\\/]/).pop()));
    } catch (error) { flash(String(error?.message || error)); }
  };
  const importFile = async () => {
    try {
      const list = await window.electronAPI.importWorkspaces();
      if (!list) return;
      const added = ws.importMany(list);
      if (added[0]) setSelectedId(added[0].id);
      flash(t("ws_imported", added.length));
    } catch { flash(t("ws_import_invalid")); }
  };

  const setView = (view) => {
    if (!selected || selected.view === view) return;
    ws.update(selected.id, { view }); // applies on reopen
  };
  const isPending = selected && ws.pendingIds.includes(selected.id);

  return (
    <div onClick={onClose}
         style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
                  display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:16 }}>
      <div data-float onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("ws_title")}
           style={{ background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:10,
                    width:"min(820px, 100%)", height:"min(560px, calc(100vh - 32px))", display:"flex", flexDirection:"column",
                    boxShadow:"0 8px 40px rgba(0,0,0,.8)", fontFamily:"inherit", overflow:"hidden" }}>
        <div style={{ display:"flex", alignItems:"center", padding:"14px 18px", borderBottom:"0.5px solid var(--pl-border-soft)" }}>
          <span style={{ fontSize:14, fontWeight:700, color:"var(--pl-text-1)" }}>▦ {t("ws_title")}</span>
          {notice && <span role="status" style={{ marginLeft:14, fontSize:11, color:"var(--pl-text-4)" }}>{notice}</span>}
          <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
            <button onClick={importFile} style={smallBtn}>{t("ws_import")}</button>
            <button onClick={() => exportList(ws.workspaces, "pulplog-workspaces")} disabled={!ws.workspaces.length}
              style={{ ...smallBtn, opacity: ws.workspaces.length ? 1 : .5 }}>{t("ws_export_all")}</button>
          </div>
          <button onClick={onClose} style={{ marginLeft:12, background:"none", border:"none",
            color:"var(--pl-text-6)", cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>✕</button>
        </div>

        <div style={{ display:"flex", flex:1, minHeight:0 }}>
          {/* list */}
          <div style={{ width:220, flexShrink:0, borderRight:"0.5px solid var(--pl-border-soft)", display:"flex",
                        flexDirection:"column", minHeight:0 }}>
            <div style={{ flex:1, overflowY:"auto", padding:6 }}>
              {ws.workspaces.map(w => (
                <div key={w.id} onClick={() => setSelectedId(w.id)}
                  style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 8px", borderRadius:5, cursor:"pointer",
                           fontSize:12, color:"var(--pl-text-2)",
                           background: w.id === selectedId ? "var(--pl-bg-hover)" : "transparent" }}>
                  <span style={dot(w.color)} />
                  <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{w.name}</span>
                  {ws.activeIds.includes(w.id) && <span title={t("ws_active")} style={{ fontSize:9, color:"var(--pl-accent)" }}>●</span>}
                </div>
              ))}
            </div>
            <div style={{ padding:8, borderTop:"0.5px solid var(--pl-border-soft)" }}>
              <button onClick={createNew} style={{ ...smallBtn, width:"100%" }}>{t("ws_new")}</button>
            </div>
          </div>

          {/* detail */}
          <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", padding:"16px 18px", gap:14, overflowY:"auto" }}>
            {!selected ? (
              <div style={{ color:"var(--pl-text-6)", fontSize:12, margin:"auto" }}>{t("ws_select_hint")}</div>
            ) : (<>
              <div style={{ display:"flex", gap:10, alignItems:"flex-end", flexWrap:"wrap" }}>
                <label style={{ flex:1, minWidth:180, display:"flex", flexDirection:"column", gap:5, fontSize:10,
                                color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1 }}>
                  {t("ws_name").toUpperCase()}
                  <input key={selected.id} defaultValue={selected.name} maxLength={80}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== selected.name) ws.update(selected.id, { name:v }); }}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:5,
                             color:"var(--pl-text-1)", fontFamily:"inherit", fontSize:13, padding:"6px 8px", fontWeight:400,
                             letterSpacing:0 }} />
                </label>
                <button onClick={() => isActive ? ws.deactivate(selected.id) : ws.activate(selected.id)}
                  style={{ ...smallBtn, padding:"7px 14px",
                           ...(isActive ? { borderColor:selected.color, color:"var(--pl-text-1)" } : {}) }}>
                  {isActive ? t("ws_deactivate") : t("ws_activate")}
                </button>
              </div>

              {isPending && (
                <div role="status" style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:6,
                              border:`0.5px solid ${selected.color}`, background:"var(--pl-bg-input)", fontSize:11,
                              color:"var(--pl-text-3)", flexWrap:"wrap" }}>
                  <span style={{ flex:1, minWidth:180 }}>↻ {t("ws_pending")}</span>
                  <button onClick={() => ws.reopen(selected.id)}
                    style={{ ...smallBtn, borderColor:selected.color, color:"var(--pl-text-1)" }}>{t("ws_reopen")}</button>
                </div>
              )}

              <div>
                <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginBottom:7 }}>
                  {t("ws_color").toUpperCase()}
                </div>
                <div style={{ display:"flex", gap:7, alignItems:"center", flexWrap:"wrap" }}>
                  {WS_PALETTE.map(color => (
                    <button key={color} onClick={() => ws.update(selected.id, { color })} aria-label={color}
                      style={{ ...dot(color, 20), border: selected.color === color ? "2px solid var(--pl-text-1)" : "2px solid transparent",
                               cursor:"pointer", padding:0 }} />
                  ))}
                  <input type="color" value={selected.color} title={t("ws_color")}
                    onChange={e => ws.update(selected.id, { color:e.target.value.toUpperCase() })}
                    style={{ width:28, height:22, padding:0, border:"none", background:"none", cursor:"pointer" }} />
                </div>
              </div>

              <div>
                <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginBottom:7 }}>
                  {t("ws_view").toUpperCase()}
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                  {["tabs", "merged"].map(view => (
                    <button key={view} onClick={() => setView(view)} aria-pressed={selected.view === view}
                      style={{ ...smallBtn, ...(selected.view === view
                        ? { borderColor:"var(--pl-border-focus)", color:"var(--pl-text-1)", background:"var(--pl-bg-hover)" } : {}) }}>
                      {view === "tabs" ? `▭ ${t("ws_view_tabs")}` : `⧉ ${t("ws_view_merged")}`}
                    </button>
                  ))}
                  <span style={{ fontSize:10, color:"var(--pl-text-6)" }}>
                    {selected.view === "merged" ? t("ws_view_merged_hint") : t("ws_view_tabs_hint")}
                  </span>
                </div>
              </div>

              <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:120 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:7, flexWrap:"wrap" }}>
                  <span style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginRight:"auto" }}>
                    {t("ws_entries").toUpperCase()} · {selected.entries.length}
                  </span>
                  <button onClick={addFile} style={smallBtn}>{t("ws_add_file")}</button>
                  <button onClick={() => setPatternOpen(o => !o)} style={smallBtn} aria-expanded={patternOpen}>{t("ws_add_pattern")}</button>
                  <button onClick={() => ws.addEntries(selected.id, openTabEntries())} style={smallBtn}>{t("ws_add_open")}</button>
                </div>
                {patternOpen && (
                  <div style={{ border:"0.5px solid var(--pl-border)", borderRadius:6, padding:10, marginBottom:8,
                                display:"flex", flexDirection:"column", gap:7, fontSize:11 }}>
                    <input autoFocus value={pattern} onChange={e => setPattern(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addPattern(); if (e.key === "Escape") { e.stopPropagation(); setPatternOpen(false); } }}
                      placeholder="C:\logs\app-*.log"
                      style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:5,
                               color:"var(--pl-text-1)", fontFamily:"inherit", fontSize:12, padding:"6px 8px" }} />
                    <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                      <label style={{ display:"flex", alignItems:"center", gap:5, color:"var(--pl-text-3)", cursor:"pointer" }}>
                        <input type="checkbox" checked={latestOnly} onChange={e => setLatestOnly(e.target.checked)} style={{ margin:0 }} />
                        {t("ws_latest_only")}
                      </label>
                      <span style={{ color:"var(--pl-text-6)", flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}
                        title={preview?.join("\n") || ""}>
                        {!pattern.trim() ? t("ws_pattern_help")
                          : !patternValid ? t("ws_pattern_invalid")
                          : preview == null ? "…"
                          : preview.length ? t("ws_pattern_matches", preview.length, preview.slice(0, 3).join(", "))
                          : t("ws_pattern_none")}
                      </span>
                      <button onClick={addPattern} disabled={!patternValid}
                        style={{ ...smallBtn, opacity: patternValid ? 1 : .5 }}>{t("ws_pattern_add")}</button>
                    </div>
                  </div>
                )}
                <div style={{ border:"0.5px solid var(--pl-border-soft)", borderRadius:6, overflowY:"auto", flex:1 }}>
                  {selected.entries.length === 0 && (
                    <div style={{ padding:14, fontSize:12, color:"var(--pl-text-6)" }}>{t("ws_entries_empty")}</div>
                  )}
                  {selected.entries.map(entry => {
                    const key = entryKey(entry);
                    return (
                      <div key={key} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px",
                                              borderBottom:"0.5px solid var(--pl-border-soft)", fontSize:12 }}>
                        <span style={{ fontSize:9, color:"var(--pl-text-6)", width:52, flexShrink:0, textTransform:"uppercase" }}>
                          {isPatternEntry(entry) ? t("ws_type_pattern")
                            : entry.type === "docker" ? `${RUNTIME_META[runtimeOf(entry)].icon} ${RUNTIME_META[runtimeOf(entry)].label}`
                            : t(`ws_type_${entry.type}`)}
                          {isPatternEntry(entry) && (
                            <div style={{ fontSize:8, textTransform:"none" }}>
                              {entry.latestOnly !== false ? t("ws_latest_short") : t("ws_all_short")}
                            </div>
                          )}
                        </span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ color:"var(--pl-text-2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {entry.label || entryDetail(entry)}
                          </div>
                          <div title={entryDetail(entry)} style={{ fontSize:10, color:"var(--pl-text-6)", overflow:"hidden",
                                       textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{entryDetail(entry)}</div>
                        </div>
                        <button onClick={() => ws.removeEntry(selected.id, key)} title={t("ws_delete")}
                          style={{ background:"none", border:"none", color:"var(--pl-text-6)", cursor:"pointer", fontSize:11 }}>✕</button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                <button onClick={duplicate} style={smallBtn}>{t("ws_duplicate")}</button>
                <button onClick={() => exportList([selected], selected.name)} style={smallBtn}>{t("ws_export_one")}</button>
                {!confirmDelete ? (
                  <button onClick={() => setConfirmDelete(true)}
                    style={{ ...smallBtn, marginLeft:"auto", color:"var(--pl-error-text)" }}>{t("ws_delete")}</button>
                ) : (
                  <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center", fontSize:11, color:"var(--pl-text-3)" }}>
                    <span>{t("ws_delete_confirm")}</span>
                    <button onClick={() => { ws.remove(selected.id); setConfirmDelete(false); }}
                      style={{ ...smallBtn, color:"var(--pl-error-text)", borderColor:"var(--pl-error-border)" }}>{t("ws_confirm")}</button>
                    <button onClick={() => setConfirmDelete(false)} style={smallBtn}>{t("ws_cancel")}</button>
                  </div>
                )}
              </div>
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
