import React from "react";
import { useLang } from "../i18n.jsx";

function Welcome({ onOpen, isElectron, recentFiles, onOpenRecent }) {
  const t = useLang();
  return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                  flexDirection:"column", gap:16, color:"var(--pl-text-7)" }}>
      <div style={{ fontSize:44 }}>📋</div>
      <p style={{ fontSize:18, color:"var(--pl-text-5)", margin:0 }}>PulpLog</p>
      <button onClick={onOpen}
        style={{ background:"var(--pl-bg-input)", border:"1px solid var(--pl-text-7)", borderRadius:8,
                 color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:13,
                 padding:"10px 24px", cursor:"pointer" }}>
        {t("open_file_btn")}
      </button>

      {recentFiles?.length > 0 && (
        <div style={{ marginTop:8, width:440 }}>
          <div style={{ fontSize:10, color:"var(--pl-text-8)", fontWeight:700, letterSpacing:1,
                         marginBottom:6, textAlign:"center" }}>{t("recent_h")}</div>
          <div style={{ border:"0.5px solid var(--pl-border-soft)", borderRadius:6, overflow:"hidden" }}>
            {recentFiles.map((fp, i) => {
              const name = fp.split(/[\\/]/).pop();
              return (
                <div key={fp} onClick={() => onOpenRecent(fp)} title={fp}
                     style={{ padding:"7px 14px", fontSize:12, cursor:"pointer",
                               borderBottom: i < recentFiles.length - 1
                                 ? "0.5px solid var(--pl-border-soft)" : "none",
                               background:"var(--pl-bg-footer)",
                               display:"flex", gap:8, alignItems:"center", overflow:"hidden" }}
                     onMouseEnter={e => e.currentTarget.style.background = "var(--pl-bg-hover)"}
                     onMouseLeave={e => e.currentTarget.style.background = "var(--pl-bg-footer)"}>
                  <span style={{ color:"var(--pl-text-8)" }}>📄</span>
                  <span style={{ color:"var(--pl-text-3)", flexShrink:0 }}>{name}</span>
                  <span style={{ color:"var(--pl-text-6)", fontSize:10, overflow:"hidden",
                                  textOverflow:"ellipsis", whiteSpace:"nowrap",
                                  direction:"rtl", textAlign:"left", minWidth:0 }}>{fp}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize:11, color:"var(--pl-text-6)", marginTop:4 }}>
        {isElectron ? t("hint_electron") : t("hint_web")}
      </div>
    </div>
  );
}

export { Welcome };
