// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Renderer helpers for container tabs (Docker, Podman, nerdctl, Kubernetes).
// A container tab keeps `tab.docker` = the picked item:
//   { runtime, name, containerId?, namespace?, context?, pod?, workload?, container? }
// Tabs from before runtimes existed have no `runtime` and are Docker.

export const RUNTIME_META = {
  docker:     { icon:"🐳", label:"Docker" },
  podman:     { icon:"🦭", label:"Podman" },
  nerdctl:    { icon:"📦", label:"nerdctl" },
  kubernetes: { icon:"☸",  label:"Kubernetes" },
};

export const runtimeOf = item => (item && RUNTIME_META[item.runtime] ? item.runtime : "docker");

/* Where the container comes from, shown on each picker card and in tooltips */
export function originLabel(item) {
  const runtime = runtimeOf(item);
  if (runtime === "kubernetes") return `${item.context} · ${item.namespace}`;
  if (runtime === "nerdctl") return `nerdctl · ${item.namespace || "default"}`;
  return RUNTIME_META[runtime].label;
}

/* What `docker:logs:start` needs. Kubernetes: the live pod, or the workload
   (deployment/x…) when the tab was reopened from a workspace. */
export function containerSource(item) {
  const runtime = runtimeOf(item);
  if (runtime === "kubernetes") {
    const source = { runtime, context:item.context, namespace:item.namespace, container:item.container };
    if (item.pod) source.pod = item.pod;
    if (item.workload) source.workload = item.workload;
    return source;
  }
  const source = { runtime, id:item.containerId || item.name };
  if (runtime === "nerdctl") source.namespace = item.namespace || "default";
  return source;
}

export function containerTabLabel(item) {
  const runtime = runtimeOf(item);
  const { icon } = RUNTIME_META[runtime];
  if (runtime === "kubernetes") return `${icon} ${item.pod || item.workload} · ${item.container}`;
  return `${icon} ${item.name}`;
}

export function containerTooltip(item) {
  const runtime = runtimeOf(item);
  const lines = [`${RUNTIME_META[runtime].icon} ${RUNTIME_META[runtime].label} · ${originLabel(item)}`];
  if (runtime === "kubernetes") {
    lines.push(`${item.pod ? `pod ${item.pod}` : item.workload}`, `container ${item.container}`);
    if (item.pod && item.workload) lines.push(item.workload);
  } else {
    lines.push(item.name);
    if (item.containerId && item.containerId !== item.name) lines.push(`ID: ${String(item.containerId).slice(0, 12)}`);
  }
  return lines.join("\n");
}

/* Picker item (from containers:list) → tab.docker */
export function tabDockerFromItem(item) {
  const runtime = runtimeOf(item);
  if (runtime === "kubernetes") {
    return { runtime, name:item.name, context:item.context, namespace:item.namespace,
             pod:item.pod, workload:item.workload || undefined, container:item.container };
  }
  return { runtime, name:item.name, containerId:item.id,
           ...(runtime === "nerdctl" ? { namespace:item.namespace || "default" } : {}) };
}
