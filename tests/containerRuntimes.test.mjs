// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { containerSource, containerTabLabel, originLabel, tabDockerFromItem } from "../src/containers.mjs";
import { entryFromTab, entryKey as rendererKey } from "../src/workspaces.mjs";

const require = createRequire(import.meta.url);
const rt = require("../containerRuntimes.cjs");
const ws = require("../workspaces.cjs");

test("logsArgs builds each runtime's follow command", () => {
  assert.deepEqual(rt.logsArgs({ runtime:"docker", id:"web" }), ["logs", "--follow", "--tail=500", "web"]);
  assert.deepEqual(rt.logsArgs({ id:"abc123" }, 50), ["logs", "--follow", "--tail=50", "abc123"]);
  assert.deepEqual(rt.logsArgs({ runtime:"podman", id:"db" }), ["logs", "--follow", "--tail=500", "db"]);
  assert.deepEqual(rt.logsArgs({ runtime:"nerdctl", id:"api", namespace:"k8s.io" }),
    ["--namespace", "k8s.io", "logs", "--follow", "--tail=500", "api"]);
  assert.deepEqual(rt.logsArgs({ runtime:"kubernetes", context:"minikube", namespace:"default", pod:"api-7f9c8d-x2k4j", container:"app" }),
    ["--context", "minikube", "--namespace", "default", "logs", "--follow", "--tail=500", "api-7f9c8d-x2k4j", "--container", "app"]);
  assert.deepEqual(rt.logsArgs({ runtime:"kubernetes", context:"arn:aws:eks:us-east-1:1:cluster/prod", namespace:"web",
    workload:"deployment/api", container:"app" }).slice(7, 8), ["deployment/api"]);
});

test("normalizeSource rejects option injection and malformed names", () => {
  assert.throws(() => rt.normalizeSource({ runtime:"docker", id:"--privileged" }));
  assert.throws(() => rt.normalizeSource({ runtime:"docker", id:"a b" }));
  assert.throws(() => rt.normalizeSource({ runtime:"nerdctl", id:"x", namespace:"-n" }));
  assert.throws(() => rt.normalizeSource({ runtime:"kubernetes", context:"--kubeconfig=/x", namespace:"d", pod:"p", container:"c" }));
  assert.throws(() => rt.normalizeSource({ runtime:"kubernetes", context:"m", namespace:"Bad_NS", pod:"p", container:"c" }));
  assert.throws(() => rt.normalizeSource({ runtime:"kubernetes", context:"m", namespace:"d", container:"c" }));
  assert.throws(() => rt.normalizeSource({ runtime:"kubernetes", context:"m", namespace:"d", workload:"service/x", container:"c" }));
  assert.equal(rt.normalizeSource({ runtime:"evil", id:"web" }).runtime, "docker");
});

test("parsers read docker, podman and nerdctl output", () => {
  const docker = rt.parseDockerPs([
    JSON.stringify({ ID:"a1b2c3d4e5f6", Names:"web", Image:"nginx:1.27", Status:"Up 2 hours" }),
    "not json",
    JSON.stringify({ ID:"-bad", Names:"x" }),
  ].join("\n"));
  assert.deepEqual(docker, [{ runtime:"docker", id:"a1b2c3d4e5f6", name:"web", image:"nginx:1.27", status:"Up 2 hours" }]);

  const podman = rt.parsePodmanPs(JSON.stringify([{ Id:"ff00", Names:["db"], Image:"postgres:16", State:"running" }]));
  assert.deepEqual(podman, [{ runtime:"podman", id:"ff00", name:"db", image:"postgres:16", status:"running" }]);
  assert.deepEqual(rt.parsePodmanPs("garbage"), []);

  const nerd = rt.parseNerdctlPs([
    JSON.stringify({ ID:"c1", Names:"api", Image:"ghcr.io/x/api:1", Status:"Up" }),
    JSON.stringify({ ID:"c2", Names:"k8s_POD", Image:"registry.k8s.io/pause:3.9", Status:"Up" }),
  ].join("\n"), "k8s.io");
  assert.deepEqual(nerd.map(c => [c.name, c.namespace]), [["api", "k8s.io"]]);
  assert.deepEqual(rt.parseNamespaces("default\nk8s.io\n-x\n"), ["default", "k8s.io"]);
});

