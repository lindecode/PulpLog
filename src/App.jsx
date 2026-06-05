import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";

/* ═══════════════════════════════════════════
   Constants
═══════════════════════════════════════════ */
const ROW_H    = 22;
const OVERSCAN = 40;
const IS_ELECTRON = typeof window !== "undefined" && !!window.electronAPI;

/* ═══════════════════════════════════════════
   Log classification & styling
═══════════════════════════════════════════ */
function classify(line) {
  if (/^\s*(at |\.{3}\s*\d+ more)/.test(line))  return "stack";
  if (/^Caused by:/i.test(line.trimStart()))      return "causedby";
  if (/\bERROR\b/.test(line))                     return "error";
  if (/\bWARN\b/.test(line))                      return "warn";
  if (/\bINFO\b/.test(line))                      return "info";
  if (/\bDEBUG\b/.test(line))                     return "debug";
  if (/\bTRACE\b/.test(line))                     return "trace";
  if (/Exception|Error:/.test(line))              return "exception";
  return "plain";
}

const STYLE = {
  error:     { bg:"#3a1010", bar:"#e04444", txt:"#ff8888" },
  exception: { bg:"#3a1010", bar:"#b03030", txt:"#ff6666" },
  causedby:  { bg:"#3a2010", bar:"#d06030", txt:"#ffaa66" },
  stack:     { bg:"#16122a", bar:"#5a3a9a", txt:"#a090d0" },
  warn:      { bg:"#281e08", bar:"#c08020", txt:"#f0c060" },
  info:      { bg:"#081c2c", bar:"#2a7faa", txt:"#60b8e8" },
  debug:     { bg:"#101010", bar:"#2a4a2a", txt:"#6a9a6a" },
  trace:     { bg:"#0e0e0e", bar:"#222",    txt:"#555"    },
  plain:     { bg:"transparent", bar:"transparent", txt:"#b0b0b0" },
};

