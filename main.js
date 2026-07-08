const { app, BrowserWindow, ipcMain, dialog, Menu, shell, globalShortcut, clipboard } = require("electron");
const path = require("path");
const fs   = require("fs");
const http           = require("http");
const { execFile, spawn } = require("child_process");
const { Client: SshClient } = require("ssh2");

const IS_DEV = process.env.NODE_ENV === "development" || !app.isPackaged;

/* ── file IO state ── */
const activeReads = new Map(); // readId → stream
const watchers = new Map(); // watchId → { watcher, pollTimer, filePath, lastSize }

/* ── Single-instance + file-arg from OS ── */
let pendingFileArg = null;

function getFileArgFromArgv(argv) {
  // Skip exe/electron (argv[0]) and '.' used in dev mode
  const candidates = argv.slice(1).filter(a => !a.startsWith("-") && a !== ".");
  return candidates.find(a => {
    try { return fs.statSync(a).isFile(); } catch { return false; }
  }) || null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingFileArg = getFileArgFromArgv(process.argv);

  app.on("second-instance", (_event, argv) => {
    const wins = BrowserWindow.getAllWindows();
    if (!wins.length) return;
    const win = wins[0];
    if (win.isMinimized()) win.restore();
    win.focus();
    const fp = getFileArgFromArgv(argv);
    if (fp) win.webContents.send("open-file-arg", fp);
  });
}

/* ── App diagnostics logger ── */
const MAX_APP_LOG = 500;
const appLogEntries = [];

function logEntry(level, category, msg) {
  const entry = { ts: Date.now(), level, category, msg };
  appLogEntries.push(entry);
  if (appLogEntries.length > MAX_APP_LOG) appLogEntries.shift();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("applog:new", entry);
  }
}

function checkCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 3000, windowsHide: true, ...options }, (err, stdout, stderr) => {
      const output = `${stdout || ""}${stderr || ""}`.trim();
      if (err) {
        resolve({
          available: false,
          reason: output || err.message || `${command} no disponible`,
        });
        return;
      }
      resolve({ available: true, detail: output });
    });
  });
}

function parseWslDistros(output) {
  return String(output || "")
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .map(line => line.replace(/\s+\(Default\)$/i, "").trim())
    .filter(Boolean)
    .filter(name => !/^docker-desktop(?:-data)?$/i.test(name));
}

async function getSystemCapabilities() {
  const [docker, ssh, wsl] = await Promise.all([
    checkCommand("docker", ["version", "--format", "{{.Server.Version}}"]),
    checkCommand("ssh", ["-V"]),
    process.platform === "win32"
      ? checkCommand("wsl.exe", ["--status"])
      : Promise.resolve({ available: false, reason: "WSL2 solo esta disponible en Windows" }),
  ]);

  if (wsl.available && process.platform === "win32") {
    const listed = await checkCommand("wsl.exe", ["-l", "-q"]);
    wsl.distros = listed.available ? parseWslDistros(listed.detail) : [];
    if (!listed.available) wsl.reason = listed.reason;
  }

  return {
    platform: process.platform,
    docker,
    ssh,
    wsl,
  };
}

ipcMain.handle("system:capabilities", async () => {
  const caps = await getSystemCapabilities();
  for (const [name, cap] of Object.entries(caps)) {
    if (name === "platform") continue;
    logEntry(cap.available ? "INFO" : "WARN", "system",
      `${name}: ${cap.available ? "disponible" : cap.reason}`);
  }
  return caps;
});

/* ─── window ─── */
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500,
    backgroundColor: "#0a0a0a",
    icon: path.join(__dirname, "assets", "icon.png"),
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
      { label:"GitHub", click: () => shell.openExternal("https://github.com/lindecode/PulpLog") },
      { type:"separator" },
      { label:"Acerca de PulpLog…", click: () => win.webContents.send("menu:about") },
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

