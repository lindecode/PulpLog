// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// WSL files are opened from Windows as \\wsl.localhost\<distro>\<linux path>
// (or the older \\wsl$\<distro>\…). Windows reads them with the permissions of
// the distro's default user; root-only files need `wsl -u root` instead.

const UNC_RE = /^[\\/]{2}wsl(?:\.localhost|\$)[\\/]([^\\/]+)((?:[\\/].*)?)$/i;

/* "\\wsl.localhost\Ubuntu\var\log\syslog" → { distro:"Ubuntu", linuxPath:"/var/log/syslog" } */
export function parseWslUncPath(value) {
  const match = String(value || "").match(UNC_RE);
  if (!match) return null;
  const linuxPath = (match[2] || "/").replace(/\\/g, "/") || "/";
  return { distro: match[1], linuxPath: linuxPath.startsWith("/") ? linuxPath : `/${linuxPath}` };
}

/* ("Ubuntu", "/var/log/syslog") → "\\wsl.localhost\Ubuntu\var\log\syslog" */
export function wslUncPath(distro, linuxPath = "/") {
  const clean = String(linuxPath || "/").replace(/^\/+/, "").replace(/\//g, "\\");
  return `\\\\wsl.localhost\\${distro}${clean ? `\\${clean}` : ""}`;
}

/* Read errors that mean "only root (or another user) may read this". */
export const isPermissionError = message => /EPERM|EACCES|permission denied|operation not permitted|acceso denegado/i.test(String(message || ""));
