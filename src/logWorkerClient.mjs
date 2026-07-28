import { classifyLines, countLevels } from "./logProcessing.mjs";

export function createLogWorkerClient() {
  if (typeof Worker === "undefined") return null;
  const worker = new Worker(new URL("./logWorker.mjs", import.meta.url), { type:"module" });
  const pending = new Map();
  let nextId = 1;
  worker.onmessage = ({ data }) => {
    const request = pending.get(data?.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve({ items:data.items, stats:data.stats });
  };
  worker.onerror = error => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  return {
    process(lines, startLine) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, lines, startLine });
      }).catch(() => {
        const items = classifyLines(lines, startLine);
        return { items, stats:countLevels(items) };
      });
    },
    terminate() {
      worker.terminate();
      for (const request of pending.values()) request.resolve({
        items:[], stats:{ error:0, warn:0, info:0, debug:0 },
      });
      pending.clear();
    },
  };
}