import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collectLogDates, filterLogs } from "./logProcessing.mjs";

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

export function useBatchedLines(onBatch, delay = 75, maxBufferedLines = Number.POSITIVE_INFINITY) {
  const MAX_BATCH_LINES = 5000;
  const callbackRef = useRef(onBatch);
  const bufferRef = useRef([]);
  const timerRef = useRef(null);
  callbackRef.current = onBatch;

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!bufferRef.current.length) return;
    const batch = bufferRef.current.splice(0, MAX_BATCH_LINES);
    const result = callbackRef.current(batch);
    if (result && typeof result.finally === "function") {
      timerRef.current = -1;
      result.finally(() => {
        timerRef.current = null;
        if (bufferRef.current.length) timerRef.current = setTimeout(flush, 16);
      });
    } else if (bufferRef.current.length) timerRef.current = setTimeout(flush, 16);
  }, []);

  const enqueue = useCallback((lines) => {
    if (!lines.length) return;
    for (let offset = 0; offset < lines.length; offset += MAX_BATCH_LINES)
      bufferRef.current.push(...lines.slice(offset, offset + MAX_BATCH_LINES));
    if (bufferRef.current.length > maxBufferedLines)
      bufferRef.current.splice(0, bufferRef.current.length - maxBufferedLines);
    if (!timerRef.current) timerRef.current = setTimeout(flush, delay);
  }, [delay, flush, maxBufferedLines]);

  enqueue.clear = () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    bufferRef.current = [];
  };

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    bufferRef.current = [];
  }, []);

  return enqueue;
}
export function useFilteredLogs(kind, classified, filterText, filterUseRegex, levels, context, searchText, searchUseRegex, timeRange, reportMetric) {
  return useMemo(() => {
    const started = performance.now();
    const result = filterLogs(classified, filterText, filterUseRegex, levels, context, searchText, searchUseRegex, timeRange);
    const duration = performance.now() - started;
    if (duration >= 4) {
      queueMicrotask(() => reportMetric("search", duration, `${kind}: ${classified.length} lines`));
    }
    return result;
  }, [kind, classified, filterText, filterUseRegex, levels, context, searchText, searchUseRegex, timeRange, reportMetric]);
}

export function useAvailableLogDates(classified) {
  return useMemo(() => collectLogDates(classified), [classified]);
}
