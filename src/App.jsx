import { useState, useEffect, useRef, useMemo, useCallback, memo, createContext, useContext } from "react";
import { appendRecentItems, classify, classifyLines, countLevels, findAdjacentLineIndex, findLineRange, splitTextChunk } from "./logProcessing.mjs";
import { getRememberedScroll, setRememberedScroll, useBatchedLines, useFilteredLogs, useRememberedState } from "./logHooks.mjs";
import { createLogWorkerClient } from "./logWorkerClient.mjs";

/* ═══════════════════════════════════════════
   Constants
═══════════════════════════════════════════ */
const ROW_H    = 22;
const OVERSCAN = 40;
const IS_ELECTRON = typeof window !== "undefined" && !!window.electronAPI;
const RENDERER_STARTED_AT = performance.now();

const reportMetric = (name, value, detail = "") => {
  if (IS_ELECTRON) window.electronAPI.recordMetric({ name, value, detail }).catch(() => {});
};
const FILE_CACHE_MAX_ENTRIES = 3;
const FILE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const fileCache = new Map();
let fileCacheBytes = 0;

function getCachedFile(filePath, stat) {
  const entry = fileCache.get(filePath);
  if (!entry) return null;
  if (!stat || entry.size !== stat.size || entry.mtime !== stat.mtime) {
    fileCache.delete(filePath);
    fileCacheBytes -= entry.size;
    return null;
  }
  fileCache.delete(filePath);
  fileCache.set(filePath, entry);
  return entry;
}

function cacheFile(filePath, stat, items, stats) {
  const previous = fileCache.get(filePath);
  if (previous) fileCacheBytes -= previous.size;
  fileCache.delete(filePath);
  if (!stat || stat.size > FILE_CACHE_MAX_BYTES) return;
  const entry = { size:stat.size, mtime:stat.mtime, items, stats:{ ...stats } };
  fileCache.set(filePath, entry);
  fileCacheBytes += entry.size;
  while (fileCache.size > FILE_CACHE_MAX_ENTRIES || fileCacheBytes > FILE_CACHE_MAX_BYTES) {
    const oldestKey = fileCache.keys().next().value;
    const oldest = fileCache.get(oldestKey);
    fileCache.delete(oldestKey);
    fileCacheBytes -= oldest?.size || 0;
  }
}
function useDebouncedValue(value, delay = 180) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
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
    search_ph:       "✨  resaltar…",
    search_regex_ph: "regex…",
    search_regex_btn_title:"Activar búsqueda por expresión regular",
    search_regex_invalid_title:"Regex de búsqueda inválida",
    context_title:   "Líneas de contexto antes/después de cada resultado del filtro",
    context_gap:     n => `${n} ${n === 1 ? "línea omitida" : "líneas omitidas"}`,
    match_prev_title:"Resultado anterior",
    match_next_title:"Resultado siguiente",
    match_count:     (cur, total) => `${cur}/${total}`,
    bm_prev_title:   "Marcador anterior (Shift+F2)",
    bm_next_title:   "Marcador siguiente (F2)",
    bm_clear_title:  "Limpiar todos los marcadores",
    bm_clear_btn:    "✕ marcas",
    copy_results:    "Copiar",
    copy_results_title:"Copiar resultados visibles",
    export_results:  "Exportar",
    export_results_title:"Exportar resultados visibles",
    bm_count:        n => `${n} ${n === 1 ? "marca" : "marcas"}`,
    tail_title:      "Tail -f — seguir archivo en vivo",
    tail_follow:     "▶ seguir",
    tail_stop:       "⏹ detener",
    refresh_title:   "Recargar archivo ahora",
    refresh_btn:     "↻ actualizar",
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
    selected_line:   n => `Línea ${fmtNum(n)} seleccionada · ↑/↓ navegar · Esc liberar`,
    clear_selection: "Quitar selección (Esc)",
    selected_rows:   (n, visible) => visible === n ? `${fmtNum(n)} filas seleccionadas` : `${fmtNum(n)} seleccionadas · ${fmtNum(visible)} visibles`,
    copy_selected:   "Copiar filas",
    copy_selected_numbers:"Copiar con números de línea",
    export_selected: "Exportar selección",
    bookmark_selected_add:"Agregar marcadores",
    bookmark_selected_remove:"Quitar marcadores",
    filter_this_text:"Filtrar por este texto",
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
    remote_mode_ssh: "SSH sistema",
    remote_mode_native:"SSH credenciales",
    remote_mode_wsl: "WSL2",
    remote_host:     "Host o alias SSH",
    remote_user:     "Usuario",
    remote_key:      "Llave privada",
    remote_key_pick: "Elegir",
    remote_password: "Contraseña",
    remote_passphrase:"Passphrase",
    remote_fingerprint:"Fingerprint esperado",
    remote_trust_host:"Confiar en host solo esta sesión",
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
    pref_max_lines:  "Máximo de líneas conservadas en flujos vivos",
    lines_discarded: n => `${fmtNum(n)} líneas antiguas descartadas`,
    lang_h:          "IDIOMA",
    theme_h:         "TEMA",
    theme_classic:   "Clásica",
    theme_light:     "Blanca",
    theme_vscode:    "Oscura",
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
    split_right_title: "Dividir a la derecha",
    split_down_title:  "Dividir abajo",
    split_close_title: "Cerrar división",
  },
  en: {
    bm_add:          "Bookmark line",
    bm_remove:       "Remove bookmark",
    filter_ph:       "🔍  filter…",
    regex_ph:        "regex…",
    regex_btn_title: "Enable regular expression filter",
    search_ph:       "✨  highlight…",
    search_regex_ph: "regex…",
    search_regex_btn_title:"Enable regular expression search",
    search_regex_invalid_title:"Invalid search regex",
    context_title:   "Context lines before/after each filter match",
    context_gap:     n => `${n} line${n === 1 ? "" : "s"} skipped`,
    match_prev_title:"Previous match",
    match_next_title:"Next match",
    match_count:     (cur, total) => `${cur}/${total}`,
    bm_prev_title:   "Previous bookmark (Shift+F2)",
    bm_next_title:   "Next bookmark (F2)",
    bm_clear_title:  "Clear all bookmarks",
    bm_clear_btn:    "✕ marks",
    copy_results:    "Copy",
    copy_results_title:"Copy visible results",
    export_results:  "Export",
    export_results_title:"Export visible results",
    bm_count:        n => `${n} ${n === 1 ? "bookmark" : "bookmarks"}`,
    tail_title:      "Tail -f — follow file live",
    tail_follow:     "▶ follow",
    tail_stop:       "⏹ stop",
    refresh_title:   "Reload file now",
    refresh_btn:     "↻ refresh",
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
    selected_line:   n => `Line ${fmtNum(n)} selected · ↑/↓ navigate · Esc release`,
    clear_selection: "Clear selection (Esc)",
    selected_rows:   (n, visible) => visible === n ? `${fmtNum(n)} rows selected` : `${fmtNum(n)} selected · ${fmtNum(visible)} visible`,
    copy_selected:   "Copy rows",
    copy_selected_numbers:"Copy with line numbers",
    export_selected: "Export selection",
    bookmark_selected_add:"Add bookmarks",
    bookmark_selected_remove:"Remove bookmarks",
    filter_this_text:"Filter by this text",
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
    remote_mode_ssh: "System SSH",
    remote_mode_native:"SSH credentials",
    remote_mode_wsl: "WSL2",
    remote_host:     "SSH host or alias",
    remote_user:     "User",
    remote_key:      "Private key",
    remote_key_pick: "Choose",
    remote_password: "Password",
    remote_passphrase:"Passphrase",
    remote_fingerprint:"Expected fingerprint",
    remote_trust_host:"Trust host for this session only",
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
    pref_max_lines:  "Maximum retained lines in live streams",
    lines_discarded: n => `${fmtNum(n)} old lines discarded`,
    lang_h:          "LANGUAGE",
    theme_h:         "THEME",
    theme_classic:   "Classic",
    theme_light:     "Light",
    theme_vscode:    "Dark",
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
    split_right_title: "Split right",
    split_down_title:  "Split down",
    split_close_title: "Close split",
  },
};

