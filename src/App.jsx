import React, { useState, useEffect, useRef, useCallback } from "react";
import { LangCtx, T } from "./i18n.jsx";
import { IS_ELECTRON, reportMetric, RENDERER_STARTED_AT } from "./utils.mjs";
import { Pane, usePaneTabs } from "./components/Pane.jsx";
import { DiagPanel, SettingsModal, AboutModal, HelpGuideModal } from "./components/Modals.jsx";

export default function App() {
  const [about,        setAbout]       = useState(false);
  const [helpGuideOpen,setHelpGuideOpen]= useState(false);
  const [diagOpen,     setDiagOpen]    = useState(false);
  const [settingsOpen, setSettingsOpen]= useState(false);
  const [capabilities, setCapabilities]= useState(null);
  const [settings,     setSettings]    = useState({
    recentFiles:[], remoteProfiles:[], autoScrollDefault:false, showNumsDefault:true, maxLiveLines:500000, language:"es", theme:"classic"
  });
  const [splitDirection, setSplitDirection] = useState(null); // null | "row" | "column"
  const [splitRatio,     setSplitRatio]     = useState(0.5);
  const [focusedPane,    setFocusedPane]    = useState("A");   // "A" | "B" — transient, not persisted
  const [sessionReady,   setSessionReady]   = useState(!IS_ELECTRON);
  const [toast,          setToast]          = useState(null);
  const containerRef = useRef(null);
  const toastTimerRef = useRef(null);

  /* ── Translation function ── */
  const t = useCallback((key, ...args) => {
    const lang = settings.language || "es";
    const entry = (T[lang] ?? T.es)[key] ?? T.es[key] ?? key;
    return typeof entry === "function" ? entry(...args) : entry;
  }, [settings.language]);

  const notifyFileMissing = useCallback((fp) => {
    clearTimeout(toastTimerRef.current);
    const name = fp.split(/[\\/]/).pop();
    setToast(t("file_missing_toast", name));
    toastTimerRef.current = setTimeout(() => setToast(null), 6000);
  }, [t]);
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const paneA = usePaneTabs(setSettings, notifyFileMissing);
  const paneB = usePaneTabs(setSettings, notifyFileMissing);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      reportMetric("renderer-first-frame", performance.now() - RENDERER_STARTED_AT, "App mounted");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme || "classic";
  }, [settings.theme]);

  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    let alive = true;
    const timer = setTimeout(() => {
      window.electronAPI.getCapabilities()
        .then(caps => { if (alive) setCapabilities(caps); })
        .catch(() => { if (alive) setCapabilities({}); });
    }, 600);
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const savePref = useCallback((key, val) => {
    setSettings(prev => ({ ...prev, [key]: val }));
    if (IS_ELECTRON) window.electronAPI.setSettings({ [key]: val });
  }, []);

  const removeRecent = useCallback(async (fp) => {
    const recent = await window.electronAPI.removeRecentFile(fp);
    setSettings(prev => ({ ...prev, recentFiles: recent }));
  }, []);

  const clearAllRecent = useCallback(async () => {
    await window.electronAPI.setSettings({ recentFiles: [] });
    setSettings(prev => ({ ...prev, recentFiles: [] }));
  }, []);

  const saveRemoteProfiles = useCallback((remoteProfiles) => {
    setSettings(prev => ({ ...prev, remoteProfiles }));
    if (IS_ELECTRON) window.electronAPI.setSettings({ remoteProfiles });
  }, []);

  const closeSplit = () => {
    const contentTabs = paneB.tabs.filter(t => t.filePath || t.docker || t.remote);
    // Note: nextId from Pane won't be available here directly, we could just use Date.now() for the temporary welcome tab ID
    const newWelcomeId = Date.now();
    paneB.setTabs([{ id:newWelcomeId, label:"$welcome", filePath:null, fileSize:null }]);
    paneB.setActive(newWelcomeId);
    if (contentTabs.length) paneA.setTabs(prev => {
      const withoutWelcome = prev.filter(t => t.filePath || t.docker || t.remote);
      return [...withoutWelcome, ...contentTabs];
    });
    setSplitDirection(null);
    setFocusedPane("A");
  };

  const startDividerDrag = (e) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      const pos  = splitDirection === "column" ? ev.clientY - rect.top : ev.clientX - rect.left;
      const size = splitDirection === "column" ? rect.height : rect.width;
      setSplitRatio(Math.min(0.85, Math.max(0.15, pos / size)));
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /* ── Mount: load settings, restore session (both panes) or open initial file arg ── */
  useEffect(() => {
    if (!IS_ELECTRON) return;
    let alive = true;
    (async () => {
      try {
        const s = await window.electronAPI.getSettings();
        if (!alive) return;
        setSettings(prev => ({ ...prev, ...s, recentFiles: s.recentFiles || [] }));

        const initialArg = await window.electronAPI.getInitialFileArg();
        if (!alive) return;

        if (initialArg) {
          const stat = await window.electronAPI.statFile(initialArg);
          if (stat) {
            const label = initialArg.split(/[\\/]/).pop();
            const id = Date.now();
            paneA.setTabs(previous => {
              if (previous.length === 1 && previous[0].label === "$welcome") {
                return [{ id, label, filePath:initialArg, fileSize:stat.size }];
              }
              if (previous.some(t => t.filePath === initialArg)) return previous;
              return [...previous, { id, label, filePath:initialArg, fileSize:stat.size }];
            });
            const recent = await window.electronAPI.addRecentFile(initialArg);
            if (alive) setSettings(prev => ({ ...prev, recentFiles:recent }));
          }
        } else if (s.panes?.length) {
          const restorePane = (entries, setTabs) => {
            if (!alive) return false;
            const tabEntries = (entries || []).map((st, idx) => ({
              id:Date.now() + idx, label:st.label, filePath:st.filePath, fileSize:st.fileSize, groupStart:!!st.groupStart,
            }));
            if (!tabEntries.length) return false;
            setTabs(previous => {
              if (previous.length === 1 && previous[0].label === "$welcome") {
                return tabEntries;
              }
              return previous;
            });
            return true;
          };
          restorePane(s.panes[0]?.tabs, paneA.setTabs);
          if (s.splitDirection && s.panes[1]?.tabs?.length) {
            const restoredSecondPane = restorePane(s.panes[1].tabs, paneB.setTabs);
            if (restoredSecondPane) {
              setSplitDirection(s.splitDirection);
              setSplitRatio(s.splitRatio ?? 0.5);
            }
          }
        }
      } catch (error) {
        console.error("No se pudo restaurar la sesión", error);
      } finally {
        if (alive) setSessionReady(true);
      }
    })();
    const unsub = window.electronAPI.onOpenFileArg(fp => paneA.openFileByPath(fp));
    return () => { alive = false; unsub?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Persist both panes' tabs + split state on every change ── */
  useEffect(() => {
    if (!IS_ELECTRON || !sessionReady) return;
    const timer = setTimeout(() => {
      const serialize = tabs => tabs
        .filter(tb => tb.filePath && tb.filePath !== "__web__")
        .map(tb => ({ filePath: tb.filePath, label: tb.label, fileSize: tb.fileSize, groupStart: !!tb.groupStart }));
      const panes = [{ tabs: serialize(paneA.tabs) }];
      if (splitDirection) panes.push({ tabs: serialize(paneB.tabs) });
      window.electronAPI.setSettings({ panes, splitDirection, splitRatio });
    }, 600);
    return () => clearTimeout(timer);
  }, [sessionReady, paneA.tabs, paneB.tabs, splitDirection, splitRatio]);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    const cleanAbout = window.electronAPI.onMenuAbout(() => setAbout(true));
    const cleanHelpGuide = window.electronAPI.onMenuUserGuide(() => setHelpGuideOpen(true));
    return () => { cleanAbout?.(); cleanHelpGuide?.(); };
  }, []);

  /* ── Split-view menu commands ── */
  useEffect(() => {
    if (!IS_ELECTRON) return;
    const cleanRight = window.electronAPI.onMenuSplitRight(() => setSplitDirection("row"));
    const cleanDown  = window.electronAPI.onMenuSplitDown(()  => setSplitDirection("column"));
    const cleanClose = window.electronAPI.onMenuSplitClose(() => closeSplit());
    return () => { cleanRight?.(); cleanDown?.(); cleanClose?.(); };
  }, [closeSplit]);

  return (
    <LangCtx.Provider value={t}>
      <div style={{ display:"flex", flexDirection:"column", height:"100vh",
                    background:"var(--pl-bg-app)", color:"var(--pl-text-1)", overflow:"hidden",
                    fontFamily:"'JetBrains Mono','Fira Code','Cascadia Code',monospace" }}>

        {/* chrome bar */}
        <div style={{ display:"flex", alignItems:"stretch", background:"var(--pl-bg-tabbar)",
                      borderBottom:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}>
          <button onClick={() => setSplitDirection("row")}
            style={{ background: splitDirection==="row" ? "var(--pl-split-active-bg)" : "transparent",
                     border:"none", color: splitDirection==="row" ? "var(--pl-accent-alt)" : "var(--pl-text-6)",
                     padding:"0 14px", cursor:"pointer", fontSize:13,
                     borderRight:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}
            title={t("split_right_title")}>◨</button>

          <button onClick={() => setSplitDirection("column")}
            style={{ background: splitDirection==="column" ? "var(--pl-split-active-bg)" : "transparent",
                     border:"none", color: splitDirection==="column" ? "var(--pl-accent-alt)" : "var(--pl-text-6)",
                     padding:"0 14px", cursor:"pointer", fontSize:13,
                     borderRight:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}
            title={t("split_down_title")}>⬓</button>

          {splitDirection && (
            <button onClick={closeSplit}
              style={{ background:"transparent", border:"none", color:"var(--pl-icon-close)",
                       padding:"0 14px", cursor:"pointer", fontSize:13,
                       borderRight:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}
              title={t("split_close_title")}>✕</button>
          )}

          {IS_ELECTRON && (
            <button onClick={() => setDiagOpen(p => !p)}
              style={{ background: diagOpen ? "var(--pl-diag-active-bg)" : "transparent",
                       border:"none", color: diagOpen ? "var(--pl-icon-diag)" : "var(--pl-text-6)",
                       padding:"0 14px", cursor:"pointer", fontSize:13,
                       borderRight:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}
              title={t("diag_btn_title")}>
              📋
            </button>
          )}

          {IS_ELECTRON && (
            <button onClick={() => setSettingsOpen(p => !p)}
              style={{ background: settingsOpen ? "var(--pl-settings-active-bg)" : "transparent",
                       border:"none", color: settingsOpen ? "var(--pl-cat-remote)" : "var(--pl-text-6)",
                       padding:"0 14px", cursor:"pointer", fontSize:14,
                       borderRight:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}
              title={t("settings_title")}>
              ⚙
            </button>
          )}

          <button onClick={() => setAbout(true)}
            style={{ background:"transparent", border:"none", color:"var(--pl-text-7)",
                     padding:"0 14px", cursor:"pointer", fontSize:11,
                     marginLeft:"auto", flexShrink:0, fontFamily:"inherit" }}
            title={t("about_title")}>
            {t("about_btn")}
          </button>
        </div>

        <div ref={containerRef}
             style={{ display:"flex", flex:1, minHeight:0, overflow:"hidden",
                      flexDirection: splitDirection === "column" ? "column" : "row" }}>
          <div style={{ flexBasis: splitDirection ? `${splitRatio*100}%` : "100%",
                        minWidth:0, minHeight:0, display:"flex", overflow:"hidden" }}>
            <Pane paneId="A" focused={focusedPane==="A"} onFocus={() => setFocusedPane("A")}
                  pane={paneA} capabilities={capabilities} settings={settings}
                  onRemoteProfilesChange={saveRemoteProfiles} />
          </div>

          {splitDirection && (
            <>
              <div onMouseDown={startDividerDrag}
                   style={{ [splitDirection==="column" ? "height" : "width"]: 6, flexShrink:0,
                            cursor: splitDirection==="column" ? "row-resize" : "col-resize",
                            background:"var(--pl-border-soft)" }} />
              <div style={{ flexBasis: `${(1-splitRatio)*100}%`,
                            minWidth:0, minHeight:0, display:"flex", overflow:"hidden" }}>
                <Pane paneId="B" focused={focusedPane==="B"} onFocus={() => setFocusedPane("B")}
                      pane={paneB} capabilities={capabilities} settings={settings}
                      onRemoteProfilesChange={saveRemoteProfiles} />
              </div>
            </>
          )}
        </div>

        {diagOpen     && IS_ELECTRON && <DiagPanel onClose={() => setDiagOpen(false)} />}

        {settingsOpen && IS_ELECTRON && (
          <SettingsModal
            settings={settings}
            onClose={() => setSettingsOpen(false)}
            onOpenFile={(focusedPane === "B" ? paneB : paneA).openFileByPath}
            onRemoveRecent={removeRecent}
            onClearRecent={clearAllRecent}
            onTogglePref={savePref}
          />
        )}
        {about && <AboutModal onClose={() => setAbout(false)} />}
        {helpGuideOpen && <HelpGuideModal lang={settings.language || "es"} onClose={() => setHelpGuideOpen(false)} />}
        {toast && (
          <div role="alert" style={{ position:"fixed", left:"50%", bottom:20, transform:"translateX(-50%)",
                        zIndex:2000, display:"flex", alignItems:"center", gap:10, maxWidth:"min(560px, calc(100vw - 32px))",
                        padding:"10px 12px", borderRadius:8, background:"var(--pl-error-bg)",
                        border:"1px solid var(--pl-error-border)", color:"var(--pl-error-text)",
                        fontSize:12, boxShadow:"0 8px 28px rgba(0,0,0,.4)" }}>
            <span style={{ flexShrink:0 }}>⚠</span>
            <span style={{ flex:1, minWidth:0 }}>{toast}</span>
            <button onClick={() => setToast(null)} title={t("toast_dismiss")}
              style={{ flexShrink:0, background:"none", border:"none", color:"inherit",
                       cursor:"pointer", fontSize:13, padding:"0 2px", fontFamily:"inherit" }}>✕</button>
          </div>
        )}
      </div>
    </LangCtx.Provider>
  );
}
