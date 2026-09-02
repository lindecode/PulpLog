export const MAX_LIVE_LINES = 500_000;

// Loggers that don't shout their level in uppercase (pino/winston/bunyan-style
// JSON, or a bracketed/tagged "level: value" prefix) still carry it — just
// bounded by a delimiter (quote, bracket, colon/equals) rather than free in
// the sentence, so this won't fire on prose that merely mentions "an error".
const TAGGED_LEVEL = /"level"\s*:\s*"?(fatal|error|err|warn(?:ing)?|info|debug|trace)"?|[\[(<](fatal|error|err|warn(?:ing)?|info|debug|trace)[\])>]|\b(fatal|error|err|warn(?:ing)?|info|debug|trace)\b\s*[:=]/i;

function normalizeTaggedLevel(raw) {
  const lower = raw.toLowerCase();
  if (lower === "warning") return "warn";
  if (lower === "err" || lower === "fatal") return "error";
  return lower;
}

export function classify(line) {
  if (/^\s*(at |\.{3}\s*\d+ more)/.test(line)) return "stack";
  if (/^Caused by:/i.test(line.trimStart())) return "causedby";
  if (/\bERROR\b/.test(line)) return "error";
  if (/\bWARN\b/.test(line)) return "warn";
  if (/\bINFO\b/.test(line)) return "info";
  if (/\bDEBUG\b/.test(line)) return "debug";
  if (/\bTRACE\b/.test(line)) return "trace";
  if (/Exception|Error:/.test(line)) return "exception";
  const tagged = line.match(TAGGED_LEVEL);
  if (tagged) return normalizeTaggedLevel(tagged[1] || tagged[2] || tagged[3]);
  return "plain";
}

export function classifyLines(lines, startLine = 1) {
  return lines.map((raw, i) => ({ raw, origLine: startLine + i, type: classify(raw) }));
}

const DATE_TIME_RE = /\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?(?:Z|[+-]\d{2}:?\d{2})?\b/;
const TIME_RE = /\b(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?\b/;

function todayParts() {
  const now = new Date();
  return { y:now.getFullYear(), mo:now.getMonth() + 1, d:now.getDate() };
}

function millisFromFraction(value) {
  if (!value) return 0;
  return Number(String(value).slice(0, 3).padEnd(3, "0"));
}

function datePartsToMillis(y, mo, d, h, mi, s, fraction) {
  const ms = millisFromFraction(fraction);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, s, ms);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

function dateKeyToParts(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  if (datePartsToMillis(y, mo, d, 0, 0, 0) === null) return null;
  return { y, mo, d };
}

function timestampDateKey(raw) {
  const match = String(raw || "").match(DATE_TIME_RE);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function parseTimestampFromText(raw, defaultDate = todayParts()) {
  const text = String(raw || "");
  let match = text.match(DATE_TIME_RE);
  if (match) {
    return datePartsToMillis(
      Number(match[1]), Number(match[2]), Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6]), match[7],
    );
  }
  match = text.match(TIME_RE);
  if (!match) return null;
  return datePartsToMillis(
    defaultDate.y, defaultDate.mo, defaultDate.d,
    Number(match[1]), Number(match[2]), Number(match[3]), match[4],
  );
}

export function parseTimeBoundary(value, defaultDate = todayParts()) {
  const text = String(value || "").trim();
  if (!text) return { value:null, valid:true };
  const time = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,6}))?$/);
  if (!time) return { value:null, valid:false };
  const millis = datePartsToMillis(
    defaultDate.y, defaultDate.mo, defaultDate.d,
    Number(time[1]), Number(time[2]), Number(time[3] || 0), time[4],
  );
  return { value:millis, valid:millis !== null };
}