ipcMain.handle("dialog:ssh-key", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Seleccionar llave privada SSH",
    filters: [
      { name:"SSH keys", extensions:["pem","key","ppk","*"] },
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
ipcMain.handle("file:read", async (event, payload) => {
  const filePath = typeof payload === "string" ? payload : payload?.filePath;
  const readId = typeof payload === "string" ? filePath : payload?.readId;
  if (!filePath || !readId) throw new Error("Invalid file read request");

  return new Promise((resolve, reject) => {
    let bytesRead = 0;
    let settled = false;
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024*1024 });
    activeReads.set(readId, stream);
    stream.on("data",  chunk => {
      bytesRead += chunk.length;
      event.sender.send("file:chunk", readId, chunk.toString("utf8"));
      event.sender.send("file:progress", readId, bytesRead);
    });
    stream.on("end",   ()    => {
      settled = true;
      activeReads.delete(readId);
      event.sender.send("file:done", readId);
      resolve();
    });
    stream.on("error", err  => {
      settled = true;
      activeReads.delete(readId);
      logEntry("ERROR", "file", `Error leyendo ${path.basename(filePath)}: ${err.message}`);
      event.sender.send("file:error", readId, err.message);
      reject(err);
    });
    stream.on("close", () => {
      activeReads.delete(readId);
      if (!settled) {
        settled = true;
        resolve();
      }
    });
  });
});

ipcMain.handle("file:read:cancel", async (_event, readId) => {
  const stream = activeReads.get(readId);
  if (!stream) return false;
  activeReads.delete(readId);
  stream.destroy();
  return true;
});

/* ─── IPC: tail -f with rotation detection ─── */
ipcMain.handle("file:watch", async (event, payload) => {
  const filePath = typeof payload === "string" ? payload : payload?.filePath;
  const watchId = typeof payload === "string" ? filePath : payload?.watchId;
  if (!filePath || !watchId) throw new Error("Invalid file watch request");

  stopWatch(watchId);
  logEntry("INFO", "file", `Iniciando watch: ${path.basename(filePath)}`);

  let lastSize = 0;
  try { lastSize = fs.statSync(filePath).size; } catch {}

  function startWatcher() {
    let w;
    try {
      w = fs.watch(filePath, { persistent: false }, (eventType) => {
        if (eventType === "rename") {
          w.close();
          watchers.delete(watchId);
          logEntry("WARN", "file", `Archivo rotado: ${path.basename(filePath)}`);
          event.sender.send("file:rotated", watchId, filePath);
          waitForFile(watchId, filePath, () => {
            lastSize = 0;
            logEntry("INFO", "file", `Archivo recreado: ${path.basename(filePath)}`);
            event.sender.send("file:recreated", watchId, filePath);
            startWatcher();
          });
          return;
        }
        try {
          const { size } = fs.statSync(filePath);
          if (size < lastSize) {
            lastSize = 0;
            logEntry("WARN", "file", `Archivo truncado: ${path.basename(filePath)}`);
            event.sender.send("file:truncated", watchId, filePath);
            return;
          }
          if (size === lastSize) return;
          const fd  = fs.openSync(filePath, "r");
          const buf = Buffer.allocUnsafe(size - lastSize);
          fs.readSync(fd, buf, 0, buf.length, lastSize);
          fs.closeSync(fd);
          lastSize = size;
          event.sender.send("file:newlines", watchId, filePath, buf.toString("utf8"));
        } catch { /* file briefly unavailable */ }
      });
    } catch { return; }
    watchers.set(watchId, { watcher: w, pollTimer: null, filePath, lastSize });
  }

  startWatcher();
  return true;
});

function stopWatch(watchId) {
  const entry = watchers.get(watchId);
  if (!entry) return;
  try { entry.watcher && entry.watcher.close(); } catch {}
  if (entry.pollTimer) clearInterval(entry.pollTimer);
  watchers.delete(watchId);
}

