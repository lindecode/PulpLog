const { app, BrowserWindow, ipcMain, dialog, Menu, shell, globalShortcut, clipboard } = require("electron");
const path = require("path");
const fs   = require("fs");
const crypto = require("crypto");
const { StringDecoder } = require("string_decoder");
const http           = require("http");
const https          = require("https");
const { execFile, spawn } = require("child_process");
const { Client: SshClient } = require("ssh2");

const IS_SMOKE_TEST = process.env.PULPLOG_SMOKE_TEST === "1";
const IS_DEV = !IS_SMOKE_TEST && (process.env.NODE_ENV === "development" || !app.isPackaged);
const GITHUB_RELEASES_URL = "https://github.com/lindecode/PulpLog/releases";
const GITHUB_LATEST_RELEASE_API = "https://api.github.com/repos/lindecode/PulpLog/releases/latest";

function assertTrustedSender(event) {
  const source = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
  const trusted = IS_DEV
    ? /^http:\/\/(?:localhost|127\.0\.0\.1):5173(?:\/|$)/.test(source)
    : source.startsWith("file:");
  if (!trusted) throw new Error("IPC sender is not trusted");
}

function normalizeLocalPath(value) {
  if (typeof value !== "string" || !value || value.length > 32767 || value.includes("\0")) {
    throw new Error("Invalid file path");
  }
  return path.resolve(value);
}

function normalizeIdentifier(value, label) {
  if (typeof value !== "string" || !value || value.length > 160 || /[\x00-\x1f]/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}
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
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || (process.env.APPIMAGE ? path.dirname(process.env.APPIMAGE) : null);
const logsDir = portableDir ? path.join(portableDir, "logs") : path.join(app.getPath("userData"), "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const logFilePath = path.join(logsDir, "pulplog-app.log");

function logEntry(level, category, msg) {
  const entry = { ts: Date.now(), level, category, msg };
  appLogEntries.push(entry);
  if (appLogEntries.length > MAX_APP_LOG) appLogEntries.shift();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("applog:new", entry);
  }
  try {
    const tsStr = new Date(entry.ts).toISOString();
    fs.appendFileSync(logFilePath, `[${tsStr}] [${entry.level}] [${entry.category}] ${entry.msg}\n`);
  } catch {}
}

process.on("uncaughtException", err => {
  logEntry("ERROR", "main", `Uncaught exception: ${err.stack || err.message}`);
});
process.on("unhandledRejection", reason => {
  logEntry("ERROR", "main", `Unhandled rejection: ${reason instanceof Error ? reason.stack : reason}`);
});

const alertCooldowns = new Map();

/* ── Native-UI i18n: menu, dialogs, and error alerts don't go through the
   renderer's translation table, so they need their own — kept in sync with
   the user's language preference via `currentLanguage` (see updateSettings). ── */
let currentLanguage = "es";

const MENU_STRINGS = {
  es: {
    file:"Archivo", open_file:"Abrir archivo…", open_recent:"Abrir reciente", no_recent:"Sin archivos recientes",
    new_tab:"Nueva pestaña", close_tab:"Cerrar pestaña", reopen_tab:"Reabrir pestaña cerrada", quit:"Salir",
    view:"Ver", reload:"Recargar", devtools:"DevTools", fullscreen:"Pantalla completa",
    zoom_reset:"Tamaño real", zoom_in:"Acercar", zoom_out:"Alejar",
    split_right:"Dividir a la derecha", split_down:"Dividir abajo", split_close:"Cerrar división",
    help:"Ayuda", user_guide:"Manual de usuario", check_updates:"Buscar actualizaciones",
    github:"GitHub", about:"Acerca de PulpLog…",
    file_unavailable_title:"Archivo no disponible", file_unavailable_msg:"No se pudo abrir el archivo reciente",
    open_location:"Abrir ubicación del archivo", copy_path:"Copiar ruta del archivo",
    duplicate_tab:"Duplicar bitácora", reload_tab:"Recargar bitácora", rename_tab:"Renombrar pestaña",
    group_start_off:"Quitar separador de grupo", group_start_on:"Iniciar grupo aquí",
    close_others:"Cerrar otras pestañas", close_right:"Cerrar pestañas a la derecha",
    open_log_dialog:"Abrir archivo de log", pick_ssh_key:"Seleccionar llave privada SSH",
    export_dialog:"Exportar resultados", filter_logs:"Logs", filter_all:"Todos", filter_ssh_keys:"Llaves SSH",
    ok:"Aceptar", cancel:"Cancelar", tech_detail:"Detalle técnico",
    updates_title:"Actualizaciones de PulpLog",
    update_available:(latest, current) => `Hay una nueva versión disponible: ${latest}\nVersión instalada: ${current}`,
    update_available_detail:(name, publishedAt) => [name, publishedAt ? `Publicado: ${publishedAt}` : ""].filter(Boolean).join("\n"),
    update_open_release:"Abrir GitHub Releases",
    update_later:"Después",
    update_skip_version:"No volver a mostrar esta versión",
    update_skipped:(latest) => `La versión ${latest} está oculta por tu preferencia.`,
    update_show_again:"Volver a mostrar",
    update_current:(current) => `PulpLog está actualizado.\nVersión instalada: ${current}`,
    update_error:"No se pudo consultar GitHub Releases.",
    err_docker:"Error de Docker", err_docker_logs:"Error en logs Docker",
    err_remote:"Error remoto", err_ssh:"Error SSH",
    shortcut_open_file:"Abrir archivo", shortcut_new_tab:"Nueva pestaña",
    shortcut_close_tab:"Cerrar pestaña activa", shortcut_reopen_tab:"Reabrir última pestaña",
    shortcut_bring_front:"Traer al frente", shortcut_registered:"registrado", shortcut_unavailable:"no disponible",
    win_conflict_a:"Abre el Centro de acción (Win11)", win_conflict_t:"Cicla la barra de tareas (Win11)",
    win_conflict_w:"Abre Widgets (Win11)",
  },
  en: {
    file:"File", open_file:"Open file…", open_recent:"Open recent", no_recent:"No recent files",
    new_tab:"New tab", close_tab:"Close tab", reopen_tab:"Reopen closed tab", quit:"Quit",
    view:"View", reload:"Reload", devtools:"DevTools", fullscreen:"Toggle Full Screen",
    zoom_reset:"Actual Size", zoom_in:"Zoom In", zoom_out:"Zoom Out",
    split_right:"Split right", split_down:"Split down", split_close:"Close split",
    help:"Help", user_guide:"User Guide", check_updates:"Check for Updates",
    github:"GitHub", about:"About PulpLog…",
    file_unavailable_title:"File unavailable", file_unavailable_msg:"Could not open the recent file",
    open_location:"Show in folder", copy_path:"Copy file path",
    duplicate_tab:"Duplicate tab", reload_tab:"Reload tab", rename_tab:"Rename tab",
    group_start_off:"Remove group separator", group_start_on:"Start group here",
    close_others:"Close other tabs", close_right:"Close tabs to the right",
    open_log_dialog:"Open log file", pick_ssh_key:"Select SSH private key",
    export_dialog:"Export results", filter_logs:"Logs", filter_all:"All files", filter_ssh_keys:"SSH keys",
    ok:"OK", cancel:"Cancel", tech_detail:"Technical detail",
    updates_title:"PulpLog Updates",
    update_available:(latest, current) => `A new version is available: ${latest}\nInstalled version: ${current}`,
    update_available_detail:(name, publishedAt) => [name, publishedAt ? `Published: ${publishedAt}` : ""].filter(Boolean).join("\n"),
    update_open_release:"Open GitHub Releases",
    update_later:"Later",
    update_skip_version:"Do not show this version again",
    update_skipped:(latest) => `Version ${latest} is hidden by your preference.`,
    update_show_again:"Show Again",
    update_current:(current) => `PulpLog is up to date.\nInstalled version: ${current}`,
    update_error:"Could not check GitHub Releases.",
    err_docker:"Docker error", err_docker_logs:"Docker logs error",
    err_remote:"Remote error", err_ssh:"SSH error",
    shortcut_open_file:"Open file", shortcut_new_tab:"New tab",
    shortcut_close_tab:"Close active tab", shortcut_reopen_tab:"Reopen last tab",
    shortcut_bring_front:"Bring to front", shortcut_registered:"registered", shortcut_unavailable:"unavailable",
    win_conflict_a:"Opens Action Center (Win11)", win_conflict_t:"Cycles the taskbar (Win11)",
    win_conflict_w:"Opens Widgets (Win11)",
  },
};
function mt(key) {
  return (MENU_STRINGS[currentLanguage] || MENU_STRINGS.es)[key] || key;
}
function mtf(key, ...args) {
  const entry = mt(key);
  return typeof entry === "function" ? entry(...args) : entry;
}

function parseReleaseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

function compareVersions(a, b) {
  const av = parseReleaseVersion(a);
  const bv = parseReleaseVersion(b);
  if (!av || !bv) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  }
  return 0;
}

