import React, { useState, useEffect, useRef } from "react";
import { useLang, GUIDE, GUIDE_SHORTCUTS } from "../i18n.jsx";
import { useEscapeToClose } from "../hooks.mjs";
import { fmtNum, IS_ELECTRON } from "../utils.mjs";
import { Btn } from "./SharedUI.jsx";

/* ═══════════════════════════════════════════
   Rotation banner
═══════════════════════════════════════════ */
function RotationBanner({ event, countdown }) {
  const t = useLang();
  const CFG = {
    rotated:   { bg:"var(--pl-banner-rotated-bg)", border:"var(--pl-bookmark)", color:"var(--pl-bookmark)", icon:"↻", label: t("rotated", countdown) },
    truncated: { bg:"var(--pl-banner-truncated-bg)", border:"var(--pl-accent)", color:"var(--pl-accent-hover)", icon:"⬇", label: t("truncated", countdown) },
    recreated: { bg:"var(--pl-banner-recreated-bg)", border:"var(--pl-status-live)", color:"var(--pl-status-live)", icon:"✓", label: t("recreated") },
  };
  const c = CFG[event] || CFG.rotated;
  return (
    <div style={{ padding:"6px 14px", background:c.bg, borderBottom:`1px solid ${c.border}`,
                  color:c.color, fontSize:12, display:"flex", alignItems:"center", gap:8,
                  flexShrink:0, fontFamily:"inherit" }}>
      <span style={{ fontSize:16 }}>{c.icon}</span> {c.label}
    </div>
  );
}