/** Poll every 500 ms until filePath exists again, then call cb */
function waitForFile(watchId, filePath, cb) {
  const timer = setInterval(() => {
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      clearInterval(timer);
      watchers.delete(watchId);
      cb();
    } catch { /* not yet */ }
  }, 500);
  watchers.set(watchId, { watcher: null, pollTimer: timer, filePath, lastSize: 0 });
}

/* ─── IPC: stop watching ─── */
ipcMain.handle("file:unwatch", async (_e, payload) => {
  const filePath = typeof payload === "string" ? payload : payload?.filePath;
  const watchId = typeof payload === "string" ? payload : payload?.watchId;
  if (filePath) logEntry("INFO", "file", `Watch detenido: ${path.basename(filePath)}`);
  stopWatch(watchId);
});

ipcMain.handle("clipboard:writeText", async (_e, text) => {
  clipboard.writeText(String(text ?? ""));
  return true;
});

ipcMain.handle("export:text", async (_e, payload) => {
  const defaultPath = payload?.defaultPath || "pulplog-results.log";
  const content = String(payload?.content ?? "");
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Exportar resultados",
    defaultPath,
    filters: [
      { name:"Log", extensions:["log"] },
      { name:"Text", extensions:["txt"] },
      { name:"Todos", extensions:["*"] },
    ],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, content, "utf8");
  logEntry("INFO", "file", `Resultados exportados: ${path.basename(filePath)}`);
  return filePath;
});

/* ─── Docker ─── */
const DOCKER_SOCKET = process.platform === "win32"
  ? "//./pipe/docker_engine"
  : "/var/run/docker.sock";

function dockerGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { socketPath: DOCKER_SOCKET, path: apiPath, headers: { Accept: "application/json" } },
      (res) => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end",  () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
  });
}

ipcMain.handle("docker:list", async () => {
  logEntry("INFO", "docker", "Listando contenedores…");
  try {
    const result = await dockerGet("/containers/json?all=false");
    const count = Array.isArray(result) ? result.length : "?";
    logEntry("INFO", "docker", `Contenedores activos: ${count}`);
    return result;
  } catch (e) {
    logEntry("ERROR", "docker", `Error al listar contenedores: ${e.message}`);
    return { error: e.message };
  }
});

const dockerStreams = new Map(); // containerId → { proc, stopped }

ipcMain.handle("docker:logs:start", (event, containerId) => {
  const shortId = containerId.slice(0, 12);
  logEntry("INFO", "docker", `Iniciando stream: ${shortId}`);
  stopDockerStream(containerId);

  const proc = spawn("docker", ["logs", "--follow", "--tail=500", containerId], {
    windowsHide: true,
    shell: process.platform === "win32",
  });

  const stream = { proc, stopped: false };
  let lineBuf  = "";
  let hadLines = false;

  function send(ch, ...args) {
    if (!event.sender.isDestroyed()) event.sender.send(ch, ...args);
  }

  function flushLines(data) {
    lineBuf += data.toString("utf8");
    const parts = lineBuf.split("\n");
    lineBuf = parts.pop();
    const complete = parts.filter(Boolean);
    if (complete.length) { hadLines = true; send("docker:lines", containerId, complete.join("\n")); }
  }

  proc.stdout.on("data", flushLines);
  proc.stderr.on("data", flushLines);

  proc.on("spawn", () => {
    logEntry("INFO", "docker", `Proceso iniciado: ${shortId}`);
    send("docker:spawned", containerId);
  });

  proc.on("close", (code) => {
    dockerStreams.delete(containerId);
    // Killed intentionally (tab closed, stop button, React StrictMode cleanup) — not an error
    if (stream.stopped) {
      logEntry("INFO", "docker", `Stream ${shortId} detenido`);
      return;
    }
    // code=null means killed by signal unexpectedly; actual errors have a non-zero exit code
    const isError = code !== null && code !== 0;
    if (isError && !hadLines) {
      logEntry("ERROR", "docker", `Stream ${shortId} terminó con código ${code}`);
      send("docker:error", containerId, `docker logs terminó con código ${code}`);
    } else {
      logEntry("INFO", "docker", `Stream ${shortId} terminado (código ${code})`);
      send("docker:end", containerId);
    }
  });

  proc.on("error", (e) => {
    dockerStreams.delete(containerId);
    if (stream.stopped) return;
    logEntry("ERROR", "docker", `Error proceso ${shortId}: ${e.message}`);
    send("docker:error", containerId, e.message);
  });

  dockerStreams.set(containerId, stream);
});

