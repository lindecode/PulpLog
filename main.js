const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("path");
const fs   = require("fs");

const IS_DEV = process.env.NODE_ENV === "development" || !app.isPackaged;

/* ── watcher state per filePath ── */
const watchers = new Map(); // filePath → { watcher, pollTimer, lastSize }

/* ─── window ─── */
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500,
    backgroundColor: "#0a0a0a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (IS_DEV) { win.loadURL("http://localhost:5173"); win.webContents.openDevTools(); }
  else          win.loadFile(path.join(__dirname, "dist", "index.html"));
  buildMenu(win);
  return win;
}

function buildMenu(win) {
  const template = [
    { label: "Archivo", submenu: [
      { label:"Abrir archivo…", accelerator:"CmdOrCtrl+O",
        click: () => win.webContents.send("menu:open-file") },
      { label:"Nueva pestaña",  accelerator:"CmdOrCtrl+T",
        click: () => win.webContents.send("menu:new-tab") },
      { type:"separator" }, { role:"quit", label:"Salir" },
    ]},
    { label: "Ver", submenu: [
      { role:"reload", label:"Recargar" },
      { role:"toggleDevTools", label:"DevTools" },
      { type:"separator" },
      { role:"resetZoom" }, { role:"zoomIn" }, { role:"zoomOut" },
      { type:"separator" }, { role:"togglefullscreen", label:"Pantalla completa" },
    ]},
    { label:"Ayuda", submenu:[
      { label:"GitHub", click: () => shell.openExternal("https://github.com/") },
    ]},
  ];
  if (process.platform === "darwin")
    template.unshift({ label: app.name, submenu:[{role:"about"},{role:"hide"},{role:"quit"}] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ─── IPC: open dialog ─── */
ipcMain.handle("dialog:open", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Abrir archivo de log",
    filters: [
      { name:"Logs", extensions:["log","txt","out"] },
      { name:"Todos", extensions:["*"] },
    ],
    properties: ["openFile"],
  });
  return canceled ? null : filePaths[0];
});

/* ─── IPC: stat ─── */
ipcMain.handle("file:stat", async (_e, filePath) => {
  try { const s = fs.statSync(filePath); return { size: s.size, mtime: s.mtimeMs }; }
  catch { return null; }
});

/* ─── IPC: stream read in 1 MB chunks ─── */
ipcMain.handle("file:read", async (event, filePath) => {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding:"utf8", highWaterMark: 1024*1024 });
    stream.on("data",  chunk => event.sender.send("file:chunk", chunk));
    stream.on("end",   ()    => { event.sender.send("file:done"); resolve(); });
    stream.on("error", err  => { event.sender.send("file:error", err.message); reject(err); });
  });
});

/* ─── IPC: tail -f with rotation detection ─── */
ipcMain.handle("file:watch", async (event, filePath) => {
  stopWatch(filePath);

  let lastSize = 0;
  try { lastSize = fs.statSync(filePath).size; } catch {}

  function startWatcher() {
    let w;
    try {
      w = fs.watch(filePath, { persistent: false }, (eventType) => {
        if (eventType === "rename") {
          // File renamed/deleted → log rotation
          w.close();
          watchers.delete(filePath);
          event.sender.send("file:rotated", filePath);
          // Poll until the same path reappears (log manager creates a fresh file)
          waitForFile(filePath, () => {
            lastSize = 0;
            event.sender.send("file:recreated", filePath);
            startWatcher(); // re-attach watcher on the new file
          });
          return;
        }
        // "change": new content appended
        try {
          const { size } = fs.statSync(filePath);
          if (size < lastSize) {
            // Truncation (e.g. logrotate copytruncate)
            lastSize = 0;
            event.sender.send("file:truncated", filePath);
            return;
          }
          if (size === lastSize) return;
          const fd  = fs.openSync(filePath, "r");
          const buf = Buffer.allocUnsafe(size - lastSize);
          fs.readSync(fd, buf, 0, buf.length, lastSize);
          fs.closeSync(fd);
          lastSize = size;
          event.sender.send("file:newlines", buf.toString("utf8"));
        } catch { /* file briefly unavailable */ }
      });
    } catch { return; }
    watchers.set(filePath, { watcher: w, pollTimer: null, lastSize });
  }

  startWatcher();
  return true;
});

function stopWatch(filePath) {
  const entry = watchers.get(filePath);
  if (!entry) return;
  try { entry.watcher && entry.watcher.close(); } catch {}
  if (entry.pollTimer) clearInterval(entry.pollTimer);
  watchers.delete(filePath);
}

/** Poll every 500 ms until filePath exists again, then call cb */
function waitForFile(filePath, cb) {
  const timer = setInterval(() => {
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      clearInterval(timer);
      cb();
    } catch { /* not yet */ }
  }, 500);
  // store timer so we can clear it if unwatch is called
  watchers.set(filePath, { watcher: null, pollTimer: timer, lastSize: 0 });
}

/* ─── IPC: stop watching ─── */
ipcMain.handle("file:unwatch", async (_e, filePath) => stopWatch(filePath));

/* ─── lifecycle ─── */
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => {
  watchers.forEach((e) => { try { e.watcher && e.watcher.close(); } catch {} });
  if (process.platform !== "darwin") app.quit();
});
