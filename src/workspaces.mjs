// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Workspaces (renderer side): pure helpers + useWorkspaces hook.
// A workspace is a named, colored set of log sources (file / docker / remote).
// Several can be active at once. Each tab records the workspaces it belongs to
// in `workspaceIds`; `wsOwned` marks tabs a workspace opened.
// A workspace only opens or closes: activating opens its logs, deactivating
// closes the tabs it opened (unless another active workspace also has them).
// Nothing stays alive in the background. Edits to an active workspace are not
// applied live: it is marked "pending" and the change applies when reopened.
import { useState, useEffect, useCallback, useRef } from "react";

export const WS_PALETTE = ["#E5534B", "#57AB5A", "#539BF5", "#C69026", "#B083F0", "#39C5CF", "#E275AD", "#DB6D28"];
const IS_WIN = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent || "");
const SECRET_KEYS = ["password", "passphrase", "trustHostForSession"];

export function entryFromTab(tab) {
  if (!tab) return null;
  if (tab.filePath && tab.filePath !== "__web__") return { type:"file", filePath:tab.filePath, label:tab.label };
  if (tab.docker) return { type:"docker", containerId:tab.docker.containerId, name:tab.docker.name, label:tab.label };
  if (tab.remote) {
    const remote = { ...tab.remote };
    SECRET_KEYS.forEach(key => delete remote[key]);
    return { type:"remote", remote, label:tab.label };
  }
  return null;
}

/* Must stay in sync with entryKey() in workspaces.cjs */
export function entryKey(entry, isWin = IS_WIN) {
  if (!entry) return null;
  if (entry.type === "file") return `file:${isWin ? entry.filePath.toLowerCase() : entry.filePath}`;
  if (entry.type === "docker") return `docker:${entry.name || entry.containerId}`;
  const r = entry.remote || {};
  return `remote:${[r.mode, r.user, r.target, r.port, r.distro, r.source, r.filePath, r.containerName || r.containerId].join("|")}`;
}

export const tabKey = tab => entryKey(entryFromTab(tab));

/* File entries whose file name contains * or ? (folder must be literal) */
export const isPatternEntry = entry => entry?.type === "file" && /[*?]/.test(String(entry.filePath).split(/[\\/]/).pop());

/* Belongs-to check that also covers tabs opened from a pattern entry */
const tabMatchesKey = (tab, key) => tab.wsEntryKey === key || tabKey(tab) === key;

export function nextColor(workspaces) {
  const used = new Set(workspaces.map(ws => ws.color));
  return WS_PALETTE.find(color => !used.has(color)) || WS_PALETTE[workspaces.length % WS_PALETTE.length];
}