ipcMain.handle("docker:logs:stop", (_e, containerId) => {
  logEntry("INFO", "docker", `Stream detenido manualmente: ${containerId.slice(0, 12)}`);
  stopDockerStream(containerId);
});

function stopDockerStream(containerId) {
  const stream = dockerStreams.get(containerId);
  if (!stream) return;
  stream.stopped = true;
  try { stream.proc.kill(); } catch {}
  dockerStreams.delete(containerId);
}

/* ─── Remote logs: SSH / WSL tail -F ─── */
const remoteStreams = new Map(); // streamId → { proc, stopped, label }

function quotePosixArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeTailLines(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 500;
  return Math.min(Math.max(n, 1), 10000);
}

function normalizeFingerprint(value) {
  return String(value || "")
    .trim()
    .replace(/^SHA256:/i, "")
    .replace(/[\s:]/g, "")
    .toLowerCase();
}

function validateSshTarget(config) {
  const target = String(config?.target || "").trim();
  const user = String(config?.user || "").trim();
  const port = String(config?.port || "").trim();
  const identityFile = String(config?.identityFile || "").trim();
  if (!target) throw new Error("El host SSH es obligatorio");
  if (target.startsWith("-") || /\s/.test(target)) throw new Error("Host SSH inválido");
  if (user && (user.startsWith("-") || /[\s@]/.test(user))) throw new Error("Usuario SSH inválido");
  if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535))
    throw new Error("Puerto SSH inválido");
  if (identityFile && !fs.existsSync(identityFile)) throw new Error("La llave SSH no existe");
  const hostParts = target.includes("@") ? target.split("@") : [];
  return {
    target,
    host: hostParts.length ? hostParts.pop() : target,
    username: user || (hostParts.length ? hostParts.join("@") : undefined),
    port: port ? Number(port) : 22,
    identityFile,
  };
}

function buildRemoteCommand(config) {
  const mode = config?.mode === "wsl" ? "wsl" : "ssh";
  const filePath = String(config?.filePath || "").trim();
  const tailLines = normalizeTailLines(config?.tailLines);
  if (!filePath) throw new Error("La ruta de la bitácora es obligatoria");

  if (mode === "wsl") {
    if (process.platform !== "win32") throw new Error("WSL2 solo esta disponible en Windows");
    const distro = String(config?.distro || "").trim();
    if (distro.startsWith("-")) throw new Error("Nombre de distro WSL inválido");
    const args = [];
    if (distro) args.push("-d", distro);
    args.push("--", "tail", "-n", String(tailLines), "-F", "--", filePath);
    return {
      command: process.platform === "win32" ? "wsl.exe" : "wsl",
      args,
      label: distro ? `WSL:${distro}:${filePath}` : `WSL:${filePath}`,
    };
  }

  const { target, user, port, identityFile } = {
    ...validateSshTarget(config),
    user: String(config?.user || "").trim(),
    port: String(config?.port || "").trim(),
  };

  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
  if (port) args.push("-p", port);
  if (identityFile) args.push("-i", identityFile, "-o", "IdentitiesOnly=yes");
  const sshTarget = user && !target.includes("@") ? `${user}@${target}` : target;
  args.push(sshTarget, `tail -n ${tailLines} -F -- ${quotePosixArg(filePath)}`);
  return { command: "ssh", args, label: `${sshTarget}:${filePath}` };
}