export function collectLogDates(classified, limit = 366) {
  const dates = new Set();
  for (const item of classified) {
    const key = timestampDateKey(item.raw);
    if (!key) continue;
    dates.add(key);
    if (dates.size > limit) return [];
  }
  return [...dates].sort();
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
function buildMatcher(text, useRegex) {
  if (!text) return { match:null, valid:true };
  if (useRegex) {
    try {
      const regex = new RegExp(text, "i");
      return { match: item => Boolean(item.raw && regex.test(item.raw)), valid:true };
    } catch { return { match:null, valid:false }; }
  }
  const lower = text.toLowerCase();
  return { match: item => Boolean(item.raw && item.raw.toLowerCase().includes(lower)), valid:true };
}

// `filterText` hides non-matching lines (with ±context); `searchText` highlights
// matches without hiding anything — both can be active at the same time.
function applyTimeRange(classified, timeRange) {
  if (!timeRange?.enabled) return { items:classified, valid:true };
  const defaultDate = dateKeyToParts(timeRange.date) || todayParts();
  const from = parseTimeBoundary(timeRange.from, defaultDate);
  const to = parseTimeBoundary(timeRange.to, defaultDate);
  const includeUndated = timeRange.includeUndated !== false;
  if (!from.valid || !to.valid) return { items:[], valid:false };
  const selectedDate = dateKeyToParts(timeRange.date);
  const dayStart = selectedDate ? datePartsToMillis(selectedDate.y, selectedDate.mo, selectedDate.d, 0, 0, 0) : null;
  const dayEnd = selectedDate ? datePartsToMillis(selectedDate.y, selectedDate.mo, selectedDate.d, 23, 59, 59, "999") : null;
  if (from.value == null && to.value == null && !selectedDate) return { items:classified, valid:true };

  let lastTimestamp = null;
  const items = classified.filter(item => {
    const parsed = parseTimestampFromText(item.raw, defaultDate);
    if (parsed !== null) lastTimestamp = parsed;
    const timestamp = parsed ?? lastTimestamp;
    if (timestamp == null) return includeUndated;
    if (dayStart != null && (timestamp < dayStart || timestamp > dayEnd)) return false;
    if (from.value != null && timestamp < from.value) return false;
    if (to.value != null && timestamp > to.value) return false;
    return true;
  });
  return { items, valid:true };
}

export function filterLogs(classified, filterText, filterUseRegex, levels, context, searchText, searchUseRegex, timeRange) {
  const hidden = new Set();
  if (!levels.error) { hidden.add("error"); hidden.add("exception"); }
  if (!levels.stack) { hidden.add("stack"); hidden.add("causedby"); }
  for (const key of ["warn", "info", "debug", "trace", "plain"]) {
    if (!levels[key]) hidden.add(key);
  }
  const visible = hidden.size ? classified.filter(item => !hidden.has(item.type)) : classified;
  const { items:timeVisible, valid:timeRangeValid } = applyTimeRange(visible, timeRange);
  if (!timeRangeValid) {
    return { filtered:[], filterRegexValid:true, searchRegexValid:true, timeRangeValid, matchOrigLines:[] };
  }

  const { match: filterMatch, valid: filterRegexValid } = buildMatcher(filterText, filterUseRegex);
  if (!filterRegexValid) {
    return { filtered:[], filterRegexValid, searchRegexValid:true, timeRangeValid, matchOrigLines:[] };
  }
  const afterFilter = filterMatch ? applyContext(timeVisible, filterMatch, context) : timeVisible;

  const { match: searchMatch, valid: searchRegexValid } = buildMatcher(searchText, searchUseRegex);
  const filtered = searchMatch
    ? afterFilter.map(item => searchMatch(item) ? { ...item, matched:true } : item)
    : afterFilter;

  let matchOrigLines = [];
  if (searchMatch) {
    matchOrigLines = filtered.filter(x => x.matched).map(x => x.origLine);
  } else if (filterMatch) {
    matchOrigLines = afterFilter.filter(x => !x.contextOnly).map(x => x.origLine);
  }

  return { filtered, filterRegexValid, searchRegexValid, timeRangeValid, matchOrigLines };
}