test("parseKubePods lists one entry per container and derives the workload", () => {
  const out = rt.parseKubePods(JSON.stringify({ items:[
    { metadata:{ name:"api-7f9c8d-x2k4j", namespace:"default", labels:{ "pod-template-hash":"7f9c8d" },
                 ownerReferences:[{ kind:"ReplicaSet", name:"api-7f9c8d", controller:true }] },
      spec:{ containers:[{ name:"app", image:"api:1" }, { name:"sidecar", image:"envoy:1" }] },
      status:{ phase:"Running", containerStatuses:[{ name:"app", state:{ running:{} }, restartCount:2 },
                                                   { name:"sidecar", state:{ waiting:{ reason:"CrashLoopBackOff" } } }] } },
    { metadata:{ name:"db-0", namespace:"data", ownerReferences:[{ kind:"StatefulSet", name:"db", controller:true }] },
      spec:{ containers:[{ name:"postgres", image:"postgres:16" }] }, status:{ phase:"Pending" } },
    { metadata:{ name:"Bad_Pod", namespace:"default" }, spec:{ containers:[{ name:"x" }] } },
  ] }), "minikube");
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(c => [c.pod, c.container, c.workload, c.status]), [
    ["api-7f9c8d-x2k4j", "app", "deployment/api", "Running · 2 restarts"],
    ["api-7f9c8d-x2k4j", "sidecar", "deployment/api", "CrashLoopBackOff"],
    ["db-0", "postgres", "statefulset/db", "Pending"],
  ]);
  assert.ok(out.every(c => c.context === "minikube" && c.runtime === "kubernetes"));
  assert.deepEqual(rt.parseKubeContexts("minikube\nkind-dev\n--bad\n"), ["minikube", "kind-dev"]);
  assert.throws(() => rt.kubePodsArgs("-x"));
});

test("renderer helpers turn picker items into tabs and log sources", () => {
  const k8s = { runtime:"kubernetes", context:"minikube", namespace:"default", pod:"api-1", container:"app",
                workload:"deployment/api", id:"default/api-1/app", name:"api-1 · app" };
  const tab = tabDockerFromItem(k8s);
  assert.equal(containerTabLabel(tab), "☸ api-1 · app");
  assert.equal(originLabel(tab), "minikube · default");
  assert.deepEqual(containerSource(tab), { runtime:"kubernetes", context:"minikube", namespace:"default",
                                            container:"app", pod:"api-1", workload:"deployment/api" });
  assert.doesNotThrow(() => rt.logsArgs(containerSource(tab)));
  // tabs from before runtimes existed are plain Docker
  assert.deepEqual(containerSource({ containerId:"abc", name:"web" }), { runtime:"docker", id:"abc" });
  const nerd = tabDockerFromItem({ runtime:"nerdctl", id:"c1", name:"api", namespace:"k8s.io" });
  assert.deepEqual(containerSource(nerd), { runtime:"nerdctl", id:"c1", namespace:"k8s.io" });
});

test("workspace entries keep the runtime, reopen k8s by workload, and keys match", () => {
  const isWin = process.platform === "win32";
  const tabs = [
    { label:"🐳 web", docker:{ containerId:"abc", name:"web" } },                       // legacy docker tab
    { label:"🦭 db", docker:{ runtime:"podman", containerId:"ff00", name:"db" } },
    { label:"📦 api", docker:{ runtime:"nerdctl", containerId:"c1", name:"api", namespace:"k8s.io" } },
    { label:"☸ api", docker:{ runtime:"kubernetes", context:"minikube", namespace:"default", pod:"api-1",
                              workload:"deployment/api", container:"app", name:"api-1 · app" } },
  ];
  for (const tab of tabs) {
    const entry = entryFromTab(tab);
    const normalized = ws.normalizeEntry(entry);
    assert.ok(normalized, tab.label);
    assert.equal(rendererKey(entry, isWin), ws.entryKey(normalized), tab.label);
  }
  const k8s = ws.normalizeEntry(entryFromTab(tabs[3]));
  assert.equal(k8s.workload, "deployment/api");
  assert.equal(k8s.pod, undefined);
  assert.equal(ws.entryKey(ws.normalizeEntry({ type:"docker", name:"web" })), "docker:web"); // old files unchanged
  assert.equal(ws.normalizeEntry({ type:"docker", runtime:"kubernetes", context:"-x", namespace:"d", pod:"p", container:"c" }), null);
});