/* ═══════════════════════════════════════════
   DiagPanel – bitácora de diagnóstico
═══════════════════════════════════════════ */
function DiagPanel({ onClose }) {
  const t = useLang();
  const [entries, setEntries] = useState([]);
  const scrollRef   = useRef(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    window.electronAPI.getAppLog().then(setEntries);
    const unsub = window.electronAPI.onAppLogNew(entry => {
      setEntries(prev => [...prev, entry]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (atBottomRef.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries]);

  const LEVEL = {
    ERROR: { color:"var(--pl-lvl-error-txt)", bg:"var(--pl-diag-error-bg)", label:"ERROR" },
    WARN:  { color:"var(--pl-lvl-warn-txt)", bg:"var(--pl-diag-warn-bg)", label:"WARN " },
    INFO:  { color:"var(--pl-accent-hover)", bg:"transparent", label:"INFO " },
  };
  const CAT_COLOR = { docker:"var(--pl-cat-docker)", file:"var(--pl-cat-file)", remote:"var(--pl-cat-remote)", system:"var(--pl-cat-system)", performance:"var(--pl-cat-performance)", settings:"var(--pl-cat-settings)" };
  const fmt = ts => new Date(ts).toLocaleTimeString(undefined, { hour12:false });

  return (
    <div style={{ height:210, flexShrink:0, borderTop:"1px solid var(--pl-border-soft)",
                  background:"var(--pl-bg-app)", display:"flex", flexDirection:"column",
                  fontFamily:"inherit" }}>

      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 10px",
                    background:"var(--pl-bg-footer)", borderBottom:"0.5px solid var(--pl-border-soft)", flexShrink:0 }}>
        <span style={{ fontSize:10, color:"var(--pl-text-5)", fontWeight:700, letterSpacing:1 }}>
          {t("diag_title")}
        </span>
        <span style={{ fontSize:10, color:"var(--pl-text-8)" }}>{t("diag_entries", entries.length)}</span>
        <Btn onClick={() => { window.electronAPI.clearAppLog(); setEntries([]); }}>
          {t("diag_clear")}
        </Btn>
        <button onClick={onClose}
          style={{ marginLeft:"auto", background:"none", border:"none",
                   color:"var(--pl-text-7)", cursor:"pointer", fontSize:13, padding:"0 4px",
                   fontFamily:"inherit" }}>
          ✕
        </button>
      </div>

      <div ref={scrollRef}
           onScroll={e => {
             const el = e.currentTarget;
             atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
           }}
           style={{ flex:1, overflowY:"auto" }}>
        {entries.length === 0 && (
          <div style={{ padding:"20px 10px", color:"var(--pl-text-7)", fontSize:11, textAlign:"center" }}>
            {t("diag_empty")}
          </div>
        )}
        {entries.map((e, i) => {
          const s = LEVEL[e.level] || LEVEL.INFO;
          return (
            <div key={i} style={{ display:"flex", gap:10, padding:"2px 10px", fontSize:11,
                                  background:s.bg, borderBottom:"0.5px solid var(--pl-hairline)",
                                  fontFamily:"inherit" }}>
              <span style={{ color:"var(--pl-text-8)", flexShrink:0, minWidth:72 }}>{fmt(e.ts)}</span>
              <span style={{ color:s.color, fontWeight:700, flexShrink:0, minWidth:42,
                             fontFamily:"monospace" }}>{s.label}</span>
              <span style={{ color: CAT_COLOR[e.category] || "var(--pl-text-6)", flexShrink:0,
                             minWidth:52 }}>[{e.category}]</span>
              <span style={{ color:"var(--pl-text-4)" }}>{e.msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Settings modal
═══════════════════════════════════════════ */
function PrefToggle({ label, value, onChange }) {
  return (
    <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", userSelect:"none" }}>
      <div onClick={() => onChange(!value)}
           style={{ width:28, height:16, borderRadius:8, flexShrink:0,
                    background: value ? "var(--pl-toggle-on-bg)" : "var(--pl-toggle-off-bg)",
                    border:`1px solid ${value ? "var(--pl-status-live)" : "var(--pl-border)"}`,
                    position:"relative", cursor:"pointer" }}>
        <div style={{ position:"absolute", top:2, left: value ? 14 : 2,
                       width:10, height:10, borderRadius:"50%",
                       background: value ? "var(--pl-toggle-on-knob)" : "var(--pl-toggle-off-knob)",
                       transition:"left .12s" }} />
      </div>
      <span style={{ fontSize:11, color:"var(--pl-text-4)" }}>{label}</span>
    </label>
  );
}

function SettingsModal({ settings, onClose, onOpenFile, onRemoveRecent, onClearRecent, onTogglePref }) {
  const t = useLang();
  const lang = settings.language || "es";
  const theme = settings.theme || "classic";
  useEscapeToClose(onClose);

  return (
    <div onClick={onClose}
         style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
                  display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("settings_title")}
           style={{ background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:10,
                    padding:"28px 32px", minWidth:500, maxWidth:620,
                    boxShadow:"0 8px 40px rgba(0,0,0,.8)", fontFamily:"inherit" }}>

        <div style={{ display:"flex", alignItems:"center", marginBottom:22 }}>
          <span style={{ fontSize:14, color:"var(--pl-text-1)", fontWeight:700 }}>{t("settings_header")}</span>
          <button onClick={onClose}
            style={{ marginLeft:"auto", background:"none", border:"none",
                     color:"var(--pl-text-6)", cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>✕</button>
        </div>

        {/* language */}
        <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
          {t("lang_h")}
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:24 }}>
          {["es","en"].map(l => (
            <button key={l} onClick={() => onTogglePref("language", l)}
              style={{ background: lang === l ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                       border:`0.5px solid ${lang === l ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                       borderRadius:6, color: lang === l ? "var(--pl-accent-hover)" : "var(--pl-text-5)",
                       fontFamily:"inherit", fontSize:12, padding:"5px 18px",
                       cursor:"pointer", fontWeight: lang === l ? 700 : 400 }}>
              {l === "es" ? "Español" : "English"}
            </button>
          ))}
        </div>

        {/* theme */}
        <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
          {t("theme_h")}
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:24 }}>
          {["classic","light","vscode","ember"].map(th => (
            <button key={th} onClick={() => onTogglePref("theme", th)}
              style={{ background: theme === th ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                       border:`0.5px solid ${theme === th ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                       borderRadius:6, color: theme === th ? "var(--pl-accent-hover)" : "var(--pl-text-5)",
                       fontFamily:"inherit", fontSize:12, padding:"5px 18px",
                       cursor:"pointer", fontWeight: theme === th ? 700 : 400 }}>
              {t(`theme_${th}`)}
            </button>
          ))}
        </div>

        {/* recent files */}
        <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginBottom:8 }}>
          {t("recent_files_h")}
        </div>
        {settings.recentFiles.length === 0 ? (
          <div style={{ fontSize:11, color:"var(--pl-text-8)", padding:"10px 0 16px" }}>{t("no_recent")}</div>
        ) : (
          <>
            <div style={{ maxHeight:200, overflowY:"auto", marginBottom:8,
                           border:"0.5px solid var(--pl-border-soft)", borderRadius:6 }}>
              {settings.recentFiles.map((fp, i) => {
                const name = fp.split(/[\\/]/).pop();
                return (
                  <div key={fp}
                       style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px",
                                borderBottom: i < settings.recentFiles.length - 1
                                  ? "0.5px solid var(--pl-border-soft)" : "none",
                                background:"var(--pl-bg-footer)" }}>
                    <span onClick={() => { onOpenFile(fp); onClose(); }}
                          title={fp}
                          style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", gap:6,
                                   fontSize:12, color:"var(--pl-text-3)", cursor:"pointer", overflow:"hidden" }}>
                      <span style={{ flexShrink:0 }}>📄 <b style={{ color:"var(--pl-text-2)" }}>{name}</b></span>
                      <span style={{ flex:1, minWidth:0, fontSize:10, color:"var(--pl-text-6)",
                                     overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                                     direction:"rtl", textAlign:"left" }}>{fp}</span>
                    </span>
                    <button onClick={() => onRemoveRecent(fp)}
                      style={{ background:"none", border:"none", color:"var(--pl-text-7)",
                               cursor:"pointer", fontSize:11, padding:"0 4px", flexShrink:0 }}>✕</button>
                  </div>
                );
              })}
            </div>
            <Btn onClick={onClearRecent}>{t("clear_recents")}</Btn>
          </>
        )}

        {/* preferences */}
        <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1,
                       marginTop:24, marginBottom:12 }}>
          {t("prefs_h")}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <PrefToggle
            label={t("pref_autoscroll")}
            value={settings.autoScrollDefault}
            onChange={v => onTogglePref("autoScrollDefault", v)}
          />
          <PrefToggle
            label={t("pref_linenums")}
            value={settings.showNumsDefault}
            onChange={v => onTogglePref("showNumsDefault", v)}
          />          <label style={{ display:"flex", alignItems:"center", gap:10, color:"var(--pl-text-4)", fontSize:11 }}>
            <span style={{ flex:1 }}>{t("pref_max_lines")}</span>
            <select value={settings.maxLiveLines || 500000}
              onChange={e => onTogglePref("maxLiveLines", Number(e.target.value))}
              style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:5,
                       color:"var(--pl-text-3)", fontFamily:"inherit", fontSize:11, padding:"4px 8px" }}>
              {[100000, 250000, 500000, 1000000, 2000000].map(value => (
                <option key={value} value={value}>{fmtNum(value)}</option>
              ))}
            </select>
          </label>
        </div>

        <button onClick={onClose}
          style={{ marginTop:28, background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                   borderRadius:6, color:"var(--pl-text-4)", fontFamily:"inherit",
                   fontSize:11, padding:"6px 20px", cursor:"pointer" }}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   About modal