const LangCtx = createContext(() => "");
const useLang = () => useContext(LangCtx);

/* ═══════════════════════════════════════════
   Log classification & styling
═══════════════════════════════════════════ */
const STYLE = {
  error:     { bg:"var(--pl-lvl-error-bg)",     bar:"var(--pl-lvl-error-bar)",     txt:"var(--pl-lvl-error-txt)" },
  exception: { bg:"var(--pl-lvl-exception-bg)", bar:"var(--pl-lvl-exception-bar)", txt:"var(--pl-lvl-exception-txt)" },
  causedby:  { bg:"var(--pl-lvl-causedby-bg)",  bar:"var(--pl-lvl-causedby-bar)",  txt:"var(--pl-lvl-causedby-txt)" },
  stack:     { bg:"var(--pl-lvl-stack-bg)",     bar:"var(--pl-lvl-stack-bar)",     txt:"var(--pl-lvl-stack-txt)" },
  warn:      { bg:"var(--pl-lvl-warn-bg)",      bar:"var(--pl-lvl-warn-bar)",      txt:"var(--pl-lvl-warn-txt)" },
  info:      { bg:"var(--pl-lvl-info-bg)",      bar:"var(--pl-lvl-info-bar)",      txt:"var(--pl-lvl-info-txt)" },
  debug:     { bg:"var(--pl-lvl-debug-bg)",     bar:"var(--pl-lvl-debug-bar)",     txt:"var(--pl-lvl-debug-txt)" },
  trace:     { bg:"var(--pl-lvl-trace-bg)",     bar:"var(--pl-lvl-trace-bar)",     txt:"var(--pl-lvl-trace-txt)" },
  plain:     { bg:"transparent", bar:"transparent", txt:"var(--pl-lvl-plain-txt)" },
};