function formatReleaseDate(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(currentLanguage === "en" ? "en-US" : "es-MX", {
      year: "numeric", month: "short", day: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `PulpLog/${app.getVersion()}`,
      },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          req.destroy(new Error("Response too large"));
        }
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub HTTP ${res.statusCode}: ${body.slice(0, 240)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error("GitHub request timed out")));
    req.on("error", reject);
  });
}

async function checkForUpdates(win) {
  const currentVersion = app.getVersion();
  try {
    const release = await fetchJson(GITHUB_LATEST_RELEASE_API);
    const latestTag = String(release?.tag_name || "").trim();
    const latestUrl = release?.html_url || GITHUB_RELEASES_URL;
    if (!parseReleaseVersion(latestTag)) throw new Error(`Invalid release tag: ${latestTag || "(empty)"}`);

    if (compareVersions(latestTag, currentVersion) > 0) {
      const settings = await loadSettings();
      if (settings.skippedUpdateVersion === latestTag) {
        const { response } = await dialog.showMessageBox(win || undefined, {
          type: "info",
          title: mt("updates_title"),
          message: mtf("update_skipped", latestTag),
          detail: mtf("update_available_detail", release?.name || "", formatReleaseDate(release?.published_at)),
          buttons: [mt("ok"), mt("update_open_release"), mt("update_show_again")],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (response === 1) shell.openExternal(latestUrl);
        if (response === 2) await updateSettings(current => ({ ...current, skippedUpdateVersion: "" }));
        return;
      }

      logEntry("INFO", "system", `Nueva version disponible: ${latestTag} (instalada ${currentVersion})`);
      const { response, checkboxChecked } = await dialog.showMessageBox(win || undefined, {
        type: "info",
        title: mt("updates_title"),
        message: mtf("update_available", latestTag, `v${currentVersion}`),
        detail: mtf("update_available_detail", release?.name || "", formatReleaseDate(release?.published_at)),
        buttons: [mt("update_open_release"), mt("update_later")],
        checkboxLabel: mt("update_skip_version"),
        checkboxChecked: false,
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (checkboxChecked) {
        await updateSettings(current => ({ ...current, skippedUpdateVersion: latestTag }));
      }
      if (response === 0) shell.openExternal(latestUrl);
      return;
    }

    logEntry("INFO", "system", `PulpLog actualizado: ${currentVersion}; ultimo release ${latestTag}`);
    await dialog.showMessageBox(win || undefined, {
      type: "info",
      title: mt("updates_title"),
      message: mtf("update_current", `v${currentVersion}`),
      detail: latestTag ? `GitHub Releases: ${latestTag}` : GITHUB_RELEASES_URL,
      buttons: [mt("ok")],
      noLink: true,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    logEntry("WARN", "system", `No se pudo consultar actualizaciones: ${msg}`);
    const { response } = await dialog.showMessageBox(win || undefined, {
      type: "warning",
      title: mt("updates_title"),
      message: mt("update_error"),
      detail: msg,
      buttons: [mt("ok"), mt("update_open_release")],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response === 1) shell.openExternal(GITHUB_RELEASES_URL);
  }
}

const ERROR_EXPLANATIONS = {
  es: {
    docker_enoent:"Docker no esta instalado o no esta en el PATH.",
    docker_daemon:"Docker Desktop o el daemon de Docker no esta respondiendo.",
    docker_permission:"No hay permisos para acceder a Docker.",
    remote_fingerprint:"No se pudo validar la huella (fingerprint) del servidor. Comprueba la huella mostrada antes de continuar.",
    remote_auth:"Autenticacion SSH rechazada. Revisa usuario, contrasena, llave o passphrase.",
    remote_timeout:"No se pudo conectar al host remoto. Revisa host, puerto, VPN/firewall o red.",
    remote_path:"No se pudo leer la ruta remota. Revisa que el archivo exista y que el usuario tenga permisos.",
    generic:"Ocurrio un error inesperado.",
  },
  en: {
    docker_enoent:"Docker is not installed or is not on PATH.",
    docker_daemon:"Docker Desktop or the Docker daemon is not responding.",
    docker_permission:"No permission to access Docker.",
    remote_fingerprint:"Could not validate the server fingerprint. Check the fingerprint shown before continuing.",
    remote_auth:"SSH authentication was rejected. Check the user, password, key, or passphrase.",
    remote_timeout:"Could not connect to the remote host. Check host, port, VPN/firewall, or network.",
    remote_path:"Could not read the remote path. Check that the file exists and the user has permission.",
    generic:"An unexpected error occurred.",
  },
};

function explainError(category, msg) {
  const text = String(msg || "");
  const lower = text.toLowerCase();
  const E = ERROR_EXPLANATIONS[currentLanguage] || ERROR_EXPLANATIONS.es;
  if (category === "docker") {
    if (lower.includes("enoent") || lower.includes("not recognized") || lower.includes("no se reconoce"))
      return E.docker_enoent;
    if (lower.includes("connect") || lower.includes("pipe") || lower.includes("socket") || lower.includes("daemon"))
      return E.docker_daemon;
    if (lower.includes("permission") || lower.includes("access") || lower.includes("denied"))
      return E.docker_permission;
  }
  if (category === "remote") {
    if (lower.includes("host key") || lower.includes("fingerprint"))
      return E.remote_fingerprint;
    if (lower.includes("authentication") || lower.includes("auth") || lower.includes("permission denied"))
      return E.remote_auth;
    if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("connect"))
      return E.remote_timeout;
    if (lower.includes("no such file") || lower.includes("cannot open") || lower.includes("tail"))
      return E.remote_path;
  }
  return text || E.generic;
}

function showErrorAlert(sender, category, title, msg) {
  const key = `${category}:${title}:${msg}`;
  const now = Date.now();
  if ((alertCooldowns.get(key) || 0) > now - 15000) return;
  alertCooldowns.set(key, now);

  const win = sender && !sender.isDestroyed() ? BrowserWindow.fromWebContents(sender) : BrowserWindow.getFocusedWindow();
  const detail = explainError(category, msg);
  dialog.showMessageBox(win || undefined, {
    type: "error",
    title,
    message: title,
    detail: detail === msg ? detail : `${detail}\n\n${mt("tech_detail")}: ${msg}`,
    buttons: [mt("ok")],
    noLink: true,
  }).catch(() => {});
}

const MIN_ZOOM_LEVEL = -4;
const MAX_ZOOM_LEVEL = 4;
const ZOOM_STEP = 0.5;

function setWindowZoom(win, nextLevel) {
  if (!win || win.isDestroyed()) return;
  const bounded = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, nextLevel));
  win.webContents.setZoomLevel(bounded);
}

function adjustWindowZoom(win, delta) {
  if (!win || win.isDestroyed()) return;
  setWindowZoom(win, win.webContents.getZoomLevel() + delta);
}

function setupWindowZoomShortcuts(win) {
  win.webContents.on("before-input-event", (event, input) => {
    if (!(input.control || input.meta) || input.alt) return;
    const key = String(input.key || "").toLowerCase();
    const code = String(input.code || "");
    if (key === "+" || key === "=" || code === "Equal" || code === "NumpadAdd") {
      event.preventDefault();
      adjustWindowZoom(win, ZOOM_STEP);
    } else if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") {
      event.preventDefault();
      adjustWindowZoom(win, -ZOOM_STEP);
    } else if (key === "0" || code === "Digit0" || code === "Numpad0") {
      event.preventDefault();
      setWindowZoom(win, 0);
    }
  });
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

function parseSshConfigHosts(contents) {
  const hosts = [];
  const seen = new Set();
  for (const rawLine of String(contents || "").split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    const match = line.match(/^Host\s+(.+)$/i);
    if (!match) continue;
    for (const host of match[1].trim().split(/\s+/)) {
      if (!host || host.startsWith("!") || /[*?]/.test(host) || seen.has(host)) continue;
      seen.add(host);
      hosts.push(host);
    }
  }
  return hosts.slice(0, 250);
}

function readSystemSshHosts() {
  try {
    return parseSshConfigHosts(fs.readFileSync(path.join(app.getPath("home"), ".ssh", "config"), "utf8"));
  } catch {
    return [];
  }
}

async function readWslSshHosts(distro) {
  const result = await checkCommand("wsl.exe", ["-d", distro, "--", "sh", "-lc", "test -r ~/.ssh/config && cat ~/.ssh/config"], { timeout:5000 });
  return result.available ? parseSshConfigHosts(result.detail) : [];
}

function checkSshAgent() {
  return new Promise(resolve => {
    execFile("ssh-add", ["-l"], { timeout:3000, windowsHide:true }, (error, stdout, stderr) => {
      if (!error) {
        const keyCount = String(stdout || "").split(/\r?\n/).filter(Boolean).length;
        resolve({ running:true, keysLoaded:keyCount > 0, keyCount });
        return;
      }
      const message = String(stderr || stdout || error.message || "").trim();
      const runningWithoutKeys = error.code === 1 && /no identities/i.test(message);
      resolve(runningWithoutKeys
        ? { running:true, keysLoaded:false, keyCount:0 }
        : { running:false, keysLoaded:false, keyCount:0 });
    });
  });
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
    wsl.sshHosts = Object.fromEntries(await Promise.all(
      wsl.distros.map(async distro => [distro, await readWslSshHosts(distro)])
    ));
  }

  ssh.hosts = ssh.available ? readSystemSshHosts() : [];
  ssh.agent = ssh.available ? await checkSshAgent() : { running:false, keysLoaded:false, keyCount:0 };

  return {
    platform: process.platform,
    docker,
    ssh,
    wsl,
  };
}

ipcMain.handle("system:capabilities", async (_event, options = {}) => {
  const caps = await getSystemCapabilities();
  if (!options?.silent) {
    for (const [name, cap] of Object.entries(caps)) {
      if (name === "platform") continue;
      logEntry(cap.available ? "INFO" : "WARN", "system",
        `${name}: ${cap.available ? "disponible" : cap.reason}`);
    }
  }
  return caps;
});

function loadSplashLogoDataUri() {
  const candidates = [
    path.join(__dirname, "src", "public", "lindecode-max.jpeg"),
    path.join(__dirname, "dist", "lindecode-max.jpeg"),
  ];
  for (const p of candidates) {
    try {
      const buf = fs.readFileSync(p);
      return `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch {}
  }
  return null;
}

/* ─── window ─── */
function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 360,
    height: 220,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#0a0a0a",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const logoDataUri = loadSplashLogoDataUri();

  const html = `<!doctype html>
    <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          * { box-sizing: border-box; }
          html, body { width: 100%; height: 100%; margin: 0; }
          body {
            display: grid; place-items: center; overflow: hidden;
            background: radial-gradient(circle at 50% 30%, #18242b 0, #0d1114 48%, #080909 100%);
            color: #d7e0e4; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
            user-select: none;
          }
          main { display: flex; flex-direction: column; align-items: center; }
          .mark {
            width: 62px; height: 62px; display: grid; place-items: center;
            border: 1px solid #2a7faa; border-radius: 15px; overflow: hidden;
            background: linear-gradient(145deg, #182c36, #0d171c);
            color: #65c7ef; font: 700 31px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
            box-shadow: 0 10px 35px rgba(0,0,0,.45), inset 0 0 24px rgba(42,127,170,.12);
          }
          .mark img { width: 100%; height: 100%; object-fit: cover; }
          h1 { margin: 14px 0 4px; font-size: 20px; letter-spacing: .7px; }
          p { margin: 0; color: #65737a; font-size: 12px; }
          .loader { width: 150px; height: 2px; margin-top: 22px; overflow: hidden; background: #182126; }
          .loader::after {
            content: ""; display: block; width: 45%; height: 100%; background: #3aa6d6;
            animation: loading 1.05s ease-in-out infinite;
          }
          @keyframes loading { from { transform: translateX(-110%); } to { transform: translateX(335%); } }
          @media (prefers-reduced-motion: reduce) { .loader::after { animation-duration: 2.5s; } }
        </style>
      </head>
      <body><main><div class="mark">${logoDataUri ? `<img src="${logoDataUri}" alt="LindeCode">` : "P"}</div><h1>PulpLog</h1><p>Abriendo aplicación…</p><div class="loader"></div></main></body>
    </html>`;

  splash.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
  splash.once("ready-to-show", () => {
    if (!splash.isDestroyed()) splash.show();
  });
  return splash;
}
function createWindow(splash = null) {
  const splashStartedAt = Date.now();
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500,
    show: false,
    backgroundColor: "#0a0a0a",
    icon: path.join(__dirname, "assets", "icon.png"),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let revealed = false;
  let revealDelayTimer = null;
  let revealFallback = null;
  const revealWindow = (force = false) => {
    if (revealed || win.isDestroyed()) return;
    const remaining = splash ? Math.max(0, 550 - (Date.now() - splashStartedAt)) : 0;
    if (!force && remaining > 0) {
      clearTimeout(revealDelayTimer);
      revealDelayTimer = setTimeout(() => revealWindow(), remaining);
      return;
    }
    revealed = true;
    clearTimeout(revealDelayTimer);
    clearTimeout(revealFallback);
    if (splash && !splash.isDestroyed()) splash.destroy();
    if (!IS_SMOKE_TEST) {
      win.show();
      win.focus();
    }
  };
  win.once("ready-to-show", () => revealWindow());
  win.webContents.once("did-fail-load", () => revealWindow(true));
  revealFallback = setTimeout(() => revealWindow(true), 12000);
  win.once("closed", () => {
    clearTimeout(revealFallback);
    clearTimeout(revealDelayTimer);
    if (splash && !splash.isDestroyed()) splash.destroy();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action:"deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const current = win.webContents.getURL();
    if (current && url !== current) event.preventDefault();
  });
  setupWindowZoomShortcuts(win);
  if (IS_DEV) { win.loadURL("http://localhost:5173"); win.webContents.openDevTools(); }
  else          win.loadFile(path.join(__dirname, "dist", "index.html"));
  buildMenu(win);
  loadSettings().then(settings => buildMenu(win, settings.recentFiles)).catch(() => {});
  return win;
}

function truncateMiddle(str, headLen = 10, tailLen = 5) {
  return str.length > headLen + tailLen ? `${str.slice(0, headLen)}.....${str.slice(-tailLen)}` : str;
}

function recentFileMenuLabel(filePath) {
  // Windows menus don't render `toolTip` as a hover tooltip, so the label itself
  // needs to carry enough of the path to disambiguate same-named files in
  // different folders — head + tail of the directory (and of the filename,
  // in case that alone is long) covers that without making the menu item
  // unreasonably wide.
  const base = truncateMiddle(path.basename(filePath), 35, 10);
  const dir = path.dirname(filePath).replace(/[\\/]+$/, "");
  if (!dir) return base;
  return `${truncateMiddle(dir)}${path.sep}${base}`;
}

function buildMenu(win, recentFiles = []) {
  const recentSubmenu = recentFiles.length
    ? recentFiles.slice(0, 10).map(filePath => ({
        label:recentFileMenuLabel(filePath),
        toolTip:filePath,
        click:async () => {
          try {
            const normalized = normalizeLocalPath(filePath);
            const stat = await fs.promises.stat(normalized);
            if (!stat.isFile()) throw new Error("Not a file");
            if (!win.isDestroyed()) win.webContents.send("menu:open-recent", normalized);
          } catch {
            dialog.showMessageBox(win, {
              type:"warning", title:mt("file_unavailable_title"),
              message:mt("file_unavailable_msg"), detail:filePath,
            });
          }
        },
      }))
    : [{ label:mt("no_recent"), enabled:false }];
  const template = [
    { label: mt("file"), submenu: [
      { label:mt("open_file"), accelerator:"CmdOrCtrl+O",
        click: () => win.webContents.send("menu:open-file") },
      { id:"open-recent", label:mt("open_recent"), submenu:recentSubmenu },
      { label:mt("new_tab"),  accelerator:"CmdOrCtrl+T",
        click: () => win.webContents.send("menu:new-tab") },
      { label:mt("close_tab"), accelerator:"CmdOrCtrl+W",
        click: () => win.webContents.send("global:close-tab") },
      { label:mt("reopen_tab"), accelerator:"CmdOrCtrl+Shift+T",
        click: () => win.webContents.send("global:reopen-tab") },
      { type:"separator" }, { role:"quit", label:mt("quit") },
    ]},
    { label: mt("view"), submenu: [
      { role:"reload", label:mt("reload") },
      { role:"toggleDevTools", label:mt("devtools") },
      { type:"separator" },
      { label:mt("zoom_reset"), accelerator:"CmdOrCtrl+0", click: () => setWindowZoom(win, 0) },
      { label:mt("zoom_in"), accelerator:"CmdOrCtrl+Plus", click: () => adjustWindowZoom(win, ZOOM_STEP) },
      { label:mt("zoom_out"), accelerator:"CmdOrCtrl+-", click: () => adjustWindowZoom(win, -ZOOM_STEP) },
      { type:"separator" }, { role:"togglefullscreen", label:mt("fullscreen") },
      { type:"separator" },
      { label:mt("split_right"), accelerator:"CmdOrCtrl+\\",
        click: () => win.webContents.send("menu:split-right") },
      { label:mt("split_down"), accelerator:"CmdOrCtrl+Shift+\\",
        click: () => win.webContents.send("menu:split-down") },
      { label:mt("split_close"), accelerator:"CmdOrCtrl+Alt+\\",
        click: () => win.webContents.send("menu:split-close") },
    ]},
    { label:mt("help"), submenu:[
      { label:mt("user_guide"), accelerator:"F1", click: () => win.webContents.send("menu:user-guide") },
      { label:mt("check_updates"), click: () => checkForUpdates(win) },
      { type:"separator" },
      { label:mt("github"), click: () => shell.openExternal("https://github.com/lindecode/PulpLog") },
      { type:"separator" },
      { label:mt("about"), click: () => win.webContents.send("menu:about") },
    ]},
  ];
  if (process.platform === "darwin")
    template.unshift({ label: app.name, submenu:[{role:"about"},{role:"hide"},{role:"quit"}] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function refreshApplicationMenu(settings) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) buildMenu(win, settings?.recentFiles || []);
}
/* ─── IPC: open dialog ─── */
ipcMain.handle("dialog:open", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: mt("open_log_dialog"),
    filters: [
      { name:mt("filter_logs"), extensions:["log","txt","out"] },
      { name:mt("filter_all"), extensions:["*"] },
    ],
    properties: ["openFile"],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle("dialog:ssh-key", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: mt("pick_ssh_key"),
    filters: [
      { name:mt("filter_ssh_keys"), extensions:["pem","key","*"] },
      { name:mt("filter_all"), extensions:["*"] },
    ],
    properties: ["openFile"],
  });
  return canceled ? null : filePaths[0];
});

/* ─── IPC: stat ─── */
ipcMain.handle("file:stat", async (event, requestedPath) => {
  assertTrustedSender(event);
  try {
    const filePath = normalizeLocalPath(requestedPath);
    const s = await fs.promises.stat(filePath);
    return { size: s.size, mtime: s.mtimeMs };
  }
  catch { return null; }
});

/* ─── IPC: stream read in 1 MB chunks ─── */
ipcMain.handle("file:read", async (event, payload) => {
  assertTrustedSender(event);
  const filePath = normalizeLocalPath(typeof payload === "string" ? payload : payload?.filePath);
  const readId = typeof payload === "string" ? filePath : payload?.readId;
  if (!filePath || !readId) throw new Error("Invalid file read request");

  return new Promise((resolve, reject) => {
    let bytesRead = 0;
    let settled = false;
    const decoder = new StringDecoder("utf8");
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024*1024 });
    activeReads.set(readId, stream);
    stream.on("data",  chunk => {
      bytesRead += chunk.length;
      event.sender.send("file:chunk", readId, decoder.write(chunk), bytesRead);
    });
    stream.on("end",   ()    => {
      settled = true;
      activeReads.delete(readId);
      const remainder = decoder.end();
      if (remainder) event.sender.send("file:chunk", readId, remainder, bytesRead);
      event.sender.send("file:done", readId, bytesRead);
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

/* ─── IPC: tail -f with rotation detection ───
 * Asynchronous, non-overlapping polling instead of fs.watch.
 * fs.watch is backed by a different native mechanism per OS
 * (inotify / FSEvents / ReadDirectoryChangesW) and each one can miss or
 * delay events depending on how the writer flushes, or on network/virtual
 * filesystems. Polling behaves identically on Windows/macOS/Linux and
 * keeps retrying the read every tick, so a transient share/lock failure
 * (e.g. another program briefly holding the file) just resolves on the
 * next poll instead of silently losing that chunk of data. */
const WATCH_POLL_MS = 400;

ipcMain.handle("file:watch", async (event, payload) => {
  assertTrustedSender(event);
  const filePath = normalizeLocalPath(typeof payload === "string" ? payload : payload?.filePath);
  const watchId = typeof payload === "string" ? filePath : payload?.watchId;
  const startOffset = Number.isFinite(payload?.startOffset) && payload.startOffset >= 0
    ? payload.startOffset
    : null;
  if (!filePath || !watchId) throw new Error("Invalid file watch request");

  stopWatch(watchId);
  logEntry("INFO", "file", `Iniciando watch: ${path.basename(filePath)}`);

  async function startWatcher() {
    const entry = {
      watcher: null,
      pollTimer: null,
      filePath,
      lastSize: 0,
      lastIno: null,
      stopped: false,
      decoder: new StringDecoder("utf8"),
    };
    watchers.set(watchId, entry);

    try {
      const stat = await fs.promises.stat(filePath);
      if (entry.stopped) return;
      entry.lastSize = startOffset === null ? stat.size : Math.min(startOffset, stat.size);
      entry.lastIno = stat.ino || null;
    } catch { /* the polling loop handles files that disappear during startup */ }

    const schedule = (delay = WATCH_POLL_MS) => {
      if (entry.stopped) return;
      clearTimeout(entry.pollTimer);
      entry.pollTimer = setTimeout(tick, delay);
    };

    const send = (channel, ...args) => {
      if (!entry.stopped && !event.sender.isDestroyed()) event.sender.send(channel, ...args);
    };

    const waitForRecreation = () => {
      if (entry.stopped) return;
      entry.pollTimer = setTimeout(async () => {
        if (entry.stopped) return;
        try {
          await fs.promises.access(filePath, fs.constants.R_OK);
          if (entry.stopped) return;
          const stat = await fs.promises.stat(filePath);
          entry.lastSize = stat.size;
          entry.lastIno = stat.ino || null;
          entry.decoder = new StringDecoder("utf8");
          logEntry("INFO", "file", `Archivo recreado: ${path.basename(filePath)}`);
          send("file:recreated", watchId, filePath);
          schedule();
        } catch {
          waitForRecreation();
        }
      }, 500);
    };

    const tick = async () => {
      if (entry.stopped) return;
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        logEntry("WARN", "file", `Archivo rotado: ${path.basename(filePath)}`);
        send("file:rotated", watchId, filePath);
        waitForRecreation();
        return;
      }

      if (entry.lastIno && stat.ino && stat.ino !== entry.lastIno) {
        entry.lastSize = stat.size;
        entry.lastIno = stat.ino;
        entry.decoder = new StringDecoder("utf8");
        logEntry("WARN", "file", `Archivo rotado: ${path.basename(filePath)}`);
        send("file:rotated", watchId, filePath);
        send("file:recreated", watchId, filePath);
        schedule();
        return;
      }

      if (stat.size < entry.lastSize) {
        entry.lastSize = 0;
        entry.decoder = new StringDecoder("utf8");
        logEntry("WARN", "file", `Archivo truncado: ${path.basename(filePath)}`);
        send("file:truncated", watchId, filePath);
        schedule();
        return;
      }
      if (stat.size === entry.lastSize) {
        schedule();
        return;
      }

      let handle;
      try {
        handle = await fs.promises.open(filePath, "r");
        const length = stat.size - entry.lastSize;
        const buf = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buf, 0, length, entry.lastSize);
        if (entry.stopped) return;
        entry.lastSize += bytesRead;
        entry.lastIno = stat.ino || entry.lastIno;
        const decoded = entry.decoder.write(buf.subarray(0, bytesRead));
        if (decoded) send("file:newlines", watchId, filePath, decoded);
      } catch {
        // The writer may lock the file briefly; keep the previous offset and retry.
      } finally {
        try { await handle?.close(); } catch {}
      }
      schedule();
    };

    schedule();
  }
  startWatcher();
  return true;
});

function stopWatch(watchId) {
  const entry = watchers.get(watchId);
  if (!entry) return;
  entry.stopped = true;
  try { entry.watcher && entry.watcher.close(); } catch {}
  if (entry.pollTimer) clearTimeout(entry.pollTimer);
  watchers.delete(watchId);
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

ipcMain.handle("export:text", async (event, payload) => {
  assertTrustedSender(event);
  const defaultPath = payload?.defaultPath || "pulplog-results.log";
  const content = String(payload?.content ?? "");
  if (Buffer.byteLength(content, "utf8") > 512 * 1024 * 1024) throw new Error("Export exceeds 512 MB");
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: mt("export_dialog"),
    defaultPath,
    filters: [
      { name:"Log", extensions:["log"] },
      { name:"Text", extensions:["txt"] },
      { name:mt("filter_all"), extensions:["*"] },
    ],
  });
  if (canceled || !filePath) return null;
  await fs.promises.writeFile(filePath, content, "utf8");
  logEntry("INFO", "file", `Resultados exportados: ${path.basename(filePath)}`);
  return filePath;
});

/* ─── Tab context menu ─── */
ipcMain.handle("tabmenu:show", (event, payload) => {
  const { tabId, paneId, filePath, hasContent, tabCount, canCloseRight, groupStart, x, y } = payload || {};

  function sendAction(action) {
    if (!event.sender.isDestroyed()) event.sender.send("tabmenu:action", { tabId, paneId, action });
  }

  const template = [];
  if (filePath) {
    template.push({ label: mt("open_location"), click: () => shell.showItemInFolder(filePath) });
    template.push({ label: mt("copy_path"), click: () => clipboard.writeText(filePath) });
    template.push({ type: "separator" });
  }
  if (hasContent) {
    template.push({ label: mt("duplicate_tab"), click: () => sendAction("duplicate") });
    template.push({ label: mt("reload_tab"), click: () => sendAction("reload") });
    template.push({ type: "separator" });
  }
  template.push({ label: mt("rename_tab"), click: () => sendAction("rename") });
  template.push({
    label: groupStart ? mt("group_start_off") : mt("group_start_on"),
    click: () => sendAction("toggle-group-start"),
  });
  template.push({ type: "separator" });
  template.push({ label: mt("close_others"), enabled: tabCount > 1, click: () => sendAction("close-others") });
  template.push({ label: mt("close_right"), enabled: !!canCloseRight, click: () => sendAction("close-right") });

  const win = BrowserWindow.fromWebContents(event.sender);
  Menu.buildFromTemplate(template).popup({ window: win || undefined, x, y });
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

ipcMain.handle("docker:list", async (event) => {
  logEntry("INFO", "docker", "Listando contenedores…");
  try {
    const result = await dockerGet("/containers/json?all=false");
    const count = Array.isArray(result) ? result.length : "?";
    logEntry("INFO", "docker", `Contenedores activos: ${count}`);
    return result;
  } catch (e) {
    logEntry("ERROR", "docker", `Error al listar contenedores: ${e.message}`);
    showErrorAlert(event.sender, "docker", mt("err_docker"), e.message);
    return { error: e.message };
  }
});

const dockerStreams = new Map(); // streamId → { proc, stopped }

ipcMain.handle("docker:logs:start", (event, payload) => {
  assertTrustedSender(event);
  const streamId = normalizeIdentifier(payload?.streamId, "stream id");
  const containerId = normalizeIdentifier(payload?.containerId, "container id");
  if (!streamId || !containerId) throw new Error("Invalid docker stream request");
  const shortId = containerId.slice(0, 12);
  logEntry("INFO", "docker", `Iniciando stream: ${shortId}`);
  stopDockerStream(streamId);

  const proc = spawn("docker", ["logs", "--follow", "--tail=500", containerId], {
    windowsHide: true,
    shell: false,
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
    if (complete.length) { hadLines = true; send("docker:lines", streamId, complete.join("\n")); }
  }

  proc.stdout.on("data", flushLines);
  proc.stderr.on("data", flushLines);

  proc.on("spawn", () => {
    logEntry("INFO", "docker", `Proceso iniciado: ${shortId}`);
    send("docker:spawned", streamId);
  });

  proc.on("close", (code) => {
    dockerStreams.delete(streamId);
    // Killed intentionally (tab closed, stop button, React StrictMode cleanup) — not an error
    if (stream.stopped) {
      logEntry("INFO", "docker", `Stream ${shortId} detenido`);
      return;
    }
    // code=null means killed by signal unexpectedly; actual errors have a non-zero exit code
    const isError = code !== null && code !== 0;
    if (isError && !hadLines) {
      logEntry("ERROR", "docker", `Stream ${shortId} terminó con código ${code}`);
      const msg = `docker logs terminó con código ${code}`;
      showErrorAlert(event.sender, "docker", mt("err_docker_logs"), msg);
      send("docker:error", streamId, msg);
    } else {
      logEntry("INFO", "docker", `Stream ${shortId} terminado (código ${code})`);
      send("docker:end", streamId);
    }
  });

  proc.on("error", (e) => {
    dockerStreams.delete(streamId);
    if (stream.stopped) return;
    logEntry("ERROR", "docker", `Error proceso ${shortId}: ${e.message}`);
    showErrorAlert(event.sender, "docker", mt("err_docker_logs"), e.message);
    send("docker:error", streamId, e.message);
  });

  dockerStreams.set(streamId, stream);
});

ipcMain.handle("docker:logs:stop", (_e, streamId) => {
  logEntry("INFO", "docker", `Stream detenido manualmente: ${streamId}`);
  stopDockerStream(streamId);
});

function stopDockerStream(streamId) {
  const stream = dockerStreams.get(streamId);
  if (!stream) return;
  stream.stopped = true;
  try { stream.proc.kill(); } catch {}
  dockerStreams.delete(streamId);
}

/* ─── Remote logs: SSH / WSL tail -F ─── */
const remoteStreams = new Map(); // streamId → { proc, stopped, label }
const REMOTE_READY_MARKER = "__PULPLOG_REMOTE_READY__";
const REMOTE_HISTORY_MARKER = "__PULPLOG_REMOTE_HISTORY__";

function quotePosixArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeTailLines(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 500;
  return Math.min(Math.max(n, 1), 10000);
}

function normalizeRemoteHistory(config) {
  const mode = ["lines", "bytes", "full"].includes(config?.historyMode) ? config.historyMode : "lines";
  const requestedMb = Number.parseInt(config?.maxInitialMb, 10);
  const maxMb = Math.min(Math.max(Number.isFinite(requestedMb) ? requestedMb : 100, 1), 200);
  return { mode, maxMb, maxBytes:maxMb * 1024 * 1024, tailLines:normalizeTailLines(config?.tailLines) };
}

function buildRemoteTailScript(config, filePath) {
  const history = normalizeRemoteHistory(config);
  const quotedPath = quotePosixArg(filePath);
  if (config?.resumeOnly)
    return `printf '${REMOTE_READY_MARKER}\\n'; exec tail -n 0 -F -- ${quotedPath}`;
  if (history.mode === "lines")
    return `printf '${REMOTE_READY_MARKER}\\n'; exec tail -n ${history.tailLines} -F -- ${quotedPath}`;
  return `size=$(wc -c < ${quotedPath} 2>/dev/null || printf -- -1); `
    + `printf '${REMOTE_HISTORY_MARKER}:${history.mode}:%s:${history.maxBytes}\\n' "$size"; `
    + `printf '${REMOTE_READY_MARKER}\\n'; exec tail -c ${history.maxBytes} -F -- ${quotedPath}`;
}

function normalizeFingerprint(value) {
  return String(value || "")
    .trim()
    .replace(/^SHA256:/i, "")
    .replace(/\s/g, "")
    .replace(/=+$/, "");
}

function formatHostFingerprint(key) {
  return `SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
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
  const mode = ["wsl", "ssh-wsl"].includes(config?.mode) ? config.mode : "ssh";
  const filePath = String(config?.filePath || "").trim();
  const tailScript = buildRemoteTailScript(config, filePath);
  if (!filePath) throw new Error("La ruta de la bitácora es obligatoria");

  if (mode === "wsl") {
    if (process.platform !== "win32") throw new Error("WSL2 solo esta disponible en Windows");
    const distro = String(config?.distro || "").trim();
    if (distro.startsWith("-")) throw new Error("Nombre de distro WSL inválido");
    const args = [];
    if (distro) args.push("-d", distro);
    args.push("--", "sh", "-lc", tailScript);
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

  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];
  if (port) args.push("-p", port);
  if (identityFile) args.push("-i", identityFile, "-o", "IdentitiesOnly=yes");
  const proxyJump = String(config?.proxyJump || "").trim();
  if (proxyJump) {
    if (proxyJump.startsWith("-") || /\s/.test(proxyJump)) throw new Error("Servidor intermedio inválido");
    args.push("-J", proxyJump);
  }
  const sshTarget = user && !target.includes("@") ? `${user}@${target}` : target;
  args.push(sshTarget, tailScript);
  if (mode === "ssh-wsl") {
    if (process.platform !== "win32") throw new Error("SSH desde WSL2 solo está disponible en Windows");
    const distro = String(config?.distro || "").trim();
    if (distro.startsWith("-")) throw new Error("Nombre de distro WSL inválido");
    const wslArgs = [];
    if (distro) wslArgs.push("-d", distro);
    wslArgs.push("--", "ssh", ...args);
    return { command:"wsl.exe", args:wslArgs, label:`WSL SSH:${distro || "default"}:${sshTarget}:${filePath}` };
  }
  return { command: "ssh", args, label: `${sshTarget}:${filePath}` };
}

function testSystemSsh(config) {
  const filePath = String(config?.filePath || "").trim();
  if (!filePath) return Promise.reject(new Error("La ruta de la bitácora es obligatoria"));
  const { target, user, port, identityFile } = { ...validateSshTarget(config), user:String(config?.user || "").trim(), port:String(config?.port || "").trim() };
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"];
  if (port) args.push("-p", port);
  if (identityFile) args.push("-i", identityFile, "-o", "IdentitiesOnly=yes");
  const proxyJump = String(config?.proxyJump || "").trim();
  if (proxyJump) {
    if (proxyJump.startsWith("-") || /\s/.test(proxyJump)) return Promise.reject(new Error("Servidor intermedio inválido"));
    args.push("-J", proxyJump);
  }
  const sshTarget = user && !target.includes("@") ? `${user}@${target}` : target;
  args.push(sshTarget, `command -v tail >/dev/null && test -r ${quotePosixArg(filePath)}`);
  let command = "ssh";
  let commandArgs = args;
  if (config?.mode === "ssh-wsl") {
    if (process.platform !== "win32") return Promise.reject(new Error("SSH desde WSL2 solo está disponible en Windows"));
    const distro = String(config?.distro || "").trim();
    if (distro.startsWith("-")) return Promise.reject(new Error("Nombre de distro WSL inválido"));
    command = "wsl.exe";
    commandArgs = [...(distro ? ["-d", distro] : []), "--", "ssh", ...args];
  }
  return new Promise((resolve, reject) => {
    execFile(command, commandArgs, { timeout:15000, windowsHide:true }, (error, _stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim()));
      resolve({ ok:true, fingerprint:null });
    });
  });
}

function testNativeSsh(config) {
  const filePath = String(config?.filePath || "").trim();
  const { host, username:requestedUsername, port, identityFile } = validateSshTarget(config);
  const expectedFingerprint = normalizeFingerprint(config?.fingerprint);
  const trustHostForSession = Boolean(config?.trustHostForSession);
  const discoveringHost = !expectedFingerprint && !trustHostForSession;
  if (!discoveringHost && !filePath) return Promise.reject(new Error("La ruta de la bitácora es obligatoria"));
  const username = requestedUsername || (discoveringHost ? (process.env.USERNAME || "pulplog") : "");
  if (!username) return Promise.reject(new Error("El usuario SSH es obligatorio para validar el acceso"));
  const password = String(config?.password || "");
  const passphrase = String(config?.passphrase || "");
  if (!discoveringHost && !password && !identityFile)
    return Promise.reject(new Error("Ingresa contraseña o llave privada para validar el acceso"));
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;
    let seenFingerprint = "";
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch {}
      error ? reject(error) : resolve(result);
    };
    const connection = {
      host, port, username, password:password || undefined,
      readyTimeout:12000, keepaliveInterval:15000, keepaliveCountMax:3,
      tryKeyboard:false,
      hostVerifier(key) {
        seenFingerprint = formatHostFingerprint(key);
        if (expectedFingerprint) return normalizeFingerprint(seenFingerprint) === expectedFingerprint;
        return trustHostForSession;
      },
    };
    if (identityFile) {
      connection.privateKey = fs.readFileSync(identityFile);
      if (passphrase) connection.passphrase = passphrase;
    }
    client.once("ready", () => client.exec(
      `command -v tail >/dev/null && test -r ${quotePosixArg(filePath)}`,
      (error, channel) => {
        if (error) return finish(error);
        let stderr = "";
        channel.stderr.on("data", data => { stderr += data.toString("utf8"); });
        channel.on("close", code => code === 0
          ? finish(null, { ok:true, fingerprint:seenFingerprint })
          : finish(new Error(stderr.trim() || `Validación remota terminó con código ${code}`)));
      }
    ));
    client.once("error", error => {
      const hint = seenFingerprint && !expectedFingerprint
        ? ` Huella (fingerprint) del servidor: ${seenFingerprint}` : "";
      finish(new Error(`${error.message}${hint}`));
    });
    client.connect(connection);
  });
}

function startNativeSshStream(event, payload) {
  const streamId = payload?.streamId;
  const filePath = String(payload?.filePath || "").trim();
  const tailScript = buildRemoteTailScript(payload, filePath);
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
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
    tryKeyboard: false,
    hostVerifier(key) {
      seenFingerprint = formatHostFingerprint(key);
      if (expectedFingerprint) return normalizeFingerprint(seenFingerprint) === expectedFingerprint;
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
  let stderrBuf = "";
  let hadLines = false;
  let dropFirstHistoryLine = false;
  let historyExpected = 0;
  let historyReceived = 0;
  let lastHistoryProgress = 0;

  function send(ch, ...args) {
    if (!event.sender.isDestroyed()) event.sender.send(ch, ...args);
  }

  function flushLines(data) {
    if (historyExpected > 0) historyReceived += data.length;
    lineBuf += data.toString("utf8");
    const parts = lineBuf.split("\n");
    lineBuf = parts.pop();
    const complete = parts.filter(Boolean).filter(line => {
      const history = line.trim().match(/^__PULPLOG_REMOTE_HISTORY__:(lines|bytes|full):(-?\d+):(\d+)$/);
      if (history) {
        const size = Number(history[2]);
        const limit = Number(history[3]);
        send("remote:history", streamId, { mode:history[1], size, limit });
        dropFirstHistoryLine = size > limit;
        historyExpected = size >= 0 ? Math.min(size, limit) : 0;
        historyReceived = Math.min(data.length, historyExpected);
        return false;
      }
      if (dropFirstHistoryLine) { dropFirstHistoryLine = false; return false; }
      return line.trim() !== REMOTE_READY_MARKER;
    });
    if (complete.length) {
      hadLines = true;
      send("remote:lines", streamId, complete.join("\n"));
    }
    if (historyExpected > 0) {
      const percent = Math.min(100, Math.round(historyReceived * 100 / historyExpected));
      if (percent === 100 || percent >= lastHistoryProgress + 2) {
        lastHistoryProgress = percent;
        send("remote:progress", streamId, { received:Math.min(historyReceived, historyExpected), total:historyExpected, percent });
      }
      if (percent === 100) historyExpected = 0;
    }
  }

  client.on("ready", () => {
    logEntry("INFO", "remote", `SSH nativo conectado: ${label}`);
    client.exec(tailScript, (err, channel) => {
      if (err) {
        remoteStreams.delete(streamId);
        showErrorAlert(event.sender, "remote", mt("err_remote"), err.message);
        send("remote:error", streamId, err.message);
        client.end();
        return;
      }
      stream.channel = channel;
      send("remote:spawned", streamId);
      channel.on("data", flushLines);
      channel.stderr.on("data", data => { stderrBuf += data.toString("utf8"); });
      channel.on("close", (code) => {
        remoteStreams.delete(streamId);
        client.end();
        if (stream.stopped) {
          logEntry("INFO", "remote", `SSH nativo detenido: ${label}`);
          return;
        }
        if (code) {
          const msg = stderrBuf.trim() || `tail terminó con código ${code}`;
          logEntry("ERROR", "remote", `${label}: ${msg}`);
          showErrorAlert(event.sender, "remote", mt("err_remote"), msg);
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
    const fingerprintHint = seenFingerprint ? ` Huella (fingerprint) del servidor: ${seenFingerprint}` : "";
    const msg = `${e.message}${fingerprintHint}`;
    logEntry("ERROR", "remote", `${label}: ${msg}`);
    showErrorAlert(event.sender, "remote", mt("err_ssh"), msg);
    send("remote:error", streamId, msg);
  });

  client.on("end", () => {
    if (!stream.stopped) logEntry("INFO", "remote", `SSH nativo desconectado: ${label}`);
  });

  remoteStreams.set(streamId, stream);
  logEntry("INFO", "remote", `Iniciando SSH nativo: ${label}`);
  client.connect(config);
  // ssh2 copies password/passphrase into its own internal config synchronously
  // during connect(), so our local copies are no longer needed. privateKey is
  // kept by reference and parsed later during auth, so it must not be cleared here.
  config.password = null;
  config.passphrase = null;
}

ipcMain.handle("remote:logs:start", (event, payload) => {
  assertTrustedSender(event);
  const streamId = normalizeIdentifier(payload?.streamId, "stream id");
  if (!streamId) throw new Error("Invalid remote stream request");
  stopRemoteStream(streamId);

  if (payload?.mode === "ssh-native") {
    try {
      startNativeSshStream(event, payload);
    } catch (e) {
      showErrorAlert(event.sender, "remote", mt("err_ssh"), e.message);
      event.sender.send("remote:error", streamId, e.message);
    }
    return;
  }

  let spec;
  try {
    spec = buildRemoteCommand(payload);
  } catch (e) {
    showErrorAlert(event.sender, "remote", mt("err_remote"), e.message);
    event.sender.send("remote:error", streamId, e.message);
    return;
  }

  logEntry("INFO", "remote", `Iniciando stream remoto: ${spec.label}`);
  const proc = spawn(spec.command, spec.args, { windowsHide: true });
  const stream = { proc, stopped: false, label: spec.label };
  let lineBuf = "";
  let stderrBuf = "";
  let hadLines = false;
  let remoteReady = false;
  let dropFirstHistoryLine = false;
  let historyExpected = 0;
  let historyReceived = 0;
  let lastHistoryProgress = 0;

  function send(ch, ...args) {
    if (!event.sender.isDestroyed()) event.sender.send(ch, ...args);
  }

  function flushLines(data) {
    if (historyExpected > 0) historyReceived += data.length;
    lineBuf += data.toString("utf8");
    const parts = lineBuf.split("\n");
    lineBuf = parts.pop();
    const complete = parts.filter(Boolean).filter(line => {
      const history = line.trim().match(/^__PULPLOG_REMOTE_HISTORY__:(lines|bytes|full):(-?\d+):(\d+)$/);
      if (history) {
        const size = Number(history[2]);
        const limit = Number(history[3]);
        send("remote:history", streamId, { mode:history[1], size, limit });
        dropFirstHistoryLine = size > limit;
        historyExpected = size >= 0 ? Math.min(size, limit) : 0;
        historyReceived = Math.min(data.length, historyExpected);
        return false;
      }
      if (dropFirstHistoryLine) { dropFirstHistoryLine = false; return false; }
      if (line.trim() !== REMOTE_READY_MARKER) return true;
      if (!remoteReady) {
        remoteReady = true;
        send("remote:spawned", streamId);
      }
      return false;
    });
    if (complete.length) {
      hadLines = true;
      send("remote:lines", streamId, complete.join("\n"));
    }
    if (historyExpected > 0) {
      const percent = Math.min(100, Math.round(historyReceived * 100 / historyExpected));
      if (percent === 100 || percent >= lastHistoryProgress + 2) {
        lastHistoryProgress = percent;
        send("remote:progress", streamId, { received:Math.min(historyReceived, historyExpected), total:historyExpected, percent });
      }
      if (percent === 100) historyExpected = 0;
    }
  }

  proc.stdout.on("data", flushLines);
  proc.stderr.on("data", data => { stderrBuf += data.toString("utf8"); });

  proc.on("spawn", () => {
    logEntry("INFO", "remote", `Proceso iniciado: ${spec.label}`);
  });

  proc.on("close", (code) => {
    remoteStreams.delete(streamId);
    if (stream.stopped) {
      logEntry("INFO", "remote", `Stream remoto detenido: ${spec.label}`);
      return;
    }
    const isError = code !== null && code !== 0;
    if (isError) {
      const msg = stderrBuf.trim() || `${spec.command} terminó con código ${code}`;
      logEntry("ERROR", "remote", `${spec.label}: ${msg}`);
      showErrorAlert(event.sender, "remote", mt("err_remote"), msg);
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
    showErrorAlert(event.sender, "remote", mt("err_remote"), e.message);
    send("remote:error", streamId, e.message);
  });

  remoteStreams.set(streamId, stream);
});

ipcMain.handle("remote:test", async (event, payload) => {
  assertTrustedSender(event);
  try {
    return payload?.mode === "ssh-native"
      ? await testNativeSsh(payload)
      : await testSystemSsh(payload);
  } catch (error) {
    return { ok:false, error:error?.message ?? String(error) };
  }
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
function normalizePaneTabs(tabsArr) {
  return Array.isArray(tabsArr)
    ? tabsArr
        .filter(t => t && typeof t.filePath === "string")
        .map(t => ({
          filePath: t.filePath,
          label: typeof t.label === "string" ? t.label : path.basename(t.filePath),
          fileSize: Number.isFinite(t.fileSize) ? t.fileSize : null,
          groupStart: Boolean(t.groupStart),
        }))
    : [];
}

function normalizeRemoteProfiles(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).filter(profile => profile && typeof profile === "object").map((profile, index) => ({
    id: typeof profile.id === "string" && profile.id ? profile.id.slice(0, 80) : `profile-${index}`,
    name: typeof profile.name === "string" ? profile.name.slice(0, 80) : "SSH",
    mode: ["ssh", "ssh-wsl", "ssh-native", "wsl"].includes(profile.mode) ? profile.mode : "ssh",
    target: typeof profile.target === "string" ? profile.target.slice(0, 255) : "",
    user: typeof profile.user === "string" ? profile.user.slice(0, 128) : "",
    port: typeof profile.port === "string" ? profile.port.slice(0, 5) : "",
    identityFile: typeof profile.identityFile === "string" ? profile.identityFile.slice(0, 32767) : "",
    fingerprint: typeof profile.fingerprint === "string" ? profile.fingerprint.slice(0, 160) : "",
    proxyJump: typeof profile.proxyJump === "string" ? profile.proxyJump.slice(0, 255) : "",
    distro: typeof profile.distro === "string" ? profile.distro.slice(0, 160) : "",
    filePath: typeof profile.filePath === "string" ? profile.filePath.slice(0, 4096) : "",
    tailLines: normalizeTailLines(profile.tailLines),
    historyMode: ["lines", "bytes", "full"].includes(profile.historyMode) ? profile.historyMode : "lines",
    maxInitialMb: normalizeRemoteHistory(profile).maxMb,
  }));
}

function normalizeSettings(value) {
  const s = value && typeof value === "object" ? value : {};
  const language = ["es", "en"].includes(s.language) ? s.language : "es";
  const theme = ["classic", "light", "vscode", "ember", "blue"].includes(s.theme) ? s.theme : "classic";
  const skippedUpdateVersion = parseReleaseVersion(s.skippedUpdateVersion) ? String(s.skippedUpdateVersion).trim() : "";

  let panes;
  if (Array.isArray(s.panes)) {
    panes = s.panes.slice(0, 2).map(p => ({ tabs: normalizePaneTabs(p?.tabs) }));
  } else if (Array.isArray(s.sessionTabs)) {
    // migration: pre-split-view flat sessionTabs → single pane
    panes = [{ tabs: normalizePaneTabs(s.sessionTabs) }];
  } else {
    panes = [{ tabs: [] }];
  }
  if (panes.length === 0) panes = [{ tabs: [] }];

  const splitDirection = ["row", "column"].includes(s.splitDirection) && panes.length === 2
    ? s.splitDirection
    : null;
  const splitRatio = Number.isFinite(s.splitRatio) ? Math.min(Math.max(s.splitRatio, 0.15), 0.85) : 0.5;
  const maxLiveLines = Number.isFinite(s.maxLiveLines)
    ? Math.min(Math.max(Math.round(s.maxLiveLines), 50_000), 2_000_000)
    : 500_000;

  return {
    recentFiles: Array.isArray(s.recentFiles) ? s.recentFiles.filter(f => typeof f === "string") : [],
    remoteProfiles: normalizeRemoteProfiles(s.remoteProfiles),
    panes,
    splitDirection,
    splitRatio,
    autoScrollDefault: Boolean(s.autoScrollDefault),
    showNumsDefault: s.showNumsDefault !== false,
    maxLiveLines,
    language,
    theme,
    skippedUpdateVersion,
  };
}
async function loadSettings() {
  try { return normalizeSettings(JSON.parse(await fs.promises.readFile(getSettingsPath(), "utf8"))); }
  catch { return normalizeSettings({}); }
}

let settingsWriteQueue = Promise.resolve();
function updateSettings(mutator) {
  const operation = settingsWriteQueue.then(async () => {
    const current = await loadSettings();
    const next = normalizeSettings(await mutator(current));
    currentLanguage = next.language;
    const target = getSettingsPath();
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.promises.mkdir(path.dirname(target), { recursive:true });
    await fs.promises.writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
    await fs.promises.rename(temporary, target);
    return next;
  });
  settingsWriteQueue = operation.catch(err => {
    logEntry("ERROR", "settings", `No se pudo guardar la configuración: ${err.message}`);
  });
  return operation;
}

ipcMain.handle("settings:get", async () => {
  await settingsWriteQueue;
  return loadSettings();
});
ipcMain.handle("settings:set", (_event, data) =>
  updateSettings(current => ({ ...current, ...(data && typeof data === "object" ? data : {}) }))
    .then(settings => { refreshApplicationMenu(settings); return settings; })
);
ipcMain.handle("recentfiles:add", (_event, fp) => updateSettings(current => {
  if (typeof fp !== "string" || !fp) return current;
  const recent = (current.recentFiles || []).filter(file => file !== fp);
  recent.unshift(fp);
  return { ...current, recentFiles:recent.slice(0, 10) };
}).then(settings => {
  refreshApplicationMenu(settings);
  return settings.recentFiles;
}));
ipcMain.handle("recentfiles:remove", (_event, fp) => updateSettings(current => ({
  ...current,
  recentFiles:(current.recentFiles || []).filter(file => file !== fp),
})).then(settings => {
  refreshApplicationMenu(settings);
  return settings.recentFiles;
}));
/* ─── IPC: app diagnostics log ─── */
ipcMain.handle("applog:get",   () => [...appLogEntries]);
ipcMain.handle("applog:clear", () => { appLogEntries.length = 0; });
ipcMain.handle("applog:add",   (_e, level, category, msg) => logEntry(level, category, msg));
ipcMain.handle("diagnostics:metric", (_event, data) => {
  const name = typeof data?.name === "string" ? data.name.slice(0, 40) : "metric";
  const value = Number(data?.value);
  const detail = typeof data?.detail === "string" ? data.detail.slice(0, 160) : "";
  if (!Number.isFinite(value)) return false;
  logEntry("INFO", "performance", `${name}: ${value.toFixed(1)} ms${detail ? ` · ${detail}` : ""}`);
  return true;
});
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
    "Super+A": mt("win_conflict_a"),
    "Super+T": mt("win_conflict_t"),
    "Super+W": mt("win_conflict_w"),
  };

  const shortcuts = [
    {
      key:   "Super+A",
      label: mt("shortcut_open_file"),
      action: () => { bringToFront(win); win.webContents.send("menu:open-file"); },
    },
    {
      key:   "Super+T",
      label: mt("shortcut_new_tab"),
      action: () => { bringToFront(win); win.webContents.send("menu:new-tab"); },
    },
    {
      key:   "Super+W",
      label: mt("shortcut_close_tab"),
      action: () => { bringToFront(win); win.webContents.send("global:close-tab"); },
    },
    {
      key:   "Super+Shift+T",
      label: mt("shortcut_reopen_tab"),
      action: () => { bringToFront(win); win.webContents.send("global:reopen-tab"); },
    },
    {
      key:   "Super+P",
      label: mt("shortcut_bring_front"),
      action: () => bringToFront(win),
    },
  ];

  for (const { key, label, action } of shortcuts) {
    const ok = globalShortcut.register(key, action);
    if (ok) {
      logEntry("INFO", "shortcuts", `${label} [${key}]: ${mt("shortcut_registered")}`);
    } else {
      const hint = isWin && WIN_CONFLICTS[key] ? ` — ${WIN_CONFLICTS[key]}` : "";
      logEntry("WARN", "shortcuts", `${label} [${key}]: ${mt("shortcut_unavailable")}${hint}`);
    }
  }
}

/* ─── lifecycle ─── */
app.whenReady().then(async () => {
  currentLanguage = (await loadSettings().catch(() => null))?.language || "es";
  const splash = IS_SMOKE_TEST ? null : createSplashWindow();
  const win = createWindow(splash);
  if (!IS_SMOKE_TEST) registerShortcuts(win);
  if (IS_SMOKE_TEST) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const smokeFile = JSON.stringify(process.env.PULPLOG_SMOKE_FILE || "");
          const result = await win.webContents.executeJavaScript(`(async () => {
            const stat = await window.electronAPI.statFile(${smokeFile});
            const readText = await new Promise((resolve, reject) => {
              let text = "";
              window.electronAPI.readFile(${smokeFile}, {
                onChunk: chunk => { text += chunk; },
                onDone: () => resolve(text),
                onError: reject,
              });
            });
            await window.electronAPI.setSettings({ maxLiveLines:250000 });
            const settings = await window.electronAPI.getSettings();
            return {
              hasRoot: document.querySelector("#root")?.childElementCount > 0,
              hasPreload: typeof window.electronAPI?.statFile === "function",
              sandboxed: typeof process === "undefined",
              statSize: stat?.size,
              readMatches: readText === "INFO ready\\n",
              settingsPersisted: settings?.maxLiveLines === 250000
            };
          })()`);
          const recentMenu = Menu.getApplicationMenu()?.getMenuItemById("open-recent");
          if (!result.hasRoot || !result.hasPreload || !result.sandboxed ||
              result.statSize !== 11 || !result.readMatches || !result.settingsPersisted ||
              !recentMenu?.submenu) throw new Error(JSON.stringify(result));
          console.log("PULPLOG_SMOKE_OK");
          app.exit(0);
        } catch (error) {
          console.error("PULPLOG_SMOKE_FAILED", error);
          app.exit(1);
        }
      }, 250);
    });
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  activeReads.forEach((stream) => { try { stream.destroy(); } catch {} });
  activeReads.clear();
  watchers.forEach((e) => {
    e.stopped = true;
    try { e.watcher && e.watcher.close(); } catch {}
    if (e.pollTimer) clearTimeout(e.pollTimer);
  });
  watchers.clear();
  dockerStreams.forEach((_e, id) => stopDockerStream(id));
  remoteStreams.forEach((_e, id) => stopRemoteStream(id));
  if (process.platform !== "darwin") app.quit();
});
