// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Picks several open log tabs (and optionally extra files from disk) and
// combines them into one merged tab interleaved by timestamp.
import React, { useState, useCallback } from "react";
import { useLang } from "../i18n.jsx";
import { useEscapeToClose } from "../hooks.mjs";
import { IS_ELECTRON } from "../utils.mjs";
import { combineTabFiles } from "../mergedSource.mjs";
import { containerSource } from "../containers.mjs";

const fileName = fp => fp.split(/[\\/]/).pop();

export function CombinePicker({ candidates, initialIds, onCombine, onClose }) {
  const t = useLang();
  useEscapeToClose(onClose);
  const [selected, setSelected] = useState(() => new Set(initialIds?.length ? initialIds : candidates.map(tab => tab.id)));
  const [extra, setExtra] = useState([]);          // extra paths picked from disk
  const [title, setTitle] = useState("");
  const [closeSources, setCloseSources] = useState(false);

  const toggle = id => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const addFromDisk = useCallback(async () => {
    const fp = await window.electronAPI.openFileDialog();
    if (fp) setExtra(prev => prev.includes(fp) ? prev : [...prev, fp]);
  }, []);

  const chosenTabs = candidates.filter(tab => selected.has(tab.id));
  const files = combineTabFiles([...chosenTabs, ...extra.map(filePath => ({ filePath }))],
    { containerSource: docker => ({ source: containerSource(docker) }) });
  const canCombine = files.length >= 2;
  const defaultTitle = files.slice(0, 3).map(f => f.label).join(" + ") + (files.length > 3 ? " …" : "");

  const submit = () => {
    if (!canCombine) return;
    onCombine({ title: title.trim() || defaultTitle, files, sourceIds: closeSources ? chosenTabs.map(tab => tab.id) : [] });
  };

  const row = { display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderRadius:4,
                cursor:"pointer", fontSize:12, color:"var(--pl-text-2)" };
  const btn = { background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:6,
                color:"var(--pl-text-4)", fontFamily:"inherit", fontSize:11, padding:"6px 14px", cursor:"pointer" };

  return (
    <div onClick={onClose}
         style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
                  display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div data-float onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("combine_title")}
           style={{ background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:10,
                    padding:"20px 22px", width:"min(520px, 92vw)", maxHeight:"80vh", display:"flex", flexDirection:"column",
                    gap:12, boxShadow:"0 8px 40px rgba(0,0,0,.8)", fontFamily:"inherit" }}>
        <div style={{ fontSize:14, fontWeight:700, color:"var(--pl-text-1)" }}>⧉ {t("combine_title")}</div>
        <div style={{ fontSize:11, color:"var(--pl-text-5)" }}>{t("combine_hint")}</div>

        <div style={{ overflowY:"auto", minHeight:0, border:"0.5px solid var(--pl-border-soft)", borderRadius:6, padding:4 }}>
          {candidates.map(tab => (
            <label key={tab.id} style={row} title={tab.merged ? tab.merged.files.map(f => f.filePath || f.label).join("\n") : tab.filePath || tab.label}>
              <input type="checkbox" checked={selected.has(tab.id)} onChange={() => toggle(tab.id)} />
              <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {tab.merged ? `⧉ ${tab.label} · ${tab.merged.files.length}` : tab.label}
              </span>
            </label>
          ))}
          {extra.map(fp => (
            <label key={fp} style={row} title={fp}>
              <input type="checkbox" checked onChange={() => setExtra(prev => prev.filter(x => x !== fp))} />
              <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fileName(fp)}</span>
            </label>
          ))}
          {!candidates.length && !extra.length && (
            <div style={{ padding:8, fontSize:11, color:"var(--pl-text-6)" }}>{t("combine_empty")}</div>
          )}
        </div>

        {IS_ELECTRON && (
          <button onClick={addFromDisk} style={{ ...btn, alignSelf:"flex-start" }}>+ {t("combine_add_file")}</button>
        )}

        <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"var(--pl-text-5)" }}>
          {t("combine_name")}
          <input value={title} placeholder={defaultTitle} onChange={e => setTitle(e.target.value)}
                 onKeyDown={e => { if (e.key === "Enter") submit(); }}
                 style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:4,
                          color:"var(--pl-text-1)", fontSize:12, fontFamily:"inherit", padding:"5px 8px" }} />
        </label>

        <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, color:"var(--pl-text-4)", cursor:"pointer" }}>
          <input type="checkbox" checked={closeSources} onChange={e => setCloseSources(e.target.checked)} />
          {t("combine_close_sources")}
        </label>

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:11, color: canCombine ? "var(--pl-text-6)" : "var(--pl-accent)" }}>
            {canCombine ? t("combine_count", files.length) : t("combine_need_two")}
          </span>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={onClose} style={btn}>{t("cancel")}</button>
            <button onClick={submit} disabled={!canCombine}
                    style={{ ...btn, color: canCombine ? "var(--pl-text-1)" : "var(--pl-text-7)",
                             borderColor: canCombine ? "var(--pl-accent)" : "var(--pl-border)",
                             cursor: canCombine ? "pointer" : "not-allowed" }}>
              ⧉ {t("combine_go")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