function hl(raw, type) {
  if (type === "stack" || type === "causedby") return esc(raw);
  return esc(raw)
    .replace(/\b(ERROR|WARN|INFO|DEBUG|TRACE)\b/g,
      m => `<b style="color:${STYLE[m.toLowerCase()]?.bar||"#aaa"};font-weight:700">${m}</b>`)
    .replace(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[.,]\d+)/g,
      '<span style="color:#484848">$1</span>')
    .replace(/\[([\w\-]+)\]/g,
      '<span style="color:#5a5a7a">[$1]</span>')
    .replace(/([a-z][a-z0-9_]*\.){2,}[A-Z][a-zA-Z0-9_]*/g,
      '<span style="color:#5a7a5a">$&</span>');
}
const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fmtSize = b => b>=1e9?`${(b/1e9).toFixed(2)} GB`:b>=1e6?`${(b/1e6).toFixed(1)} MB`:b>=1e3?`${(b/1e3).toFixed(0)} KB`:`${b} B`;
const fmtNum  = n => n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}k`:String(n);

/* ═══════════════════════════════════════════
   LogRow
═══════════════════════════════════════════ */
const LogRow = memo(({ item, showNums, isBookmarked, onToggleBookmark }) => {
  const s = STYLE[item.type] || STYLE.plain;
  return (
    <div style={{
      display:"flex", alignItems:"stretch", height:ROW_H,
      background: isBookmarked ? "rgba(255,200,50,.07)" : s.bg,
      borderBottom:"0.5px solid rgba(255,255,255,.02)",
      outline: isBookmarked ? "0.5px solid rgba(255,200,50,.25)" : "none",
    }}>
      {/* gutter: line number + bookmark dot */}
      {showNums && (
        <span
          onClick={() => onToggleBookmark(item.origLine)}
          title={isBookmarked ? "Quitar marcador" : "Marcar línea"}
          style={{ minWidth:58, display:"flex", alignItems:"center", justifyContent:"flex-end",
                   gap:4, padding:"0 6px 0 4px", fontSize:10, color:"#2e2e2e",
                   lineHeight:`${ROW_H}px`, flexShrink:0, userSelect:"none",
                   cursor:"pointer", fontFamily:"inherit" }}>
          {isBookmarked
            ? <span style={{ color:"#f0c040", fontSize:10 }}>◆</span>
            : <span style={{ color:"#1e1e1e", fontSize:10 }}>◇</span>}
          {item.origLine}
        </span>
      )}
      <span style={{ width:4, flexShrink:0,
                     background: isBookmarked ? "#c0a030" : s.bar }} />
      <span
        style={{ padding:"0 10px", fontSize:12, lineHeight:`${ROW_H}px`, color:s.txt,
                 flex:1, minWidth:0, whiteSpace:"pre", overflow:"hidden",
                 textOverflow:"ellipsis", fontFamily:"inherit" }}
        dangerouslySetInnerHTML={{ __html: hl(item.raw, item.type) }}
      />
    </div>
  );
});

/* ═══════════════════════════════════════════
   VirtualList
═══════════════════════════════════════════ */
function VirtualList({ items, showNums, bookmarks, onToggleBookmark, listRef }) {
  const [scrollTop, setScrollTop] = useState(0);
  const [height,    setHeight]    = useState(500);
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Expose scroll helpers via listRef
  useEffect(() => {
    if (!listRef) return;
    listRef.current = {
      scrollToBottom: () => { if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; },
      scrollToTop:    () => { if (containerRef.current) containerRef.current.scrollTop = 0; },
      scrollToIndex:  (idx) => {
        if (containerRef.current)
          containerRef.current.scrollTop = Math.max(0, idx * ROW_H - height / 2);
      },
    };
  });

  const total  = items.length;
  const totalH = total * ROW_H;
  const start  = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end    = Math.min(total, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);

  return (
    <div ref={containerRef}
         style={{ overflow:"auto", flex:1, minHeight:0 }}
         onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height:totalH, position:"relative" }}>
        <div style={{ position:"absolute", top: start * ROW_H, width:"100%" }}>
          {items.slice(start, end).map(item => (
            <LogRow
              key={item.origLine}
              item={item}
              showNums={showNums}
              isBookmarked={bookmarks.has(item.origLine)}
              onToggleBookmark={onToggleBookmark}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   LogTab
═══════════════════════════════════════════ */
function LogTab({ filePath, fileName, fileSize }) {
  const [rawLines,    setRawLines]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [progress,    setProgress]    = useState(0);
  const [tailing,     setTailing]     = useState(false);
  const [autoScroll,  setAutoScroll]  = useState(false);
  const [showNums,    setShowNums]    = useState(true);
  const [filter,      setFilter]      = useState("");
  const [useRegex,    setUseRegex]    = useState(false);
  const [regexError,  setRegexError]  = useState(false);
  const [bookmarks,   setBookmarks]   = useState(new Set());
  const [bmCursor,    setBmCursor]    = useState(-1); // index into sorted bookmarks
  const [rotation,    setRotation]    = useState(null); // { event, countdown }
  const [reloadKey,   setReloadKey]   = useState(0);
  const [lvl, setLvl] = useState({
    error:true, warn:true, info:true, debug:true, trace:true, stack:true, plain:true
  });

  const listRef    = useRef(null);
  const bufRef     = useRef("");
  const unwatchRef = useRef(null);
  const timerRef   = useRef(null);

  /* ── Stream read ── */
  useEffect(() => {
    if (!filePath) return;
    setLoading(true); setProgress(0); setRawLines([]);
    bufRef.current = "";

    if (IS_ELECTRON) {
      const totalBytes = fileSize || 1;
      let received = 0;
      const cancel = window.electronAPI.readFile(filePath, {
        onChunk(chunk) {
          received += chunk.length;
          setProgress(Math.min(received / totalBytes, 0.99));
          bufRef.current += chunk;
        },
        onDone() {
          const lines = bufRef.current.split("\n");
          if (lines[lines.length-1] === "") lines.pop();
          setRawLines(lines);
          bufRef.current = "";
          setLoading(false);
          setProgress(1);
        },
        onError(msg) { console.error(msg); setLoading(false); },
      });
      return cancel;
    } else {
      const file = window.__pendingFile;
      if (!file) { setLoading(false); return; }
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable) setProgress(e.loaded / e.total);
      };
      reader.onload = (e) => {
        const lines = e.target.result.split("\n");
        if (lines[lines.length - 1] === "") lines.pop();
        setRawLines(lines);
        setLoading(false);
        setProgress(1);
      };
      reader.onerror = () => setLoading(false);
      reader.readAsText(file);
      return () => reader.abort();
    }
  }, [filePath, fileSize, reloadKey]);

  /* ── Rotation countdown & reload ── */
  useEffect(() => {
    if (!rotation || rotation.event === "recreated") return;
    if (rotation.countdown <= 0) {
      setRotation(null);
      setReloadKey(k => k + 1);
      return;
    }
    timerRef.current = setTimeout(() =>
      setRotation(r => r ? { ...r, countdown: r.countdown - 1 } : null), 1000);
    return () => clearTimeout(timerRef.current);
  }, [rotation]);

  /* ── Tail toggle ── */
  const toggleTail = useCallback(() => {
    if (tailing) {
      unwatchRef.current?.();
      unwatchRef.current = null;
      setTailing(false);
    } else {
      if (!IS_ELECTRON) return;
      const unwatch = window.electronAPI.watchFile(filePath, {
        onNewLines(text) {
          const newLines = text.split("\n").filter(Boolean);
          setRawLines(prev => [...prev, ...newLines]);
          if (autoScroll) listRef.current?.scrollToBottom();
        },
        onRotated() {
          setRotation({ event:"rotated", countdown: 3 });
          // stop current watch; reload will restart it
          unwatchRef.current?.();
          unwatchRef.current = null;
          setTailing(false);
        },
        onTruncated() {
          setRotation({ event:"truncated", countdown: 2 });
          unwatchRef.current?.();
          unwatchRef.current = null;
          setTailing(false);
        },
        onRecreated() {
          setRotation({ event:"recreated", countdown: 0 });
          setReloadKey(k => k + 1);
        },
      });
      unwatchRef.current = unwatch;
      setTailing(true);
    }
  }, [tailing, filePath, autoScroll]);

  useEffect(() => () => { unwatchRef.current?.(); }, []);

  /* ── Classify ── */
  const classified = useMemo(() =>
    rawLines.map((raw, i) => ({ raw, origLine: i + 1, type: classify(raw) })),
    [rawLines]
  );

  const stats = useMemo(() => ({
    error: classified.filter(x => x.type==="error"||x.type==="exception").length,
    warn:  classified.filter(x => x.type==="warn").length,
    info:  classified.filter(x => x.type==="info").length,
    debug: classified.filter(x => x.type==="debug").length,
  }), [classified]);

  /* ── Filter (text or regex) ── */
  const { filtered, regexValid } = useMemo(() => {
    const hide = new Set();
    if (!lvl.error) { hide.add("error"); hide.add("exception"); }
    if (!lvl.stack) { hide.add("stack"); hide.add("causedby"); }
    ["warn","info","debug","trace","plain"].forEach(k => { if (!lvl[k]) hide.add(k); });

    if (!filter) return { filtered: classified.filter(x => !hide.has(x.type)), regexValid: true };

    if (useRegex) {
      let re;
      try { re = new RegExp(filter, "i"); }
      catch { return { filtered: [], regexValid: false }; }
      return {
        filtered: classified.filter(x => !hide.has(x.type) && re.test(x.raw)),
        regexValid: true,
      };
    }
    const lf = filter.toLowerCase();
    return {
      filtered: classified.filter(x => !hide.has(x.type) && x.raw.toLowerCase().includes(lf)),
      regexValid: true,
    };
  }, [classified, filter, useRegex, lvl]);

  useEffect(() => setRegexError(!regexValid), [regexValid]);

  /* ── Bookmarks ── */
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
    let next;
    if (direction === "next") {
      next = bmCursor >= sortedBookmarks.length - 1 ? 0 : bmCursor + 1;
    } else {
      next = bmCursor <= 0 ? sortedBookmarks.length - 1 : bmCursor - 1;
    }
    setBmCursor(next);
    const origLine = sortedBookmarks[next];
    const idx = filtered.findIndex(x => x.origLine >= origLine);
    if (idx >= 0) listRef.current?.scrollToIndex(idx);
  }, [sortedBookmarks, bmCursor, filtered]);

  /* ── UI ── */
  const toggle = key => setLvl(p => ({ ...p, [key]: !p[key] }));

  const BADGES = [
    { key:"error", label:"ERROR", bg:"#a02020", fg:"#ffcccc", cnt:stats.error },
    { key:"warn",  label:"WARN",  bg:"#906010", fg:"#ffe090", cnt:stats.warn  },
    { key:"info",  label:"INFO",  bg:"#1a5f88", fg:"#90d0f0", cnt:stats.info  },
    { key:"debug", label:"DEBUG", bg:"#244024", fg:"#90c890", cnt:stats.debug },
    { key:"stack", label:"STACK", bg:"#3a256a", fg:"#c0a8f0", cnt:null        },
    { key:"plain", label:"PLAIN", bg:"#2a2a2a", fg:"#aaa",    cnt:null        },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0, overflow:"hidden" }}>

      {/* ── toolbar ── */}
      <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 10px",
                    background:"#111", borderBottom:"0.5px solid #222",
                    flexWrap:"wrap", flexShrink:0 }}>

        {/* filter input + regex toggle */}
        <div style={{ display:"flex", flex:1, minWidth:140, position:"relative" }}>
          <input
            style={{ flex:1, background:"#181818",
                     border:`0.5px solid ${regexError ? "#883030" : "#2e2e2e"}`,
                     borderRadius:"6px 0 0 6px", color: regexError ? "#ff6060" : "#bbb",
                     fontFamily:"inherit", fontSize:12, padding:"4px 10px",
                     outline:"none" }}
            placeholder={useRegex ? "regex…" : "🔍  filtrar…"}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button
            onClick={() => setUseRegex(p => !p)}
            title="Activar filtro por expresión regular"
            style={{ background: useRegex ? "#1a2a3a" : "#181818",
                     border:`0.5px solid ${useRegex ? "#2a6a9a" : "#2e2e2e"}`,
                     borderLeft:"none", borderRadius:"0 6px 6px 0",
                     color: useRegex ? "#60b8e8" : "#555",
                     fontFamily:"monospace", fontSize:11, padding:"4px 10px",
                     cursor:"pointer", fontWeight: useRegex ? 700 : 400 }}>
            .*
          </button>
        </div>

        <Sep />

        {/* level badges */}
        {BADGES.map(({ key, label, bg, fg, cnt }) => (
          <span key={key} onClick={() => toggle(key)}
            style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11,
                     padding:"3px 7px", borderRadius:6, fontWeight:600,
                     cursor:"pointer", userSelect:"none",
                     background: lvl[key] ? bg : "#181818",
                     color:      lvl[key] ? fg : "#444",
                     border:     `1.5px solid ${lvl[key] ? bg : "#222"}`,
                     opacity:    lvl[key] ? 1 : 0.45 }}>
            {label}
            {cnt > 0 && (
              <span style={{ background:"rgba(255,255,255,.18)", borderRadius:4,
                             padding:"0 4px", fontSize:10 }}>{fmtNum(cnt)}</span>
            )}
          </span>
        ))}

        <Sep />

        {/* bookmarks */}
        <Btn onClick={() => jumpBookmark("prev")}
          disabled={sortedBookmarks.length === 0} title="Marcador anterior (Shift+F2)">
          ◆ ↑
        </Btn>
        <Btn onClick={() => jumpBookmark("next")}
          disabled={sortedBookmarks.length === 0} title="Marcador siguiente (F2)">
          ◆ ↓
        </Btn>
        {bookmarks.size > 0 && (
          <span style={{ fontSize:10, color:"#c0a030", padding:"0 2px" }}>
            {bookmarks.size} {bookmarks.size === 1 ? "marca" : "marcas"}
          </span>
        )}
        {bookmarks.size > 0 && (
          <Btn onClick={() => { setBookmarks(new Set()); setBmCursor(-1); }}
            title="Limpiar todos los marcadores">
            ✕ marcas
          </Btn>
        )}

        <Sep />

        {/* tail / scroll controls */}
        <Btn active={tailing} onClick={toggleTail} disabled={!IS_ELECTRON}
          title="Tail -f — seguir archivo en vivo">
          {tailing ? "⏹ stop" : "▶ tail"}
        </Btn>
        <Btn active={autoScroll} onClick={() => setAutoScroll(p => !p)} title="Auto-scroll al final">
          ↓ auto
        </Btn>
        <Btn active={showNums} onClick={() => setShowNums(p => !p)} title="Números de línea">
          #
        </Btn>
        <Btn onClick={() => listRef.current?.scrollToTop()}>↑ inicio</Btn>
        <Btn onClick={() => listRef.current?.scrollToBottom()}>↓ fin</Btn>
      </div>

      {/* ── progress ── */}
      {loading && (
        <div style={{ height:3, background:"#181818", flexShrink:0 }}>
          <div style={{ height:"100%", background:"#2a7faa", transition:"width .08s",
                        width:`${progress*100}%` }} />
        </div>
      )}

      {/* ── rotation banner ── */}
      {rotation && (
        <RotationBanner event={rotation.event} countdown={rotation.countdown} />
      )}

      {/* ── virtual list ── */}
      {loading ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:12, color:"#444", fontSize:13 }}>
          <span style={{ fontSize:28, display:"block", color:"#2a7faa",
            animation:"spin 1s linear infinite" }}>↻</span>
          Leyendo… {Math.round(progress*100)}%
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:8, color:"#333", fontSize:13 }}>
          {regexError
            ? <><span style={{ color:"#ff6060", fontSize:14 }}>⚠</span> Regex inválida</>
            : filter ? `Sin resultados para "${filter}"` : "Sin líneas"}
        </div>
      ) : (
        <VirtualList
          items={filtered}
          showNums={showNums}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
          listRef={listRef}
        />
      )}

      {/* ── status bar ── */}
      <div style={{ display:"flex", gap:14, padding:"4px 10px", background:"#0d0d0d",
                    borderTop:"0.5px solid #1a1a1a", fontSize:10, flexShrink:0, alignItems:"center" }}>
        {[["#883030",stats.error,"err"],["#806010",stats.warn,"warn"],
          ["#1a5070",stats.info,"info"],["#284028",stats.debug,"dbg"]].map(([c,n,l])=>(
          <span key={l} style={{ color:c }}>{fmtNum(n)} <span style={{color:"#252525"}}>{l}</span></span>
        ))}
        {tailing && <span style={{ color:"#2a9a4a" }}>● live</span>}
        {bookmarks.size > 0 && (
          <span style={{ color:"#c0a030" }}>◆ {bookmarks.size}</span>
        )}
        <span style={{ marginLeft:"auto", color:"#444" }}>
          {fmtNum(filtered.length)} / {fmtNum(rawLines.length)} líneas
          {fileSize ? ` · ${fmtSize(fileSize)}` : ""}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Rotation banner component
═══════════════════════════════════════════ */
function RotationBanner({ event, countdown }) {
  const CFG = {
    rotated:   { bg:"#2a1a00", border:"#c08020", color:"#f0c060", icon:"↻", label:`Archivo rotado — recargando en ${countdown}s…` },
    truncated: { bg:"#0a1e2a", border:"#2a7faa", color:"#60b8e8", icon:"⬇", label:`Archivo truncado — recargando en ${countdown}s…` },
    recreated: { bg:"#0a2a0a", border:"#2a8a2a", color:"#60d060", icon:"✓", label:"Nuevo archivo detectado — cargando…" },
  };
  const c = CFG[event] || CFG.rotated;
  return (
    <div style={{ padding:"6px 14px", background:c.bg, borderBottom:`1px solid ${c.border}`,
                  color:c.color, fontSize:12, display:"flex", alignItems:"center", gap:8,
                  flexShrink:0, fontFamily:"inherit" }}>
      <span style={{ fontSize:16 }}>{c.icon}</span> {c.label}
    </div>
  );
}

/* ═══════════════════════════════════════════
   About modal
═══════════════════════════════════════════ */
function AboutModal({ onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
               display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:"#111", border:"0.5px solid #2a2a2a", borderRadius:10,
                 padding:"32px 40px", minWidth:300, textAlign:"center",
                 boxShadow:"0 8px 40px rgba(0,0,0,.8)", fontFamily:"inherit" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>📋</div>
        <div style={{ fontSize:18, color:"#ccc", fontWeight:700, marginBottom:4 }}>LogViewer</div>
        <div style={{ fontSize:11, color:"#444", marginBottom:20 }}>v1.0.0</div>
        <div style={{ width:40, height:"0.5px", background:"#2a2a2a", margin:"0 auto 20px" }} />
        <div style={{ fontSize:13, color:"#888", marginBottom:6 }}>Desarrollado por</div>
        <div style={{ fontSize:16, color:"#2a7faa", fontWeight:700, letterSpacing:1 }}>LindeCode</div>
        <div style={{ marginTop:20, fontSize:11, color:"#333" }}>Licencia MIT © 2026</div>
        <button
          onClick={onClose}
          style={{ marginTop:24, background:"#181818", border:"0.5px solid #2e2e2e",
                   borderRadius:6, color:"#666", fontFamily:"inherit",
                   fontSize:11, padding:"6px 20px", cursor:"pointer" }}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Small helpers
═══════════════════════════════════════════ */
function Btn({ children, onClick, active, title, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      style={{ background: active ? "#1a3a1a" : "#181818",
               border:`0.5px solid ${active ? "#3a6a3a":"#2e2e2e"}`,
               borderRadius:6, color: active ? "#8dc88d":"#777",
               fontFamily:"inherit", fontSize:11, padding:"4px 9px",
               cursor: disabled ? "not-allowed":"pointer",
               opacity: disabled ? 0.4 : 1, whiteSpace:"nowrap" }}>
      {children}
    </button>
  );
}

function Sep() {
  return <span style={{ width:"0.5px", background:"#252525", alignSelf:"stretch" }} />;
}

/* ═══════════════════════════════════════════
   Docker – container picker modal
═══════════════════════════════════════════ */
function DockerPicker({ onSelect, onClose }) {
  const [containers, setContainers] = useState(null);
  const [error,      setError]      = useState(null);

  useEffect(() => {
    window.electronAPI.listContainers()
      .then(res => res?.error ? setError(res.error) : setContainers(res))
      .catch(e  => setError(e.message));
  }, []);

  return (
    <div onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
               display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:"#111", border:"0.5px solid #2a2a2a", borderRadius:10,
                 padding:"24px", minWidth:440, maxWidth:580, fontFamily:"inherit",
                 boxShadow:"0 8px 40px rgba(0,0,0,.8)" }}>
        <div style={{ fontSize:14, color:"#ccc", fontWeight:700, marginBottom:16 }}>
          🐳 Contenedores Docker activos
        </div>

        {containers === null && !error && (
          <div style={{ color:"#444", fontSize:12, padding:"8px 0" }}>Conectando con Docker…</div>
        )}
        {error && (
          <div style={{ color:"#ff6060", fontSize:12, padding:"8px 0", lineHeight:1.6 }}>
            <span style={{ fontWeight:700 }}>Error:</span> {error}
            <br /><span style={{ color:"#555" }}>¿Está Docker corriendo y accesible?</span>
          </div>
        )}
        {containers?.length === 0 && (
          <div style={{ color:"#555", fontSize:12, padding:"8px 0" }}>No hay contenedores en ejecución.</div>
        )}

        <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:320, overflowY:"auto" }}>
          {containers?.map(c => {
            const name   = c.Names?.[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
            const image  = c.Image ?? "";
            const status = c.Status ?? "";
            return (
              <div key={c.Id} onClick={() => onSelect(c.Id, name, image)}
                style={{ padding:"10px 14px", borderRadius:6, cursor:"pointer",
                         background:"#161616", border:"0.5px solid #222",
                         display:"flex", flexDirection:"column", gap:3,
                         transition:"background .1s" }}
                onMouseEnter={e => e.currentTarget.style.background="#1e2a1e"}
                onMouseLeave={e => e.currentTarget.style.background="#161616"}>
                <span style={{ color:"#ccc", fontSize:13, fontWeight:600 }}>{name}</span>
                <span style={{ color:"#555", fontSize:10 }}>{image} · {status}</span>
              </div>
            );
          })}
        </div>

        <button onClick={onClose}
          style={{ marginTop:20, background:"#181818", border:"0.5px solid #2e2e2e",
                   borderRadius:6, color:"#666", fontFamily:"inherit",
                   fontSize:11, padding:"6px 20px", cursor:"pointer" }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Docker – log streaming tab
═══════════════════════════════════════════ */
function DockerTab({ containerId, containerName }) {
  const [rawLines,   setRawLines]  = useState([]);
  const [spawned,    setSpawned]   = useState(false);
  const [connected,  setConnected] = useState(false);
  const [error,      setError]     = useState(null);
  const [filter,     setFilter]    = useState("");
  const [useRegex,   setUseRegex]  = useState(false);
  const [regexError, setRegexError]= useState(false);
  const [bookmarks,  setBookmarks] = useState(new Set());
  const [bmCursor,   setBmCursor]  = useState(-1);
  const [showNums,   setShowNums]  = useState(true);
  const [autoScroll, setAutoScroll]= useState(true);
  const [lvl, setLvl] = useState({
    error:true, warn:true, info:true, debug:true, trace:true, stack:true, plain:true,
  });

  const listRef       = useRef(null);
  const autoScrollRef = useRef(true);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);

  useEffect(() => {
    const unwatch = window.electronAPI.streamDockerLogs(containerId, {
      onSpawned() { setSpawned(true); },
      onLines(text) {
        const incoming = text.split("\n").filter(Boolean);
        setRawLines(prev => [...prev, ...incoming]);
        setConnected(true);
        if (autoScrollRef.current) listRef.current?.scrollToBottom();
      },
      onEnd()      { setConnected(false); },
      onError(msg) { setError(msg); setConnected(false); },
    });
    return unwatch;
  }, [containerId]);

  const classified = useMemo(() =>
    rawLines.map((raw, i) => ({ raw, origLine: i + 1, type: classify(raw) })),
    [rawLines]
  );

  const stats = useMemo(() => ({
    error: classified.filter(x => x.type==="error"||x.type==="exception").length,
    warn:  classified.filter(x => x.type==="warn").length,
    info:  classified.filter(x => x.type==="info").length,
    debug: classified.filter(x => x.type==="debug").length,
  }), [classified]);

  const { filtered, regexValid } = useMemo(() => {
    const hide = new Set();
    if (!lvl.error) { hide.add("error"); hide.add("exception"); }
    if (!lvl.stack) { hide.add("stack"); hide.add("causedby"); }
    ["warn","info","debug","trace","plain"].forEach(k => { if (!lvl[k]) hide.add(k); });

    if (!filter) return { filtered: classified.filter(x => !hide.has(x.type)), regexValid: true };
    if (useRegex) {
      let re;
      try { re = new RegExp(filter, "i"); }
      catch { return { filtered: [], regexValid: false }; }
      return { filtered: classified.filter(x => !hide.has(x.type) && re.test(x.raw)), regexValid: true };
    }
    const lf = filter.toLowerCase();
    return { filtered: classified.filter(x => !hide.has(x.type) && x.raw.toLowerCase().includes(lf)), regexValid: true };
  }, [classified, filter, useRegex, lvl]);

  useEffect(() => setRegexError(!regexValid), [regexValid]);

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

  const toggle = key => setLvl(p => ({ ...p, [key]: !p[key] }));

  const BADGES = [
    { key:"error", label:"ERROR", bg:"#a02020", fg:"#ffcccc", cnt:stats.error },
    { key:"warn",  label:"WARN",  bg:"#906010", fg:"#ffe090", cnt:stats.warn  },
    { key:"info",  label:"INFO",  bg:"#1a5f88", fg:"#90d0f0", cnt:stats.info  },
    { key:"debug", label:"DEBUG", bg:"#244024", fg:"#90c890", cnt:stats.debug },
    { key:"stack", label:"STACK", bg:"#3a256a", fg:"#c0a8f0", cnt:null        },
    { key:"plain", label:"PLAIN", bg:"#2a2a2a", fg:"#aaa",    cnt:null        },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0, overflow:"hidden" }}>

      {/* toolbar */}
      <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 10px",
                    background:"#111", borderBottom:"0.5px solid #222",
                    flexWrap:"wrap", flexShrink:0 }}>

        <span style={{ fontSize:11, color:"#2a9a4a", background:"#0a1a0a",
                       border:"0.5px solid #1a3a1a", borderRadius:6, padding:"3px 8px",
                       fontWeight:700, flexShrink:0, whiteSpace:"nowrap" }}>
          🐳 {containerName}
        </span>

        <Sep />

        <div style={{ display:"flex", flex:1, minWidth:140 }}>
          <input
            style={{ flex:1, background:"#181818",
                     border:`0.5px solid ${regexError ? "#883030" : "#2e2e2e"}`,
                     borderRadius:"6px 0 0 6px", color: regexError ? "#ff6060" : "#bbb",
                     fontFamily:"inherit", fontSize:12, padding:"4px 10px", outline:"none" }}
            placeholder={useRegex ? "regex…" : "🔍  filtrar…"}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button onClick={() => setUseRegex(p => !p)}
            style={{ background: useRegex ? "#1a2a3a" : "#181818",
                     border:`0.5px solid ${useRegex ? "#2a6a9a" : "#2e2e2e"}`,
                     borderLeft:"none", borderRadius:"0 6px 6px 0",
                     color: useRegex ? "#60b8e8" : "#555",
                     fontFamily:"monospace", fontSize:11, padding:"4px 10px",
                     cursor:"pointer", fontWeight: useRegex ? 700 : 400 }}>
            .*
          </button>
        </div>

        <Sep />

        {BADGES.map(({ key, label, bg, fg, cnt }) => (
          <span key={key} onClick={() => toggle(key)}
            style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11,
                     padding:"3px 7px", borderRadius:6, fontWeight:600,
                     cursor:"pointer", userSelect:"none",
                     background: lvl[key] ? bg : "#181818",
                     color:      lvl[key] ? fg : "#444",
                     border:     `1.5px solid ${lvl[key] ? bg : "#222"}`,
                     opacity:    lvl[key] ? 1 : 0.45 }}>
            {label}
            {cnt > 0 && <span style={{ background:"rgba(255,255,255,.18)", borderRadius:4, padding:"0 4px", fontSize:10 }}>{fmtNum(cnt)}</span>}
          </span>
        ))}

        <Sep />

        <Btn onClick={() => jumpBookmark("prev")} disabled={!sortedBookmarks.length} title="Marcador anterior (Shift+F2)">◆ ↑</Btn>
        <Btn onClick={() => jumpBookmark("next")} disabled={!sortedBookmarks.length} title="Marcador siguiente (F2)">◆ ↓</Btn>
        {bookmarks.size > 0 && <span style={{ fontSize:10, color:"#c0a030", padding:"0 2px" }}>{bookmarks.size} {bookmarks.size===1?"marca":"marcas"}</span>}
        {bookmarks.size > 0 && <Btn onClick={() => { setBookmarks(new Set()); setBmCursor(-1); }} title="Limpiar marcadores">✕ marcas</Btn>}

        <Sep />

        <Btn active={autoScroll} onClick={() => setAutoScroll(p => !p)} title="Auto-scroll al final">↓ auto</Btn>
        <Btn active={showNums}   onClick={() => setShowNums(p => !p)}   title="Números de línea">#</Btn>
        <Btn onClick={() => listRef.current?.scrollToTop()}>↑ inicio</Btn>
        <Btn onClick={() => listRef.current?.scrollToBottom()}>↓ fin</Btn>
      </div>

      {/* error banner */}
      {error && (
        <div style={{ padding:"6px 14px", background:"#2a1010", borderBottom:"1px solid #883030",
                      color:"#ff8888", fontSize:12, flexShrink:0, fontFamily:"inherit" }}>
          ⚠ {error}
        </div>
      )}

      {/* content */}
      {rawLines.length === 0 && !error ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:10, color:"#333", fontSize:13 }}>
          <span style={{ fontSize:28, color:"#2a9a4a", animation:"spin 1s linear infinite" }}>↻</span>
          {spawned ? "Esperando logs del contenedor…" : "Iniciando proceso…"}
          {spawned && <span style={{ fontSize:10, color:"#252525" }}>El contenedor no ha emitido logs aún</span>}
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      color:"#333", fontSize:13 }}>
          {regexError
            ? <><span style={{ color:"#ff6060" }}>⚠</span> Regex inválida</>
            : filter ? `Sin resultados para "${filter}"` : "Sin líneas"}
        </div>
      ) : (
        <VirtualList
          items={filtered}
          showNums={showNums}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
          listRef={listRef}
        />
      )}

      {/* status bar */}
      <div style={{ display:"flex", gap:14, padding:"4px 10px", background:"#0d0d0d",
                    borderTop:"0.5px solid #1a1a1a", fontSize:10, flexShrink:0, alignItems:"center" }}>
        {[["#883030",stats.error,"err"],["#806010",stats.warn,"warn"],
          ["#1a5070",stats.info,"info"],["#284028",stats.debug,"dbg"]].map(([c,n,l])=>(
          <span key={l} style={{ color:c }}>{fmtNum(n)} <span style={{color:"#252525"}}>{l}</span></span>
        ))}
        {connected && <span style={{ color:"#2a9a4a" }}>● live</span>}
        {!connected && rawLines.length > 0 && <span style={{ color:"#555" }}>● detenido</span>}
        {bookmarks.size > 0 && <span style={{ color:"#c0a030" }}>◆ {bookmarks.size}</span>}
        <span style={{ marginLeft:"auto", color:"#444" }}>
          {fmtNum(filtered.length)} / {fmtNum(rawLines.length)} líneas
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   App shell (tabs)
═══════════════════════════════════════════ */
let nextId = 1;

export default function App() {
  const [tabs,         setTabs]        = useState([{ id: nextId++, label:"Bienvenida", filePath:null, fileSize:null }]);
  const [active,       setActive]      = useState(1);
  const [about,        setAbout]       = useState(false);
  const [dockerPicker, setDockerPicker]= useState(false);
  const fileRef = useRef(null);

  const openFile = useCallback(async () => {
    if (IS_ELECTRON) {
      const fp = await window.electronAPI.openFileDialog();
      if (!fp) return;
      const stat  = await window.electronAPI.statFile(fp);
      const label = fp.split(/[\\/]/).pop();
      addTab(label, fp, stat?.size ?? null);
    } else {
      fileRef.current?.click();
    }
  }, []);

  const addTab = (label, filePath, fileSize) => {
    const id = nextId++;
    setTabs(p => [...p, { id, label, filePath, fileSize }]);
    setActive(id);
  };

  const openDockerTab = (containerId, name) => {
    const id = nextId++;
    setTabs(p => [...p, { id, label: `🐳 ${name}`, filePath: null, fileSize: null, docker: { containerId, name } }]);
    setActive(id);
    setDockerPicker(false);
  };

  const closeTab = (id) => {
    setTabs(prev => {
      const idx  = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        const newId = nextId++;
        setActive(newId);
        return [{ id: newId, label:"Bienvenida", filePath:null }];
      }
      setActive(a => a === id ? next[Math.min(idx, next.length - 1)].id : a);
      return next;
    });
  };

  useEffect(() => {
    if (!IS_ELECTRON) return;
    const cleanOpenFile = window.electronAPI.onMenuOpenFile(() => openFile());
    const cleanNewTab   = window.electronAPI.onMenuNewTab(() => {
      const id = nextId++;
      setTabs(p => [...p, { id, label:"Bienvenida", filePath:null }]);
      setActive(id);
    });
    return () => { cleanOpenFile?.(); cleanNewTab?.(); };
  }, [openFile]);

  const activeTab = tabs.find(t => t.id === active) || tabs[0];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh",
                  background:"#0a0a0a", color:"#ccc", overflow:"hidden",
                  fontFamily:"'JetBrains Mono','Fira Code','Cascadia Code',monospace" }}>

      {/* tab bar */}
      <div style={{ display:"flex", alignItems:"stretch", background:"#0f0f0f",
                    borderBottom:"0.5px solid #1e1e1e", flexShrink:0, overflowX:"auto" }}>
        {tabs.map(tab => (
          <div key={tab.id}
            onClick={() => setActive(tab.id)}
            style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px",
                     borderRight:"0.5px solid #1e1e1e", cursor:"pointer", flexShrink:0,
                     fontSize:12, maxWidth:200, overflow:"hidden",
                     background: tab.id===active ? "#111":"transparent",
                     color:      tab.id===active ? "#ccc":"#555",
                     borderBottom: tab.id===active ? "1.5px solid #2a7faa":"1.5px solid transparent" }}>
            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {tab.label}
            </span>
            {tabs.length > 1 && (
              <span style={{ fontSize:10, color:"#444", padding:"0 2px", cursor:"pointer",
                             flexShrink:0, borderRadius:3 }}
                onClick={e => { e.stopPropagation(); closeTab(tab.id); }}>✕</span>
            )}
          </div>
        ))}

        <button onClick={openFile}
          style={{ background:"transparent", border:"none", color:"#444",
                   padding:"0 14px", cursor:"pointer", fontSize:18,
                   borderRight:"0.5px solid #1e1e1e", flexShrink:0 }}
          title="Abrir archivo (Ctrl+O)">+</button>

        {IS_ELECTRON && (
          <button onClick={() => setDockerPicker(true)}
            style={{ background:"transparent", border:"none", color:"#2a6a2a",
                     padding:"0 14px", cursor:"pointer", fontSize:14,
                     borderRight:"0.5px solid #1e1e1e", flexShrink:0 }}
            title="Conectar a contenedor Docker">
            🐳
          </button>
        )}

        <button onClick={() => setAbout(true)}
          style={{ background:"transparent", border:"none", color:"#333",
                   padding:"0 14px", cursor:"pointer", fontSize:11,
                   marginLeft:"auto", flexShrink:0, fontFamily:"inherit" }}
          title="Acerca de LogViewer">
          Acerca de
        </button>

        {!IS_ELECTRON && (
          <input ref={fileRef} type="file" accept=".log,.txt,.out" style={{ display:"none" }}
            onChange={e => {
              const f = e.target.files[0];
              if (!f) return;
              window.__pendingFile = f;
              addTab(f.name, "__web__", f.size);
            }} />
        )}
      </div>

      {activeTab.docker
        ? <DockerTab key={`docker-${activeTab.id}`}
                     containerId={activeTab.docker.containerId}
                     containerName={activeTab.docker.name} />
        : activeTab.filePath
          ? <LogTab key={`${activeTab.id}-${activeTab.filePath}`}
                    filePath={activeTab.filePath}
                    fileName={activeTab.label}
                    fileSize={activeTab.fileSize} />
          : <Welcome onOpen={openFile} isElectron={IS_ELECTRON} />
      }

      {about        && <AboutModal onClose={() => setAbout(false)} />}
      {dockerPicker && <DockerPicker onSelect={openDockerTab} onClose={() => setDockerPicker(false)} />}
    </div>
  );
}

function Welcome({ onOpen, isElectron }) {
  return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                  flexDirection:"column", gap:20, color:"#333" }}>
      <div style={{ fontSize:48 }}>📋</div>
      <p style={{ fontSize:18, color:"#555" }}>LogViewer</p>
      <button onClick={onOpen}
        style={{ background:"#181818", border:"1px solid #333", borderRadius:8,
                 color:"#aaa", fontFamily:"inherit", fontSize:13,
                 padding:"10px 24px", cursor:"pointer" }}>
        Abrir archivo…
      </button>
      <div style={{ fontSize:11, color:"#252525" }}>
        {isElectron ? "Ctrl+O  ·  Ctrl+T nueva pestaña  ·  clic en ◇ para marcar líneas" : ".log  .txt  .out"}
      </div>
    </div>
  );
}
