const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openFileDialog: () => ipcRenderer.invoke("dialog:open"),
  statFile:  (p) => ipcRenderer.invoke("file:stat", p),

  readFile(filePath, { onChunk, onDone, onError }) {
    const ch = (_e, c) => onChunk?.(c);
    const dn = ()      => { cleanup(); onDone?.(); };
    const er = (_e, m) => { cleanup(); onError?.(m); };
    ipcRenderer.on("file:chunk", ch);
    ipcRenderer.on("file:done",  dn);
    ipcRenderer.on("file:error", er);
    ipcRenderer.invoke("file:read", filePath);
    function cleanup() {
      ipcRenderer.removeListener("file:chunk", ch);
      ipcRenderer.removeListener("file:done",  dn);
      ipcRenderer.removeListener("file:error", er);
    }
    return cleanup;
  },

  watchFile(filePath, { onNewLines, onRotated, onTruncated, onRecreated }) {
    const nl  = (_e, t) => onNewLines?.( t);
    const rot = ()      => onRotated?.();
    const trc = ()      => onTruncated?.();
    const rec = ()      => onRecreated?.();
    ipcRenderer.on("file:newlines",  nl);
    ipcRenderer.on("file:rotated",   rot);
    ipcRenderer.on("file:truncated", trc);
    ipcRenderer.on("file:recreated", rec);
    ipcRenderer.invoke("file:watch", filePath);
    return () => {
      ipcRenderer.removeListener("file:newlines",  nl);
      ipcRenderer.removeListener("file:rotated",   rot);
      ipcRenderer.removeListener("file:truncated", trc);
      ipcRenderer.removeListener("file:recreated", rec);
      ipcRenderer.invoke("file:unwatch", filePath);
    };
  },

  onMenuOpenFile: (cb) => { ipcRenderer.on("menu:open-file", cb); return () => ipcRenderer.removeListener("menu:open-file", cb); },
  onMenuNewTab:   (cb) => { ipcRenderer.on("menu:new-tab",   cb); return () => ipcRenderer.removeListener("menu:new-tab",   cb); },

  listContainers: () => ipcRenderer.invoke("docker:list"),

  streamDockerLogs(containerId, { onLines, onEnd, onError, onSpawned }) {
    const spawnH = (_e, id)       => { if (id === containerId) onSpawned?.(); };
    const linesH = (_e, id, text) => { if (id === containerId) onLines?.(text); };
    const endH   = (_e, id)       => { if (id === containerId) { cleanup(); onEnd?.(); } };
    const errH   = (_e, id, msg)  => { if (id === containerId) { cleanup(); onError?.(msg); } };
    ipcRenderer.on("docker:spawned", spawnH);
    ipcRenderer.on("docker:lines",   linesH);
    ipcRenderer.on("docker:end",     endH);
    ipcRenderer.on("docker:error",   errH);
    ipcRenderer.invoke("docker:logs:start", containerId);
    function cleanup() {
      ipcRenderer.removeListener("docker:spawned", spawnH);
      ipcRenderer.removeListener("docker:lines",   linesH);
      ipcRenderer.removeListener("docker:end",     endH);
      ipcRenderer.removeListener("docker:error",   errH);
    }
    return () => { cleanup(); ipcRenderer.invoke("docker:logs:stop", containerId); };
  },
});
