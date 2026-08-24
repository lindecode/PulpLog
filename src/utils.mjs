export const ROW_H = 22;
export const OVERSCAN = 40;
export const IS_ELECTRON = typeof window !== "undefined" && !!window.electronAPI;
export const RENDERER_STARTED_AT = performance.now();

export const reportMetric = (name, value, detail = "") => {
  if (IS_ELECTRON) window.electronAPI.recordMetric({ name, value, detail }).catch(() => {});
};

const FILE_CACHE_MAX_ENTRIES = 3;
const FILE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const fileCache = new Map();
export let fileCacheBytes = 0;

export function getCachedFile(filePath, stat) {
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

export function cacheFile(filePath, stat, items, stats) {
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

export const fmtSize = b => b>=1e9?`${(b/1e9).toFixed(2)} GB`:b>=1e6?`${(b/1e6).toFixed(1)} MB`:b>=1e3?`${(b/1e3).toFixed(0)} KB`:`${b} B`;
export const fmtNum  = n => n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}k`:String(n);

export const fmtBytes = value => {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unit]}`;
};

export const safeFileName = s => String(s || "pulplog-results").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80);

export function buildResultText({ source, filter, items, total }) {
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

export async function copyResultText(text) {
  if (IS_ELECTRON) return window.electronAPI.copyText(text);
  return navigator.clipboard?.writeText(text);
}

export async function exportResultText(defaultPath, content) {
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

