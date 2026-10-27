// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collectLogDates, filterLogs } from "./logProcessing.mjs";
import { createFilterWorkerClient } from "./filterWorkerClient.mjs";

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
  const bufferedCharsRef = useRef(0);
  const timerRef = useRef(null);
  callbackRef.current = onBatch;

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!bufferRef.current.length) return;
    const batch = bufferRef.current.splice(0, MAX_BATCH_LINES);
    bufferedCharsRef.current -= batch.reduce((sum, line) => sum + line.length + 64, 0);
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
    bufferedCharsRef.current += lines.reduce((sum, line) => sum + line.length + 64, 0);
    let remove = 0;
    while (remove < bufferRef.current.length && (bufferedCharsRef.current > 8 * 1024 * 1024 || bufferRef.current.length - remove > maxBufferedLines)) {
      bufferedCharsRef.current -= bufferRef.current[remove].length + 64;
      remove++;
    }
    if (remove) bufferRef.current.splice(0, remove);
    if (!timerRef.current) timerRef.current = setTimeout(flush, delay);
  }, [delay, flush, maxBufferedLines]);

  enqueue.clear = () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    bufferRef.current = [];
    bufferedCharsRef.current = 0;
  };

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    bufferRef.current = [];
    bufferedCharsRef.current = 0;
  }, []);

  return enqueue;
}
export function useFilteredLogs(kind, classified, filterText, filterUseRegex, levels, context, searchText, searchUseRegex, timeRange, reportMetric, extraSearches = [], extraFilters = []) {
  const clientRef = useRef(null);
  const failedCriteriaRef = useRef(null);
  const previousCriteriaRef = useRef(null);
  const [asyncResult, setAsyncResult] = useState(null);
  const criteria = JSON.stringify([filterText, filterUseRegex, levels, context, searchText, searchUseRegex, timeRange, extraSearches, extraFilters]);
  const latestCriteria = useRef(criteria);
  latestCriteria.current = criteria;
  const usesRegex = Boolean((filterText && filterUseRegex) || (searchText && searchUseRegex)
    || extraSearches.some(item => item.text && item.useRegex) || extraFilters.some(item => item.text && item.useRegex));
  const empty = failed => ({ filtered:[], matchOrigLines:[], filterRegexValid:!failed, searchRegexValid:!failed,
    extraFilterRegexValid:extraFilters.map(() => !failed), extraSearchRegexValid:extraSearches.map(() => !failed),
    extraMatchOrigLines:extraSearches.map(() => []), timeRangeValid:true, filterTimedOut:failed });
  useEffect(() => {
    if (previousCriteriaRef.current !== criteria) {
      clientRef.current?.reset(); failedCriteriaRef.current = null; previousCriteriaRef.current = criteria;
    }
    if (!usesRegex || failedCriteriaRef.current === criteria) return;
    if (!clientRef.current) clientRef.current = createFilterWorkerClient();
    clientRef.current.run([classified, filterText, filterUseRegex, levels, context, searchText, searchUseRegex, timeRange, extraSearches, extraFilters])
      .then(result => {
        if (!result.superseded && latestCriteria.current === criteria) setAsyncResult({ criteria, result });
      })
      .catch(() => {
        if (latestCriteria.current !== criteria) return;
        clientRef.current?.reset(); failedCriteriaRef.current = criteria;
        setAsyncResult({ criteria, result:empty(true) });
      });
  }, [classified, criteria, usesRegex]); // Criteria contains all filtering options; live rows queue behind the active job.
  useEffect(() => () => { clientRef.current?.terminate(); clientRef.current = null; }, []);
  const synchronous = useMemo(() => {
    if (usesRegex) return null;
    const started = performance.now();
    const result = filterLogs(classified, filterText, filterUseRegex, levels, context, searchText, searchUseRegex, timeRange, extraSearches, extraFilters);
    const duration = performance.now() - started;
    if (duration >= 4) {
      queueMicrotask(() => reportMetric("search", duration, `${kind}: ${classified.length} lines`));
    }
    return result;
  }, [kind, classified, filterText, filterUseRegex, levels, context, searchText, searchUseRegex, timeRange, reportMetric, extraSearches, extraFilters, usesRegex]);
  return usesRegex ? asyncResult?.criteria === criteria ? asyncResult.result : empty(false) : synchronous;
}

export function useAvailableLogDates(classified) {
  return useMemo(() => collectLogDates(classified), [classified]);
}
