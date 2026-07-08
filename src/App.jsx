import { useState, useEffect, useRef, useMemo, useCallback, memo, createContext, useContext } from "react";

/* ═══════════════════════════════════════════
   Constants
═══════════════════════════════════════════ */
const ROW_H    = 22;
const OVERSCAN = 40;
const IS_ELECTRON = typeof window !== "undefined" && !!window.electronAPI;

/* ═══════════════════════════════════════════
   i18n
═══════════════════════════════════════════ */
const T = {
  es: {
    bm_add:          "Marcar línea",
    bm_remove:       "Quitar marcador",
    filter_ph:       "🔍  filtrar…",
    regex_ph:        "regex…",
    regex_btn_title: "Activar filtro por expresión regular",
    bm_prev_title:   "Marcador anterior (Shift+F2)",
    bm_next_title:   "Marcador siguiente (F2)",
    bm_clear_title:  "Limpiar todos los marcadores",
    bm_clear_btn:    "✕ marcas",
    bm_count:        n => `${n} ${n === 1 ? "marca" : "marcas"}`,
    tail_title:      "Tail -f — seguir archivo en vivo",
    tail_follow:     "▶ seguir",
    tail_stop:       "⏹ detener",
    autoscroll_title:"Auto-scroll al final",
    linenums_title:  "Números de línea",
    scroll_top:      "↑ inicio",
    scroll_bottom:   "↓ fin",
    reading:         pct => `Leyendo… ${pct}%`,
    regex_invalid:   "Regex inválida",
    no_results:      f => `Sin resultados para "${f}"`,
    no_lines:        "Sin líneas",
    live:            "● en vivo",
    stopped:         "● detenido",
    lines:           (f, tot) => `${fmtNum(f)} / ${fmtNum(tot)} líneas`,
    lines_size:      (f, tot, s) => `${fmtNum(f)} / ${fmtNum(tot)} líneas · ${s}`,
    rotated:         c => `Archivo rotado — recargando en ${c}s…`,
    truncated:       c => `Archivo truncado — recargando en ${c}s…`,
    recreated:       "Nuevo archivo detectado — cargando…",
    diag_title:      "📋 BITÁCORA",
    diag_entries:    n => `${n} entradas`,
    diag_clear:      "Limpiar",
    diag_empty:      "Sin entradas aún",
    docker_title:    "🐳 Contenedores Docker activos",
    docker_connecting:"Conectando con Docker…",
    docker_err_hint: "¿Está Docker corriendo y accesible?",
    docker_empty:    "No hay contenedores en ejecución.",
    cancel:          "Cancelar",
    docker_waiting:  "Esperando logs del contenedor…",
    docker_starting: "Iniciando proceso…",
    docker_no_logs:  "El contenedor no ha emitido logs aún",
    bm_clear_docker: "Limpiar marcadores",
    remote_title:    "Bitacora remota",
    remote_mode_ssh: "SSH",
    remote_mode_wsl: "WSL2",
    remote_host:     "Host o alias SSH",
    remote_port:     "Puerto",
    remote_distro:   "Distro WSL",
    remote_path:     "Ruta del log",
    remote_tail:     "Lineas iniciales",
    remote_open:     "Conectar",
    remote_hint:     "Usa ssh/wsl del sistema; PulpLog no guarda llaves ni contrasenas.",
    remote_waiting:  "Esperando logs remotos…",
    remote_btn_title:"Conectar a bitacora remota por SSH o WSL",
    capability_checking:"Validando herramientas del sistema…",
    capability_unavailable:"No disponible",
    developed_by:    "Desarrollado por",
    license:         "Licencia MIT © 2026",
    close:           "Cerrar",
    settings_header: "⚙ Configuración",
    recent_files_h:  "ARCHIVOS RECIENTES",
    no_recent:       "Sin archivos recientes",
    clear_recents:   "Limpiar recientes",
    prefs_h:         "PREFERENCIAS",
    pref_autoscroll: "Auto-scroll activado al abrir archivo",
    pref_linenums:   "Mostrar números de línea por defecto",
    lang_h:          "IDIOMA",
    open_file_btn:   "Abrir archivo…",
    recent_h:        "RECIENTES",
    hint_electron:   "Ctrl+O  ·  Ctrl+T nueva pestaña  ·  clic en ◇ para marcar líneas",
    hint_web:        ".log  .txt  .out",
    open_file_title: "Abrir archivo (Ctrl+O)",
    docker_btn_title:"Conectar a contenedor Docker",
    diag_btn_title:  "Bitácora de diagnóstico",
    settings_title:  "Configuración",
    about_btn:       "Acerca de",
    about_title:     "Acerca de PulpLog",
    welcome_tab:     "Bienvenida",
  },
  en: {
    bm_add:          "Bookmark line",
    bm_remove:       "Remove bookmark",
    filter_ph:       "🔍  filter…",
    regex_ph:        "regex…",
    regex_btn_title: "Enable regular expression filter",
    bm_prev_title:   "Previous bookmark (Shift+F2)",
    bm_next_title:   "Next bookmark (F2)",
    bm_clear_title:  "Clear all bookmarks",
    bm_clear_btn:    "✕ marks",
    bm_count:        n => `${n} ${n === 1 ? "bookmark" : "bookmarks"}`,
    tail_title:      "Tail -f — follow file live",
    tail_follow:     "▶ follow",
    tail_stop:       "⏹ stop",
    autoscroll_title:"Auto-scroll to bottom",
    linenums_title:  "Line numbers",
    scroll_top:      "↑ top",
    scroll_bottom:   "↓ bottom",
    reading:         pct => `Reading… ${pct}%`,
    regex_invalid:   "Invalid regex",
    no_results:      f => `No results for "${f}"`,
    no_lines:        "No lines",
    live:            "● live",
    stopped:         "● stopped",
    lines:           (f, tot) => `${fmtNum(f)} / ${fmtNum(tot)} lines`,
    lines_size:      (f, tot, s) => `${fmtNum(f)} / ${fmtNum(tot)} lines · ${s}`,
    rotated:         c => `File rotated — reloading in ${c}s…`,
    truncated:       c => `File truncated — reloading in ${c}s…`,
    recreated:       "New file detected — loading…",
    diag_title:      "📋 DIAGNOSTICS",
    diag_entries:    n => `${n} entries`,
    diag_clear:      "Clear",
    diag_empty:      "No entries yet",
    docker_title:    "🐳 Active Docker containers",
    docker_connecting:"Connecting to Docker…",
    docker_err_hint: "Is Docker running and accessible?",
    docker_empty:    "No running containers.",
    cancel:          "Cancel",
    docker_waiting:  "Waiting for container logs…",
    docker_starting: "Starting process…",
    docker_no_logs:  "Container hasn't emitted any logs yet",
    bm_clear_docker: "Clear bookmarks",
    remote_title:    "Remote log",
    remote_mode_ssh: "SSH",
    remote_mode_wsl: "WSL2",
    remote_host:     "SSH host or alias",
    remote_port:     "Port",
    remote_distro:   "WSL distro",
    remote_path:     "Log path",
    remote_tail:     "Initial lines",
    remote_open:     "Connect",
    remote_hint:     "Uses system ssh/wsl; PulpLog does not store keys or passwords.",
    remote_waiting:  "Waiting for remote logs…",
    remote_btn_title:"Connect to remote log over SSH or WSL",
    capability_checking:"Checking system tools…",
    capability_unavailable:"Unavailable",
    developed_by:    "Developed by",
    license:         "MIT License © 2026",
    close:           "Close",
    settings_header: "⚙ Settings",
    recent_files_h:  "RECENT FILES",
    no_recent:       "No recent files",
    clear_recents:   "Clear recents",
    prefs_h:         "PREFERENCES",
    pref_autoscroll: "Auto-scroll enabled when opening file",
    pref_linenums:   "Show line numbers by default",
    lang_h:          "LANGUAGE",
    open_file_btn:   "Open file…",
    recent_h:        "RECENT",
    hint_electron:   "Ctrl+O  ·  Ctrl+T new tab  ·  click ◇ to bookmark lines",
    hint_web:        ".log  .txt  .out",
    open_file_title: "Open file (Ctrl+O)",
    docker_btn_title:"Connect to Docker container",
    diag_btn_title:  "Diagnostic log",
    settings_title:  "Settings",
    about_btn:       "About",
    about_title:     "About PulpLog",
    welcome_tab:     "Welcome",
  },
};

