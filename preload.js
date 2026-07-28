const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openFileDialog: () => ipcRenderer.invoke("dialog:open"),
  openSshKeyDialog: () => ipcRenderer.invoke("dialog:ssh-key"),
  statFile:  (p) => ipcRenderer.invoke("file:stat", p),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  readFile(filePath, { onChunk, onProgress, onDone, onError }) {
    const readId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ch = (_e, id, c, b) => {
      if (id === readId) {
        onChunk?.(c);
        if (Number.isFinite(b)) onProgress?.(b);
      }
    };
    const dn = (_e, id, b) => { if (id === readId) { cleanup(); onDone?.(b); } };
    const er = (_e, id, m) => { if (id === readId) { cleanup(); onError?.(m); } };
    ipcRenderer.on("file:chunk", ch);
    ipcRenderer.on("file:done",  dn);
    ipcRenderer.on("file:error", er);
    ipcRenderer.invoke("file:read", { readId, filePath }).catch(m => {
      cleanup();
      onError?.(m?.message ?? String(m));
    });
    function cleanup() {
      ipcRenderer.removeListener("file:chunk", ch);
      ipcRenderer.removeListener("file:done",  dn);
      ipcRenderer.removeListener("file:error", er);
    }
    return () => {
      cleanup();
      ipcRenderer.invoke("file:read:cancel", readId);
    };
  },

  watchFile(filePath, { onNewLines, onRotated, onTruncated, onRecreated }) {
    const watchId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nl  = (_e, id, _fp, t) => { if (id === watchId) onNewLines?.(t); };
    const rot = (_e, id)         => { if (id === watchId) onRotated?.(); };
    const trc = (_e, id)         => { if (id === watchId) onTruncated?.(); };
    const rec = (_e, id)         => { if (id === watchId) onRecreated?.(); };
    ipcRenderer.on("file:newlines",  nl);
    ipcRenderer.on("file:rotated",   rot);
    ipcRenderer.on("file:truncated", trc);
    ipcRenderer.on("file:recreated", rec);
    ipcRenderer.invoke("file:watch", { watchId, filePath });
    return () => {
      ipcRenderer.removeListener("file:newlines",  nl);
      ipcRenderer.removeListener("file:rotated",   rot);
      ipcRenderer.removeListener("file:truncated", trc);
      ipcRenderer.removeListener("file:recreated", rec);
      ipcRenderer.invoke("file:unwatch", { watchId, filePath });
    };
  },

  onMenuOpenFile: (cb) => { ipcRenderer.on("menu:open-file", cb); return () => ipcRenderer.removeListener("menu:open-file", cb); },
  onMenuOpenRecent: (cb) => { const h = (_e, fp) => cb(fp); ipcRenderer.on("menu:open-recent", h); return () => ipcRenderer.removeListener("menu:open-recent", h); },
  onMenuNewTab:   (cb) => { ipcRenderer.on("menu:new-tab",   cb); return () => ipcRenderer.removeListener("menu:new-tab",   cb); },
  onMenuAbout:    (cb) => { ipcRenderer.on("menu:about",     cb); return () => ipcRenderer.removeListener("menu:about",     cb); },
  onMenuSplitRight: (cb) => { ipcRenderer.on("menu:split-right", cb); return () => ipcRenderer.removeListener("menu:split-right", cb); },
  onMenuSplitDown:  (cb) => { ipcRenderer.on("menu:split-down",  cb); return () => ipcRenderer.removeListener("menu:split-down",  cb); },
  onMenuSplitClose: (cb) => { ipcRenderer.on("menu:split-close", cb); return () => ipcRenderer.removeListener("menu:split-close", cb); },

  getCapabilities: () => ipcRenderer.invoke("system:capabilities"),
  copyText: (text) => ipcRenderer.invoke("clipboard:writeText", text),
  exportText: (payload) => ipcRenderer.invoke("export:text", payload),

  showTabContextMenu: (payload) => ipcRenderer.invoke("tabmenu:show", payload),
  onTabMenuAction: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on("tabmenu:action", h);
    return () => ipcRenderer.removeListener("tabmenu:action", h);
  },

  listContainers: () => ipcRenderer.invoke("docker:list"),

  streamDockerLogs(containerId, { onLines, onEnd, onError, onSpawned }) {
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const spawnH = (_e, id)       => { if (id === streamId) onSpawned?.(); };
    const linesH = (_e, id, text) => { if (id === streamId) onLines?.(text); };
    const endH   = (_e, id)       => { if (id === streamId) { cleanup(); onEnd?.(); } };
    const errH   = (_e, id, msg)  => { if (id === streamId) { cleanup(); onError?.(msg); } };
    ipcRenderer.on("docker:spawned", spawnH);
    ipcRenderer.on("docker:lines",   linesH);
    ipcRenderer.on("docker:end",     endH);
    ipcRenderer.on("docker:error",   errH);
    ipcRenderer.invoke("docker:logs:start", { streamId, containerId });
    function cleanup() {
      ipcRenderer.removeListener("docker:spawned", spawnH);
      ipcRenderer.removeListener("docker:lines",   linesH);
      ipcRenderer.removeListener("docker:end",     endH);
      ipcRenderer.removeListener("docker:error",   errH);
    }
    return () => { cleanup(); ipcRenderer.invoke("docker:logs:stop", streamId); };
  },

  /* ── App diagnostics log ── */
  streamRemoteLogs(config, { onLines, onEnd, onError, onSpawned }) {
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const spawnH = (_e, id)       => { if (id === streamId) onSpawned?.(); };
    const linesH = (_e, id, text) => { if (id === streamId) onLines?.(text); };
    const endH   = (_e, id)       => { if (id === streamId) { cleanup(); onEnd?.(); } };
    const errH   = (_e, id, msg)  => { if (id === streamId) { cleanup(); onError?.(msg); } };
    ipcRenderer.on("remote:spawned", spawnH);
    ipcRenderer.on("remote:lines",   linesH);
    ipcRenderer.on("remote:end",     endH);
    ipcRenderer.on("remote:error",   errH);
    ipcRenderer.invoke("remote:logs:start", { ...config, streamId }).catch(e => {
      cleanup();
      onError?.(e?.message ?? String(e));
    });
    function cleanup() {
      ipcRenderer.removeListener("remote:spawned", spawnH);
      ipcRenderer.removeListener("remote:lines",   linesH);
      ipcRenderer.removeListener("remote:end",     endH);
      ipcRenderer.removeListener("remote:error",   errH);
    }
    return () => { cleanup(); ipcRenderer.invoke("remote:logs:stop", streamId); };
  },

  getAppLog:   () => ipcRenderer.invoke("applog:get"),
  clearAppLog: () => ipcRenderer.invoke("applog:clear"),
  recordMetric: (data) => ipcRenderer.invoke("diagnostics:metric", data),
  onAppLogNew: (cb) => {
    const h = (_e, entry) => cb(entry);
    ipcRenderer.on("applog:new", h);
    return () => ipcRenderer.removeListener("applog:new", h);
  },

  /* ── Settings & recent files ── */
  getSettings:      () => ipcRenderer.invoke("settings:get"),
  setSettings:      (d) => ipcRenderer.invoke("settings:set", d),
  addRecentFile:    (fp) => ipcRenderer.invoke("recentfiles:add", fp),
  removeRecentFile: (fp) => ipcRenderer.invoke("recentfiles:remove", fp),

  /* ── Open from OS (file association / drag-drop on icon) ── */
  getInitialFileArg: () => ipcRenderer.invoke("file:getInitialArg"),
  onOpenFileArg: (cb) => {
    const h = (_e, fp) => cb(fp);
    ipcRenderer.on("open-file-arg", h);
    return () => ipcRenderer.removeListener("open-file-arg", h);
  },

  /* ── Global OS shortcuts ── */
  onGlobalCloseTab:  (cb) => { const h = () => cb(); ipcRenderer.on("global:close-tab",  h); return () => ipcRenderer.removeListener("global:close-tab",  h); },
  onGlobalReopenTab: (cb) => { const h = () => cb(); ipcRenderer.on("global:reopen-tab", h); return () => ipcRenderer.removeListener("global:reopen-tab", h); },
});