function hl(raw, type) {
  if (type === "stack" || type === "causedby") return esc(raw);
  return esc(raw)
    .replace(/\b(ERROR|WARN|INFO|DEBUG|TRACE)\b/g,
      m => `<b style="color:${STYLE[m.toLowerCase()]?.bar||"var(--pl-syn-fallback)"};font-weight:700">${m}</b>`)
    .replace(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[.,]\d+)/g,
      '<span style="color:var(--pl-syn-dim)">$1</span>')
    .replace(/\[([\w\-]+)\]/g,
      '<span style="color:var(--pl-syn-bracket)">[$1]</span>')
    .replace(/([a-z][a-z0-9_]*\.){2,}[A-Z][a-zA-Z0-9_]*/g,
      '<span style="color:var(--pl-syn-match)">$&</span>');
}
const esc     = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fmtSize = b => b>=1e9?`${(b/1e9).toFixed(2)} GB`:b>=1e6?`${(b/1e6).toFixed(1)} MB`:b>=1e3?`${(b/1e3).toFixed(0)} KB`:`${b} B`;
const fmtNum  = n => n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}k`:String(n);
const safeFileName = s => String(s || "pulplog-results").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80);

function buildResultText({ source, filter, items, total }) {
  const realRows = items.filter(x => !x.separator).length;
  const header = [
    `PulpLog export`,
    `Source: ${source || "unknown"}`,
    `Filter: ${filter || "(none)"}`,
    `Rows: ${realRows} / ${total}`,
    `Exported: ${new Date().toISOString()}`,
    "",
  ];
  return header.concat(items.map(item =>
    item.separator ? `--- ${item.skipped} líneas omitidas ---` : `${item.origLine}\t${item.raw}`
  )).join("\n");
}

async function copyResultText(text) {
  if (IS_ELECTRON) return window.electronAPI.copyText(text);
  return navigator.clipboard?.writeText(text);
}

async function exportResultText(defaultPath, content) {
  if (IS_ELECTRON) return window.electronAPI.exportText({ defaultPath, content });
  const blob = new Blob([content], { type:"text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultPath;
  a.click();
  URL.revokeObjectURL(url);
  return defaultPath;
}

/* ═══════════════════════════════════════════
   LogRow
═══════════════════════════════════════════ */
const LogRow = memo(({ item, showNums, isBookmarked, isSelected, isActive, onToggleBookmark, onSelectLine, onOpenContextMenu }) => {
  const t = useLang();
  if (item.separator) {
    return (
      <div style={{ display:"flex", alignItems:"center", height:ROW_H, gap:8,
                    borderBottom:"0.5px solid var(--pl-hairline)" }}>
        <div style={{ flex:1, borderTop:"0.5px dashed var(--pl-border-soft)", margin:"0 10px" }} />
        <span style={{ flexShrink:0, fontSize:10, color:"var(--pl-text-7)" }}>{t("context_gap", item.skipped)}</span>
        <div style={{ flex:1, borderTop:"0.5px dashed var(--pl-border-soft)", margin:"0 10px" }} />
      </div>
    );
  }
  const s = STYLE[item.type] || STYLE.plain;
  return (
    <div
      role="option"
      aria-selected={isSelected}
      onMouseDown={event => {
        if (!event.shiftKey) return;
        event.preventDefault();
        window.getSelection?.()?.removeAllRanges();
      }}
      onClick={event => onSelectLine(item.origLine, event)}
      onContextMenu={event => onOpenContextMenu(item, event)}
      style={{
        display:"flex", alignItems:"stretch", height:ROW_H,
        background: isSelected ? "color-mix(in srgb, var(--pl-accent) 24%, var(--pl-bg-panel))"
          : isBookmarked ? "rgba(255,200,50,.07)"
          : item.matched ? "var(--pl-search-hit-bg)" : s.bg,
        borderBottom:"0.5px solid var(--pl-hairline)",
        outline: isActive ? "1px solid var(--pl-accent)"
          : isSelected ? "1px solid color-mix(in srgb, var(--pl-accent) 55%, transparent)"
          : isBookmarked ? "0.5px solid rgba(255,200,50,.25)"
          : item.matched ? "0.5px solid var(--pl-search-hit-border)" : "none",
        outlineOffset:-1,
        opacity: item.contextOnly && !isSelected ? 0.55 : 1,
        cursor:"default",
      }}>
      {showNums && (
        <span
          onClick={() => onToggleBookmark(item.origLine)}
          title={isBookmarked ? t("bm_remove") : t("bm_add")}
          style={{ minWidth:58, display:"flex", alignItems:"center", justifyContent:"flex-end",
                   gap:4, padding:"0 6px 0 4px", fontSize:10, color:"var(--pl-text-7)",
                   lineHeight:`${ROW_H}px`, flexShrink:0, userSelect:"none",
                   cursor:"pointer", fontFamily:"inherit" }}>
          {isBookmarked
            ? <span style={{ color:"var(--pl-bookmark)", fontSize:10 }}>◆</span>
            : <span style={{ color:"var(--pl-border-soft)", fontSize:10 }}>◇</span>}
          {item.origLine}
        </span>
      )}
      <span style={{ width:4, flexShrink:0,
                     background: isBookmarked ? "var(--pl-bookmark)" : s.bar }} />
      <span
        style={{ padding:"0 10px", fontSize:12, lineHeight:`${ROW_H}px`, color:s.txt,
                 flex:1, whiteSpace:"pre", fontFamily:"inherit", userSelect:"text" }}
        dangerouslySetInnerHTML={{ __html: hl(item.raw, item.type) }}
      />
    </div>
  );
});

function useRowSelection(tabKey, classified) {
  const [selection, setStoredSelection] = useRememberedState(tabKey, "rowSelection", () => ({
    lines:new Set(), active:null, anchor:null,
  }));
  const selectionRef = useRef(selection);
  const setSelection = useCallback(updater => {
    setStoredSelection(previous => {
      const next = typeof updater === "function" ? updater(previous) : updater;
      selectionRef.current = next;
      return next;
    });
  }, [setStoredSelection]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  useEffect(() => {
    if (!classified.length || !selection.lines.size) return;
    const firstLine = classified[0].origLine;
    const lastLine = classified[classified.length - 1].origLine;
    const kept = new Set([...selection.lines].filter(line => line >= firstLine && line <= lastLine));
    if (kept.size === selection.lines.size) return;
    const active = kept.has(selection.active) ? selection.active : (kept.values().next().value ?? null);
    const anchor = kept.has(selection.anchor) ? selection.anchor : active;
    setSelection({ lines:kept, active, anchor });
  }, [classified, selection, setSelection]);
  return { selection, setSelection, selectionRef };
}

function selectedLogRows(sourceItems, lines) {
  return sourceItems.filter(item => !item.separator && lines.has(item.origLine));
}

function selectedLogText(sourceItems, lines, includeLineNumbers = false) {
  return selectedLogRows(sourceItems, lines)
    .map(item => includeLineNumbers ? `${item.origLine}\t${item.raw}` : item.raw)
    .join("\n");
}

function VirtualList({ items, sourceItems, showNums, bookmarks, onToggleBookmark, selection, setSelection,
                       listRef, stateKey, selectionSource, onFilterText }) {
  const t = useLang();
  const [scrollTop, setScrollTop] = useState(() => getRememberedScroll(stateKey));
  const [height,    setHeight]    = useState(500);
  const [contextMenu, setContextMenu] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    el.scrollTop = getRememberedScroll(stateKey);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!listRef) return;
    listRef.current = {
      scrollToBottom: () => { if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; },
      scrollToTop:    () => { if (containerRef.current) containerRef.current.scrollTop = 0; },
      scrollToIndex:  (index) => {
        if (containerRef.current)
          containerRef.current.scrollTop = Math.max(0, index * ROW_H - height / 2);
      },
    };
  });

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = event => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const total  = items.length;
  const totalH = total * ROW_H;
  const start  = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end    = Math.min(total, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
  const nativeText = () => window.getSelection?.()?.toString() || "";

  const selectLine = (line, event = {}, ignoreNativeText = false) => {
    const hasRowModifier = !!(event.shiftKey || event.ctrlKey || event.metaKey);
    if (!ignoreNativeText && !hasRowModifier && nativeText().trim()) return;
    const additive = !!(event.ctrlKey || event.metaKey);
    const extending = !!event.shiftKey;
    setSelection(previous => {
      if (extending) {
        const anchor = previous.anchor ?? previous.active ?? line;
        const range = new Set(findLineRange(items, anchor, line));
        const lines = additive ? new Set([...previous.lines, ...range]) : range;
        return { lines, active:line, anchor };
      }
      if (additive) {
        const lines = new Set(previous.lines);
        lines.has(line) ? lines.delete(line) : lines.add(line);
        const active = lines.has(line) ? line : (lines.values().next().value ?? null);
        return { lines, active, anchor:line };
      }
      return { lines:new Set([line]), active:line, anchor:line };
    });
  };

  const navigateSelection = (direction, extending, toBoundary = false) => {
    const index = findAdjacentLineIndex(
      items,
      toBoundary ? null : selection.active,
      toBoundary ? -direction : direction,
    );
    if (index < 0) return;
    selectLine(items[index].origLine, { shiftKey:extending }, true);
    listRef.current?.scrollToIndex(index);
  };

  const copySelection = (includeLineNumbers = false) => {
    const text = selectedLogText(sourceItems, selection.lines, includeLineNumbers);
    if (text) copyResultText(text);
    setContextMenu(null);
  };

  const exportSelection = () => {
    const text = selectedLogText(sourceItems, selection.lines, false);
    if (text) exportResultText(`${safeFileName(selectionSource)}-selection.log`, text);
    setContextMenu(null);
  };

  const toggleSelectionBookmarks = () => {
    const lines = [...selection.lines];
    const remove = lines.length > 0 && lines.every(line => bookmarks.has(line));
    for (const line of lines) {
      if ((remove && bookmarks.has(line)) || (!remove && !bookmarks.has(line))) onToggleBookmark(line);
    }
    setContextMenu(null);
  };

  const openContextMenu = (item, event) => {
    event.preventDefault();
    if (!selection.lines.has(item.origLine)) selectLine(item.origLine, {}, true);
    containerRef.current?.focus({ preventScroll:true });
    setContextMenu({ x:event.clientX, y:event.clientY, item });
  };

  const menuButtonStyle = {
    display:"block", width:"100%", padding:"7px 12px", border:0, background:"transparent",
    color:"var(--pl-text-2)", textAlign:"left", font:"inherit", fontSize:11, cursor:"pointer",
    whiteSpace:"nowrap",
  };
  const allSelectedBookmarked = selection.lines.size > 0 && [...selection.lines].every(line => bookmarks.has(line));

  return (
    <div ref={containerRef}
         role="listbox"
         aria-multiselectable="true"
         tabIndex={0}
         aria-label="Log lines"
         style={{ overflow:"auto", flex:1, minHeight:0, outline:"none" }}
         onMouseDown={() => containerRef.current?.focus({ preventScroll:true })}
         onKeyDown={event => {
           if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
             if (nativeText()) return;
             if (selection.lines.size) { event.preventDefault(); copySelection(false); }
           } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
             event.preventDefault();
             const lines = new Set(items.filter(item => !item.separator).map(item => item.origLine));
             const active = items.find(item => !item.separator)?.origLine ?? null;
             setSelection({ lines, active, anchor:active });
           } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
             event.preventDefault();
             navigateSelection(
               event.key === "ArrowUp" ? -1 : 1,
               event.shiftKey,
               event.ctrlKey || event.metaKey,
             );
           } else if (event.key === "Escape" && selection.lines.size) {
             event.preventDefault();
             setSelection({ lines:new Set(), active:null, anchor:null });
           }
         }}
         onScroll={event => {
           const next = event.currentTarget.scrollTop;
           setScrollTop(next);
           setRememberedScroll(stateKey, next);
           setContextMenu(null);
         }}>
      <div style={{ height:totalH, position:"relative", minWidth:"100%", width:"max-content" }}>
        <div style={{ position:"absolute", top: start * ROW_H, minWidth:"100%", width:"max-content" }}>
          {items.slice(start, end).map(item => (
            <LogRow
              key={item.separator ? item.key : item.origLine}
              item={item}
              showNums={showNums}
              isBookmarked={bookmarks.has(item.origLine)}
              isSelected={selection.lines.has(item.origLine)}
              isActive={selection.active === item.origLine}
              onToggleBookmark={onToggleBookmark}
              onSelectLine={selectLine}
              onOpenContextMenu={openContextMenu}
            />
          ))}
        </div>
      </div>
      {contextMenu && (
        <div onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}
          style={{ position:"fixed", left:contextMenu.x, top:contextMenu.y, zIndex:1000,
                   minWidth:210, padding:"5px 0", background:"var(--pl-bg-panel)",
                   border:"1px solid var(--pl-border-strong)", borderRadius:7,
                   boxShadow:"0 8px 28px rgba(0,0,0,.38)" }}>
          <button style={menuButtonStyle} onClick={() => copySelection(false)}>{t("copy_selected")}</button>
          <button style={menuButtonStyle} onClick={() => copySelection(true)}>{t("copy_selected_numbers")}</button>
          <button style={menuButtonStyle} onClick={exportSelection}>{t("export_selected")}</button>
          <div style={{ borderTop:"1px solid var(--pl-border-soft)", margin:"4px 0" }} />
          <button style={menuButtonStyle} onClick={toggleSelectionBookmarks}>
            {t(allSelectedBookmarked ? "bookmark_selected_remove" : "bookmark_selected_add")}
          </button>
          <button style={menuButtonStyle} onClick={() => {
            const text = nativeText().trim() || contextMenu.item.raw.trim();
            if (text) onFilterText(text);
            setContextMenu(null);
          }}>{t("filter_this_text")}</button>
        </div>
      )}
    </div>
  );
}

function SelectedLineStatus({ selection, visibleItems, onClear }) {
  const t = useLang();
  const total = selection.lines.size;
  if (!total) return null;
  const visible = visibleItems.reduce((count, item) =>
    count + (!item.separator && selection.lines.has(item.origLine) ? 1 : 0), 0);
  const label = total === 1 && selection.active != null
    ? t("selected_line", selection.active)
    : t("selected_rows", total, visible);
  return (
    <button type="button" onClick={onClear} title={t("clear_selection")}
      style={{ padding:0, border:0, background:"none", color:"var(--pl-accent-hover)",
               font:"inherit", cursor:"pointer", whiteSpace:"nowrap" }}>
      {label}
    </button>
  );
}
/* ═══════════════════════════════════════════
   LogTab
═══════════════════════════════════════════ */
function LogTab({ tabKey, filePath, fileName, fileSize, autoScrollDefault = false, showNumsDefault = true }) {
  const t = useLang();
  const selectionSource = fileName || filePath || "pulplog";
  const [classified,  setClassified] = useState([]);
  const [stats,       setStats]      = useState({ error:0, warn:0, info:0, debug:0, trace:0 });
  const [loading,     setLoading]     = useState(true);
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
  const autoScrollRef = useRef(autoScroll);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);

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
    setLoading(true); setProgress(0); setClassified([]);
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
        const cached = getCachedFile(filePath, currentStat);
        if (cached) {
          reportMetric("file-cache-hit", performance.now() - readStartedRef.current, fileName);
          itemsRef.current = cached.items;
          statsRef.current = { ...cached.stats };
          loadedRef.current = true;
          setClassified(cached.items);
          setStats({ ...cached.stats });
          setProgress(1);
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
            setLoading(false);
            setProgress(1);
            const heap = performance.memory?.usedJSHeapSize;
            reportMetric("file-open", performance.now() - readStartedRef.current,
              `${fileName}: ${itemsRef.current.length} lines${heap ? ` · heap ${fmtSize(heap)}` : ""}`);
            queueMicrotask(() => cacheCurrentFile(bytesRead));
          },
          onError(msg) {
            if (!disposed) { console.error(msg); setLoading(false); }
          },
        });
        return;
      }

      resetBuffers();
      const file = window.__pendingFile;
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
      if (!disposed) { console.error(err); setLoading(false); }
    });
    return () => {
      disposed = true;
      cancelRead?.();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
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

  const toggle = key => setLvl(p => ({ ...p, [key]: !p[key] }));

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

          <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0, whiteSpace:"nowrap" }}
               title={t("context_title")}>
            <span style={{ fontSize:10, color:"var(--pl-text-5)" }}>±</span>
            <input
              type="number" min={0} max={50}
              value={context}
              onChange={e => setContext(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
              style={{ width:40, background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                       borderRadius:6, color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:11,
                       padding:"3px 4px", textAlign:"center" }}
            />
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
          <span key={key} onClick={() => toggle(key)}
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

/* ═══════════════════════════════════════════
   Rotation banner
═══════════════════════════════════════════ */
function RotationBanner({ event, countdown }) {
  const t = useLang();
  const CFG = {
    rotated:   { bg:"var(--pl-banner-rotated-bg)", border:"var(--pl-bookmark)", color:"var(--pl-bookmark)", icon:"↻", label: t("rotated", countdown) },
    truncated: { bg:"var(--pl-banner-truncated-bg)", border:"var(--pl-accent)", color:"var(--pl-accent-hover)", icon:"⬇", label: t("truncated", countdown) },
    recreated: { bg:"var(--pl-banner-recreated-bg)", border:"var(--pl-status-live)", color:"var(--pl-status-live)", icon:"✓", label: t("recreated") },
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
    ERROR: { color:"var(--pl-lvl-error-txt)", bg:"var(--pl-diag-error-bg)", label:"ERROR" },
    WARN:  { color:"var(--pl-lvl-warn-txt)", bg:"var(--pl-diag-warn-bg)", label:"WARN " },
    INFO:  { color:"var(--pl-accent-hover)", bg:"transparent", label:"INFO " },
  };
  const CAT_COLOR = { docker:"var(--pl-cat-docker)", file:"var(--pl-cat-file)", remote:"var(--pl-cat-remote)", system:"var(--pl-cat-system)", performance:"var(--pl-cat-performance)", settings:"var(--pl-cat-settings)" };
  const fmt = ts => new Date(ts).toLocaleTimeString(undefined, { hour12:false });

  return (
    <div style={{ height:210, flexShrink:0, borderTop:"1px solid var(--pl-border-soft)",
                  background:"var(--pl-bg-app)", display:"flex", flexDirection:"column",
                  fontFamily:"inherit" }}>

      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 10px",
                    background:"var(--pl-bg-footer)", borderBottom:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}>
        <span style={{ fontSize:10, color:"var(--pl-text-5)", fontWeight:700, letterSpacing:1 }}>
          {t("diag_title")}
        </span>
        <span style={{ fontSize:10, color:"var(--pl-text-8)" }}>{t("diag_entries", entries.length)}</span>
        <Btn onClick={() => { window.electronAPI.clearAppLog(); setEntries([]); }}>
          {t("diag_clear")}
        </Btn>
        <button onClick={onClose}
          style={{ marginLeft:"auto", background:"none", border:"none",
                   color:"var(--pl-text-7)", cursor:"pointer", fontSize:13, padding:"0 4px",
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
          <div style={{ padding:"20px 10px", color:"var(--pl-text-7)", fontSize:11, textAlign:"center" }}>
            {t("diag_empty")}
          </div>
        )}
        {entries.map((e, i) => {
          const s = LEVEL[e.level] || LEVEL.INFO;
          return (
            <div key={i} style={{ display:"flex", gap:10, padding:"2px 10px", fontSize:11,
                                  background:s.bg, borderBottom:"0.5px solid var(--pl-hairline)",
                                  fontFamily:"inherit" }}>
              <span style={{ color:"var(--pl-text-8)", flexShrink:0, minWidth:72 }}>{fmt(e.ts)}</span>
              <span style={{ color:s.color, fontWeight:700, flexShrink:0, minWidth:42,
                             fontFamily:"monospace" }}>{s.label}</span>
              <span style={{ color: CAT_COLOR[e.category] || "var(--pl-text-6)", flexShrink:0,
                             minWidth:52 }}>[{e.category}]</span>
              <span style={{ color:"var(--pl-text-4)" }}>{e.msg}</span>
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
                    background: value ? "var(--pl-toggle-on-bg)" : "var(--pl-toggle-off-bg)",
                    border:`1px solid ${value ? "var(--pl-status-live)" : "var(--pl-border)"}`,
                    position:"relative", cursor:"pointer" }}>
        <div style={{ position:"absolute", top:2, left: value ? 14 : 2,
                       width:10, height:10, borderRadius:"50%",
                       background: value ? "var(--pl-toggle-on-knob)" : "var(--pl-toggle-off-knob)",
                       transition:"left .12s" }} />
      </div>
      <span style={{ fontSize:11, color:"var(--pl-text-4)" }}>{label}</span>
    </label>
  );
}

function SettingsModal({ settings, onClose, onOpenFile, onRemoveRecent, onClearRecent, onTogglePref }) {
  const t = useLang();
  const lang = settings.language || "es";
  const theme = settings.theme || "classic";

  return (
    <div onClick={onClose}
         style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
                  display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e => e.stopPropagation()}
           style={{ background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:10,
                    padding:"28px 32px", minWidth:500, maxWidth:620,
                    boxShadow:"0 8px 40px rgba(0,0,0,.8)", fontFamily:"inherit" }}>

        <div style={{ display:"flex", alignItems:"center", marginBottom:22 }}>
          <span style={{ fontSize:14, color:"var(--pl-text-1)", fontWeight:700 }}>{t("settings_header")}</span>
          <button onClick={onClose}
            style={{ marginLeft:"auto", background:"none", border:"none",
                     color:"var(--pl-text-6)", cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>✕</button>
        </div>

        {/* language */}
        <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
          {t("lang_h")}
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:24 }}>
          {["es","en"].map(l => (
            <button key={l} onClick={() => onTogglePref("language", l)}
              style={{ background: lang === l ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                       border:`0.5px solid ${lang === l ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                       borderRadius:6, color: lang === l ? "var(--pl-accent-hover)" : "var(--pl-text-5)",
                       fontFamily:"inherit", fontSize:12, padding:"5px 18px",
                       cursor:"pointer", fontWeight: lang === l ? 700 : 400 }}>
              {l === "es" ? "Español" : "English"}
            </button>
          ))}
        </div>

        {/* theme */}
        <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
          {t("theme_h")}
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:24 }}>
          {["classic","light","vscode"].map(th => (
            <button key={th} onClick={() => onTogglePref("theme", th)}
              style={{ background: theme === th ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                       border:`0.5px solid ${theme === th ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                       borderRadius:6, color: theme === th ? "var(--pl-accent-hover)" : "var(--pl-text-5)",
                       fontFamily:"inherit", fontSize:12, padding:"5px 18px",
                       cursor:"pointer", fontWeight: theme === th ? 700 : 400 }}>
              {t(`theme_${th}`)}
            </button>
          ))}
        </div>

        {/* recent files */}
        <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginBottom:8 }}>
          {t("recent_files_h")}
        </div>
        {settings.recentFiles.length === 0 ? (
          <div style={{ fontSize:11, color:"var(--pl-text-8)", padding:"10px 0 16px" }}>{t("no_recent")}</div>
        ) : (
          <>
            <div style={{ maxHeight:200, overflowY:"auto", marginBottom:8,
                           border:"0.5px solid var(--pl-border-soft)", borderRadius:6 }}>
              {settings.recentFiles.map((fp, i) => {
                const name = fp.split(/[\\/]/).pop();
                return (
                  <div key={fp}
                       style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px",
                                borderBottom: i < settings.recentFiles.length - 1
                                  ? "0.5px solid var(--pl-border-soft)" : "none",
                                background:"var(--pl-bg-footer)" }}>
                    <span onClick={() => { onOpenFile(fp); onClose(); }}
                          title={fp}
                          style={{ flex:1, fontSize:12, color:"var(--pl-text-3)", cursor:"pointer",
                                   overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      📄 <b style={{ color:"var(--pl-text-2)" }}>{name}</b>
                      <span style={{ fontSize:10, color:"var(--pl-text-8)", marginLeft:8 }}>{fp}</span>
                    </span>
                    <button onClick={() => onRemoveRecent(fp)}
                      style={{ background:"none", border:"none", color:"var(--pl-text-7)",
                               cursor:"pointer", fontSize:11, padding:"0 4px", flexShrink:0 }}>✕</button>
                  </div>
                );
              })}
            </div>
            <Btn onClick={onClearRecent}>{t("clear_recents")}</Btn>
          </>
        )}

        {/* preferences */}
        <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1,
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
          />          <label style={{ display:"flex", alignItems:"center", gap:10, color:"var(--pl-text-4)", fontSize:11 }}>
            <span style={{ flex:1 }}>{t("pref_max_lines")}</span>
            <select value={settings.maxLiveLines || 500000}
              onChange={e => onTogglePref("maxLiveLines", Number(e.target.value))}
              style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:5,
                       color:"var(--pl-text-3)", fontFamily:"inherit", fontSize:11, padding:"4px 8px" }}>
              {[100000, 250000, 500000, 1000000, 2000000].map(value => (
                <option key={value} value={value}>{fmtNum(value)}</option>
              ))}
            </select>
          </label>
        </div>

        <button onClick={onClose}
          style={{ marginTop:28, background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                   borderRadius:6, color:"var(--pl-text-4)", fontFamily:"inherit",
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
  const logoSrc = `${import.meta.env.BASE_URL}lindecode-max.jpeg`;
  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
               display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:10,
                 padding:"32px 40px", minWidth:300, textAlign:"center",
                 boxShadow:"0 8px 40px rgba(0,0,0,.8)", fontFamily:"inherit" }}>
        <img src={logoSrc} alt="LindeCode"
          style={{ width:96, height:96, borderRadius:12, objectFit:"cover", marginBottom:12 }} />
        <div style={{ fontSize:18, color:"var(--pl-text-1)", fontWeight:700, marginBottom:4 }}>PulpLog</div>
        <div style={{ fontSize:11, color:"var(--pl-text-6)", marginBottom:20 }}>v2.0.0</div>
        <div style={{ width:40, height:"0.5px", background:"var(--pl-border-strong)", margin:"0 auto 20px" }} />
        <div style={{ fontSize:13, color:"var(--pl-text-3)", marginBottom:6 }}>{t("developed_by")}</div>
        <div style={{ fontSize:16, color:"var(--pl-accent)", fontWeight:700, letterSpacing:1 }}>LindeCode</div>
        <div style={{ marginTop:20, fontSize:11, color:"var(--pl-text-7)" }}>{t("license")}</div>
        <button
          onClick={onClose}
          style={{ marginTop:24, background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                   borderRadius:6, color:"var(--pl-text-4)", fontFamily:"inherit",
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
      style={{ background: active ? "var(--pl-btn-active-bg)" : "var(--pl-bg-input)",
               border:`0.5px solid ${active ? "var(--pl-btn-active-border)":"var(--pl-border)"}`,
               borderRadius:6, color: active ? "var(--pl-btn-active-text)":"var(--pl-text-3)",
               fontFamily:"inherit", fontSize:11, padding:"4px 9px",
               cursor: disabled ? "not-allowed":"pointer",
               opacity: disabled ? 0.4 : 1, whiteSpace:"nowrap" }}>
      {children}
    </button>
  );
}

function Sep() {
  return <span style={{ width:"0.5px", background:"var(--pl-text-8)", alignSelf:"stretch" }} />;
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
function DockerTab({ tabKey, containerId, containerName, maxLiveLines }) {
  const t = useLang();
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
  });
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

  const toggle = key => setLvl(p => ({ ...p, [key]: !p[key] }));

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

          <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0, whiteSpace:"nowrap" }}
               title={t("context_title")}>
            <span style={{ fontSize:10, color:"var(--pl-text-5)" }}>±</span>
            <input
              type="number" min={0} max={50}
              value={context}
              onChange={e => setContext(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
              style={{ width:40, background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                       borderRadius:6, color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:11,
                       padding:"3px 4px", textAlign:"center" }}
            />
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
          <span key={key} onClick={() => toggle(key)}
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

        <Btn active={autoScroll} onClick={() => setAutoScroll(p => !p)} title={t("autoscroll_title")}>↓ auto</Btn>
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

function RemotePicker({ onSelect, onClose, capabilities }) {
  const t = useLang();
  const [mode, setMode] = useState("ssh");
  const [target, setTarget] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("");
  const [identityFile, setIdentityFile] = useState("");
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [trustHostForSession, setTrustHostForSession] = useState(false);
  const [distro, setDistro] = useState("");
  const [filePath, setFilePath] = useState("");
  const [tailLines, setTailLines] = useState(500);
  const sshCap = capabilities?.ssh;
  const wslCap = capabilities?.wsl;
  const wslDistros = wslCap?.distros || [];
  const wslDistrosKey = wslDistros.join("|");
  const modeAvailable = mode === "wsl" ? wslCap?.available : mode === "ssh-native" ? true : sshCap?.available;
  const hasNativeAuth = mode !== "ssh-native" || (user.trim() && (password || identityFile.trim()));
  const canSubmit = modeAvailable && filePath.trim() && (mode === "wsl" || target.trim()) && hasNativeAuth;

  useEffect(() => {
    if (!capabilities) return;
    if (mode === "ssh" && !sshCap?.available) setMode("ssh-native");
    if (mode === "wsl" && !wslCap?.available && sshCap?.available) setMode("ssh");
  }, [capabilities, mode, sshCap?.available, wslCap?.available]);

  useEffect(() => {
    if (mode !== "wsl" || distro || wslDistros.length === 0) return;
    setDistro(wslDistros[0]);
  }, [mode, distro, wslDistrosKey]);

  const submit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSelect({ mode, target, user, port, identityFile, password, passphrase, fingerprint, trustHostForSession, distro, filePath, tailLines });
    setPassword("");
    setPassphrase("");
  };

  const pickIdentityFile = async () => {
    if (!IS_ELECTRON) return;
    const fp = await window.electronAPI.openSshKeyDialog();
    if (fp) setIdentityFile(fp);
  };

  const inputStyle = {
    background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:6,
    color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:12, padding:"7px 9px",
    outline:"none", width:"100%",
  };

  return (
    <div onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
               display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        style={{ background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:10,
                 padding:"24px", minWidth:460, maxWidth:620, fontFamily:"inherit",
                 boxShadow:"0 8px 40px rgba(0,0,0,.8)" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:16 }}>
          <span style={{ fontSize:14, color:"var(--pl-text-1)", fontWeight:700 }}>{t("remote_title")}</span>
          <button type="button" onClick={onClose}
            style={{ marginLeft:"auto", background:"none", border:"none",
                     color:"var(--pl-text-6)", cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>x</button>
        </div>

        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          {[
            ["ssh", t("remote_mode_ssh"), sshCap],
            ["ssh-native", t("remote_mode_native"), { available:true }],
            ["wsl", t("remote_mode_wsl"), wslCap],
          ].map(([key, label, cap]) => (
            <button key={key} type="button" onClick={() => cap?.available && setMode(key)}
              disabled={!cap?.available}
              title={cap?.available ? label : (cap?.reason || t("capability_unavailable"))}
              style={{ background: mode === key ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                       border:`0.5px solid ${mode === key ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                       borderRadius:6, color: mode === key ? "var(--pl-accent-hover)" : cap?.available ? "var(--pl-text-5)" : "var(--pl-text-7)",
                       fontFamily:"inherit", fontSize:12, padding:"5px 18px",
                       cursor: cap?.available ? "pointer" : "not-allowed",
                       opacity: cap?.available ? 1 : 0.45,
                       fontWeight: mode === key ? 700 : 400 }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 110px", gap:10, marginBottom:10 }}>
          {mode === "ssh" || mode === "ssh-native" ? (
            <>
              <input style={inputStyle} value={target} onChange={e => setTarget(e.target.value)}
                placeholder={`${t("remote_host")} (prod-web, host)`} />
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

        {(mode === "ssh" || mode === "ssh-native") && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 78px", gap:10, marginBottom:10 }}>
            <input style={inputStyle} value={user} onChange={e => setUser(e.target.value)}
              placeholder={`${t("remote_user")} (opcional)`} />
            <input style={inputStyle} value={identityFile} onChange={e => setIdentityFile(e.target.value)}
              placeholder={`${t("remote_key")} (opcional)`} />
            <button type="button" onClick={pickIdentityFile}
              style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                       borderRadius:6, color:"var(--pl-text-3)", fontFamily:"inherit",
                       fontSize:11, padding:"7px 8px", cursor:"pointer" }}>
              {t("remote_key_pick")}
            </button>
          </div>
        )}

        {mode === "ssh-native" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={`${t("remote_password")} (opcional)`} />
            <input style={inputStyle} type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
              placeholder={`${t("remote_passphrase")} (opcional)`} />
          </div>
        )}

        {mode === "ssh-native" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10, alignItems:"center", marginBottom:10 }}>
            <input style={inputStyle} value={fingerprint} onChange={e => setFingerprint(e.target.value)}
              placeholder={`${t("remote_fingerprint")} SHA256:...`} />
            <label style={{ display:"flex", alignItems:"center", gap:6, color:"var(--pl-text-4)", fontSize:10, whiteSpace:"nowrap" }}>
              <input type="checkbox" checked={trustHostForSession} onChange={e => setTrustHostForSession(e.target.checked)} />
              {t("remote_trust_host")}
            </label>
          </div>
        )}

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

        <div style={{ color:"var(--pl-text-5)", fontSize:10, lineHeight:1.5, marginBottom:18 }}>
          {t("remote_hint")}
          {!modeAvailable && (
            <div style={{ color:"var(--pl-error-border)", marginTop:6 }}>
              {mode === "wsl" ? (wslCap?.reason || t("capability_unavailable")) : (sshCap?.reason || t("capability_unavailable"))}
            </div>
          )}
        </div>

        <button type="submit" disabled={!canSubmit}
          style={{ background: canSubmit ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                   border:`0.5px solid ${canSubmit ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                   borderRadius:6, color: canSubmit ? "var(--pl-accent-hover)" : "var(--pl-text-6)",
                   fontFamily:"inherit", fontSize:12, padding:"7px 20px",
                   cursor: canSubmit ? "pointer" : "not-allowed", marginRight:10 }}>
          {t("remote_open")}
        </button>
        <button type="button" onClick={onClose}
          style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                   borderRadius:6, color:"var(--pl-text-4)", fontFamily:"inherit",
                   fontSize:11, padding:"7px 20px", cursor:"pointer" }}>
          {t("cancel")}
        </button>
      </form>
    </div>
  );
}

function RemoteTab({ tabKey, config, maxLiveLines }) {
  const t = useLang();
  const selectionSource = `${config.mode || "remote"}-${config.filePath || "logs"}`;
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
  });
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);

  useEffect(() => {
    const unwatch = window.electronAPI.streamRemoteLogs(config, {
      onSpawned() { setSpawned(true); setConnected(true); },
      onLines(text) {
        enqueueLines(text.split("\n").filter(Boolean));
      },
      onEnd()      { setConnected(false); },
      onError(msg) { setError(msg); setConnected(false); },
    });
    return unwatch;
  }, [config]);

  const stats = useMemo(() => countLevels(classified), [classified]);

  const { filtered, filterRegexValid, searchRegexValid, matchOrigLines } =
    useFilteredLogs("remote", classified, filterDebounced, filterUseRegex, lvl, context, searchDebounced, searchUseRegex, reportMetric);

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

  const toggle = key => setLvl(p => ({ ...p, [key]: !p[key] }));
  const modeLabel = config.mode === "wsl"
    ? t("remote_mode_wsl")
    : config.mode === "ssh-native"
      ? t("remote_mode_native")
      : t("remote_mode_ssh");
  const sshTarget = config.user && !String(config.target || "").includes("@")
    ? `${config.user}@${config.target}`
    : config.target;
  const targetLabel = config.mode === "wsl"
    ? (config.distro ? `${config.distro}:${config.filePath}` : config.filePath)
    : `${sshTarget}:${config.filePath}`;

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
    const text = buildResultText({ source: `${modeLabel} ${targetLabel}`, filter, items: filtered, total: classified.length });
    copyResultText(text);
  }, [modeLabel, targetLabel, filter, filtered, classified.length]);

  const exportResults = useCallback(() => {
    const source = `${modeLabel}-${targetLabel}`;
    const text = buildResultText({ source: `${modeLabel} ${targetLabel}`, filter, items: filtered, total: classified.length });
    exportResultText(`${safeFileName(source)}-filtered.log`, text);
  }, [modeLabel, targetLabel, filter, filtered, classified.length]);

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0, overflow:"hidden" }}>
      <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"7px 10px",
                    background:"var(--pl-bg-panel)", borderBottom:"0.5px solid var(--pl-border-soft)",
                    flexShrink:0 }}>

        {/* row 1: filter + search + context + match nav */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
          <span style={{ fontSize:11, color:"var(--pl-cat-remote)", background:"var(--pl-remote-badge-bg)",
                         border:"0.5px solid var(--pl-remote-badge-border)", borderRadius:6, padding:"3px 8px",
                         fontWeight:700, flexShrink:0, whiteSpace:"nowrap" }}>
            {modeLabel} {targetLabel}
          </span>

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

          <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0, whiteSpace:"nowrap" }}
               title={t("context_title")}>
            <span style={{ fontSize:10, color:"var(--pl-text-5)" }}>±</span>
            <input
              type="number" min={0} max={50}
              value={context}
              onChange={e => setContext(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
              style={{ width:40, background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                       borderRadius:6, color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:11,
                       padding:"3px 4px", textAlign:"center" }}
            />
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
          <span key={key} onClick={() => toggle(key)}
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
        <Btn active={autoScroll} onClick={() => setAutoScroll(p => !p)} title={t("autoscroll_title")}>↓ auto</Btn>
        <Btn active={showNums}   onClick={() => setShowNums(p => !p)}   title={t("linenums_title")}>#</Btn>
        <Btn onClick={() => listRef.current?.scrollToTop()}>{t("scroll_top")}</Btn>
        <Btn onClick={() => listRef.current?.scrollToBottom()}>{t("scroll_bottom")}</Btn>
        </div>
      </div>

      {error && (
        <div style={{ padding:"6px 14px", background:"var(--pl-error-bg)", borderBottom:"1px solid var(--pl-error-border)",
                      color:"var(--pl-error-text)", fontSize:12, flexShrink:0, fontFamily:"inherit" }}>
          ⚠ {error}
        </div>
      )}

      {classified.length === 0 && !error ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:10, color:"var(--pl-text-7)", fontSize:13 }}>
          <span style={{ fontSize:28, color:"var(--pl-cat-remote)", animation:"spin 1s linear infinite" }}>↻</span>
          {spawned ? t("remote_waiting") : t("docker_starting")}
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
        />
      )}

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
function usePaneTabs(setSettings) {
  const [tabs,          setTabs]         = useState(() => [{ id: nextId++, label:"$welcome", filePath:null, fileSize:null }]);
  const [active,        setActive]       = useState(() => tabs[0].id);
  const [dockerPicker,  setDockerPicker] = useState(false);
  const [remotePicker,  setRemotePicker] = useState(false);
  const [renamingTabId, setRenamingTabId]= useState(null);
  const fileRef       = useRef(null);
  const closedTabsRef = useRef([]);   // stack for reopen-last-tab
  const activeRef     = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  const addTab = (label, filePath, fileSize) => {
    const id = nextId++;
    setTabs(p => [...p, { id, label, filePath, fileSize }]);
    setActive(id);
  };

  const openFileByPath = useCallback(async (fp) => {
    const stat  = await window.electronAPI.statFile(fp);
    const label = fp.split(/[\\/]/).pop();
    addTab(label, fp, stat?.size ?? null);
    const recent = await window.electronAPI.addRecentFile(fp);
    setSettings(prev => ({ ...prev, recentFiles: recent }));
  }, [setSettings]);

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
      : (config.user && !config.target.includes("@") ? `${config.user}@${config.target}` : config.target);
    const prefix = config.mode === "wsl" ? "WSL" : config.mode === "ssh-native" ? "SSH*" : "SSH";
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
    let newId = null;
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      if (idx === -1) return prev;
      newId = nextId++;
      const clone = { ...prev[idx], id: newId, reloadNonce: 0 };
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
    if (newId !== null) setActive(newId);
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
    let activeWasRemoved = false;
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      if (idx === -1) return prev;
      const removed = prev.slice(idx + 1);
      if (!removed.length) return prev;
      removed.forEach(t => {
        if (t.filePath && t.filePath !== "__web__")
          closedTabsRef.current.push({ label: t.label, filePath: t.filePath, fileSize: t.fileSize });
      });
      activeWasRemoved = removed.some(t => t.id === activeRef.current);
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
    renamingTabId, setRenamingTabId, fileRef, closedTabsRef, activeRef,
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
function Pane({ paneId, focused, onFocus, pane, capabilities, settings }) {
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
  useEffect(() => { isFocusedRef.current = focused; }, [focused]);

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
      window.__pendingFile = file;
      addTab(file.name, "__web__", file.size);
    }
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
                <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {tab.label === "$welcome" ? t("welcome_tab") : tab.label}
                </span>
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
            SSH
          </button>
        )}

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
        ? <DockerTab key={`docker-${activeTab.id}-${activeTab.reloadNonce || 0}`}
                     tabKey={String(activeTab.id)}
                     maxLiveLines={settings.maxLiveLines}
                     containerId={activeTab.docker.containerId}
                     containerName={activeTab.docker.name} />
        : activeTab.remote
          ? <RemoteTab key={`remote-${activeTab.id}-${activeTab.reloadNonce || 0}`}
                       tabKey={String(activeTab.id)} maxLiveLines={settings.maxLiveLines}
                       config={activeTab.remote} />
          : activeTab.filePath
          ? <LogTab key={`${activeTab.id}-${activeTab.filePath}-${activeTab.reloadNonce || 0}`}
                    tabKey={String(activeTab.id)}
                    filePath={activeTab.filePath}
                    fileName={activeTab.label}
                    fileSize={activeTab.fileSize}
                    autoScrollDefault={settings.autoScrollDefault}
                    showNumsDefault={settings.showNumsDefault} />
          : <Welcome onOpen={openFile} isElectron={IS_ELECTRON}
                     recentFiles={settings.recentFiles}
                     onOpenRecent={openFileByPath} />
      }

      {dockerPicker && <DockerPicker onSelect={openDockerTab} onClose={() => setDockerPicker(false)} />}
      {remotePicker && <RemotePicker onSelect={openRemoteTab} onClose={() => setRemotePicker(false)} capabilities={capabilities} />}
    </div>
  );
}

export default function App() {
  const [about,        setAbout]       = useState(false);
  const [diagOpen,     setDiagOpen]    = useState(false);
  const [settingsOpen, setSettingsOpen]= useState(false);
  const [capabilities, setCapabilities]= useState(null);
  const [settings,     setSettings]    = useState({
    recentFiles:[], autoScrollDefault:false, showNumsDefault:true, maxLiveLines:500000, language:"es", theme:"classic"
  });
  const [splitDirection, setSplitDirection] = useState(null); // null | "row" | "column"
  const [splitRatio,     setSplitRatio]     = useState(0.5);
  const [focusedPane,    setFocusedPane]    = useState("A");   // "A" | "B" — transient, not persisted
  const containerRef = useRef(null);

  const paneA = usePaneTabs(setSettings);
  const paneB = usePaneTabs(setSettings);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      reportMetric("renderer-first-frame", performance.now() - RENDERER_STARTED_AT, "App mounted");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme || "classic";
  }, [settings.theme]);
  // Safety net: without this, dropping a file anywhere it isn't explicitly
  // handled (e.g. the chrome bar) makes Chromium navigate the window to
  // that file:// path instead of doing nothing.
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

  const closeSplit = () => {
    let contentTabs = [];
    let newWelcomeId = null;
    paneB.setTabs(prev => {
      contentTabs = prev.filter(t => t.filePath || t.docker || t.remote);
      newWelcomeId = nextId++;
      return [{ id: newWelcomeId, label:"$welcome", filePath:null, fileSize:null }];
    });
    paneB.setActive(newWelcomeId);
    if (contentTabs.length) paneA.setTabs(prev => [...prev, ...contentTabs]);
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
      const s = await window.electronAPI.getSettings();
      if (!alive) return;
      setSettings(prev => ({ ...prev, ...s, recentFiles: s.recentFiles || [] }));

      const initialArg = await window.electronAPI.getInitialFileArg();
      if (!alive) return;

      if (initialArg) {
        const stat  = await window.electronAPI.statFile(initialArg);
        const label = initialArg.split(/[\\/]/).pop();
        const id    = nextId++;
        paneA.setTabs(prev => [...prev, { id, label, filePath: initialArg, fileSize: stat?.size ?? null }]);
        paneA.setActive(id);
        const recent = await window.electronAPI.addRecentFile(initialArg);
        if (alive) setSettings(prev => ({ ...prev, recentFiles: recent }));
      } else if (s.panes?.length) {
        const restorePane = async (entries, setTabs, setActive) => {
          const checked = await Promise.all((entries || []).map(async st => {
            const stat = await window.electronAPI.statFile(st.filePath);
            return stat ? { ...st, fileSize: st.fileSize ?? stat.size } : null;
          }));
          const valid = checked.filter(Boolean);
          if (!valid.length || !alive) return;
          const tabEntries = valid.map(st => ({
            id: nextId++, label: st.label, filePath: st.filePath, fileSize: st.fileSize, groupStart: !!st.groupStart,
          }));
          setTabs(prev => [...prev, ...tabEntries]);
          setActive(tabEntries[tabEntries.length - 1].id);
        };
        await restorePane(s.panes[0]?.tabs, paneA.setTabs, paneA.setActive);
        if (s.splitDirection && s.panes[1]?.tabs?.length) {
          await restorePane(s.panes[1].tabs, paneB.setTabs, paneB.setActive);
          setSplitDirection(s.splitDirection);
          setSplitRatio(s.splitRatio ?? 0.5);
        }
      }
    })();
    const unsub = window.electronAPI.onOpenFileArg(fp => paneA.openFileByPath(fp));
    return () => { alive = false; unsub?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Persist both panes' tabs + split state on every change ── */
  useEffect(() => {
    if (!IS_ELECTRON) return;
    const timer = setTimeout(() => {
      const serialize = tabs => tabs
        .filter(tb => tb.filePath && tb.filePath !== "__web__")
        .map(tb => ({ filePath: tb.filePath, label: tb.label, fileSize: tb.fileSize, groupStart: !!tb.groupStart }));
      const panes = [{ tabs: serialize(paneA.tabs) }];
      if (splitDirection) panes.push({ tabs: serialize(paneB.tabs) });
      window.electronAPI.setSettings({ panes, splitDirection, splitRatio });
    }, 600);
    return () => clearTimeout(timer);
  }, [paneA.tabs, paneB.tabs, splitDirection, splitRatio]);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    const cleanAbout = window.electronAPI.onMenuAbout(() => setAbout(true));
    return () => { cleanAbout?.(); };
  }, []);

  /* ── Split-view menu commands ── */
  useEffect(() => {
    if (!IS_ELECTRON) return;
    const cleanRight = window.electronAPI.onMenuSplitRight(() => setSplitDirection("row"));
    const cleanDown  = window.electronAPI.onMenuSplitDown(()  => setSplitDirection("column"));
    const cleanClose = window.electronAPI.onMenuSplitClose(() => closeSplit());
    return () => { cleanRight?.(); cleanDown?.(); cleanClose?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            title={t("split_right_title")}>⬓</button>

          <button onClick={() => setSplitDirection("column")}
            style={{ background: splitDirection==="column" ? "var(--pl-split-active-bg)" : "transparent",
                     border:"none", color: splitDirection==="column" ? "var(--pl-accent-alt)" : "var(--pl-text-6)",
                     padding:"0 14px", cursor:"pointer", fontSize:13,
                     borderRight:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}
            title={t("split_down_title")}>▤</button>

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
                  pane={paneA} capabilities={capabilities} settings={settings} />
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
                      pane={paneB} capabilities={capabilities} settings={settings} />
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
      </div>
    </LangCtx.Provider>
  );
}

function Welcome({ onOpen, isElectron, recentFiles, onOpenRecent }) {
  const t = useLang();
  return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                  flexDirection:"column", gap:16, color:"var(--pl-text-7)" }}>
      <div style={{ fontSize:44 }}>📋</div>
      <p style={{ fontSize:18, color:"var(--pl-text-5)", margin:0 }}>PulpLog</p>
      <button onClick={onOpen}
        style={{ background:"var(--pl-bg-input)", border:"1px solid var(--pl-text-7)", borderRadius:8,
                 color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:13,
                 padding:"10px 24px", cursor:"pointer" }}>
        {t("open_file_btn")}
      </button>

      {recentFiles?.length > 0 && (
        <div style={{ marginTop:8, width:440 }}>
          <div style={{ fontSize:10, color:"var(--pl-text-8)", fontWeight:700, letterSpacing:1,
                         marginBottom:6, textAlign:"center" }}>{t("recent_h")}</div>
          <div style={{ border:"0.5px solid var(--pl-border-soft)", borderRadius:6, overflow:"hidden" }}>
            {recentFiles.map((fp, i) => {
              const name = fp.split(/[\\/]/).pop();
              return (
                <div key={fp} onClick={() => onOpenRecent(fp)}
                     style={{ padding:"7px 14px", fontSize:12, cursor:"pointer",
                               borderBottom: i < recentFiles.length - 1
                                 ? "0.5px solid var(--pl-border-soft)" : "none",
                               background:"var(--pl-bg-footer)",
                               display:"flex", gap:8, alignItems:"center", overflow:"hidden" }}
                     onMouseEnter={e => e.currentTarget.style.background = "var(--pl-bg-hover)"}
                     onMouseLeave={e => e.currentTarget.style.background = "var(--pl-bg-footer)"}>
                  <span style={{ color:"var(--pl-text-8)" }}>📄</span>
                  <span style={{ color:"var(--pl-text-3)", flexShrink:0 }}>{name}</span>
                  <span style={{ color:"var(--pl-border-soft)", fontSize:10, overflow:"hidden",
                                  textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fp}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize:11, color:"var(--pl-border-soft)", marginTop:4 }}>
        {isElectron ? t("hint_electron") : t("hint_web")}
      </div>
    </div>
  );
}