const LangCtx = createContext(() => "");
const useLang = () => useContext(LangCtx);

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
const esc     = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fmtSize = b => b>=1e9?`${(b/1e9).toFixed(2)} GB`:b>=1e6?`${(b/1e6).toFixed(1)} MB`:b>=1e3?`${(b/1e3).toFixed(0)} KB`:`${b} B`;
const fmtNum  = n => n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}k`:String(n);

/* ═══════════════════════════════════════════
   LogRow
═══════════════════════════════════════════ */
const LogRow = memo(({ item, showNums, isBookmarked, onToggleBookmark }) => {
  const t = useLang();
  const s = STYLE[item.type] || STYLE.plain;
  return (
    <div style={{
      display:"flex", alignItems:"stretch", height:ROW_H,
      background: isBookmarked ? "rgba(255,200,50,.07)" : s.bg,
      borderBottom:"0.5px solid rgba(255,255,255,.02)",
      outline: isBookmarked ? "0.5px solid rgba(255,200,50,.25)" : "none",
    }}>
      {showNums && (
        <span
          onClick={() => onToggleBookmark(item.origLine)}
          title={isBookmarked ? t("bm_remove") : t("bm_add")}
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
function LogTab({ filePath, fileName, fileSize, autoScrollDefault = false, showNumsDefault = true }) {
  const t = useLang();
  const [rawLines,    setRawLines]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [progress,    setProgress]    = useState(0);
  const [tailing,     setTailing]     = useState(true);
  const [autoScroll,  setAutoScroll]  = useState(autoScrollDefault);
  const [showNums,    setShowNums]    = useState(showNumsDefault);
  const [filter,      setFilter]      = useState("");
  const [useRegex,    setUseRegex]    = useState(false);
  const [regexError,  setRegexError]  = useState(false);
  const [bookmarks,   setBookmarks]   = useState(new Set());
  const [bmCursor,    setBmCursor]    = useState(-1);
  const [rotation,    setRotation]    = useState(null);
  const [reloadKey,   setReloadKey]   = useState(0);
  const [lvl, setLvl] = useState({
    error:true, warn:true, info:true, debug:true, trace:true, stack:true, plain:true
  });

  const listRef       = useRef(null);
  const bufRef        = useRef("");
  const timerRef      = useRef(null);
  const autoScrollRef = useRef(autoScroll);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);

  /* ── Stream read ── */
  useEffect(() => {
    if (!filePath) return;
    setLoading(true); setProgress(0); setRawLines([]);
    bufRef.current = "";

    if (IS_ELECTRON) {
      const totalBytes = fileSize || 1;
      const cancel = window.electronAPI.readFile(filePath, {
        onProgress(bytesRead) {
          setProgress(Math.min(bytesRead / totalBytes, 0.99));
        },
        onChunk(chunk) {
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
      onNewLines(text) {
        setRawLines(prev => [...prev, ...text.split("\n").filter(Boolean)]);
        if (autoScrollRef.current) listRef.current?.scrollToBottom();
      },
      onRotated()   { setRotation({ event:"rotated",   countdown: 3 }); setTailing(false); },
      onTruncated() { setRotation({ event:"truncated", countdown: 2 }); setTailing(false); },
      onRecreated() { setRotation({ event:"recreated", countdown: 0 }); setReloadKey(k => k + 1); },
    });
    return () => unwatch?.();
  }, [tailing, loading, filePath]); // eslint-disable-line

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

        <div style={{ display:"flex", flex:1, minWidth:140, position:"relative" }}>
          <input
            style={{ flex:1, background:"#181818",
                     border:`0.5px solid ${regexError ? "#883030" : "#2e2e2e"}`,
                     borderRadius:"6px 0 0 6px", color: regexError ? "#ff6060" : "#bbb",
                     fontFamily:"inherit", fontSize:12, padding:"4px 10px", outline:"none" }}
            placeholder={useRegex ? t("regex_ph") : t("filter_ph")}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button
            onClick={() => setUseRegex(p => !p)}
            title={t("regex_btn_title")}
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
            {cnt > 0 && (
              <span style={{ background:"rgba(255,255,255,.18)", borderRadius:4,
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
          <span style={{ fontSize:10, color:"#c0a030", padding:"0 2px" }}>
            {t("bm_count", bookmarks.size)}
          </span>
        )}
        {bookmarks.size > 0 && (
          <Btn onClick={() => { setBookmarks(new Set()); setBmCursor(-1); }}
            title={t("bm_clear_title")}>
            {t("bm_clear_btn")}
          </Btn>
        )}

        <Sep />

        <Btn active={tailing} onClick={toggleTail} disabled={!IS_ELECTRON}
          title={t("tail_title")}>
          {tailing ? t("tail_stop") : t("tail_follow")}
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

      {/* progress */}
      {loading && (
        <div style={{ height:3, background:"#181818", flexShrink:0 }}>
          <div style={{ height:"100%", background:"#2a7faa", transition:"width .08s",
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
                      flexDirection:"column", gap:12, color:"#444", fontSize:13 }}>
          <span style={{ fontSize:28, display:"block", color:"#2a7faa",
            animation:"spin 1s linear infinite" }}>↻</span>
          {t("reading", Math.round(progress*100))}
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:8, color:"#333", fontSize:13 }}>
          {regexError
            ? <><span style={{ color:"#ff6060", fontSize:14 }}>⚠</span> {t("regex_invalid")}</>
            : filter ? t("no_results", filter) : t("no_lines")}
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
        {tailing && <span style={{ color:"#2a9a4a" }}>{t("live")}</span>}
        {bookmarks.size > 0 && (
          <span style={{ color:"#c0a030" }}>◆ {bookmarks.size}</span>
        )}
        <span style={{ marginLeft:"auto", color:"#444" }}>
          {fileSize
            ? t("lines_size", filtered.length, rawLines.length, fmtSize(fileSize))
            : t("lines", filtered.length, rawLines.length)}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Rotation banner
═══════════════════════════════════════════ */
function RotationBanner({ event, countdown }) {
  const t = useLang();
  const CFG = {
    rotated:   { bg:"#2a1a00", border:"#c08020", color:"#f0c060", icon:"↻", label: t("rotated", countdown) },
    truncated: { bg:"#0a1e2a", border:"#2a7faa", color:"#60b8e8", icon:"⬇", label: t("truncated", countdown) },
    recreated: { bg:"#0a2a0a", border:"#2a8a2a", color:"#60d060", icon:"✓", label: t("recreated") },
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
   DiagPanel – bitácora de diagnóstico
═══════════════════════════════════════════ */
function DiagPanel({ onClose }) {
  const t = useLang();
  const [entries, setEntries] = useState([]);
  const scrollRef   = useRef(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    window.electronAPI.getAppLog().then(setEntries);
    const unsub = window.electronAPI.onAppLogNew(entry => {
      setEntries(prev => [...prev, entry]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (atBottomRef.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries]);

  const LEVEL = {
    ERROR: { color:"#ff8888", bg:"#2a0808", label:"ERROR" },
    WARN:  { color:"#f0c060", bg:"#1c1408", label:"WARN " },
    INFO:  { color:"#60b8e8", bg:"transparent", label:"INFO " },
  };
  const CAT_COLOR = { docker:"#2a9a4a", file:"#2a7faa", remote:"#7a7aaa" };
  const fmt = ts => new Date(ts).toLocaleTimeString(undefined, { hour12:false });

  return (
    <div style={{ height:210, flexShrink:0, borderTop:"1px solid #1a1a1a",
                  background:"#070707", display:"flex", flexDirection:"column",
                  fontFamily:"inherit" }}>

      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 10px",
                    background:"#0d0d0d", borderBottom:"0.5px solid #1a1a1a", flexShrink:0 }}>
        <span style={{ fontSize:10, color:"#555", fontWeight:700, letterSpacing:1 }}>
          {t("diag_title")}
        </span>
        <span style={{ fontSize:10, color:"#252525" }}>{t("diag_entries", entries.length)}</span>
        <Btn onClick={() => { window.electronAPI.clearAppLog(); setEntries([]); }}>
          {t("diag_clear")}
        </Btn>
        <button onClick={onClose}
          style={{ marginLeft:"auto", background:"none", border:"none",
                   color:"#333", cursor:"pointer", fontSize:13, padding:"0 4px",
                   fontFamily:"inherit" }}>
          ✕
        </button>
      </div>

      <div ref={scrollRef}
           onScroll={e => {
             const el = e.currentTarget;
             atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
           }}
           style={{ flex:1, overflowY:"auto" }}>
        {entries.length === 0 && (
          <div style={{ padding:"20px 10px", color:"#222", fontSize:11, textAlign:"center" }}>
            {t("diag_empty")}
          </div>
        )}
        {entries.map((e, i) => {
          const s = LEVEL[e.level] || LEVEL.INFO;
          return (
            <div key={i} style={{ display:"flex", gap:10, padding:"2px 10px", fontSize:11,
                                  background:s.bg, borderBottom:"0.5px solid rgba(255,255,255,.02)",
                                  fontFamily:"inherit" }}>
              <span style={{ color:"#282828", flexShrink:0, minWidth:72 }}>{fmt(e.ts)}</span>
              <span style={{ color:s.color, fontWeight:700, flexShrink:0, minWidth:42,
                             fontFamily:"monospace" }}>{s.label}</span>
              <span style={{ color: CAT_COLOR[e.category] || "#444", flexShrink:0,
                             minWidth:52 }}>[{e.category}]</span>
              <span style={{ color:"#666" }}>{e.msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Settings modal
═══════════════════════════════════════════ */
function PrefToggle({ label, value, onChange }) {
  return (
    <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", userSelect:"none" }}>
      <div onClick={() => onChange(!value)}
           style={{ width:28, height:16, borderRadius:8, flexShrink:0,
                    background: value ? "#1a5f1a" : "#1e1e1e",
                    border:`1px solid ${value ? "#2a9a2a" : "#2e2e2e"}`,
                    position:"relative", cursor:"pointer" }}>
        <div style={{ position:"absolute", top:2, left: value ? 14 : 2,
                       width:10, height:10, borderRadius:"50%",
                       background: value ? "#4aaa4a" : "#333",
                       transition:"left .12s" }} />
      </div>
      <span style={{ fontSize:11, color:"#666" }}>{label}</span>
    </label>
  );
}

function SettingsModal({ settings, onClose, onOpenFile, onRemoveRecent, onClearRecent, onTogglePref }) {
  const t = useLang();
  const lang = settings.language || "es";

  return (
    <div onClick={onClose}
         style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
                  display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e => e.stopPropagation()}
           style={{ background:"#111", border:"0.5px solid #2a2a2a", borderRadius:10,
                    padding:"28px 32px", minWidth:500, maxWidth:620,
                    boxShadow:"0 8px 40px rgba(0,0,0,.8)", fontFamily:"inherit" }}>

        <div style={{ display:"flex", alignItems:"center", marginBottom:22 }}>
          <span style={{ fontSize:14, color:"#ccc", fontWeight:700 }}>{t("settings_header")}</span>
          <button onClick={onClose}
            style={{ marginLeft:"auto", background:"none", border:"none",
                     color:"#444", cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>✕</button>
        </div>

        {/* language */}
        <div style={{ fontSize:10, color:"#444", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
          {t("lang_h")}
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:24 }}>
          {["es","en"].map(l => (
            <button key={l} onClick={() => onTogglePref("language", l)}
              style={{ background: lang === l ? "#1a2a3a" : "#181818",
                       border:`0.5px solid ${lang === l ? "#2a6a9a" : "#2e2e2e"}`,
                       borderRadius:6, color: lang === l ? "#60b8e8" : "#555",
                       fontFamily:"inherit", fontSize:12, padding:"5px 18px",
                       cursor:"pointer", fontWeight: lang === l ? 700 : 400 }}>
              {l === "es" ? "Español" : "English"}
            </button>
          ))}
        </div>

        {/* recent files */}
        <div style={{ fontSize:10, color:"#444", fontWeight:700, letterSpacing:1, marginBottom:8 }}>
          {t("recent_files_h")}
        </div>
        {settings.recentFiles.length === 0 ? (
          <div style={{ fontSize:11, color:"#252525", padding:"10px 0 16px" }}>{t("no_recent")}</div>
        ) : (
          <>
            <div style={{ maxHeight:200, overflowY:"auto", marginBottom:8,
                           border:"0.5px solid #1e1e1e", borderRadius:6 }}>
              {settings.recentFiles.map((fp, i) => {
                const name = fp.split(/[\\/]/).pop();
                return (
                  <div key={fp}
                       style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px",
                                borderBottom: i < settings.recentFiles.length - 1
                                  ? "0.5px solid #1a1a1a" : "none",
                                background:"#0e0e0e" }}>
                    <span onClick={() => { onOpenFile(fp); onClose(); }}
                          title={fp}
                          style={{ flex:1, fontSize:12, color:"#777", cursor:"pointer",
                                   overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      📄 <b style={{ color:"#999" }}>{name}</b>
                      <span style={{ fontSize:10, color:"#2a2a2a", marginLeft:8 }}>{fp}</span>
                    </span>
                    <button onClick={() => onRemoveRecent(fp)}
                      style={{ background:"none", border:"none", color:"#333",
                               cursor:"pointer", fontSize:11, padding:"0 4px", flexShrink:0 }}>✕</button>
                  </div>
                );
              })}
            </div>
            <Btn onClick={onClearRecent}>{t("clear_recents")}</Btn>
          </>
        )}

        {/* preferences */}
        <div style={{ fontSize:10, color:"#444", fontWeight:700, letterSpacing:1,
                       marginTop:24, marginBottom:12 }}>
          {t("prefs_h")}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <PrefToggle
            label={t("pref_autoscroll")}
            value={settings.autoScrollDefault}
            onChange={v => onTogglePref("autoScrollDefault", v)}
          />
          <PrefToggle
            label={t("pref_linenums")}
            value={settings.showNumsDefault}
            onChange={v => onTogglePref("showNumsDefault", v)}
          />
        </div>

        <button onClick={onClose}
          style={{ marginTop:28, background:"#181818", border:"0.5px solid #2e2e2e",
                   borderRadius:6, color:"#666", fontFamily:"inherit",
                   fontSize:11, padding:"6px 20px", cursor:"pointer" }}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   About modal
═══════════════════════════════════════════ */
function AboutModal({ onClose }) {
  const t = useLang();
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
        <img src="/lindecode-max.jpeg" alt="LindeCode"
          style={{ width:96, height:96, borderRadius:12, objectFit:"cover", marginBottom:12 }} />
        <div style={{ fontSize:18, color:"#ccc", fontWeight:700, marginBottom:4 }}>PulpLog</div>
        <div style={{ fontSize:11, color:"#444", marginBottom:20 }}>v1.0.0</div>
        <div style={{ width:40, height:"0.5px", background:"#2a2a2a", margin:"0 auto 20px" }} />
        <div style={{ fontSize:13, color:"#888", marginBottom:6 }}>{t("developed_by")}</div>
        <div style={{ fontSize:16, color:"#2a7faa", fontWeight:700, letterSpacing:1 }}>LindeCode</div>
        <div style={{ marginTop:20, fontSize:11, color:"#333" }}>{t("license")}</div>
        <button
          onClick={onClose}
          style={{ marginTop:24, background:"#181818", border:"0.5px solid #2e2e2e",
                   borderRadius:6, color:"#666", fontFamily:"inherit",
                   fontSize:11, padding:"6px 20px", cursor:"pointer" }}>
          {t("close")}
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
  const t = useLang();
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
          {t("docker_title")}
        </div>

        {containers === null && !error && (
          <div style={{ color:"#444", fontSize:12, padding:"8px 0" }}>{t("docker_connecting")}</div>
        )}
        {error && (
          <div style={{ color:"#ff6060", fontSize:12, padding:"8px 0", lineHeight:1.6 }}>
            <span style={{ fontWeight:700 }}>Error:</span> {error}
            <br /><span style={{ color:"#555" }}>{t("docker_err_hint")}</span>
          </div>
        )}
        {containers?.length === 0 && (
          <div style={{ color:"#555", fontSize:12, padding:"8px 0" }}>{t("docker_empty")}</div>
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
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Docker – log streaming tab
═══════════════════════════════════════════ */
function DockerTab({ containerId, containerName }) {
  const t = useLang();
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
            placeholder={useRegex ? t("regex_ph") : t("filter_ph")}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button onClick={() => setUseRegex(p => !p)}
            title={t("regex_btn_title")}
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

        <Btn onClick={() => jumpBookmark("prev")} disabled={!sortedBookmarks.length} title={t("bm_prev_title")}>◆ ↑</Btn>
        <Btn onClick={() => jumpBookmark("next")} disabled={!sortedBookmarks.length} title={t("bm_next_title")}>◆ ↓</Btn>
        {bookmarks.size > 0 && <span style={{ fontSize:10, color:"#c0a030", padding:"0 2px" }}>{t("bm_count", bookmarks.size)}</span>}
        {bookmarks.size > 0 && <Btn onClick={() => { setBookmarks(new Set()); setBmCursor(-1); }} title={t("bm_clear_title")}>{t("bm_clear_btn")}</Btn>}

        <Sep />

        <Btn active={autoScroll} onClick={() => setAutoScroll(p => !p)} title={t("autoscroll_title")}>↓ auto</Btn>
        <Btn active={showNums}   onClick={() => setShowNums(p => !p)}   title={t("linenums_title")}>#</Btn>
        <Btn onClick={() => listRef.current?.scrollToTop()}>{t("scroll_top")}</Btn>
        <Btn onClick={() => listRef.current?.scrollToBottom()}>{t("scroll_bottom")}</Btn>
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
          {spawned ? t("docker_waiting") : t("docker_starting")}
          {spawned && <span style={{ fontSize:10, color:"#252525" }}>{t("docker_no_logs")}</span>}
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      color:"#333", fontSize:13 }}>
          {regexError
            ? <><span style={{ color:"#ff6060" }}>⚠</span> {t("regex_invalid")}</>
            : filter ? t("no_results", filter) : t("no_lines")}
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
        {connected  && <span style={{ color:"#2a9a4a" }}>{t("live")}</span>}
        {!connected && rawLines.length > 0 && <span style={{ color:"#555" }}>{t("stopped")}</span>}
        {bookmarks.size > 0 && <span style={{ color:"#c0a030" }}>◆ {bookmarks.size}</span>}
        <span style={{ marginLeft:"auto", color:"#444" }}>
          {t("lines", filtered.length, rawLines.length)}
        </span>
      </div>
    </div>
  );
}

function RemotePicker({ onSelect, onClose, capabilities }) {
  const t = useLang();
  const [mode, setMode] = useState("ssh");
  const [target, setTarget] = useState("");
  const [port, setPort] = useState("");
  const [distro, setDistro] = useState("");
  const [filePath, setFilePath] = useState("");
  const [tailLines, setTailLines] = useState(500);
  const sshCap = capabilities?.ssh;
  const wslCap = capabilities?.wsl;
  const wslDistros = wslCap?.distros || [];
  const wslDistrosKey = wslDistros.join("|");
  const modeAvailable = mode === "wsl" ? wslCap?.available : sshCap?.available;
  const canSubmit = modeAvailable && filePath.trim() && (mode === "wsl" || target.trim());

  useEffect(() => {
    if (!capabilities) return;
    if (mode === "ssh" && !sshCap?.available && wslCap?.available) setMode("wsl");
    if (mode === "wsl" && !wslCap?.available && sshCap?.available) setMode("ssh");
  }, [capabilities, mode, sshCap?.available, wslCap?.available]);

  useEffect(() => {
    if (mode !== "wsl" || distro || wslDistros.length === 0) return;
    setDistro(wslDistros[0]);
  }, [mode, distro, wslDistrosKey]);

  const submit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSelect({ mode, target, port, distro, filePath, tailLines });
  };

  const inputStyle = {
    background:"#181818", border:"0.5px solid #2e2e2e", borderRadius:6,
    color:"#bbb", fontFamily:"inherit", fontSize:12, padding:"7px 9px",
    outline:"none", width:"100%",
  };

  return (
    <div onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
               display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        style={{ background:"#111", border:"0.5px solid #2a2a2a", borderRadius:10,
                 padding:"24px", minWidth:460, maxWidth:620, fontFamily:"inherit",
                 boxShadow:"0 8px 40px rgba(0,0,0,.8)" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:16 }}>
          <span style={{ fontSize:14, color:"#ccc", fontWeight:700 }}>{t("remote_title")}</span>
          <button type="button" onClick={onClose}
            style={{ marginLeft:"auto", background:"none", border:"none",
                     color:"#444", cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>x</button>
        </div>

        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          {[["ssh", t("remote_mode_ssh"), sshCap], ["wsl", t("remote_mode_wsl"), wslCap]].map(([key, label, cap]) => (
            <button key={key} type="button" onClick={() => cap?.available && setMode(key)}
              disabled={!cap?.available}
              title={cap?.available ? label : (cap?.reason || t("capability_unavailable"))}
              style={{ background: mode === key ? "#1a2a3a" : "#181818",
                       border:`0.5px solid ${mode === key ? "#2a6a9a" : "#2e2e2e"}`,
                       borderRadius:6, color: mode === key ? "#60b8e8" : cap?.available ? "#555" : "#333",
                       fontFamily:"inherit", fontSize:12, padding:"5px 18px",
                       cursor: cap?.available ? "pointer" : "not-allowed",
                       opacity: cap?.available ? 1 : 0.45,
                       fontWeight: mode === key ? 700 : 400 }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 110px", gap:10, marginBottom:10 }}>
          {mode === "ssh" ? (
            <>
              <input style={inputStyle} value={target} onChange={e => setTarget(e.target.value)}
                placeholder={`${t("remote_host")} (prod-web, user@host)`} />
              <input style={inputStyle} value={port} onChange={e => setPort(e.target.value)}
                placeholder={t("remote_port")} />
            </>
          ) : (
            <>
              {wslDistros.length > 0 ? (
                <select style={inputStyle} value={distro} onChange={e => setDistro(e.target.value)}>
                  <option value="">Default</option>
                  {wslDistros.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              ) : (
                <input style={inputStyle} value={distro} onChange={e => setDistro(e.target.value)}
                  placeholder={`${t("remote_distro")} (Ubuntu)`} />
              )}
              <input style={inputStyle} value={tailLines} onChange={e => setTailLines(e.target.value)}
                placeholder={t("remote_tail")} />
            </>
          )}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 110px", gap:10, marginBottom:12 }}>
          <input style={inputStyle} value={filePath} onChange={e => setFilePath(e.target.value)}
            placeholder={`${t("remote_path")} (/var/log/app.log)`} />
          {mode === "ssh" ? (
            <input style={inputStyle} value={tailLines} onChange={e => setTailLines(e.target.value)}
              placeholder={t("remote_tail")} />
          ) : (
            <span />
          )}
        </div>

        <div style={{ color:"#555", fontSize:10, lineHeight:1.5, marginBottom:18 }}>
          {t("remote_hint")}
          {!modeAvailable && (
            <div style={{ color:"#885555", marginTop:6 }}>
              {mode === "wsl" ? (wslCap?.reason || t("capability_unavailable")) : (sshCap?.reason || t("capability_unavailable"))}
            </div>
          )}
        </div>

        <button type="submit" disabled={!canSubmit}
          style={{ background: canSubmit ? "#1a2a3a" : "#181818",
                   border:`0.5px solid ${canSubmit ? "#2a6a9a" : "#2e2e2e"}`,
                   borderRadius:6, color: canSubmit ? "#60b8e8" : "#444",
                   fontFamily:"inherit", fontSize:12, padding:"7px 20px",
                   cursor: canSubmit ? "pointer" : "not-allowed", marginRight:10 }}>
          {t("remote_open")}
        </button>
        <button type="button" onClick={onClose}
          style={{ background:"#181818", border:"0.5px solid #2e2e2e",
                   borderRadius:6, color:"#666", fontFamily:"inherit",
                   fontSize:11, padding:"7px 20px", cursor:"pointer" }}>
          {t("cancel")}
        </button>
      </form>
    </div>
  );
}

function RemoteTab({ config }) {
  const t = useLang();
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
    const unwatch = window.electronAPI.streamRemoteLogs(config, {
      onSpawned() { setSpawned(true); setConnected(true); },
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
  }, [config]);

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
  const modeLabel = config.mode === "wsl" ? t("remote_mode_wsl") : t("remote_mode_ssh");
  const targetLabel = config.mode === "wsl"
    ? (config.distro ? `${config.distro}:${config.filePath}` : config.filePath)
    : `${config.target}:${config.filePath}`;

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
      <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 10px",
                    background:"#111", borderBottom:"0.5px solid #222",
                    flexWrap:"wrap", flexShrink:0 }}>
        <span style={{ fontSize:11, color:"#a8a8f0", background:"#101024",
                       border:"0.5px solid #2a2a5a", borderRadius:6, padding:"3px 8px",
                       fontWeight:700, flexShrink:0, whiteSpace:"nowrap" }}>
          {modeLabel} {targetLabel}
        </span>
        <Sep />
        <div style={{ display:"flex", flex:1, minWidth:140 }}>
          <input
            style={{ flex:1, background:"#181818",
                     border:`0.5px solid ${regexError ? "#883030" : "#2e2e2e"}`,
                     borderRadius:"6px 0 0 6px", color: regexError ? "#ff6060" : "#bbb",
                     fontFamily:"inherit", fontSize:12, padding:"4px 10px", outline:"none" }}
            placeholder={useRegex ? t("regex_ph") : t("filter_ph")}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button onClick={() => setUseRegex(p => !p)}
            title={t("regex_btn_title")}
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
        <Btn onClick={() => jumpBookmark("prev")} disabled={!sortedBookmarks.length} title={t("bm_prev_title")}>◆ ↑</Btn>
        <Btn onClick={() => jumpBookmark("next")} disabled={!sortedBookmarks.length} title={t("bm_next_title")}>◆ ↓</Btn>
        {bookmarks.size > 0 && <span style={{ fontSize:10, color:"#c0a030", padding:"0 2px" }}>{t("bm_count", bookmarks.size)}</span>}
        {bookmarks.size > 0 && <Btn onClick={() => { setBookmarks(new Set()); setBmCursor(-1); }} title={t("bm_clear_title")}>{t("bm_clear_btn")}</Btn>}
        <Sep />
        <Btn active={autoScroll} onClick={() => setAutoScroll(p => !p)} title={t("autoscroll_title")}>↓ auto</Btn>
        <Btn active={showNums}   onClick={() => setShowNums(p => !p)}   title={t("linenums_title")}>#</Btn>
        <Btn onClick={() => listRef.current?.scrollToTop()}>{t("scroll_top")}</Btn>
        <Btn onClick={() => listRef.current?.scrollToBottom()}>{t("scroll_bottom")}</Btn>
      </div>

      {error && (
        <div style={{ padding:"6px 14px", background:"#2a1010", borderBottom:"1px solid #883030",
                      color:"#ff8888", fontSize:12, flexShrink:0, fontFamily:"inherit" }}>
          ⚠ {error}
        </div>
      )}

      {rawLines.length === 0 && !error ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:10, color:"#333", fontSize:13 }}>
          <span style={{ fontSize:28, color:"#7a7aaa", animation:"spin 1s linear infinite" }}>↻</span>
          {spawned ? t("remote_waiting") : t("docker_starting")}
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      color:"#333", fontSize:13 }}>
          {regexError
            ? <><span style={{ color:"#ff6060" }}>⚠</span> {t("regex_invalid")}</>
            : filter ? t("no_results", filter) : t("no_lines")}
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

      <div style={{ display:"flex", gap:14, padding:"4px 10px", background:"#0d0d0d",
                    borderTop:"0.5px solid #1a1a1a", fontSize:10, flexShrink:0, alignItems:"center" }}>
        {[["#883030",stats.error,"err"],["#806010",stats.warn,"warn"],
          ["#1a5070",stats.info,"info"],["#284028",stats.debug,"dbg"]].map(([c,n,l])=>(
          <span key={l} style={{ color:c }}>{fmtNum(n)} <span style={{color:"#252525"}}>{l}</span></span>
        ))}
        {connected  && <span style={{ color:"#2a9a4a" }}>{t("live")}</span>}
        {!connected && rawLines.length > 0 && <span style={{ color:"#555" }}>{t("stopped")}</span>}
        {bookmarks.size > 0 && <span style={{ color:"#c0a030" }}>◆ {bookmarks.size}</span>}
        <span style={{ marginLeft:"auto", color:"#444" }}>
          {t("lines", filtered.length, rawLines.length)}
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
  const [tabs,         setTabs]        = useState([{ id: nextId++, label:"$welcome", filePath:null, fileSize:null }]);
  const [active,       setActive]      = useState(1);
  const [about,        setAbout]       = useState(false);
  const [dockerPicker, setDockerPicker]= useState(false);
  const [remotePicker, setRemotePicker]= useState(false);
  const [diagOpen,     setDiagOpen]    = useState(false);
  const [settingsOpen, setSettingsOpen]= useState(false);
  const [capabilities, setCapabilities]= useState(null);
  const [settings,     setSettings]    = useState({
    recentFiles:[], autoScrollDefault:false, showNumsDefault:true, language:"es", sessionTabs:[]
  });
  const fileRef       = useRef(null);
  const closedTabsRef = useRef([]);   // stack for reopen-last-tab
  const activeRef     = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    let alive = true;
    window.electronAPI.getCapabilities()
      .then(caps => { if (alive) setCapabilities(caps); })
      .catch(() => { if (alive) setCapabilities({}); });
    return () => { alive = false; };
  }, []);

  /* ── Translation function ── */
  const t = useCallback((key, ...args) => {
    const lang = settings.language || "es";
    const entry = (T[lang] ?? T.es)[key] ?? T.es[key] ?? key;
    return typeof entry === "function" ? entry(...args) : entry;
  }, [settings.language]);

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

  const openFileByPath = useCallback(async (fp) => {
    const stat  = await window.electronAPI.statFile(fp);
    const label = fp.split(/[\\/]/).pop();
    addTab(label, fp, stat?.size ?? null);
    const recent = await window.electronAPI.addRecentFile(fp);
    setSettings(prev => ({ ...prev, recentFiles: recent }));
  }, []);

  const openFile = useCallback(async () => {
    if (IS_ELECTRON) {
      const fp = await window.electronAPI.openFileDialog();
      if (!fp) return;
      await openFileByPath(fp);
    } else {
      fileRef.current?.click();
    }
  }, [openFileByPath]);

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

  const openRemoteTab = (config) => {
    const id = nextId++;
    const name = config.mode === "wsl"
      ? (config.distro ? `WSL ${config.distro}` : "WSL")
      : config.target;
    setTabs(p => [...p, {
      id,
      label: `SSH ${name}`,
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

  /* ── Mount: load settings, restore session or open initial file arg ── */
  useEffect(() => {
    if (!IS_ELECTRON) return;
    let alive = true;
    (async () => {
      const s = await window.electronAPI.getSettings();
      if (!alive) return;
      setSettings(prev => ({ ...prev, ...s, recentFiles: s.recentFiles || [] }));

      const initialArg = await window.electronAPI.getInitialFileArg();
      if (!alive) return;

      if (initialArg) {
        const stat  = await window.electronAPI.statFile(initialArg);
        const label = initialArg.split(/[\\/]/).pop();
        const id    = nextId++;
        setTabs(prev => [...prev, { id, label, filePath: initialArg, fileSize: stat?.size ?? null }]);
        setActive(id);
        const recent = await window.electronAPI.addRecentFile(initialArg);
        if (alive) setSettings(prev => ({ ...prev, recentFiles: recent }));
      } else if (s.sessionTabs?.length) {
        const valid = [];
        for (const st of s.sessionTabs) {
          const stat = await window.electronAPI.statFile(st.filePath);
          if (stat) valid.push({ ...st, fileSize: st.fileSize ?? stat.size });
        }
        if (valid.length && alive) {
          const entries = valid.map(st => ({
            id: nextId++, label: st.label, filePath: st.filePath, fileSize: st.fileSize,
          }));
          setTabs(prev => [...prev, ...entries]);
          setActive(entries[entries.length - 1].id);
        }
      }
    })();
    const unsub = window.electronAPI.onOpenFileArg(fp => openFileByPath(fp));
    return () => { alive = false; unsub?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Persist open file tabs as session on every tab change ── */
  useEffect(() => {
    if (!IS_ELECTRON) return;
    const timer = setTimeout(() => {
      const session = tabs
        .filter(tb => tb.filePath && tb.filePath !== "__web__")
        .map(tb => ({ filePath: tb.filePath, label: tb.label, fileSize: tb.fileSize }));
      window.electronAPI.setSettings({ sessionTabs: session });
    }, 600);
    return () => clearTimeout(timer);
  }, [tabs]);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    const cleanOpenFile = window.electronAPI.onMenuOpenFile(() => openFile());
    const cleanNewTab = window.electronAPI.onMenuNewTab(() => openFile());
    const cleanAbout = window.electronAPI.onMenuAbout(() => setAbout(true));
    return () => { cleanOpenFile?.(); cleanNewTab?.(); cleanAbout?.(); };
  }, [openFile]);

  /* ── Global OS shortcuts (Super+Shift+…) ── */
  useEffect(() => {
    if (!IS_ELECTRON) return;

    const cleanClose = window.electronAPI.onGlobalCloseTab(() => {
      const id = activeRef.current;
      setTabs(prev => {
        const idx = prev.findIndex(t => t.id === id);
        const tab = prev[idx];
        if (tab?.filePath && tab.filePath !== "__web__")
          closedTabsRef.current.push({ label: tab.label, filePath: tab.filePath, fileSize: tab.fileSize });
        const next = prev.filter(t => t.id !== id);
        if (next.length === 0) {
          const newId = nextId++;
          setActive(newId);
          return [{ id: newId, label:"$welcome", filePath:null }];
        }
        setActive(a => a === id ? next[Math.min(idx, next.length - 1)].id : a);
        return next;
      });
    });

    const cleanReopen = window.electronAPI.onGlobalReopenTab(() => {
      const last = closedTabsRef.current.pop();
      if (!last) return;
      const id = nextId++;
      setTabs(p => [...p, { id, label: last.label, filePath: last.filePath, fileSize: last.fileSize }]);
      setActive(id);
    });

    return () => { cleanClose?.(); cleanReopen?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = tabs.find(tab => tab.id === active) || tabs[0];
  const dockerCap = capabilities?.docker;
  const sshCap = capabilities?.ssh;
  const wslCap = capabilities?.wsl;
  const dockerEnabled = !!dockerCap?.available;
  const remoteEnabled = !!(sshCap?.available || wslCap?.available);

  return (
    <LangCtx.Provider value={t}>
      <div style={{ display:"flex", flexDirection:"column", height:"100vh",
                    background:"#0a0a0a", color:"#ccc", overflow:"hidden",
                    fontFamily:"'JetBrains Mono','Fira Code','Cascadia Code',monospace" }}>

        {/* tab bar */}
        <div style={{ display:"flex", alignItems:"stretch", background:"#0f0f0f",
                      borderBottom:"0.5px solid #1e1e1e", flexShrink:0, overflowX:"auto" }}>
          {tabs.map(tab => (
            <div key={tab.id}
              onClick={() => setActive(tab.id)}
              title={
                tab.docker   ? `🐳 ${tab.docker.name}\nID: ${tab.docker.containerId.slice(0, 12)}` :
                tab.remote   ? `${tab.remote.mode === "wsl" ? "WSL" : "SSH"}\n${tab.remote.filePath}` :
                tab.filePath ? tab.filePath :
                               t("hint_electron")
              }
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px",
                       borderRight:"0.5px solid #1e1e1e", cursor:"pointer", flexShrink:0,
                       fontSize:12, maxWidth:200, overflow:"hidden",
                       background: tab.id===active ? "#111":"transparent",
                       color:      tab.id===active ? "#ccc":"#555",
                       borderBottom: tab.id===active ? "1.5px solid #2a7faa":"1.5px solid transparent" }}>
              <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {tab.label === "$welcome" ? t("welcome_tab") : tab.label}
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
            title={t("open_file_title")}>+</button>

          {IS_ELECTRON && (
            <button onClick={() => dockerEnabled && setDockerPicker(true)}
              disabled={!dockerEnabled}
              style={{ background:"transparent", border:"none", color: dockerEnabled ? "#2a6a2a" : "#333",
                       padding:"0 14px", cursor: dockerEnabled ? "pointer" : "not-allowed", fontSize:14,
                       borderRight:"0.5px solid #1e1e1e", flexShrink:0 }}
              title={dockerEnabled ? t("docker_btn_title") : (dockerCap?.reason || t("capability_checking"))}>
              🐳
            </button>
          )}

          {IS_ELECTRON && (
            <button onClick={() => remoteEnabled && setRemotePicker(true)}
              disabled={!remoteEnabled}
              style={{ background:"transparent", border:"none", color: remoteEnabled ? "#6a6aaa" : "#333",
                       padding:"0 14px", cursor: remoteEnabled ? "pointer" : "not-allowed", fontSize:12,
                       borderRight:"0.5px solid #1e1e1e", flexShrink:0,
                       fontFamily:"inherit", fontWeight:700 }}
              title={remoteEnabled ? t("remote_btn_title") : (sshCap?.reason || wslCap?.reason || t("capability_checking"))}>
              SSH
            </button>
          )}

          {IS_ELECTRON && (
            <button onClick={() => setDiagOpen(p => !p)}
              style={{ background: diagOpen ? "#141a14" : "transparent",
                       border:"none", color: diagOpen ? "#4a8a4a" : "#444",
                       padding:"0 14px", cursor:"pointer", fontSize:13,
                       borderRight:"0.5px solid #1e1e1e", flexShrink:0 }}
              title={t("diag_btn_title")}>
              📋
            </button>
          )}

          {IS_ELECTRON && (
            <button onClick={() => setSettingsOpen(p => !p)}
              style={{ background: settingsOpen ? "#1a1a24" : "transparent",
                       border:"none", color: settingsOpen ? "#7a7aaa" : "#444",
                       padding:"0 14px", cursor:"pointer", fontSize:14,
                       borderRight:"0.5px solid #1e1e1e", flexShrink:0 }}
              title={t("settings_title")}>
              ⚙
            </button>
          )}

          <button onClick={() => setAbout(true)}
            style={{ background:"transparent", border:"none", color:"#333",
                     padding:"0 14px", cursor:"pointer", fontSize:11,
                     marginLeft:"auto", flexShrink:0, fontFamily:"inherit" }}
            title={t("about_title")}>
            {t("about_btn")}
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
          : activeTab.remote
            ? <RemoteTab key={`remote-${activeTab.id}`} config={activeTab.remote} />
            : activeTab.filePath
            ? <LogTab key={`${activeTab.id}-${activeTab.filePath}`}
                      filePath={activeTab.filePath}
                      fileName={activeTab.label}
                      fileSize={activeTab.fileSize}
                      autoScrollDefault={settings.autoScrollDefault}
                      showNumsDefault={settings.showNumsDefault} />
            : <Welcome onOpen={openFile} isElectron={IS_ELECTRON}
                       recentFiles={settings.recentFiles}
                       onOpenRecent={openFileByPath} />
        }

        {diagOpen     && IS_ELECTRON && <DiagPanel onClose={() => setDiagOpen(false)} />}

        {settingsOpen && IS_ELECTRON && (
          <SettingsModal
            settings={settings}
            onClose={() => setSettingsOpen(false)}
            onOpenFile={openFileByPath}
            onRemoveRecent={removeRecent}
            onClearRecent={clearAllRecent}
            onTogglePref={savePref}
          />
        )}
        {about        && <AboutModal onClose={() => setAbout(false)} />}
        {dockerPicker && <DockerPicker onSelect={openDockerTab} onClose={() => setDockerPicker(false)} />}
        {remotePicker && <RemotePicker onSelect={openRemoteTab} onClose={() => setRemotePicker(false)} capabilities={capabilities} />}
      </div>
    </LangCtx.Provider>
  );
}

function Welcome({ onOpen, isElectron, recentFiles, onOpenRecent }) {
  const t = useLang();
  return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                  flexDirection:"column", gap:16, color:"#333" }}>
      <div style={{ fontSize:44 }}>📋</div>
      <p style={{ fontSize:18, color:"#555", margin:0 }}>PulpLog</p>
      <button onClick={onOpen}
        style={{ background:"#181818", border:"1px solid #333", borderRadius:8,
                 color:"#aaa", fontFamily:"inherit", fontSize:13,
                 padding:"10px 24px", cursor:"pointer" }}>
        {t("open_file_btn")}
      </button>

      {recentFiles?.length > 0 && (
        <div style={{ marginTop:8, width:440 }}>
          <div style={{ fontSize:10, color:"#252525", fontWeight:700, letterSpacing:1,
                         marginBottom:6, textAlign:"center" }}>{t("recent_h")}</div>
          <div style={{ border:"0.5px solid #1a1a1a", borderRadius:6, overflow:"hidden" }}>
            {recentFiles.map((fp, i) => {
              const name = fp.split(/[\\/]/).pop();
              return (
                <div key={fp} onClick={() => onOpenRecent(fp)}
                     style={{ padding:"7px 14px", fontSize:12, cursor:"pointer",
                               borderBottom: i < recentFiles.length - 1
                                 ? "0.5px solid #161616" : "none",
                               background:"#0d0d0d",
                               display:"flex", gap:8, alignItems:"center", overflow:"hidden" }}
                     onMouseEnter={e => e.currentTarget.style.background = "#131313"}
                     onMouseLeave={e => e.currentTarget.style.background = "#0d0d0d"}>
                  <span style={{ color:"#2a2a2a" }}>📄</span>
                  <span style={{ color:"#777", flexShrink:0 }}>{name}</span>
                  <span style={{ color:"#1e1e1e", fontSize:10, overflow:"hidden",
                                  textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fp}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize:11, color:"#1e1e1e", marginTop:4 }}>
        {isElectron ? t("hint_electron") : t("hint_web")}
      </div>
    </div>
  );
}
