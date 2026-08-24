import { useState, useEffect, useCallback, useRef } from "react";
import { useRememberedState } from "./logHooks.mjs";

export function useDebouncedValue(value, delay = 180) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useEscapeToClose(onClose) {
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function useSearchShortcuts(searchInputRef, filterInputRef, isActive) {
  useEffect(() => {
    if (!isActive) return;
    const onKey = event => {
      const isCmdOrCtrl = event.metaKey || event.ctrlKey;
      if (isCmdOrCtrl && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (event.shiftKey) {
          filterInputRef.current?.focus();
        } else {
          searchInputRef.current?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isActive, searchInputRef, filterInputRef]);
}

export function useRowSelection(tabKey, classified) {
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

