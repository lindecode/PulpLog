// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Passwords for the system OpenSSH client (Windows or inside WSL) via SSH_ASKPASS.
//
// OpenSSH with SSH_ASKPASS_REQUIRE=force runs SSH_ASKPASS with the prompt as
// argument and reads the answer from its stdout. Our helper is PulpLog itself in
// Node mode: it sends {token, prompt} over a local pipe and prints the answer.
// The secret never travels in arguments, environment variables or files; the
// environment only carries the pipe name and a one-time token per connection.
//
// Answer policy (security):
//  - the saved password is only given to the host it belongs to: a jump host
//    asking for "its" password gets the user dialog, never the destination's secret;
//  - each secret is given once: a second identical prompt means it was rejected,
//    so we stop instead of letting ssh retry with a wrong secret;
//  - host key questions are never answered "yes" automatically;
//  - anything else (2FA codes, other hops, missing secrets) goes to the user.
const net = require("net");
const crypto = require("crypto");

const MAX_PROMPT = 1000;

/* What is OpenSSH asking for? */
function classifyPrompt(raw) {
  const prompt = String(raw || "").slice(0, MAX_PROMPT);
  const text = prompt.trim();
  // "deploy@prod-api's password:"  ·  "(deploy@prod-api) Password:" (keyboard-interactive)
  const who = text.match(/^\(?([^\s@()']+)@([^\s()']+?)\)?(?:'s)?\s+password:?\s*$/i);
  if (who) return { kind: "password", user: who[1], host: who[2], prompt };
  if (/^password:?\s*$/i.test(text)) return { kind: "password", prompt };
  if (/passphrase for key/i.test(text)) return { kind: "passphrase", prompt };
  if (/continue connecting|authenticity of host|host key/i.test(text)) return { kind: "hostkey", prompt };
  return { kind: "other", prompt }; // "Verification code:", "OTP:", Duo menus…
}

/* host as OpenSSH prints it: "prod-api", "[10.0.0.5]:2222", "10.0.0.5" */
const sameHost = (a, b) => {
  const clean = value => String(value || "").toLowerCase().replace(/^\[|\](:\d+)?$/g, "");
  return !!a && !!b && clean(a) === clean(b);
};

function createAskpassBroker({ pipePath, askUser = async () => null, log = () => {} } = {}) {
  const sessions = new Map(); // token → session
  let server = null;
  let ready = null;

  function start() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      server = net.createServer(socket => {
        let buffer = "";
        socket.setEncoding("utf8");
        socket.setTimeout(180000, () => socket.destroy());
        socket.on("data", chunk => {
          buffer += chunk;
          if (buffer.length > 8192) return socket.destroy();
          const newline = buffer.indexOf("\n");
          if (newline < 0) return;
          let request;
          try { request = JSON.parse(buffer.slice(0, newline)); } catch { return socket.destroy(); }
          answer(request).then(reply => {
            socket.end(`${JSON.stringify(reply == null ? { cancel: true } : { answer: String(reply) })}\n`);
          }, () => socket.end(`${JSON.stringify({ cancel: true })}\n`));
        });
        socket.on("error", () => {});
      });
      server.on("error", reject);
      server.listen(pipePath, () => resolve(pipePath));
    });
    return ready;
  }

  async function answer(request) {
    const session = sessions.get(String(request?.token || ""));
    if (!session) return null; // unknown or expired token
    const info = classifyPrompt(request?.prompt);
    const seen = session.asked.get(info.prompt) || 0;
    session.asked.set(info.prompt, seen + 1);

    if (info.kind === "hostkey") return "no";
    if (info.kind === "password" && session.password) {
      // only the destination's own prompt; with no host in the prompt, only when there are no jumps
      const forDestination = info.host ? sameHost(info.host, session.host) && (!info.user || !session.user || info.user === session.user)
        : !session.hasJumps;
      if (forDestination) {
        if (seen > 0) { log("WARN", "askpass", `Contraseña rechazada por ${session.label}`); session.rejected = true; return null; }
        session.used = true;
        return session.password;
      }
    }
    if (info.kind === "passphrase" && session.passphrase) {
      if (seen > 0) { session.rejected = true; return null; }
      session.used = true;
      return session.passphrase;
    }
    if (seen > 2) return null; // the same question again and again: stop
    return askUser({ label: session.label, prompt: info.prompt, kind: info.kind, host: info.host || null }, session);
  }

  /* One registration per ssh process. Returns the env OpenSSH needs and a dispose(). */
  function register({ password = "", passphrase = "", user = "", host = "", hasJumps = false, label = "", owner = null } = {}) {
    const token = crypto.randomBytes(24).toString("hex");
    const session = { password, passphrase, user, host, hasJumps, owner, label: label || `${user ? `${user}@` : ""}${host}`, asked: new Map(), rejected: false, used: false };
    sessions.set(token, session);
    return {
      token,
      session,
      dispose() {
        session.password = "";
        session.passphrase = "";
        sessions.delete(token);
      },
    };
  }

  function close() {
    sessions.clear();
    if (server) server.close();
    server = null;
    ready = null;
  }

  return { start, register, close, answer, get size() { return sessions.size; } };
}

