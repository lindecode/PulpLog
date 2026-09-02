import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLang } from "../i18n.jsx";
import { getRememberedScroll, setRememberedScroll } from "../logHooks.mjs";
import { ROW_H, OVERSCAN, exportResultText, copyResultText, safeFileName } from "../utils.mjs";
import { LogRow, selectedLogText } from "./LogRow.jsx";
import { findLineRange, findAdjacentLineIndex } from "../logProcessing.mjs";

function VirtualList({ items, sourceItems, showNums, bookmarks, onToggleBookmark, selection, setSelection,
                       listRef, stateKey, selectionSource, onFilterText, onJumpBookmark, onUserScrollUp, onUserInteract, autoScroll }) {
  const t = useLang();
  const [scrollTop, setScrollTop] = useState(() => getRememberedScroll(stateKey));
  const [height,    setHeight]    = useState(500);
  const [contextMenu, setContextMenu] = useState(null);
  const containerRef = useRef(null);
  const total  = items.length;
  const totalH = total * ROW_H;
  const maxScrollTop = Math.max(0, totalH - height);
  const setScrollPosition = useCallback((value) => {
    const next = Math.max(0, Math.min(Number(value) || 0, maxScrollTop));
    setScrollTop(next);
    setRememberedScroll(stateKey, next);
    if (containerRef.current) containerRef.current.scrollTop = next;
  }, [maxScrollTop, stateKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    el.scrollTop = getRememberedScroll(stateKey);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (autoScroll && containerRef.current && selection.lines.size === 0) {
      const syncScroll = () => setScrollPosition(maxScrollTop);
      syncScroll();
      requestAnimationFrame(syncScroll);
    }
  }, [items.length, autoScroll, height, selection.lines.size, maxScrollTop, setScrollPosition]);

  useEffect(() => {
    if (scrollTop > maxScrollTop) setScrollPosition(maxScrollTop);
  }, [scrollTop, maxScrollTop, setScrollPosition]);

  useEffect(() => {
    if (!listRef) return;
    listRef.current = {
      scrollToBottom: () => setTimeout(() => setScrollPosition(maxScrollTop), 10),
      scrollToTop:    () => setScrollPosition(0),
      scrollToIndex:  (index) => setScrollPosition(Math.max(0, index * ROW_H - height / 2)),
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

  const start  = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end    = Math.min(total, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
  const nativeText = () => window.getSelection?.()?.toString() || "";

  const selectLine = (line, event = {}, ignoreNativeText = false) => {
    const hasRowModifier = !!(event.shiftKey || event.ctrlKey || event.metaKey);
    if (!ignoreNativeText && !hasRowModifier && nativeText().trim()) return;
    onUserInteract?.();
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
         style={{ overflow:"auto", flex:1, minHeight:0, outline:"none", overflowAnchor:"none" }}
         onMouseDown={() => {
           containerRef.current?.focus({ preventScroll:true });
           onUserInteract?.();
         }}
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
           } else if (event.key === "F2") {
             event.preventDefault();
             onJumpBookmark?.(event.shiftKey ? "prev" : "next");
           } else if (event.code === "Space") {
             if (selection.lines.size) { event.preventDefault(); toggleSelectionBookmarks(); }
           }
         }}
         onScroll={event => {
           const next = event.currentTarget.scrollTop;
           const clientH = event.currentTarget.clientHeight;
           const scrollH = event.currentTarget.scrollHeight;
           setScrollTop(next);
           setRememberedScroll(stateKey, next);
           setContextMenu(null);
           if (onUserScrollUp && scrollH - next - clientH > 50) {
             onUserScrollUp();
           }
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

export { VirtualList, SelectedLineStatus };