export function newWorkspaceId() {
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* Adds entries to a workspace, skipping duplicates. Pure. */
export function withEntries(ws, entries) {
  const keys = new Set(ws.entries.map(e => entryKey(e)));
  const fresh = entries.filter(e => {
    const key = entryKey(e);
    if (!key || keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  return fresh.length ? { ...ws, entries:[...ws.entries, ...fresh] } : ws;
}

const addId = (ids, id) => (ids || []).includes(id) ? ids : [...(ids || []), id];
const dropId = (ids, id) => (ids || []).filter(x => x !== id);

/* ═══════════════════════════════════════════
   useWorkspaces — store + activation logic.
   panes: [paneA, paneB] from usePaneTabs; new tabs open in panes[0].
═══════════════════════════════════════════ */
export function useWorkspaces({ panes, remoteTabLabel, onMissing, enabled }) {
  const [store, setStore] = useState({ workspaces:[], activeIds:[] });
  const [loaded, setLoaded] = useState(false);
  const storeRef = useRef(store);
  const panesRef = useRef(panes);
  panesRef.current = panes;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    window.electronAPI.getWorkspaces()
      .then(s => { if (alive) { storeRef.current = s; setStore(s); } })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [enabled]);

  const commit = useCallback((updater) => {
    const next = typeof updater === "function" ? updater(storeRef.current) : updater;
    storeRef.current = next;
    setStore(next);
    if (enabled) window.electronAPI.setWorkspaces(next).catch(() => {});
    return next;
  }, [enabled]);

  const tagTabs = (predicate, mutate) => {
    panesRef.current.forEach(pane => pane.setTabs(prev => {
      let changed = false;
      const next = prev.map(tab => {
        if (!predicate(tab)) return tab;
        changed = true;
        return mutate(tab);
      });
      return changed ? next : prev;
    }));
  };

  /* Workspaces edited while active: changes apply on reopen (session-only) */
  const [pendingIds, setPendingIds] = useState([]);
  const markPending = (wsId, on) => {
    if (on && !storeRef.current.activeIds.includes(wsId)) return;
    setPendingIds(prev => on ? addId(prev, wsId) : dropId(prev, wsId));
  };

  /* Expands an entry into concrete local files: [{ filePath, size, label }] (empty = missing) */
  const resolveFiles = async (entry) => {
    if (isPatternEntry(entry)) {
      const matches = await window.electronAPI.resolveWorkspacePattern(entry.filePath, entry.latestOnly !== false);
      return matches.map(m => ({ filePath:m.filePath, size:m.size, label:m.filePath.split(/[\\/]/).pop() }));
    }
    const stat = await window.electronAPI.statFile(entry.filePath);
    return stat ? [{ filePath:entry.filePath, size:stat.size, label:entry.label || entry.filePath.split(/[\\/]/).pop() }] : [];
  };

  /* Returns an array of new tabs (empty array = nothing found) */
  const buildTabs = async (entry, wsId) => {
    const base = { label:entry.label || "", filePath:null, fileSize:null, workspaceIds:[wsId], wsOwned:true, wsEntryKey:entryKey(entry) };
    if (entry.type === "file") {
      const files = await resolveFiles(entry);
      return files.map(f => ({ ...base, label:f.label, filePath:f.filePath, fileSize:f.size }));
    }
    if (entry.type === "docker") {
      const name = entry.name || entry.containerId;
      // container names survive re-creation; ids don't
      return [{ ...base, label:entry.label || `🐳 ${name}`, docker:{ containerId:name, name } }];
    }
    return [{ ...base, label:entry.label || remoteTabLabel(entry.remote), remote:{ ...entry.remote } }];
  };

  const openWorkspaceTabs = async (ws) => {
    // key → tab ids already open (visible or hidden); pattern tabs are also indexed by their entry key
    const openKeys = new Map();
    const index = (key, id) => { if (key) openKeys.set(key, [...(openKeys.get(key) || []), id]); };
    panesRef.current.forEach(pane => pane.tabsRef.current.forEach(tab => {
      index(tabKey(tab), tab.id);
      if (tab.wsEntryKey && tab.wsEntryKey !== tabKey(tab)) index(tab.wsEntryKey, tab.id);
    }));
    const merged = ws.view === "merged";
    const matchedIds = new Set();
    const toOpen = [];
    for (const entry of ws.entries) {
      // merged view folds local files into a single tab; docker/remote stay separate
      if (merged && entry.type === "file") continue;
      const key = entryKey(entry);
      if (openKeys.has(key)) openKeys.get(key).forEach(id => matchedIds.add(id));
      else toOpen.push(entry);
    }
    if (matchedIds.size) tagTabs(tab => matchedIds.has(tab.id), tab => ({ ...tab, workspaceIds:addId(tab.workspaceIds, ws.id) }));
    const built = await Promise.all(toOpen.map(entry => buildTabs(entry, ws.id).catch(() => [])));
    let missing = built.filter(tabs => !tabs.length).length;
    const fresh = built.flat();
    const hasMergedTab = panesRef.current.some(pane => pane.tabsRef.current.some(tab => tab.merged && tab.workspaceIds?.includes(ws.id)));
    if (merged && !hasMergedTab) {
      const fileEntries = ws.entries.filter(entry => entry.type === "file");
      const resolved = await Promise.all(fileEntries.map(entry => resolveFiles(entry).catch(() => [])));
      missing += resolved.filter(files => !files.length).length;
      const files = resolved.flat();
      if (files.length) {
        fresh.unshift({ label:`⧉ ${ws.name}`, filePath:null, fileSize:null, workspaceIds:[ws.id], wsOwned:true,
                        merged:{ title:ws.name, files:files.map(f => ({ filePath:f.filePath, label:f.label })) } });
      }
    }
    if (fresh.length) panesRef.current[0].appendTabs(fresh);
    if (missing) onMissing?.(missing);
  };

  /* Closes the tabs this workspace opened, except those another active workspace
     also includes. Evaluated when React applies the update, so tags queued
     earlier (e.g. by an activation in the same tick) are taken into account. */
  const closeOwnedTabs = (wsId) => {
    panesRef.current.forEach(pane => pane.removeTabsWhere(tab => {
      if (!tab.wsOwned || !tab.workspaceIds?.includes(wsId)) return false;
      const active = storeRef.current.activeIds;
      return !tab.workspaceIds.some(id => id !== wsId && active.includes(id));
    }));
  };

  const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

  const deactivate = useCallback((wsId) => {
    if (!storeRef.current.activeIds.includes(wsId)) return;
    commit(s => ({ ...s, activeIds:dropId(s.activeIds, wsId) }));
    closeOwnedTabs(wsId);
    markPending(wsId, false);
  }, [commit]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Adds this workspace to the active ones; the others are left as they are */
  const activate = useCallback(async (wsId) => {
    const ws = storeRef.current.workspaces.find(w => w.id === wsId);
    if (!ws || storeRef.current.activeIds.includes(wsId)) return;
    commit(s => ({ ...s, activeIds:addId(s.activeIds, wsId) }));
    await openWorkspaceTabs(ws);
  }, [commit]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Close + open again: applies pending edits (fresh read, new tail) */
  const reopen = useCallback(async (wsId) => {
    if (!storeRef.current.activeIds.includes(wsId)) return activate(wsId);
    closeOwnedTabs(wsId);
    markPending(wsId, false);
    await nextFrame(); // let the close land so the dedup snapshot is fresh
    const ws = storeRef.current.workspaces.find(w => w.id === wsId);
    if (ws) await openWorkspaceTabs(ws);
  }, [activate]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Always additive: selecting toggles one workspace without touching the others */
  const select = useCallback((wsId) => (
    storeRef.current.activeIds.includes(wsId) ? deactivate(wsId) : activate(wsId)
  ), [activate, deactivate]);

  /* Re-open workspaces that were active last session, once tabs are restored */
  const restoredRef = useRef(false);
  const restoreActive = useCallback(() => {
    if (restoredRef.current || !loaded) return;
    restoredRef.current = true;
    storeRef.current.workspaces
      .filter(ws => storeRef.current.activeIds.includes(ws.id))
      .forEach(ws => { openWorkspaceTabs(ws); });
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useCallback((fields = {}) => {
    const ws = { id:newWorkspaceId(), name:fields.name || "Workspace", color:fields.color || nextColor(storeRef.current.workspaces),
                 view:fields.view === "merged" ? "merged" : "tabs", entries:[] };
    const filled = fields.entries ? withEntries(ws, fields.entries) : ws;
    commit(s => ({ ...s, workspaces:[...s.workspaces, filled] }));
    return filled;
  }, [commit]);

  const update = useCallback((wsId, patch) => {
    const before = storeRef.current.workspaces.find(ws => ws.id === wsId);
    commit(s => ({ ...s, workspaces:s.workspaces.map(ws => ws.id === wsId ? { ...ws, ...patch } : ws) }));
    if (before && patch.view && patch.view !== before.view) markPending(wsId, true);
  }, [commit]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Deleting closes the tabs only this workspace opened; manual tabs stay open */
  const remove = useCallback((wsId) => {
    commit(s => ({ workspaces:s.workspaces.filter(ws => ws.id !== wsId), activeIds:dropId(s.activeIds, wsId) }));
    closeOwnedTabs(wsId);
    tagTabs(tab => tab.workspaceIds?.includes(wsId), tab => {
      const ids = dropId(tab.workspaceIds, wsId);
      return { ...tab, workspaceIds:ids, wsOwned:ids.length ? tab.wsOwned : false };
    });
    markPending(wsId, false);
  }, [commit]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Entry edits never open/close tabs by themselves: they apply on reopen */
  const addEntries = useCallback((wsId, entries) => {
    const before = storeRef.current.workspaces.find(ws => ws.id === wsId);
    commit(s => ({ ...s, workspaces:s.workspaces.map(ws => ws.id === wsId ? withEntries(ws, entries) : ws) }));
    const after = storeRef.current.workspaces.find(ws => ws.id === wsId);
    // tabs already open for those entries now belong to the workspace too
    const keys = new Set(entries.map(e => entryKey(e)));
    tagTabs(tab => keys.has(tabKey(tab)), tab => ({ ...tab, workspaceIds:addId(tab.workspaceIds, wsId) }));
    if (before && after && after.entries.length !== before.entries.length) markPending(wsId, true);
  }, [commit]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeEntry = useCallback((wsId, key) => {
    commit(s => ({ ...s, workspaces:s.workspaces.map(ws => ws.id === wsId
      ? { ...ws, entries:ws.entries.filter(e => entryKey(e) !== key) } : ws) }));
    // the tab leaves the workspace right away (its color goes); it stays open, and if no
    // other workspace owns it, it becomes a normal tab that deactivating no longer closes
    tagTabs(tab => tab.workspaceIds?.includes(wsId) && tabMatchesKey(tab, key), tab => {
      const ids = dropId(tab.workspaceIds, wsId);
      return { ...tab, workspaceIds:ids, wsOwned:ids.length ? tab.wsOwned : false,
               wsEntryKey:ids.length ? tab.wsEntryKey : undefined };
    });
  }, [commit]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Import: always fresh ids so imports never clobber existing workspaces */
  const importMany = useCallback((list) => {
    const fresh = list.map(ws => ({ ...ws, id:newWorkspaceId() }));
    commit(s => ({ ...s, workspaces:[...s.workspaces, ...fresh] }));
    return fresh;
  }, [commit]);

  /* Context-menu helpers operating on a concrete tab */
  const addTab = useCallback((wsId, tab) => {
    const entry = entryFromTab(tab);
    if (entry) addEntries(wsId, [entry]);
  }, [addEntries]);

  const createFromTab = useCallback((tab) => {
    const entry = entryFromTab(tab);
    if (!entry) return null;
    const ws = create({ name:tab.label || "Workspace", entries:[entry] });
    commit(s => ({ ...s, activeIds:addId(s.activeIds, ws.id) }));
    tagTabs(t => t.id === tab.id, t => ({ ...t, workspaceIds:addId(t.workspaceIds, ws.id) }));
    return ws;
  }, [create, commit]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...store, loaded, pendingIds,
    activate, deactivate, reopen, select, restoreActive,
    create, update, remove, addEntries, removeEntry, addTab, createFromTab, importMany,
  };
}