═══════════════════════════════════════════ */
function AboutModal({ onClose }) {
  const t = useLang();
  const logoSrc = `${import.meta.env.BASE_URL}lindecode-max.jpeg`;
  useEscapeToClose(onClose);
  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
               display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div
        onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("about_title")}
        style={{ background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:10,
                 padding:"32px 40px", minWidth:300, textAlign:"center",
                 boxShadow:"0 8px 40px rgba(0,0,0,.8)", fontFamily:"inherit" }}>
        <img src={logoSrc} alt="LindeCode"
          style={{ width:96, height:96, borderRadius:12, objectFit:"cover", marginBottom:12 }} />
        <div style={{ fontSize:18, color:"var(--pl-text-1)", fontWeight:700, marginBottom:4 }}>PulpLog</div>
        <div style={{ fontSize:11, color:"var(--pl-text-6)", marginBottom:20 }}>v3.0.0</div>
        <div style={{ width:40, height:"0.5px", background:"var(--pl-border-strong)", margin:"0 auto 20px" }} />
        <div style={{ fontSize:13, color:"var(--pl-text-3)", marginBottom:6 }}>{t("developed_by")}</div>
        <div style={{ fontSize:16, color:"var(--pl-accent)", fontWeight:700, letterSpacing:1 }}>LindeCode</div>
        <div style={{ marginTop:20, fontSize:11, color:"var(--pl-text-7)" }}>{t("license")}</div>
        <button
          onClick={onClose}
          style={{ marginTop:24, background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                   borderRadius:6, color:"var(--pl-text-4)", fontFamily:"inherit",
                   fontSize:11, padding:"6px 20px", cursor:"pointer" }}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Help → user guide modal
