// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// What to read on a remote server, beyond plain files: journalctl, reading as root with sudo,
// and the text encoding of the log. Pure helpers (no I/O) so they can be unit-tested.
"use strict";

const ENCODINGS = ["utf-8", "windows-1252", "iso-8859-15"];
const SUDO_MODES = ["", "nopasswd", "password"];

const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

function normalizeEncoding(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "latin1" || text === "latin-1" || text === "iso-8859-1") return "windows-1252"; // WHATWG maps latin1 to cp1252
  return ENCODINGS.includes(text) ? text : "utf-8";
}

function normalizeSudo(value) {
  return SUDO_MODES.includes(value) ? value : "";
}

/** systemd unit names: letters, digits and @ . _ : - \ (escaped instances); empty = whole journal. */
function normalizeJournalUnit(value) {
  const unit = String(value || "").trim();
  if (!unit) return "";
  if (unit.length > 256 || unit.startsWith("-") || !/^[A-Za-z0-9@._:\\-]+$/.test(unit))
    throw new Error("Nombre de unidad de journalctl inválido");
  return unit;
}

/**
 * journalctl script: emits the ready marker, then the history and follows.
 * -o short-iso gives full dates with offset, so the timeline and merging work across days.
 */
function journalScript(config, readyMarker) {
  const unit = normalizeJournalUnit(config?.journalUnit);
  const lines = Math.min(Math.max(Number.parseInt(config?.tailLines, 10) || 500, 1), 100000);
  const unitArg = unit ? ` -u ${quote(unit)}` : "";
  const base = `journalctl --no-pager -o short-iso${unitArg}`;
  const check = `if ! command -v journalctl >/dev/null 2>&1; then printf 'journalctl no está disponible en el servidor\\n' >&2; exit 127; fi; `
    + `printf '${readyMarker}\\n'; `;
  if (config?.resumeOnly) return `${check}exec ${base} -n 0 -f`;
  // `-u X -n N -f` prints nothing on some systemd versions (seen with 255): read the history with
  // its cursor, then follow from that cursor, so no entry is lost or repeated in between.
  return `${check}T=$(mktemp) || exit 1; `
    + `${base} -n ${lines} --show-cursor | while IFS= read -r l; do case "$l" in `
    + `"-- cursor: "*) printf '%s' "\${l#-- cursor: }" > "$T" ;; *) printf '%s\\n' "$l" ;; esac; done; `
    + `C=$(cat "$T"); rm -f "$T"; `
    + `if [ -n "$C" ]; then exec ${base} -f --after-cursor="$C"; else exec ${base} -n 0 -f; fi`;
}

/**
 * Runs the script as root. "nopasswd" fails fast if sudo would ask; "password" reads it once from
 * stdin (-S, empty prompt): the caller writes it and closes stdin, so a wrong password ends the
 * command instead of waiting for a retry.
 */
function withSudo(script, config) {
  const mode = normalizeSudo(config?.sudo);
  if (!mode) return script;
  const flags = mode === "nopasswd" ? "-n" : "-S -p ''";
  return `if ! command -v sudo >/dev/null 2>&1; then printf 'sudo no está disponible en el servidor\\n' >&2; exit 127; fi; `
    + `exec sudo ${flags} -- sh -c ${quote(script)}`;
}

/** The password sudo will read from stdin, or "" when sudo is not used with a password. */
function sudoSecret(config) {
  if (normalizeSudo(config?.sudo) !== "password") return "";
  return String(config?.sudoPassword || config?.password || "");
}

/** Clear message for the usual sudo failures (stderr of the remote command). */
function sudoError(stderr) {
  const text = String(stderr || "");
  if (/a (?:terminal|password) is required|no tty present|askpass/i.test(text))
    return "sudo pide contraseña: elige «sudo con contraseña» en la bitácora.";
  if (/incorrect password|sorry, try again|\d+ incorrect password attempts?/i.test(text))
    return "sudo rechazó la contraseña.";
  if (/must have a tty|requiretty/i.test(text))
    return "sudo exige una terminal (requiretty) en este servidor; pide al administrador quitarlo para este usuario.";
  if (/is not in the sudoers|not allowed to execute|may not run sudo/i.test(text))
    return "El usuario no tiene permiso de sudo en este servidor.";
  return "";
}

/** Streaming decoder for a non-UTF-8 log; null for UTF-8 (the default path keeps StringDecoder). */
function createTextDecoder(encoding) {
  const name = normalizeEncoding(encoding);
  if (name === "utf-8") return null;
  const decoder = new TextDecoder(name);
  return { write: chunk => decoder.decode(chunk, { stream:true }), end: () => decoder.decode() };
}

module.exports = {
  ENCODINGS, SUDO_MODES, normalizeEncoding, normalizeSudo, normalizeJournalUnit,
  journalScript, withSudo, sudoSecret, sudoError, createTextDecoder,
};