function startNativeSshStream(event, payload) {
  const streamId = payload?.streamId;
  const filePath = String(payload?.filePath || "").trim();
  const tailLines = normalizeTailLines(payload?.tailLines);
  if (!filePath) throw new Error("La ruta de la bitácora es obligatoria");

  const { host, username, port, identityFile, target } = validateSshTarget(payload);
  if (!username) throw new Error("El usuario SSH es obligatorio para credenciales");

  const password = String(payload?.password || "");
  const passphrase = String(payload?.passphrase || "");
  const expectedFingerprint = normalizeFingerprint(payload?.fingerprint);
  const trustHostForSession = Boolean(payload?.trustHostForSession);
  let seenFingerprint = "";
  const config = {
    host,
    port,
    username,
    readyTimeout: 12000,
    tryKeyboard: false,
    hostHash: "sha256",
    hostVerifier(hash) {
      seenFingerprint = hash;
      if (expectedFingerprint) return normalizeFingerprint(hash) === expectedFingerprint;
      return trustHostForSession;
    },
  };
  if (password) config.password = password;
  if (identityFile) {
    config.privateKey = fs.readFileSync(identityFile);
    if (passphrase) config.passphrase = passphrase;
  }
  if (!password && !identityFile) throw new Error("Ingresa contraseña o llave privada");

  const label = `${username}@${target}:${filePath}`;
  const client = new SshClient();
  const stream = { client, channel: null, stopped: false, label };
  let lineBuf = "";
  let hadLines = false;

  function send(ch, ...args) {
    if (!event.sender.isDestroyed()) event.sender.send(ch, ...args);
  }

  function flushLines(data) {
    lineBuf += data.toString("utf8");
    const parts = lineBuf.split("\n");
    lineBuf = parts.pop();
    const complete = parts.filter(Boolean);
    if (complete.length) {
      hadLines = true;
      send("remote:lines", streamId, complete.join("\n"));
    }
  }

  client.on("ready", () => {
    logEntry("INFO", "remote", `SSH nativo conectado: ${label}`);
    send("remote:spawned", streamId);
    client.exec(`tail -n ${tailLines} -F -- ${quotePosixArg(filePath)}`, (err, channel) => {
      if (err) {
        remoteStreams.delete(streamId);
        send("remote:error", streamId, err.message);
        client.end();
        return;
      }
      stream.channel = channel;
      channel.on("data", flushLines);
      channel.stderr.on("data", flushLines);
      channel.on("close", (code) => {
        remoteStreams.delete(streamId);
        client.end();
        if (stream.stopped) {
          logEntry("INFO", "remote", `SSH nativo detenido: ${label}`);
          return;
        }
        if (code && !hadLines) {
          const msg = `tail terminó con código ${code}`;
          logEntry("ERROR", "remote", `${label}: ${msg}`);
          send("remote:error", streamId, msg);
        } else {
          logEntry("INFO", "remote", `SSH nativo terminado: ${label}`);
          send("remote:end", streamId);
        }
      });
    });
  });

  client.on("error", (e) => {
    remoteStreams.delete(streamId);
    if (stream.stopped) return;
    const fingerprintHint = seenFingerprint ? ` Fingerprint SHA256:${seenFingerprint}` : "";
    const msg = `${e.message}${fingerprintHint}`;
    logEntry("ERROR", "remote", `${label}: ${msg}`);
    send("remote:error", streamId, msg);
  });

  client.on("end", () => {
    if (!stream.stopped) logEntry("INFO", "remote", `SSH nativo desconectado: ${label}`);
  });

  remoteStreams.set(streamId, stream);
  logEntry("INFO", "remote", `Iniciando SSH nativo: ${label}`);
  client.connect(config);
}

