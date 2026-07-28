import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterLogs } from "./logProcessing.mjs";

const MAX_REMEMBERED_TABS = 100;
const rememberedTabs = new Map();

function getTabRecord(tabKey) {
  if (!rememberedTabs.has(tabKey)) rememberedTabs.set(tabKey, new Map());
  const record = rememberedTabs.get(tabKey);
  rememberedTabs.delete(tabKey);
  rememberedTabs.set(tabKey, record);
  while (rememberedTabs.size > MAX_REMEMBERED_TABS) {
    rememberedTabs.delete(rememberedTabs.keys().next().value);
  }
  return record;
}

export function useRememberedState(tabKey, name, initialValue) {
  const [value, setValue] = useState(() => {
    const record = getTabRecord(tabKey);
    if (record.has(name)) return record.get(name);
    return typeof initialValue === "function" ? initialValue() : initialValue;
  });
  useEffect(() => {
    getTabRecord(tabKey).set(name, value);
  }, [tabKey, name, value]);
  return [value, setValue];
}

export function getRememberedScroll(tabKey) {
  return getTabRecord(tabKey).get("scrollTop") || 0;
}

export function setRememberedScroll(tabKey, scrollTop) {
  getTabRecord(tabKey).set("scrollTop", scrollTop);
}

export function useBatchedLines(onBatch, delay = 75) {
  const callbackRef = useRef(onBatch);
  const bufferRef = useRef([]);
  const timerRef = useRef(null);
  callbackRef.current = onBatch;

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!bufferRef.current.length) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    callbackRef.current(batch);
  }, []);

  const enqueue = useCallback((lines) => {
    if (!lines.length) return;
    bufferRef.current.push(...lines);
    if (!timerRef.current) timerRef.current = setTimeout(flush, delay);
  }, [delay, flush]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    bufferRef.current = [];
  }, []);

  return enqueue;
}
export function useFilteredLogs(kind, classified, searchFilter, useRegex, levels, context, reportMetric) {
  return useMemo(() => {
    const started = performance.now();
    const result = filterLogs(classified, searchFilter, useRegex, levels, context);
    const duration = performance.now() - started;
    if (duration >= 4) {
      queueMicrotask(() => reportMetric("search", duration, `${kind}: ${classified.length} lines`));
    }
    return result;
  }, [kind, classified, searchFilter, useRegex, levels, context, reportMetric]);
}