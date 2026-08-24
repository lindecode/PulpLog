import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLang } from "../i18n.jsx";
import { useDebouncedValue, useRowSelection } from "../hooks.mjs";
import { useRememberedState, useFilteredLogs } from "../logHooks.mjs";
import { classifyLines, countLevels, splitTextChunk } from "../logProcessing.mjs";
import { createLogWorkerClient } from "../logWorkerClient.mjs";
import { IS_ELECTRON, getCachedFile, cacheFile, reportMetric, safeFileName, buildResultText, copyResultText, exportResultText, fmtSize, fmtNum } from "../utils.mjs";
import { VirtualList, SelectedLineStatus } from "./VirtualList.jsx";
import { ContextInput, Btn, Sep } from "./SharedUI.jsx";
import { RotationBanner } from "./Modals.jsx";

/* ═══════════════════════════════════════════
   LogTab
═══════════════════════════════════════════ */
function LogTab({ tabKey, filePath, webFile = null, fileName, fileSize, onLoadingChange,
                  autoScrollDefault = false, showNumsDefault = true }) {
  const t = useLang();
  const selectionSource = fileName || filePath || "pulplog";
  const [classified,  setClassified] = useState([]);
  const [stats,       setStats]      = useState({ error:0, warn:0, info:0, debug:0, trace:0 });
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState(null);
  const [progress,    setProgress]    = useState(0);
  const [tailing,     setTailing]     = useRememberedState(tabKey, "tailing", true);
  const [autoScroll,  setAutoScroll]  = useRememberedState(tabKey, "autoScroll", autoScrollDefault);
  const [showNums,    setShowNums]    = useRememberedState(tabKey, "showNums", showNumsDefault);
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
  const [bookmarks,   setBookmarks]   = useRememberedState(tabKey, "bookmarks", () => new Set());
  const [bmCursor,    setBmCursor]    = useRememberedState(tabKey, "bmCursor", -1);

  const [rotation,    setRotation]    = useState(null);
  const [reloadKey,   setReloadKey]   = useState(0);
  const [lvl, setLvl] = useRememberedState(tabKey, "levels", () => ({
    error:true, warn:true, info:true, debug:true, trace:true, stack:true, plain:true
  }));
  const { selection, setSelection, selectionRef } = useRowSelection(tabKey, classified);

  const listRef       = useRef(null);
  const itemsRef      = useRef([]);
  const carryRef      = useRef("");
  const statsRef      = useRef({ error:0, warn:0, info:0, debug:0, trace:0 });
  const progressRef   = useRef(0);
  const loadedRef     = useRef(false);
  const workerRef     = useRef(null);
  const processingRef = useRef(Promise.resolve());
  const nextParsedRef = useRef(1);
  const readStartedRef= useRef(0);
  const timerRef      = useRef(null);
  const watchOffsetRef= useRef(null);
  const autoScrollRef = useRef(autoScroll);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);
  useEffect(() => { onLoadingChange?.(Number(tabKey), loading); }, [tabKey, loading, onLoadingChange]);

  const appendCompleteLines = (lines) => {
    if (!lines.length) return processingRef.current;
    const startLine = nextParsedRef.current;
    nextParsedRef.current += lines.length;
    processingRef.current = processingRef.current.then(async () => {
      const result = workerRef.current
        ? await workerRef.current.process(lines, startLine)
        : (() => {
            const items = classifyLines(lines, startLine);
            return { items, stats:countLevels(items) };
          })();
      itemsRef.current.push(...result.items);
      for (const key of ["error", "warn", "info", "debug", "trace"]) {
        statsRef.current[key] += result.stats[key] || 0;
      }
    });
    return processingRef.current;
  };
  const appendChunk = (chunk) => {
    const split = splitTextChunk(carryRef.current, chunk);
    carryRef.current = split.carry;
    appendCompleteLines(split.lines);
  };

  const publishLoadedData = async () => {
    if (carryRef.current) appendCompleteLines([carryRef.current]);
    await processingRef.current;
    carryRef.current = "";
    setClassified(itemsRef.current);
    setStats({ ...statsRef.current });
  };

  const cacheCurrentFile = (expectedSize = null) => {
    if (!IS_ELECTRON || !loadedRef.current) return;
    const items = itemsRef.current;
    const counts = { ...statsRef.current };
    window.electronAPI.statFile(filePath).then(stat => {
      if (stat && (expectedSize === null || stat.size === expectedSize)) {
        cacheFile(filePath, stat, items, counts);
      }
    }).catch(() => {});
  };

  /* Stream read */
  useEffect(() => {
    if (!filePath) return;
    let disposed = false;
    let cancelRead = null;
    setLoading(true); setLoadError(null); setProgress(0); setClassified([]);
    loadedRef.current = false;
    readStartedRef.current = performance.now();

    const resetBuffers = () => {
      itemsRef.current = [];
      carryRef.current = "";
      statsRef.current = { error:0, warn:0, info:0, debug:0, trace:0 };
      progressRef.current = 0;
      processingRef.current = Promise.resolve();
      nextParsedRef.current = 1;
      workerRef.current?.terminate();
      workerRef.current = createLogWorkerClient();
      setStats({ ...statsRef.current });
    };

    const start = async () => {
      if (IS_ELECTRON) {
        const currentStat = await window.electronAPI.statFile(filePath);
        if (disposed) return;
        if (!currentStat) throw new Error("El archivo no existe o no se puede leer");
        const cached = getCachedFile(filePath, currentStat);
        if (cached) {
          reportMetric("file-cache-hit", performance.now() - readStartedRef.current, fileName);
          itemsRef.current = cached.items;
          statsRef.current = { ...cached.stats };
          loadedRef.current = true;
          setClassified(cached.items);
          setStats({ ...cached.stats });
          setProgress(1);
          watchOffsetRef.current = currentStat?.size ?? fileSize ?? null;
          setLoading(false);
          return;
        }

        reportMetric("file-cache-miss", performance.now() - readStartedRef.current, fileName);
        resetBuffers();
        const totalBytes = currentStat?.size || fileSize || 1;
        cancelRead = window.electronAPI.readFile(filePath, {
          onProgress(bytesRead) {
            if (disposed) return;
            const next = Math.min(bytesRead / totalBytes, 0.99);
            if (next - progressRef.current >= 0.02) {
              progressRef.current = next;
              setProgress(next);
            }
          },
          onChunk(chunk) {
            if (!disposed) appendChunk(chunk);
          },
          async onDone(bytesRead) {
            if (disposed) return;
            await publishLoadedData();
            if (disposed) return;
            loadedRef.current = true;
            watchOffsetRef.current = bytesRead;
            setLoading(false);
            setProgress(1);
            const heap = performance.memory?.usedJSHeapSize;
            reportMetric("file-open", performance.now() - readStartedRef.current,
              `${fileName}: ${itemsRef.current.length} lines${heap ? ` · heap ${fmtSize(heap)}` : ""}`);
            queueMicrotask(() => cacheCurrentFile(bytesRead));
          },
          onError(msg) {
            if (!disposed) { console.error(msg); setLoadError(String(msg)); setLoading(false); }
          },
        });
        return;
      }

      resetBuffers();
      const file = webFile;
      if (!file) { setLoading(false); return; }
      const reader = new FileReader();
      cancelRead = () => reader.abort();
      reader.onprogress = (e) => {
        if (!disposed && e.lengthComputable) setProgress(e.loaded / e.total);
      };
      reader.onload = async (e) => {
        if (disposed) return;
        appendChunk(e.target.result);
        await publishLoadedData();
        if (disposed) return;
        loadedRef.current = true;
        setLoading(false);
        setProgress(1);
      };
      reader.onerror = () => { if (!disposed) setLoading(false); };
      reader.readAsText(file);
    };

    start().catch(err => {
      if (!disposed) { console.error(err); setLoadError(err?.message ?? String(err)); setLoading(false); }
    });
    return () => {
      disposed = true;
      cancelRead?.();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [filePath, webFile, fileSize, reloadKey]);

  /* ── Rotation countdown & reload ── */
  useEffect(() => {
    if (!rotation || rotation.event === "recreated") return;
    if (rotation.countdown <= 0) {
      setRotation(null);
      setReloadKey(k => k + 1);
      setTailing(true);
      return;
    }
    timerRef.current = setTimeout(() =>
      setRotation(r => r ? { ...r, countdown: r.countdown - 1 } : null), 1000);
    return () => clearTimeout(timerRef.current);
  }, [rotation]);

  /* ── Tail toggle (simple flip; the effect below manages the actual watcher) ── */
  const toggleTail = useCallback(() => setTailing(p => !p), []);

  /* ── Reactive watcher: auto-starts when tailing=true and file is fully loaded ── */
  useEffect(() => {
    if (!tailing || loading || !IS_ELECTRON || !filePath) return;
    const unwatch = window.electronAPI.watchFile(filePath, {
      startOffset: watchOffsetRef.current,
      async onNewLines(text) {
        appendChunk(text);
        await processingRef.current;
        setClassified([...itemsRef.current]);
        setStats({ ...statsRef.current });
        if (autoScrollRef.current && selectionRef.current.lines.size === 0) listRef.current?.scrollToBottom();
      },
      onRotated()   { setRotation({ event:"rotated",   countdown: 3 }); setTailing(false); },
      onTruncated() { setRotation({ event:"truncated", countdown: 2 }); setTailing(false); },
      onRecreated() { setRotation({ event:"recreated", countdown: 0 }); setReloadKey(k => k + 1); },
    });
    return () => unwatch?.();
  }, [tailing, loading, filePath]); // eslint-disable-line

  const { filtered, filterRegexValid, searchRegexValid, matchOrigLines } =
    useFilteredLogs("file", classified, filterDebounced, filterUseRegex, lvl, context, searchDebounced, searchUseRegex, reportMetric);

  const shownCount = useMemo(() => filtered.filter(x => !x.separator).length, [filtered]);


  useEffect(() => setFilterRegexError(!filterRegexValid), [filterRegexValid]);
  useEffect(() => setSearchRegexError(!searchRegexValid), [searchRegexValid]);

  const toggleBookmark = useCallback((origLine) => {
    setBookmarks(prev => {
      const next = new Set(prev);
      next.has(origLine) ? next.delete(origLine) : next.add(origLine);
      return next;
    });
  }, []);

  const sortedBookmarks = useMemo(() =>
    [...bookmarks].sort((a,b) => a - b), [bookmarks]);

  const jumpBookmark = useCallback((direction) => {
    if (sortedBookmarks.length === 0) return;
    const next = direction === "next"
      ? (bmCursor >= sortedBookmarks.length - 1 ? 0 : bmCursor + 1)
      : (bmCursor <= 0 ? sortedBookmarks.length - 1 : bmCursor - 1);
    setBmCursor(next);
    const origLine = sortedBookmarks[next];
    const idx = filtered.findIndex(x => x.origLine >= origLine);
    if (idx >= 0) listRef.current?.scrollToIndex(idx);
  }, [sortedBookmarks, bmCursor, filtered]);

  const jumpMatch = useCallback((direction) => {
    if (matchOrigLines.length === 0) return;
    const next = direction === "next"
      ? (matchCursor >= matchOrigLines.length - 1 ? 0 : matchCursor + 1)
      : (matchCursor <= 0 ? matchOrigLines.length - 1 : matchCursor - 1);
    setMatchCursor(next);
    const origLine = matchOrigLines[next];
    const idx = filtered.findIndex(x => x.origLine >= origLine);
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
    const text = buildResultText({ source: filePath || fileName, filter, items: filtered, total: classified.length });
    copyResultText(text);
  }, [filePath, fileName, filter, filtered, classified.length]);

  const exportResults = useCallback(() => {
    const source = fileName || filePath || "pulplog-results";
    const text = buildResultText({ source: filePath || fileName, filter, items: filtered, total: classified.length });
    exportResultText(`${safeFileName(source)}-filtered.log`, text);
  }, [filePath, fileName, filter, filtered, classified.length]);

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0, overflow:"hidden" }}>

      {/* toolbar */}
      <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"7px 10px",
                    background:"var(--pl-bg-panel)", borderBottom:"0.5px solid var(--pl-border-soft)",
                    flexShrink:0 }}>

        {/* row 1: filter + search + context + match nav */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
          <div style={{ display:"flex", flex:"1 1 120px", minWidth:60 }}>
            <input
              style={{ flex:1, minWidth:0, background:"var(--pl-bg-input)",
                       border:`0.5px solid ${filterRegexError ? "var(--pl-error-border)" : "var(--pl-border)"}`,
                       borderRadius:"6px 0 0 6px", color: filterRegexError ? "var(--pl-error-text)" : "var(--pl-text-2)",
                       fontFamily:"inherit", fontSize:12, padding:"4px 10px", outline:"none" }}
              placeholder={filterUseRegex ? t("regex_ph") : t("filter_ph")}
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <button
              onClick={() => setFilterUseRegex(p => !p)}
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

          <div style={{ display:"flex", flex:"1 1 120px", minWidth:60 }}>
            <input
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
            <button
              onClick={() => setSearchUseRegex(p => !p)}
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
            {cnt > 0 && (
              <span style={{ background:"var(--pl-badge-overlay)", borderRadius:4,
                             padding:"0 4px", fontSize:10 }}>{fmtNum(cnt)}</span>
            )}
          </span>
        ))}

        <Sep />

        <Btn onClick={() => jumpBookmark("prev")}
          disabled={sortedBookmarks.length === 0} title={t("bm_prev_title")}>
          ◆ ↑
        </Btn>
        <Btn onClick={() => jumpBookmark("next")}
          disabled={sortedBookmarks.length === 0} title={t("bm_next_title")}>
          ◆ ↓
        </Btn>
        {bookmarks.size > 0 && (
          <span style={{ fontSize:10, color:"var(--pl-bookmark)", padding:"0 2px" }}>
            {t("bm_count", bookmarks.size)}
          </span>
        )}
        {bookmarks.size > 0 && (
          <Btn onClick={() => { setBookmarks(new Set()); setBmCursor(-1); }}
            title={t("bm_clear_title")}>
            {t("bm_clear_btn")}
          </Btn>
        )}

        <Btn onClick={copyResults} disabled={!filtered.length} title={t("copy_results_title")}>{t("copy_results")}</Btn>
        <Btn onClick={exportResults} disabled={!filtered.length} title={t("export_results_title")}>{t("export_results")}</Btn>

        <Sep />

        <Btn active={tailing} onClick={toggleTail} disabled={!IS_ELECTRON}
          title={t("tail_title")}>
          {tailing ? t("tail_stop") : t("tail_follow")}
        </Btn>
        <Btn onClick={() => setReloadKey(k => k + 1)} disabled={!filePath}
          title={t("refresh_title")}>
          {t("refresh_btn")}
        </Btn>
        <Btn active={autoScroll} onClick={() => setAutoScroll(p => !p)} title={t("autoscroll_title")}>
          ↓ auto
        </Btn>
        <Btn active={showNums} onClick={() => setShowNums(p => !p)} title={t("linenums_title")}>
          #
        </Btn>
        <Btn onClick={() => listRef.current?.scrollToTop()}>{t("scroll_top")}</Btn>
        <Btn onClick={() => listRef.current?.scrollToBottom()}>{t("scroll_bottom")}</Btn>
        </div>
      </div>

      {/* progress */}
      {loading && (
        <div style={{ height:3, background:"var(--pl-bg-input)", flexShrink:0 }}>
          <div style={{ height:"100%", background:"var(--pl-accent)", transition:"width .08s",
                        width:`${progress*100}%` }} />
        </div>
      )}

      {/* rotation banner */}
      {rotation && (
        <RotationBanner event={rotation.event} countdown={rotation.countdown} />
      )}

      {/* virtual list */}
      {loading ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:12, color:"var(--pl-text-6)", fontSize:13 }}>
          <span style={{ fontSize:28, display:"block", color:"var(--pl-accent)",
            animation:"spin 1s linear infinite" }}>↻</span>
          {t("reading", Math.round(progress*100))}
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : loadError ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:8, padding:24, color:"var(--pl-error-text)",
                      fontSize:13, textAlign:"center" }}>
          <span style={{ fontSize:20 }}>⚠</span>
          {t("file_open_error", loadError)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:8, color:"var(--pl-text-7)", fontSize:13 }}>
          {filterRegexError
            ? <><span style={{ color:"var(--pl-error-text)", fontSize:14 }}>⚠</span> {t("regex_invalid")}</>
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
        />
      )}

      {/* status bar */}
      <div style={{ display:"flex", gap:14, padding:"4px 10px", background:"var(--pl-bg-footer)",
                    borderTop:"0.5px solid var(--pl-border-soft)", fontSize:10, flexShrink:0, alignItems:"center" }}>
        {[["var(--pl-error-border)",stats.error,"err"],["var(--pl-stat-warn)",stats.warn,"warn"],
          ["var(--pl-stat-info)",stats.info,"info"],["var(--pl-stat-debug)",stats.debug,"dbg"]].map(([c,n,l])=>(
          <span key={l} style={{ color:c }}>{fmtNum(n)} <span style={{color:"var(--pl-text-8)"}}>{l}</span></span>
        ))}
        {tailing && <span style={{ color:"var(--pl-status-live)" }}>{t("live")}</span>}
        {bookmarks.size > 0 && (
          <span style={{ color:"var(--pl-bookmark)" }}>◆ {bookmarks.size}</span>
        )}
        <SelectedLineStatus selection={selection} visibleItems={filtered}
          onClear={() => setSelection({ lines:new Set(), active:null, anchor:null })} />
        <span style={{ marginLeft:"auto", color:"var(--pl-text-6)" }}>
          {fileSize
            ? t("lines_size", shownCount, classified.length, fmtSize(fileSize))
            : t("lines", shownCount, classified.length)}
        </span>
      </div>
    </div>
  );
}


export { LogTab };