ipcMain.handle("remote:logs:start", (event, payload) => {
  const streamId = payload?.streamId;
  if (!streamId) throw new Error("Invalid remote stream request");
  stopRemoteStream(streamId);

  if (payload?.mode === "ssh-native") {
    try {
      startNativeSshStream(event, payload);
    } catch (e) {
      event.sender.send("remote:error", streamId, e.message);
    }
    return;
  }

  let spec;
  try {
    spec = buildRemoteCommand(payload);
  } catch (e) {
    event.sender.send("remote:error", streamId, e.message);
    return;
  }

  logEntry("INFO", "remote", `Iniciando stream remoto: ${spec.label}`);
  const proc = spawn(spec.command, spec.args, { windowsHide: true });
  const stream = { proc, stopped: false, label: spec.label };
  let lineBuf = "";
  let hadLines = false;

  function send(ch, ...args) {
    if (!event.sender.isDestroyed()) event.sender.send(ch, ...args);
  }

  function flushLines(data) {
    lineBuf += data.toString("utf8");
    const parts = lineBuf.split("\n");
    lineBuf = parts.pop();
    const complete = parts.filter(Boolean);
    if (complete.length) {
      hadLines = true;
      send("remote:lines", streamId, complete.join("\n"));
    }
  }

  proc.stdout.on("data", flushLines);
  proc.stderr.on("data", flushLines);

  proc.on("spawn", () => {
    logEntry("INFO", "remote", `Proceso iniciado: ${spec.label}`);
    send("remote:spawned", streamId);
  });

  proc.on("close", (code) => {
    remoteStreams.delete(streamId);
    if (stream.stopped) {
      logEntry("INFO", "remote", `Stream remoto detenido: ${spec.label}`);
      return;
    }
    const isError = code !== null && code !== 0;
    if (isError && !hadLines) {
      const msg = `${spec.command} terminó con código ${code}`;
      logEntry("ERROR", "remote", `${spec.label}: ${msg}`);
      send("remote:error", streamId, msg);
    } else {
      logEntry("INFO", "remote", `Stream remoto terminado: ${spec.label} (código ${code})`);
      send("remote:end", streamId);
    }
  });

  proc.on("error", (e) => {
    remoteStreams.delete(streamId);
    if (stream.stopped) return;
    logEntry("ERROR", "remote", `${spec.label}: ${e.message}`);
    send("remote:error", streamId, e.message);
  });

  remoteStreams.set(streamId, stream);
});

ipcMain.handle("remote:logs:stop", (_e, streamId) => {
  stopRemoteStream(streamId);
});

function stopRemoteStream(streamId) {
  const stream = remoteStreams.get(streamId);
  if (!stream) return;
  stream.stopped = true;
  try { stream.proc && stream.proc.kill(); } catch {}
  try { stream.channel && stream.channel.close(); } catch {}
  try { stream.client && stream.client.end(); } catch {}
  remoteStreams.delete(streamId);
}

/* ─── Settings & recent files (userData JSON) ─── */
function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}
function normalizeSettings(value) {
  const s = value && typeof value === "object" ? value : {};
  const language = ["es", "en"].includes(s.language) ? s.language : "es";
  return {
    ...s,
    recentFiles: Array.isArray(s.recentFiles) ? s.recentFiles.filter(f => typeof f === "string") : [],
    sessionTabs: Array.isArray(s.sessionTabs)
      ? s.sessionTabs
          .filter(t => t && typeof t.filePath === "string")
          .map(t => ({
            filePath: t.filePath,
            label: typeof t.label === "string" ? t.label : path.basename(t.filePath),
            fileSize: Number.isFinite(t.fileSize) ? t.fileSize : null,
          }))
      : [],
    autoScrollDefault: Boolean(s.autoScrollDefault),
    showNumsDefault: s.showNumsDefault !== false,
    language,
  };
}
function loadSettings() {
  try { return normalizeSettings(JSON.parse(fs.readFileSync(getSettingsPath(), "utf8"))); }
  catch { return normalizeSettings({}); }
}
function saveSettings(data) {
  try { fs.writeFileSync(getSettingsPath(), JSON.stringify(normalizeSettings(data), null, 2), "utf8"); }
  catch {}
}

