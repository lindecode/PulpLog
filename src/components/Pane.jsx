import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLang } from "../i18n.jsx";
import { IS_ELECTRON } from "../utils.mjs";
import { LogTab } from "./LogTab.jsx";
import { DockerTab, DockerPicker } from "./DockerTab.jsx";
import { RemoteTab, RemotePicker } from "./RemoteTab.jsx";
import { Welcome } from "./Welcome.jsx";

/* ═══════════════════════════════════════════
   App shell (tabs)
═══════════════════════════════════════════ */
let nextId = 1;

/* ═══════════════════════════════════════════
   usePaneTabs — one independent tab list + all
   its tab-management actions. Called twice (pane
   A / pane B) from App() so each pane owns its
   own tabs/active/reopen-stack.
═══════════════════════════════════════════ */
function usePaneTabs(setSettings, notifyFileMissing) {
  const [tabs,          setTabs]         = useState(() => [{ id: nextId++, label:"$welcome", filePath:null, fileSize:null }]);
  const [active,        setActive]       = useState(() => tabs[0].id);
  const [dockerPicker,  setDockerPicker] = useState(false);
  const [remotePicker,  setRemotePicker] = useState(false);
  const [renamingTabId, setRenamingTabId]= useState(null);
  const fileRef       = useRef(null);
  const closedTabsRef = useRef([]);   // stack for reopen-last-tab
  const activeRef     = useRef(active);
  const tabsRef       = useRef(tabs);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  const addTab = (label, filePath, fileSize, extra = {}) => {
    const id = nextId++;
    const tab = { id, label, filePath, fileSize, ...extra };
    setTabs(p => p.length === 1 && !p[0].filePath && !p[0].docker && !p[0].remote ? [tab] : [...p, tab]);
    setActive(id);
  };

  const openFileByPath = useCallback(async (fp) => {
    const stat  = await window.electronAPI.statFile(fp);
    if (!stat) {
      const recent = await window.electronAPI.removeRecentFile(fp).catch(() => null);
      if (recent) setSettings(prev => ({ ...prev, recentFiles: recent }));
      notifyFileMissing?.(fp);
      return false;
    }
    const label = fp.split(/[\\/]/).pop();
    addTab(label, fp, stat.size);
    const recent = await window.electronAPI.addRecentFile(fp);
    setSettings(prev => ({ ...prev, recentFiles: recent }));
    return true;
  }, [setSettings, notifyFileMissing]);

  const openFile = useCallback(async () => {
    if (IS_ELECTRON) {
      const fp = await window.electronAPI.openFileDialog();
      if (!fp) return;
      await openFileByPath(fp);
    } else {
      fileRef.current?.click();
    }
  }, [openFileByPath]);

  const openDockerTab = (containerId, name) => {
    const id = nextId++;
    setTabs(p => [...p, { id, label: `🐳 ${name}`, filePath: null, fileSize: null, docker: { containerId, name } }]);
    setActive(id);
    setDockerPicker(false);
  };

  const openRemoteTab = (config) => {
    const id = nextId++;
    const name = config.mode === "wsl"
      ? (config.distro ? `WSL ${config.distro}` : "WSL")
      : config.mode === "ssh-wsl"
        ? `${config.distro || "WSL"} → ${config.target}`
      : (config.user && !config.target.includes("@") ? `${config.user}@${config.target}` : config.target);
    const prefix = config.mode === "wsl" ? "WSL2" : config.mode === "ssh-wsl" ? "SSH WSL2" : config.mode === "ssh-native" ? "SSH directo" : "SSH";
    setTabs(p => [...p, {
      id,
      label: `${prefix} ${name}`,
      filePath: null,
      fileSize: null,
      remote: config,
    }]);
    setActive(id);
    setRemotePicker(false);
  };

  const closeTab = (id) => {
    setTabs(prev => {
      const idx = prev.findIndex(tab => tab.id === id);
      const tab = prev[idx];
      if (tab?.filePath && tab.filePath !== "__web__")
        closedTabsRef.current.push({ label: tab.label, filePath: tab.filePath, fileSize: tab.fileSize });
      const next = prev.filter(tab => tab.id !== id);
      if (next.length === 0) {
        const newId = nextId++;
        setActive(newId);
        return [{ id: newId, label:"$welcome", filePath:null }];
      }
      setActive(a => a === id ? next[Math.min(idx, next.length - 1)].id : a);
      return next;
    });
  };

  const duplicateTab = (tabId) => {
    const idx = tabsRef.current.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    if (tabsRef.current[idx]?.remote) return;
    const newId = nextId++;
    setTabs(prev => {
      const currentIdx = prev.findIndex(t => t.id === tabId);
      if (currentIdx === -1) return prev;
      const clone = { ...prev[currentIdx], id: newId, reloadNonce: 0 };
      const next = [...prev];
      next.splice(currentIdx + 1, 0, clone);
      return next;
    });
    setActive(newId);
  };

  const reloadTab = (tabId) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, reloadNonce: (t.reloadNonce || 0) + 1 } : t));
  };

  const renameTab = (tabId, label) => {
    const trimmed = label.trim();
    if (trimmed) setTabs(prev => prev.map(t => t.id === tabId ? { ...t, label: trimmed } : t));
    setRenamingTabId(null);
  };

  const closeOtherTabs = (tabId) => {
    setTabs(prev => {
      const keep = prev.find(t => t.id === tabId);
      if (!keep) return prev;
      prev.forEach(t => {
        if (t.id !== tabId && t.filePath && t.filePath !== "__web__")
          closedTabsRef.current.push({ label: t.label, filePath: t.filePath, fileSize: t.fileSize });
      });
      return [keep];
    });
    setActive(tabId);
  };

  const closeTabsToRight = (tabId) => {
    const snapshot = tabsRef.current;
    const snapshotIndex = snapshot.findIndex(t => t.id === tabId);
    const activeWasRemoved = snapshotIndex >= 0 && snapshot.slice(snapshotIndex + 1).some(t => t.id === activeRef.current);
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      if (idx === -1) return prev;
      const removed = prev.slice(idx + 1);
      if (!removed.length) return prev;
      removed.forEach(t => {
        if (t.filePath && t.filePath !== "__web__")
          closedTabsRef.current.push({ label: t.label, filePath: t.filePath, fileSize: t.fileSize });
      });
      return prev.slice(0, idx + 1);
    });
    if (activeWasRemoved) setActive(tabId);
  };

  // exact behavior of the former inline global-shortcut handlers, now reusable
  const closeActiveTab = () => closeTab(activeRef.current);

  const reopenLastClosedTab = () => {
    const last = closedTabsRef.current.pop();
    if (!last) return;
    const id = nextId++;
    setTabs(p => [...p, { id, label: last.label, filePath: last.filePath, fileSize: last.fileSize }]);
    setActive(id);
  };

  const toggleGroupStart = (tabId) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, groupStart: !t.groupStart } : t));
  };

  const reorderTab = (draggedId, targetId) => {
    setTabs(prev => {
      const from = prev.findIndex(t => t.id === draggedId);
      const to   = prev.findIndex(t => t.id === targetId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  return {
    tabs, setTabs, active, setActive,
    dockerPicker, setDockerPicker, remotePicker, setRemotePicker,
    renamingTabId, setRenamingTabId, fileRef, closedTabsRef, activeRef, tabsRef,
    addTab, openDockerTab, openRemoteTab, openFile, openFileByPath,
    closeTab, duplicateTab, reloadTab, renameTab,
    closeOtherTabs, closeTabsToRight, closeActiveTab, reopenLastClosedTab,
    toggleGroupStart, reorderTab,
  };
}

/* ═══════════════════════════════════════════
   Pane — one pane's tab bar + content. Two of
   these are rendered by App() (side by side or
   stacked) when split, one when not.
═══════════════════════════════════════════ */
function Pane({ paneId, focused, onFocus, pane, capabilities, settings, onRemoteProfilesChange }) {
  const t = useLang();
  const {
    tabs, active, setActive,
    dockerPicker, setDockerPicker, remotePicker, setRemotePicker,
    renamingTabId, setRenamingTabId, fileRef,
    addTab, openDockerTab, openRemoteTab, openFile, openFileByPath,
    closeTab, duplicateTab, reloadTab, renameTab,
    closeOtherTabs, closeTabsToRight, closeActiveTab, reopenLastClosedTab,
    toggleGroupStart, reorderTab,
  } = pane;

  const isFocusedRef = useRef(focused);
  const [mountedTabIds, setMountedTabIds] = useState(() => new Set([active]));
  const [loadingTabIds, setLoadingTabIds] = useState(() => new Set());
  useEffect(() => { isFocusedRef.current = focused; }, [focused]);
  useEffect(() => {
    if (active == null) return;
    setMountedTabIds(previous => previous.has(active) ? previous : new Set([...previous, active]));
  }, [active]);

  const setTabLoading = useCallback((tabId, isLoading) => {
    setLoadingTabIds(previous => {
      const hasId = previous.has(tabId);
      if (hasId === isLoading) return previous;
      const next = new Set(previous);
      isLoading ? next.add(tabId) : next.delete(tabId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    const cleanOpenFile   = window.electronAPI.onMenuOpenFile(() => { if (isFocusedRef.current) openFile(); });
    const cleanOpenRecent = window.electronAPI.onMenuOpenRecent(fp => { if (isFocusedRef.current) openFileByPath(fp); });
    const cleanNewTab     = window.electronAPI.onMenuNewTab(() => { if (isFocusedRef.current) openFile(); });
    return () => { cleanOpenFile?.(); cleanOpenRecent?.(); cleanNewTab?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!IS_ELECTRON) return;
    const cleanClose  = window.electronAPI.onGlobalCloseTab(()  => { if (isFocusedRef.current) closeActiveTab(); });
    const cleanReopen = window.electronAPI.onGlobalReopenTab(() => { if (isFocusedRef.current) reopenLastClosedTab(); });
    return () => { cleanClose?.(); cleanReopen?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!IS_ELECTRON) return;
    const cleanup = window.electronAPI.onTabMenuAction(({ tabId, paneId: targetPane, action }) => {
      if (targetPane !== paneId) return;
      if (action === "duplicate") duplicateTab(tabId);
      else if (action === "reload") reloadTab(tabId);
      else if (action === "rename") setRenamingTabId(tabId);
      else if (action === "close-others") closeOtherTabs(tabId);
      else if (action === "close-right") closeTabsToRight(tabId);
      else if (action === "toggle-group-start") toggleGroupStart(tabId);
    });
    return () => cleanup?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = tabs.find(tab => tab.id === active) || tabs[0];
  const dockerCap = capabilities?.docker;
  const sshCap = capabilities?.ssh;
  const wslCap = capabilities?.wsl;
  const dockerEnabled = !!dockerCap?.available;
  const remoteEnabled = true;

  const handleFileDrop = (e) => {
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    e.preventDefault();
    onFocus();
    if (IS_ELECTRON) {
      Array.from(files).forEach(file => {
        let fp;
        try { fp = window.electronAPI.getPathForFile(file); } catch { fp = null; }
        if (fp) openFileByPath(fp);
      });
    } else {
      const file = files[0];
      addTab(file.name, "__web__", file.size, { webFile:file });
    }
  };

  const submitRemotePicker = (config) => {
    if (remotePicker && typeof remotePicker === "object" && remotePicker.tabId) {
      pane.setTabs(previous => previous.map(tab => tab.id === remotePicker.tabId
        ? { ...tab, remote:config, reloadNonce:(tab.reloadNonce || 0) + 1 }
        : tab));
      setRemotePicker(false);
      return;
    }
    openRemoteTab(config);
  };

  return (
    <div onMouseDownCapture={onFocus} onFocusCapture={onFocus}
         onDragOver={e => e.preventDefault()}
         onDrop={handleFileDrop}
         style={{ display:"flex", flexDirection:"column", flex:1, minWidth:0, minHeight:0, overflow:"hidden" }}>

      {/* tab bar */}
      <div style={{ display:"flex", alignItems:"stretch", background:"var(--pl-bg-tabbar)",
                    borderBottom:"0.5px solid var(--pl-border-soft)", flexShrink:0, overflowX:"auto" }}>
        {tabs.map((tab, idx) => (
          <div key={tab.id} style={{ display:"flex", alignItems:"stretch" }}>
            {tab.groupStart && idx > 0 && (
              <div style={{ width:2, alignSelf:"stretch", background:"var(--pl-text-7)", flexShrink:0 }} />
            )}
            <div
              draggable={renamingTabId !== tab.id}
              onDragStart={e => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(tab.id));
              }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const draggedId = Number(e.dataTransfer.getData("text/plain"));
                if (draggedId && draggedId !== tab.id) reorderTab(draggedId, tab.id);
              }}
              onClick={() => setActive(tab.id)}
              onContextMenu={e => {
                e.preventDefault();
                if (!IS_ELECTRON) return;
                window.electronAPI.showTabContextMenu({
                  tabId: tab.id,
                  paneId,
                  filePath: tab.filePath && tab.filePath !== "__web__" ? tab.filePath : null,
                  hasContent: !!(tab.docker || tab.remote || (tab.filePath && tab.filePath !== "__web__")),
                  tabCount: tabs.length,
                  canCloseRight: idx < tabs.length - 1,
                  groupStart: !!tab.groupStart,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              title={
                tab.docker   ? `🐳 ${tab.docker.name}\nID: ${tab.docker.containerId.slice(0, 12)}` :
                tab.remote   ? `${tab.remote.mode === "wsl" ? "WSL" : "SSH"}\n${tab.remote.filePath}` :
                tab.filePath ? tab.filePath :
                               t("hint_electron")
              }
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px",
                       borderRight:"0.5px solid var(--pl-border-soft)", cursor:"pointer", flexShrink:0,
                       fontSize:12, maxWidth:200, overflow:"hidden",
                       WebkitUserDrag:"element", userSelect:"none",
                       background: tab.id===active ? "var(--pl-bg-panel)":"transparent",
                       color:      tab.id===active ? "var(--pl-text-1)":"var(--pl-text-5)",
                       borderBottom: tab.id===active ? "1.5px solid var(--pl-accent)":"1.5px solid transparent" }}>
              {renamingTabId === tab.id ? (
                <input
                  autoFocus
                  defaultValue={tab.label === "$welcome" ? t("welcome_tab") : tab.label}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => renameTab(tab.id, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") e.target.blur();
                    else if (e.key === "Escape") setRenamingTabId(null);
                  }}
                  style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-accent)", borderRadius:3,
                           color:"var(--pl-text-1)", fontSize:12, fontFamily:"inherit", width:120, padding:"1px 4px" }}
                />
              ) : (
                <>
                  {loadingTabIds.has(tab.id) && (
                    <span aria-label={t("reading", 0)} style={{ display:"inline-block", flexShrink:0,
                      color:"var(--pl-accent)", animation:"spin 1s linear infinite" }}>↻</span>
                  )}
                  {!mountedTabIds.has(tab.id) && tab.filePath && (
                    <span title={t("reading", 0)} style={{ color:"var(--pl-text-7)", flexShrink:0 }}>○</span>
                  )}
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {tab.label === "$welcome" ? t("welcome_tab") : tab.label}
                  </span>
                </>
              )}
              {tabs.length > 1 && (
                <span style={{ fontSize:10, color:"var(--pl-text-6)", padding:"0 2px", cursor:"pointer",
                               flexShrink:0, borderRadius:3 }}
                  onClick={e => { e.stopPropagation(); closeTab(tab.id); }}>✕</span>
              )}
            </div>
          </div>
        ))}

        <button onClick={openFile}
          style={{ background:"transparent", border:"none", color:"var(--pl-text-6)",
                   padding:"0 14px", cursor:"pointer", fontSize:18,
                   borderRight:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}
          title={t("open_file_title")}>+</button>

        {IS_ELECTRON && (
          <button onClick={() => dockerEnabled && setDockerPicker(true)}
            disabled={!dockerEnabled}
            style={{ background:"transparent", border:"none", color: dockerEnabled ? "var(--pl-cat-docker)" : "var(--pl-text-7)",
                     padding:"0 14px", cursor: dockerEnabled ? "pointer" : "not-allowed", fontSize:14,
                     borderRight:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}
            title={dockerEnabled ? t("docker_btn_title") : (dockerCap?.reason || t("capability_checking"))}>
            🐳
          </button>
        )}

        {IS_ELECTRON && (
          <button onClick={() => remoteEnabled && setRemotePicker(true)}
            disabled={!remoteEnabled}
            style={{ background:"transparent", border:"none", color: remoteEnabled ? "var(--pl-cat-remote)" : "var(--pl-text-7)",
                     padding:"0 14px", cursor: remoteEnabled ? "pointer" : "not-allowed", fontSize:12,
                     borderRight:"0.5px solid var(--pl-border-soft)", flexShrink:0,
                     fontFamily:"inherit", fontWeight:700 }}
            title={remoteEnabled ? t("remote_btn_title") : (sshCap?.reason || wslCap?.reason || t("capability_checking"))}>
            SSH / WSL
          </button>
        )}

        {!IS_ELECTRON && (
          <input ref={fileRef} type="file" accept=".log,.txt,.out" style={{ display:"none" }}
            onChange={e => {
              const f = e.target.files[0];
              if (!f) return;
              addTab(f.name, "__web__", f.size, { webFile:f });
            }} />
        )}
      </div>

      {tabs.filter(tab => mountedTabIds.has(tab.id) || tab.id === activeTab.id).map(tab => (
        <div key={tab.id} aria-hidden={tab.id !== activeTab.id}
             style={{ display:tab.id === activeTab.id ? "flex" : "none", flex:1, minHeight:0, overflow:"hidden" }}>
          {tab.docker
            ? <DockerTab key={`docker-${tab.id}-${tab.reloadNonce || 0}`}
                         tabKey={String(tab.id)} maxLiveLines={settings.maxLiveLines}
                         containerId={tab.docker.containerId} containerName={tab.docker.name}
                         isActive={tab.id === activeTab.id && focused} />
            : tab.remote
              ? <RemoteTab key={`remote-${tab.id}-${tab.reloadNonce || 0}`}
                           tabKey={String(tab.id)} maxLiveLines={settings.maxLiveLines} config={tab.remote}
                           onConfigureConnection={() => setRemotePicker({ tabId:tab.id,
                             config:{ ...tab.remote, password:"", passphrase:"", trustHostForSession:false } })}
                           isActive={tab.id === activeTab.id && focused} />
              : tab.filePath
                ? <LogTab key={`${tab.id}-${tab.filePath}-${tab.reloadNonce || 0}`}
                          tabKey={String(tab.id)} filePath={tab.filePath} webFile={tab.webFile || null}
                          fileName={tab.label} fileSize={tab.fileSize}
                          onLoadingChange={setTabLoading}
                          autoScrollDefault={settings.autoScrollDefault}
                          showNumsDefault={settings.showNumsDefault}
                          isActive={tab.id === activeTab.id && focused} />
                : <Welcome onOpen={openFile} isElectron={IS_ELECTRON}
                           recentFiles={settings.recentFiles} onOpenRecent={openFileByPath} />}
        </div>
      ))}

      {dockerPicker && <DockerPicker onSelect={openDockerTab} onClose={() => setDockerPicker(false)} />}
      {remotePicker && <RemotePicker onSelect={submitRemotePicker} onClose={() => setRemotePicker(false)}
        capabilities={capabilities} profiles={settings.remoteProfiles || []}
        onProfilesChange={onRemoteProfilesChange}
        initialConfig={typeof remotePicker === "object" ? remotePicker.config : null} />}
    </div>
  );
}


export { usePaneTabs, Pane };
