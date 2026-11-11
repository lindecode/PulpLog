// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Container runtimes for the local "containers" picker: Docker, Podman,
// nerdctl (containerd) and Kubernetes (kubectl: minikube, kind, k3s, clouds).
// Pure helpers: CLI arguments + output parsers. main.js runs them with
// execFile/spawn (never a shell); every name that reaches an argv is validated
// and may not start with "-" so it can't be read as an option.
"use strict";

const RUNTIMES = {
  docker:     { bin:"docker",  label:"Docker" },
  podman:     { bin:"podman",  label:"Podman" },
  nerdctl:    { bin:"nerdctl", label:"nerdctl" },
  kubernetes: { bin:"kubectl", label:"Kubernetes" },
};
const RUNTIME_IDS = Object.keys(RUNTIMES);
const DEFAULT_TAIL = 500;

const CONTAINER_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;          // docker/podman/nerdctl id or name
const K8S_NAME_RE  = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;       // DNS-1123
const WORKLOAD_RE  = /^(deployment|statefulset|daemonset|job|replicaset)\/[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
// kube contexts can look like "arn:aws:eks:…:cluster/x" or "user@cluster"
const CONTEXT_RE   = /^[A-Za-z0-9_][A-Za-z0-9_.:/@+-]{0,255}$/;

function check(value, re, label) {
  const text = String(value ?? "").trim();
  if (!re.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}

/* Validates a log source coming from the renderer (or a workspace file). */
function normalizeSource(value) {
  const s = value && typeof value === "object" ? value : {};
  const runtime = RUNTIME_IDS.includes(s.runtime) ? s.runtime : "docker";
  if (runtime === "kubernetes") {
    const out = {
      runtime,
      context: check(s.context, CONTEXT_RE, "Kubernetes context"),
      namespace: check(s.namespace, K8S_NAME_RE, "Kubernetes namespace"),
      container: check(s.container, K8S_NAME_RE, "Kubernetes container"),
    };
    if (s.pod) out.pod = check(s.pod, K8S_NAME_RE, "Kubernetes pod");
    if (s.workload) out.workload = check(s.workload, WORKLOAD_RE, "Kubernetes workload");
    if (!out.pod && !out.workload) throw new Error("Kubernetes source needs a pod or workload");
    return out;
  }
  const out = { runtime, id: check(s.id ?? s.containerId, CONTAINER_RE, "container") };
  if (runtime === "nerdctl") out.namespace = check(s.namespace || "default", CONTAINER_RE, "nerdctl namespace");
  return out;
}

/* argv for `<bin> …` that streams logs. Kubernetes prefers the live pod and
   falls back to the workload (e.g. deployment/api) whose pod names change. */
function logsArgs(source, tail = DEFAULT_TAIL) {
  const n = Math.min(100000, Math.max(0, Number.parseInt(tail, 10) || DEFAULT_TAIL));
  const s = normalizeSource(source);
  if (s.runtime === "kubernetes") {
    return ["--context", s.context, "--namespace", s.namespace, "logs", "--follow", `--tail=${n}`,
            s.pod || s.workload, "--container", s.container];
  }
  const base = ["logs", "--follow", `--tail=${n}`, s.id];
  return s.runtime === "nerdctl" ? ["--namespace", s.namespace, ...base] : base;
}

/* ── listing ── */
const jsonLines = stdout => String(stdout || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);

const firstName = names => (Array.isArray(names) ? names[0] : String(names || "").split(",")[0] || "").replace(/^\//, "");

const DOCKER_LIST_ARGS = ["ps", "--no-trunc", "--format", "{{json .}}"];
function parseDockerPs(stdout, runtime = "docker") {
  return jsonLines(stdout).filter(c => CONTAINER_RE.test(String(c.ID || ""))).map(c => ({
    runtime, id:String(c.ID), name:firstName(c.Names) || String(c.ID).slice(0, 12),
    image:String(c.Image || ""), status:String(c.Status || c.State || ""),
  }));
}

const PODMAN_LIST_ARGS = ["ps", "--format", "json"];
function parsePodmanPs(stdout) {
  let list;
  try { list = JSON.parse(String(stdout || "[]")); } catch { return []; }
  return (Array.isArray(list) ? list : []).filter(c => CONTAINER_RE.test(String(c.Id || c.ID || ""))).map(c => {
    const id = String(c.Id || c.ID);
    return { runtime:"podman", id, name:firstName(c.Names) || id.slice(0, 12),
             image:String(c.Image || ""), status:String(c.Status || c.State || "") };
  });
}

const NERDCTL_NAMESPACES_ARGS = ["namespace", "ls", "--quiet"];
const parseNamespaces = stdout => String(stdout || "").split(/\r?\n/).map(s => s.trim()).filter(ns => CONTAINER_RE.test(ns));
const nerdctlListArgs = namespace => ["--namespace", namespace, ...DOCKER_LIST_ARGS];
function parseNerdctlPs(stdout, namespace) {
  // k8s.io holds one "pause" sandbox per pod: noise for log reading
  return parseDockerPs(stdout, "nerdctl")
    .filter(c => !/(^|\/)pause:/.test(c.image))
    .map(c => ({ ...c, namespace }));
}

const KUBE_CONTEXTS_ARGS = ["config", "get-contexts", "--output=name"];
const KUBE_CURRENT_ARGS = ["config", "current-context"];
const parseKubeContexts = stdout => String(stdout || "").split(/\r?\n/).map(s => s.trim()).filter(c => CONTEXT_RE.test(c));
const kubePodsArgs = context => ["--context", check(context, CONTEXT_RE, "Kubernetes context"),
  "get", "pods", "--all-namespaces", "--output=json", "--request-timeout=8s"];

/* Deployment pods are owned by a ReplicaSet named "<deployment>-<pod-template-hash>" */
function workloadOf(pod) {
  const owner = (pod.metadata?.ownerReferences || []).find(o => o.controller) || pod.metadata?.ownerReferences?.[0];
  if (!owner?.name) return null;
  const kind = String(owner.kind || "").toLowerCase();
  if (kind === "replicaset") {
    const hash = pod.metadata?.labels?.["pod-template-hash"];
    if (hash && owner.name.endsWith(`-${hash}`)) return `deployment/${owner.name.slice(0, -(hash.length + 1))}`;
    return `replicaset/${owner.name}`;
  }
  if (["statefulset", "daemonset", "job"].includes(kind)) return `${kind}/${owner.name}`;
  return null;
}

function containerStatus(pod, name) {
  const st = (pod.status?.containerStatuses || []).find(c => c.name === name);
  if (!st) return pod.status?.phase || "";
  if (st.state?.running) return `Running${st.restartCount ? ` · ${st.restartCount} restarts` : ""}`;
  if (st.state?.waiting) return st.state.waiting.reason || "Waiting";
  if (st.state?.terminated) return st.state.terminated.reason || "Terminated";
  return pod.status?.phase || "";
}

function parseKubePods(stdout, context) {
  let data;
  try { data = JSON.parse(String(stdout || "{}")); } catch { return []; }
  const out = [];
  for (const pod of Array.isArray(data.items) ? data.items : []) {
    const podName = pod.metadata?.name;
    const namespace = pod.metadata?.namespace;
    if (!K8S_NAME_RE.test(podName || "") || !K8S_NAME_RE.test(namespace || "")) continue;
    const workload = workloadOf(pod);
    for (const c of pod.spec?.containers || []) {
      if (!K8S_NAME_RE.test(c.name || "")) continue;
      out.push({
        runtime:"kubernetes", context, namespace, pod:podName, container:c.name,
        workload: workload && WORKLOAD_RE.test(workload) ? workload : null,
        id:`${namespace}/${podName}/${c.name}`, name:`${podName} · ${c.name}`,
        image:String(c.image || ""), status:containerStatus(pod, c.name),
      });
    }
  }
  return out;
}

module.exports = {
  RUNTIMES, RUNTIME_IDS, DEFAULT_TAIL,
  normalizeSource, logsArgs,
  DOCKER_LIST_ARGS, parseDockerPs,
  PODMAN_LIST_ARGS, parsePodmanPs,
  NERDCTL_NAMESPACES_ARGS, parseNamespaces, nerdctlListArgs, parseNerdctlPs,
  KUBE_CONTEXTS_ARGS, KUBE_CURRENT_ARGS, parseKubeContexts, kubePodsArgs, parseKubePods, workloadOf,
};
