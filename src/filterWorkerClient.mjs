// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
export function createFilterWorkerClient(factory = () => new Worker(new URL("./filterWorker.mjs", import.meta.url), { type:"module" }), timeoutMs = 2000) {
  let worker = null;
  let active = null;
  let queued = null;
  let disposed = false;
  const settle = (value, error) => {
    if (!active) return;
    const job = active;
    clearTimeout(job.timer); active = null;
    if (error) { worker?.terminate(); worker = null; job.reject(error); }
    else job.resolve(value);
    pump();
  };
  const pump = () => {
    if (active || !queued || disposed) return;
    active = queued; queued = null;
    try {
      if (!worker) {
        worker = factory();
        const currentWorker = worker;
        worker.onmessage = ({ data }) => {
          if (worker === currentWorker) data.error ? settle(null, new Error("Filter failed")) : settle(data.result);
        };
        worker.onerror = () => { if (worker === currentWorker) settle(null, new Error("Filter worker failed")); };
      }
      active.timer = setTimeout(() => settle(null, new Error("Filter timed out")), timeoutMs);
      worker.postMessage(active.args);
    } catch (error) { settle(null, error); }
  };
  const reset = () => {
    worker?.terminate(); worker = null;
    if (active) { clearTimeout(active.timer); active.resolve({ superseded:true }); active = null; }
    if (queued) { queued.resolve({ superseded:true }); queued = null; }
  };
  return {
    run(args) {
      if (disposed) return Promise.reject(new Error("Filter worker disposed"));
      return new Promise((resolve, reject) => {
        if (queued) queued.resolve({ superseded:true });
        queued = { args, resolve, reject };
        pump();
      });
    },
    reset,
    terminate() { disposed = true; reset(); },
  };
}
