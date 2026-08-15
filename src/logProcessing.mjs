export const MAX_LIVE_LINES = 500_000;

export function classify(line) {
  if (/^\s*(at |\.{3}\s*\d+ more)/.test(line)) return "stack";
  if (/^Caused by:/i.test(line.trimStart())) return "causedby";
  if (/\bERROR\b/.test(line)) return "error";
  if (/\bWARN\b/.test(line)) return "warn";
  if (/\bINFO\b/.test(line)) return "info";
  if (/\bDEBUG\b/.test(line)) return "debug";
  if (/\bTRACE\b/.test(line)) return "trace";
  if (/Exception|Error:/.test(line)) return "exception";
  return "plain";
}

export function classifyLines(lines, startLine = 1) {
  return lines.map((raw, i) => ({ raw, origLine: startLine + i, type: classify(raw) }));
}

export function countLevels(items) {
  const counts = { error:0, warn:0, info:0, debug:0, trace:0 };
  for (const item of items) {
    if (item.type === "error" || item.type === "exception") counts.error++;
    else if (item.type === "warn") counts.warn++;
    else if (item.type === "info") counts.info++;
    else if (item.type === "debug") counts.debug++;
    else if (item.type === "trace") counts.trace++;
  }
  return counts;
}

export function appendRecentItems(previous, incoming, limit = MAX_LIVE_LINES) {
  if (!incoming.length) return previous;
  const combined = previous.concat(incoming);
  return combined.length > limit ? combined.slice(combined.length - limit) : combined;
}

export function findAdjacentLineIndex(items, selectedLine, direction) {
  const step = direction < 0 ? -1 : 1;
  const selectedIndex = items.findIndex(item =>
    !item.separator && item.origLine === selectedLine);
  let index = selectedIndex >= 0
    ? selectedIndex + step
    : (step > 0 ? 0 : items.length - 1);
  while (index >= 0 && index < items.length) {
    if (!items[index].separator) return index;
    index += step;
  }
  return -1;
}

export function findLineRange(items, anchorLine, targetLine) {
  const anchorIndex = items.findIndex(item => !item.separator && item.origLine === anchorLine);
  const targetIndex = items.findIndex(item => !item.separator && item.origLine === targetLine);
  if (targetIndex < 0) return [];
  if (anchorIndex < 0) return [targetLine];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return items.slice(start, end + 1).filter(item => !item.separator).map(item => item.origLine);
}

export function splitTextChunk(carry, chunk) {
  const parts = (carry + chunk).split("\n");
  return { lines:parts.slice(0, -1), carry:parts[parts.length - 1] ?? "" };
}

// grep -C semantics: merge overlapping windows and mark gaps between them.
export function applyContext(classified, isMatch, context) {
  if (!context) return classified.filter(isMatch);
  const ranges = [];
  for (let i = 0; i < classified.length; i++) {
    if (!isMatch(classified[i])) continue;
    const start = Math.max(0, i - context);
    const end = Math.min(classified.length - 1, i + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  const out = [];
  let previousEnd = -1;
  for (const range of ranges) {
    if (previousEnd >= 0) {
      out.push({ separator:true, key:`sep-${range.start}`, skipped:range.start - previousEnd - 1 });
    }
    for (let i = range.start; i <= range.end; i++) {
      const item = classified[i];
      out.push(isMatch(item) ? item : { ...item, contextOnly:true });
    }
    previousEnd = range.end;
  }
  return out;
}
export function filterLogs(classified, searchFilter, useRegex, levels, context, searchMode) {
  const hidden = new Set();
  if (!levels.error) { hidden.add("error"); hidden.add("exception"); }
  if (!levels.stack) { hidden.add("stack"); hidden.add("causedby"); }
  for (const key of ["warn", "info", "debug", "trace", "plain"]) {
    if (!levels[key]) hidden.add(key);
  }
  const visible = hidden.size ? classified.filter(item => !hidden.has(item.type)) : classified;

  if (!searchFilter) {
    return { filtered:visible, regexValid:true, matchOrigLines:[] };
  }

  let isMatch;
  if (useRegex) {
    let regex;
    try { regex = new RegExp(searchFilter, "i"); }
    catch { return { filtered: searchMode ? visible : [], regexValid:false, matchOrigLines:[] }; }
    isMatch = item => regex.test(item.raw);
  } else {
    const lowerFilter = searchFilter.toLowerCase();
    isMatch = item => item.raw.toLowerCase().includes(lowerFilter);
  }

  if (searchMode) {
    const filtered = visible.map(item => isMatch(item) ? { ...item, matched:true } : item);
    return { filtered, regexValid:true, matchOrigLines: filtered.filter(x => x.matched).map(x => x.origLine) };
  }

  const filtered = applyContext(visible, isMatch, context);
  return { filtered, regexValid:true, matchOrigLines: filtered.filter(x => !x.contextOnly).map(x => x.origLine) };
}