═══════════════════════════════════════════ */
function HelpGuideModal({ lang, onClose }) {
  const t = useLang();
  const sections = GUIDE[lang] || GUIDE.es;
  const shortcuts = GUIDE_SHORTCUTS[lang] || GUIDE_SHORTCUTS.es;
  useEscapeToClose(onClose);
  return (
    <div onClick={onClose}
         style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
                  display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("help_guide_title")}
           style={{ background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:10,
                    padding:"26px 30px", width:"min(640px, calc(100vw - 32px))", maxHeight:"85vh",
                    overflowY:"auto", boxShadow:"0 8px 40px rgba(0,0,0,.8)", fontFamily:"inherit" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:18 }}>
          <span style={{ fontSize:14, color:"var(--pl-text-1)", fontWeight:700 }}>📋 {t("help_guide_title")}</span>
          <button onClick={onClose}
            style={{ marginLeft:"auto", background:"none", border:"none",
                     color:"var(--pl-text-6)", cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>✕</button>
        </div>

        {sections.map(({ title, items }) => (
          <div key={title} style={{ marginBottom:18 }}>
            <div style={{ fontSize:11, color:"var(--pl-accent-hover)", fontWeight:700,
                          letterSpacing:.5, marginBottom:6 }}>{title}</div>
            <ul style={{ margin:0, paddingLeft:18, display:"flex", flexDirection:"column", gap:4 }}>
              {items.map(item => (
                <li key={item} style={{ fontSize:12, color:"var(--pl-text-3)", lineHeight:1.5 }}>{item}</li>
              ))}
            </ul>
          </div>
        ))}

        <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
          {lang === "en" ? "KEYBOARD SHORTCUTS" : "ATAJOS DE TECLADO"}
        </div>
        <div style={{ border:"0.5px solid var(--pl-border-soft)", borderRadius:6, overflow:"hidden", marginBottom:20 }}>
          {shortcuts.map(([key, desc], i) => (
            <div key={key} style={{ display:"flex", gap:12, padding:"6px 10px", alignItems:"center",
                          background: i % 2 ? "var(--pl-bg-footer)" : "transparent",
                          borderBottom: i < shortcuts.length - 1 ? "0.5px solid var(--pl-border-soft)" : "none" }}>
              <code style={{ flexShrink:0, minWidth:150, fontSize:11, color:"var(--pl-accent-hover)",
                             fontFamily:"inherit" }}>{key}</code>
              <span style={{ fontSize:11, color:"var(--pl-text-4)" }}>{desc}</span>
            </div>
          ))}
        </div>

        <button onClick={onClose}
          style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                   borderRadius:6, color:"var(--pl-text-4)", fontFamily:"inherit",
                   fontSize:11, padding:"6px 20px", cursor:"pointer" }}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}


export { RotationBanner, DiagPanel, SettingsModal, AboutModal, HelpGuideModal };