ipcMain.handle("settings:get", () => loadSettings());
ipcMain.handle("settings:set", (_e, data) => {
  saveSettings({ ...loadSettings(), ...data });
});
ipcMain.handle("recentfiles:add", (_e, fp) => {
  const s = loadSettings();
  const recent = (s.recentFiles || []).filter(f => f !== fp);
  recent.unshift(fp);
  s.recentFiles = recent.slice(0, 10);
  saveSettings(s);
  return s.recentFiles;
});
ipcMain.handle("recentfiles:remove", (_e, fp) => {
  const s = loadSettings();
  s.recentFiles = (s.recentFiles || []).filter(f => f !== fp);
  saveSettings(s);
  return s.recentFiles;
});

/* ─── IPC: app diagnostics log ─── */
ipcMain.handle("applog:get",   () => [...appLogEntries]);
ipcMain.handle("applog:clear", () => { appLogEntries.length = 0; });

/* ─── IPC: initial file arg (pull model — renderer asks on mount) ─── */
ipcMain.handle("file:getInitialArg", () => {
  const fp = pendingFileArg;
  pendingFileArg = null;
  return fp;
});

/* ─── Global shortcuts ─── */
function bringToFront(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function registerShortcuts(win) {
  // macOS: Super = Cmd, conflicts with everything — skip.
  // Windows: Super = Win key. Win+A/T/W are reserved by Win11 (Action Center, Taskbar, Widgets),
  //          but Electron will try regardless; bitácora reports success or failure per shortcut.
  // Linux:   Super is generally free for these combos across major DEs (GNOME, KDE, XFCE).
  if (process.platform === "darwin") return;

  const isWin = process.platform === "win32";

  const WIN_CONFLICTS = {
    "Super+A": "Abre el Centro de acción (Win11)",
    "Super+T": "Cicla la barra de tareas (Win11)",
    "Super+W": "Abre Widgets (Win11)",
  };

  const shortcuts = [
    {
      key:   "Super+A",
      label: "Abrir archivo",
      action: () => { bringToFront(win); win.webContents.send("menu:open-file"); },
    },
    {
      key:   "Super+T",
      label: "Nueva pestaña",
      action: () => { bringToFront(win); win.webContents.send("menu:new-tab"); },
    },
    {
      key:   "Super+W",
      label: "Cerrar pestaña activa",
      action: () => { bringToFront(win); win.webContents.send("global:close-tab"); },
    },
    {
      key:   "Super+Shift+T",
      label: "Reabrir última pestaña",
      action: () => { bringToFront(win); win.webContents.send("global:reopen-tab"); },
    },
    {
      key:   "Super+P",
      label: "Traer al frente",
      action: () => bringToFront(win),
    },
  ];

  for (const { key, label, action } of shortcuts) {
    const ok = globalShortcut.register(key, action);
    if (ok) {
      logEntry("INFO", "shortcuts", `${label} [${key}]: registrado`);
    } else {
      const hint = isWin && WIN_CONFLICTS[key] ? ` — ${WIN_CONFLICTS[key]}` : "";
      logEntry("WARN", "shortcuts", `${label} [${key}]: no disponible${hint}`);
    }
  }
}

/* ─── lifecycle ─── */
app.whenReady().then(() => {
  const win = createWindow();
  registerShortcuts(win);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  activeReads.forEach((stream) => { try { stream.destroy(); } catch {} });
  activeReads.clear();
  watchers.forEach((e) => {
    try { e.watcher && e.watcher.close(); } catch {}
    if (e.pollTimer) clearInterval(e.pollTimer);
  });
  watchers.clear();
  dockerStreams.forEach((_e, id) => stopDockerStream(id));
  remoteStreams.forEach((_e, id) => stopRemoteStream(id));
  if (process.platform !== "darwin") app.quit();
});