/* The helper OpenSSH runs (PulpLog's executable with ELECTRON_RUN_AS_NODE=1). */
const HELPER_SOURCE = `// Generated by PulpLog: SSH_ASKPASS helper. Holds no secrets.
const net = require("net");
const raw = process.env.PULPLOG_ASKPASS_PIPE || "", token = process.env.PULPLOG_ASKPASS_TOKEN;
if (!raw || !token) process.exit(1);
// Windows pipes travel as a bare name: WSLENV mangles the leading backslashes
const pipe = process.platform === "win32" && /^[\\w.-]+$/.test(raw) ? "\\\\\\\\.\\\\pipe\\\\" + raw : raw;
const socket = net.connect(pipe);
let data = "";
socket.setEncoding("utf8");
socket.setTimeout(190000, () => process.exit(1));
socket.on("connect", () => socket.write(JSON.stringify({ token, prompt: process.argv.slice(2).join(" ") }) + "\\n"));
socket.on("data", chunk => { data += chunk; });
socket.on("end", () => {
  try {
    const reply = JSON.parse(data.split("\\n")[0]);
    if (reply.cancel || typeof reply.answer !== "string") process.exit(1);
    process.stdout.write(reply.answer + "\\n", () => process.exit(0));
  } catch { process.exit(1); }
});
socket.on("error", () => process.exit(1));
`;

/* Windows: SSH_ASKPASS must be one path → a .cmd that starts the helper. */
const windowsWrapper = (execPath, helperPath) => `@echo off\r\n"${execPath}" "${helperPath}" %*\r\n`;

/* WSL: a shell script (on /mnt/c) that starts the Windows helper through interop. */
const wslWrapper = (execPathInWsl, helperWindowsPath) =>
  `#!/bin/sh\n# Generated by PulpLog: SSH_ASKPASS helper for WSL. Holds no secrets.\nexec '${execPathInWsl.replace(/'/g, "'\\''")}' '${helperWindowsPath.replace(/'/g, "'\\''")}' "$@"\n`;

/* Env for the ssh process (Windows) or for wsl.exe (forwarded with WSLENV). */
function askpassEnv({ askpassPath, pipePath, token, viaWsl = false, baseEnv = process.env }) {
  // a Windows pipe goes as its bare name (the helper adds \\.\pipe\): WSLENV eats leading backslashes
  const pipeValue = String(pipePath).replace(/^\\\\[.?]\\pipe\\/i, "");
  const vars = {
    SSH_ASKPASS: askpassPath,
    SSH_ASKPASS_REQUIRE: "force",
    DISPLAY: baseEnv.DISPLAY || "pulplog:0",
    ELECTRON_RUN_AS_NODE: "1",
    PULPLOG_ASKPASS_PIPE: pipeValue,
    PULPLOG_ASKPASS_TOKEN: token,
  };
  if (!viaWsl) return { ...baseEnv, ...vars };
  // SSH_ASKPASS/p: wsl.exe translates the Windows path; the rest pass through as-is
  const shared = ["SSH_ASKPASS/p", "SSH_ASKPASS_REQUIRE", "DISPLAY", "ELECTRON_RUN_AS_NODE", "PULPLOG_ASKPASS_PIPE", "PULPLOG_ASKPASS_TOKEN"];
  const existing = String(baseEnv.WSLENV || "").split(":").filter(Boolean);
  return { ...baseEnv, ...vars, WSLENV: [...existing, ...shared].join(":") };
}

module.exports = { classifyPrompt, createAskpassBroker, askpassEnv, HELPER_SOURCE, windowsWrapper, wslWrapper };
