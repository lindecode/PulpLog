// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;

function dockerContainer(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(id)) throw new Error("Invalid Docker container");
  return id;
}

function dockerCheck(unavailable = "Docker CLI unavailable on remote host") {
  return `command -v docker >/dev/null 2>&1 || { printf '%s\\n' ${quote(unavailable)} >&2; exit 127; }; docker info >/dev/null || exit $?; `;
}

function dockerListScript(unavailable) {
  return `${dockerCheck(unavailable)}exec docker ps -a --no-trunc --format '{{json .}}'`;
}

function dockerReadCheck(config, unavailable) {
  return `${dockerCheck(unavailable)}docker inspect --type container ${quote(dockerContainer(config.containerId))} >/dev/null`;
}

function dockerLogsScript(config, readyMarker, unavailable) {
  const tail = config.resumeOnly ? 0 : Math.min(100000, Math.max(0, Number.parseInt(config.tailLines, 10) || 500));
  return `${dockerReadCheck(config, unavailable)} || exit $?; printf '%s\\n' ${quote(readyMarker)}; exec docker logs --follow --tail=${tail} ${quote(dockerContainer(config.containerId))} 2>&1`;
}

function parseDockerContainers(stdout) {
  return String(stdout || "").split(/\r?\n/).filter(line => line.trim()).map(line => {
    const entry = JSON.parse(line);
    return { id:dockerContainer(entry.ID), name:String(entry.Names || entry.ID),
      image:String(entry.Image || ""), status:String(entry.Status || ""), state:String(entry.State || "") };
  });
}

module.exports = { dockerContainer, dockerListScript, dockerReadCheck, dockerLogsScript, parseDockerContainers };
