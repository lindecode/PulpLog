import React, { memo } from "react";
import { useLang } from "../i18n.jsx";
import { ROW_H } from "../utils.mjs";

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
const fmtBytes = value => {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unit]}`;
};
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


function selectedLogRows(sourceItems, lines) {
  return sourceItems.filter(item => !item.separator && lines.has(item.origLine));
}

function selectedLogText(sourceItems, lines, includeLineNumbers = false) {
  return selectedLogRows(sourceItems, lines)
    .map(item => includeLineNumbers ? `${item.origLine}\t${item.raw}` : item.raw)
    .join("\n");
}


export { STYLE, hl, esc, LogRow, selectedLogRows, selectedLogText };
