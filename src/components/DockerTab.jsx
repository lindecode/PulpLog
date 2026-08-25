import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLang } from "../i18n.jsx";
import { useDebouncedValue, useRowSelection, useEscapeToClose, useSearchShortcuts } from "../hooks.mjs";
import { useRememberedState, useBatchedLines, useFilteredLogs } from "../logHooks.mjs";
import { classifyLines, countLevels, appendRecentItems } from "../logProcessing.mjs";
import { reportMetric, safeFileName, buildResultText, copyResultText, exportResultText, fmtNum } from "../utils.mjs";
import { VirtualList, SelectedLineStatus } from "./VirtualList.jsx";
import { ContextInput, Btn, Sep } from "./SharedUI.jsx";

/* ═══════════════════════════════════════════
   Docker – container picker modal
═══════════════════════════════════════════ */
function DockerPicker({ onSelect, onClose }) {
  const t = useLang();
  const [containers, setContainers] = useState(null);
  const [error,      setError]      = useState(null);
  useEscapeToClose(onClose);

  useEffect(() => {
    window.electronAPI.listContainers()
      .then(res => res?.error ? setError(res.error) : setContainers(res))
      .catch(e  => setError(e.message));
  }, []);

  return (
    <div onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
               display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("docker_title")}
        style={{ background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:10,
                 padding:"24px", minWidth:440, maxWidth:580, fontFamily:"inherit",
                 boxShadow:"0 8px 40px rgba(0,0,0,.8)" }}>
        <div style={{ fontSize:14, color:"var(--pl-text-1)", fontWeight:700, marginBottom:16 }}>
          {t("docker_title")}
        </div>

        {containers === null && !error && (
          <div style={{ color:"var(--pl-text-6)", fontSize:12, padding:"8px 0" }}>{t("docker_connecting")}</div>
        )}
        {error && (
          <div style={{ color:"var(--pl-error-text)", fontSize:12, padding:"8px 0", lineHeight:1.6 }}>
            <span style={{ fontWeight:700 }}>Error:</span> {error}
            <br /><span style={{ color:"var(--pl-text-5)" }}>{t("docker_err_hint")}</span>
          </div>
        )}
        {containers?.length === 0 && (
          <div style={{ color:"var(--pl-text-5)", fontSize:12, padding:"8px 0" }}>{t("docker_empty")}</div>
        )}

        <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:320, overflowY:"auto" }}>
          {containers?.map(c => {
            const name   = c.Names?.[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
            const image  = c.Image ?? "";
            const status = c.Status ?? "";
            return (
              <div key={c.Id} onClick={() => onSelect(c.Id, name, image)}
                style={{ padding:"10px 14px", borderRadius:6, cursor:"pointer",
                         background:"var(--pl-bg-hover)", border:"0.5px solid var(--pl-border-soft)",
                         display:"flex", flexDirection:"column", gap:3,
                         transition:"background .1s" }}
                onMouseEnter={e => e.currentTarget.style.background="var(--pl-docker-row-hover)"}
                onMouseLeave={e => e.currentTarget.style.background="var(--pl-bg-hover)"}>
                <span style={{ color:"var(--pl-text-1)", fontSize:13, fontWeight:600 }}>{name}</span>
                <span style={{ color:"var(--pl-text-5)", fontSize:10 }}>{image} · {status}</span>
              </div>
            );
          })}
        </div>

        <button onClick={onClose}
          style={{ marginTop:20, background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                   borderRadius:6, color:"var(--pl-text-4)", fontFamily:"inherit",
                   fontSize:11, padding:"6px 20px", cursor:"pointer" }}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Docker – log streaming tab
═══════════════════════════════════════════ */
function DockerTab({ tabKey, maxLiveLines, containerId, containerName, isActive = false }) {
  const t = useLang();
  const searchInputRef = useRef(null);
  const filterInputRef = useRef(null);
  useSearchShortcuts(searchInputRef, filterInputRef, isActive);

  const selectionSource = `docker-${containerName}`;
  const [classified, setClassified] = useState([]);
  const [spawned,    setSpawned]   = useState(false);
  const [connected,  setConnected] = useState(false);
  const [error,      setError]     = useState(null);
  const [filter,       setFilter]       = useRememberedState(tabKey, "filter", "");
  const [filterUseRegex, setFilterUseRegex] = useRememberedState(tabKey, "useRegex", false);
  const filterDebounced = useDebouncedValue(filter);
  const [context,      setContext]      = useRememberedState(tabKey, "context", 0);
  const [search,       setSearch]       = useRememberedState(tabKey, "search", "");
  const [searchUseRegex, setSearchUseRegex] = useRememberedState(tabKey, "searchUseRegex", false);
  const searchDebounced = useDebouncedValue(search);
  const [matchCursor,  setMatchCursor]  = useRememberedState(tabKey, "matchCursor", -1);
  const [filterRegexError, setFilterRegexError] = useState(false);
  const [searchRegexError, setSearchRegexError] = useState(false);
  const [bookmarks,  setBookmarks] = useRememberedState(tabKey, "bookmarks", () => new Set());
  const [bmCursor,   setBmCursor]  = useRememberedState(tabKey, "bmCursor", -1);

  const [showNums,   setShowNums]  = useRememberedState(tabKey, "showNums", true);
  const [autoScroll, setAutoScroll]= useRememberedState(tabKey, "autoScroll", true);
  const [lvl, setLvl] = useRememberedState(tabKey, "levels", () => ({
    error:true, warn:true, info:true, debug:true, trace:true, stack:true, plain:true,
  }));
  const { selection, setSelection, selectionRef } = useRowSelection(tabKey, classified);

  const listRef       = useRef(null);
  const nextLineRef   = useRef(1);
  const autoScrollRef = useRef(true);
  const enqueueLines = useBatchedLines(incoming => {
    const batch = classifyLines(incoming, nextLineRef.current);
    nextLineRef.current += incoming.length;
    setClassified(prev => appendRecentItems(prev, batch, maxLiveLines));
    setConnected(true);
    if (autoScrollRef.current && selectionRef.current.lines.size === 0) listRef.current?.scrollToBottom();
  }, 75, maxLiveLines);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);

  useEffect(() => {
    const unwatch = window.electronAPI.streamDockerLogs(containerId, {
      onSpawned() { setSpawned(true); },
      onLines(text) {
        enqueueLines(text.split("\n").filter(Boolean));
      },
      onEnd()      { setConnected(false); },
      onError(msg) { setError(msg); setConnected(false); },
    });
    return unwatch;
  }, [containerId]);

  const stats = useMemo(() => countLevels(classified), [classified]);

  const { filtered, filterRegexValid, searchRegexValid, matchOrigLines } =
    useFilteredLogs("docker", classified, filterDebounced, filterUseRegex, lvl, context, searchDebounced, searchUseRegex, reportMetric);

  const shownCount = useMemo(() => filtered.filter(x => !x.separator).length, [filtered]);

  const droppedCount = Math.max(0, nextLineRef.current - 1 - classified.length);

  useEffect(() => setFilterRegexError(!filterRegexValid), [filterRegexValid]);
  useEffect(() => setSearchRegexError(!searchRegexValid), [searchRegexValid]);

  const toggleBookmark = useCallback((origLine) => {
    setBookmarks(prev => {
      const next = new Set(prev);
      next.has(origLine) ? next.delete(origLine) : next.add(origLine);
      return next;
    });
  }, []);

  const sortedBookmarks = useMemo(() => [...bookmarks].sort((a, b) => a - b), [bookmarks]);

  const jumpBookmark = useCallback((direction) => {
    if (!sortedBookmarks.length) return;
    const next = direction === "next"
      ? (bmCursor >= sortedBookmarks.length - 1 ? 0 : bmCursor + 1)
      : (bmCursor <= 0 ? sortedBookmarks.length - 1 : bmCursor - 1);
    setBmCursor(next);
    const idx = filtered.findIndex(x => x.origLine >= sortedBookmarks[next]);
    if (idx >= 0) listRef.current?.scrollToIndex(idx);
  }, [sortedBookmarks, bmCursor, filtered]);

  const jumpMatch = useCallback((direction) => {
    if (!matchOrigLines.length) return;
    const next = direction === "next"
      ? (matchCursor >= matchOrigLines.length - 1 ? 0 : matchCursor + 1)
      : (matchCursor <= 0 ? matchOrigLines.length - 1 : matchCursor - 1);
    setMatchCursor(next);
    const idx = filtered.findIndex(x => x.origLine >= matchOrigLines[next]);
    if (idx >= 0) {
      listRef.current?.scrollToIndex(idx);
      const hitLine = filtered[idx].origLine;
      setSelection({ lines:new Set([hitLine]), active:hitLine, anchor:hitLine });
    }
  }, [matchOrigLines, matchCursor, filtered, setSelection]);

  const toggle = (key, event) => setLvl(p => {
    if (!event?.ctrlKey && !event?.metaKey) return { ...p, [key]: !p[key] };
    // Ctrl/Cmd+click "solos" this level; pressing it again while already
    // isolated restores every level instead of leaving everything hidden.
    const isolated = Object.keys(p).every(k => p[k] === (k === key));
    return Object.fromEntries(Object.keys(p).map(k => [k, isolated || k === key]));
  });

  const BADGES = [
    { key:"error", label:"ERROR", bg:"var(--pl-chip-error-bg)", fg:"var(--pl-chip-error-fg)", cnt:stats.error },
    { key:"warn",  label:"WARN",  bg:"var(--pl-chip-warn-bg)",  fg:"var(--pl-chip-warn-fg)",  cnt:stats.warn  },
    { key:"info",  label:"INFO",  bg:"var(--pl-chip-info-bg)",  fg:"var(--pl-chip-info-fg)",  cnt:stats.info  },
    { key:"debug", label:"DEBUG", bg:"var(--pl-chip-debug-bg)", fg:"var(--pl-chip-debug-fg)", cnt:stats.debug },
    { key:"trace", label:"TRACE", bg:"var(--pl-chip-trace-bg)", fg:"var(--pl-chip-trace-fg)", cnt:stats.trace },
    { key:"stack", label:"STACK", bg:"var(--pl-chip-stack-bg)", fg:"var(--pl-chip-stack-fg)", cnt:null        },
    { key:"plain", label:"PLAIN", bg:"var(--pl-chip-plain-bg)", fg:"var(--pl-chip-plain-fg)", cnt:null        },
  ];

  const copyResults = useCallback(() => {
    const text = buildResultText({ source: `Docker ${containerName}`, filter, items: filtered, total: classified.length });
    copyResultText(text);
  }, [containerName, filter, filtered, classified.length]);

  const exportResults = useCallback(() => {
    const source = `docker-${containerName}`;
    const text = buildResultText({ source: `Docker ${containerName}`, filter, items: filtered, total: classified.length });
    exportResultText(`${safeFileName(source)}-filtered.log`, text);
  }, [containerName, filter, filtered, classified.length]);

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0, overflow:"hidden" }}>

      {/* toolbar */}
      <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"7px 10px",
                    background:"var(--pl-bg-panel)", borderBottom:"0.5px solid var(--pl-border-soft)",
                    flexShrink:0 }}>

        {/* row 1: filter + search + context + match nav */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
          <span style={{ fontSize:11, color:"var(--pl-cat-docker)", background:"var(--pl-docker-badge-bg)",
                         border:"0.5px solid var(--pl-docker-badge-border)", borderRadius:6, padding:"3px 8px",
                         fontWeight:700, flexShrink:0, whiteSpace:"nowrap" }}>
            🐳 {containerName}
          </span>

          <div style={{ display:"flex", flex:"1 1 120px", minWidth:60 }}>
            <input
              ref={searchInputRef}
              style={{ flex:1, minWidth:0, background:"var(--pl-bg-input)",
                       border:`0.5px solid ${searchRegexError ? "var(--pl-error-border)" : "var(--pl-border)"}`,
                       borderRadius:"6px 0 0 6px", color: searchRegexError ? "var(--pl-error-text)" : "var(--pl-text-2)",
                       fontFamily:"inherit", fontSize:12, padding:"4px 10px", outline:"none" }}
              placeholder={searchUseRegex ? t("search_regex_ph") : t("search_ph")}
              title={searchRegexError ? t("search_regex_invalid_title") : undefined}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                jumpMatch(e.shiftKey ? "prev" : "next");
              }}
            />
            <button onClick={() => setSearchUseRegex(p => !p)}
              title={t("search_regex_btn_title")}
              style={{ background: searchUseRegex ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                       border:`0.5px solid ${searchUseRegex ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                       borderLeft:"none", borderRadius:"0 6px 6px 0",
                       color: searchUseRegex ? "var(--pl-accent-hover)" : "var(--pl-text-5)",
                       fontFamily:"monospace", fontSize:11, padding:"4px 10px",
                       cursor:"pointer", fontWeight: searchUseRegex ? 700 : 400 }}>
              .*
            </button>
          </div>

          <div style={{ display:"flex", flex:"1 1 120px", minWidth:60 }}>
            <input
              ref={filterInputRef}
              style={{ flex:1, minWidth:0, background:"var(--pl-bg-input)",
                       border:`0.5px solid ${filterRegexError ? "var(--pl-error-border)" : "var(--pl-border)"}`,
                       borderRadius:"6px 0 0 6px", color: filterRegexError ? "var(--pl-error-text)" : "var(--pl-text-2)",
                       fontFamily:"inherit", fontSize:12, padding:"4px 10px", outline:"none" }}
              placeholder={filterUseRegex ? t("regex_ph") : t("filter_ph")}
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <button onClick={() => setFilterUseRegex(p => !p)}
              title={t("regex_btn_title")}
              style={{ background: filterUseRegex ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                       border:`0.5px solid ${filterUseRegex ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                       borderLeft:"none", borderRadius:"0 6px 6px 0",
                       color: filterUseRegex ? "var(--pl-accent-hover)" : "var(--pl-text-5)",
                       fontFamily:"monospace", fontSize:11, padding:"4px 10px",
                       cursor:"pointer", fontWeight: filterUseRegex ? 700 : 400 }}>
              .*
            </button>
          </div>

          <ContextInput value={context} onChange={setContext} />

          {(filter || search) && matchOrigLines.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0, whiteSpace:"nowrap" }}>
              <Btn onClick={() => jumpMatch("prev")} title={t("match_prev_title")}>▲</Btn>
              <Btn onClick={() => jumpMatch("next")} title={t("match_next_title")}>▼</Btn>
              <span style={{ fontSize:10, color:"var(--pl-text-4)" }}>
                {t("match_count", matchCursor < 0 ? 0 : matchCursor + 1, matchOrigLines.length)}
              </span>
            </div>
          )}
        </div>

        {/* row 2: level chips + bookmarks + actions */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>

        {BADGES.map(({ key, label, bg, fg, cnt }) => (
          <span key={key} onClick={event => toggle(key, event)} title={t("level_toggle_title")}
            style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11,
                     padding:"3px 7px", borderRadius:6, fontWeight:600,
                     cursor:"pointer", userSelect:"none",
                     background: lvl[key] ? bg : "var(--pl-bg-input)",
                     color:      lvl[key] ? fg : "var(--pl-text-6)",
                     border:     `1.5px solid ${lvl[key] ? bg : "var(--pl-border-soft)"}`,
                     opacity:    lvl[key] ? 1 : 0.45 }}>
            {label}
            {cnt > 0 && <span style={{ background:"var(--pl-badge-overlay)", borderRadius:4, padding:"0 4px", fontSize:10 }}>{fmtNum(cnt)}</span>}
          </span>
        ))}

        <Sep />

        <Btn onClick={() => jumpBookmark("prev")} disabled={!sortedBookmarks.length} title={t("bm_prev_title")}>◆ ↑</Btn>
        <Btn onClick={() => jumpBookmark("next")} disabled={!sortedBookmarks.length} title={t("bm_next_title")}>◆ ↓</Btn>
        {bookmarks.size > 0 && <span style={{ fontSize:10, color:"var(--pl-bookmark)", padding:"0 2px" }}>{t("bm_count", bookmarks.size)}</span>}
        {bookmarks.size > 0 && <Btn onClick={() => { setBookmarks(new Set()); setBmCursor(-1); }} title={t("bm_clear_title")}>{t("bm_clear_btn")}</Btn>}
        <Btn onClick={copyResults} disabled={!filtered.length} title={t("copy_results_title")}>{t("copy_results")}</Btn>
        <Btn onClick={exportResults} disabled={!filtered.length} title={t("export_results_title")}>{t("export_results")}</Btn>

        <Sep />

        <Btn active={autoScroll} variant="accent" onClick={() => { setAutoScroll(p => { if (!p) listRef.current?.scrollToBottom(); return !p; }); }} title={t("autoscroll_title")}>{t("autoscroll_btn")}</Btn>
        <Btn active={showNums}   onClick={() => setShowNums(p => !p)}   title={t("linenums_title")}>#</Btn>
        <Btn onClick={() => listRef.current?.scrollToTop()}>{t("scroll_top")}</Btn>
        <Btn onClick={() => listRef.current?.scrollToBottom()}>{t("scroll_bottom")}</Btn>
        </div>
      </div>

      {/* error banner */}
      {error && (
        <div style={{ padding:"6px 14px", background:"var(--pl-error-bg)", borderBottom:"1px solid var(--pl-error-border)",
                      color:"var(--pl-error-text)", fontSize:12, flexShrink:0, fontFamily:"inherit" }}>
          ⚠ {error}
        </div>
      )}

      {/* content */}
      {classified.length === 0 && !error ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:10, color:"var(--pl-text-7)", fontSize:13 }}>
          <span style={{ fontSize:28, color:"var(--pl-status-live)", animation:"spin 1s linear infinite" }}>↻</span>
          {spawned ? t("docker_waiting") : t("docker_starting")}
          {spawned && <span style={{ fontSize:10, color:"var(--pl-text-8)" }}>{t("docker_no_logs")}</span>}
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      color:"var(--pl-text-7)", fontSize:13 }}>
          {filterRegexError
            ? <><span style={{ color:"var(--pl-error-text)" }}>⚠</span> {t("regex_invalid")}</>
            : filter ? t("no_results", filter) : t("no_lines")}
        </div>
      ) : (
        <VirtualList
          items={filtered}
          sourceItems={classified}
          showNums={showNums}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
          selection={selection}
          setSelection={setSelection}
          listRef={listRef}
          stateKey={tabKey}
          selectionSource={selectionSource}
          onFilterText={setFilter}
          onJumpBookmark={jumpBookmark}
          onUserScrollUp={() => setAutoScroll(false)}
          autoScroll={autoScroll}
        />
      )}

      {/* status bar */}
      <div style={{ display:"flex", gap:14, padding:"4px 10px", background:"var(--pl-bg-footer)",
                    borderTop:"0.5px solid var(--pl-border-soft)", fontSize:10, flexShrink:0, alignItems:"center" }}>
        {[["var(--pl-error-border)",stats.error,"err"],["var(--pl-stat-warn)",stats.warn,"warn"],
          ["var(--pl-stat-info)",stats.info,"info"],["var(--pl-stat-debug)",stats.debug,"dbg"]].map(([c,n,l])=>(
          <span key={l} style={{ color:c }}>{fmtNum(n)} <span style={{color:"var(--pl-text-8)"}}>{l}</span></span>
        ))}
        {connected  && <span style={{ color:"var(--pl-status-live)" }}>{t("live")}</span>}
        {!connected && classified.length > 0 && <span style={{ color:"var(--pl-status-stopped)" }}>{t("stopped")}</span>}
        {droppedCount > 0 && <span style={{ color:"var(--pl-status-warn)" }}>{t("lines_discarded", droppedCount)}</span>}
        {bookmarks.size > 0 && <span style={{ color:"var(--pl-bookmark)" }}>◆ {bookmarks.size}</span>}
        <SelectedLineStatus selection={selection} visibleItems={filtered}
          onClear={() => setSelection({ lines:new Set(), active:null, anchor:null })} />
        <span style={{ marginLeft:"auto", color:"var(--pl-text-6)" }}>
          {t("lines", shownCount, classified.length)}
        </span>
      </div>
    </div>
  );
}


export { DockerPicker, DockerTab };
