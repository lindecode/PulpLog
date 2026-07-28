import { classifyLines, countLevels } from "./logProcessing.mjs";

self.onmessage = ({ data }) => {
  const { id, lines, startLine } = data || {};
  try {
    const items = classifyLines(Array.isArray(lines) ? lines : [], startLine);
    self.postMessage({ id, items, stats:countLevels(items) });
  } catch (error) {
    self.postMessage({ id, error:error?.message || String(error) });
  }
};