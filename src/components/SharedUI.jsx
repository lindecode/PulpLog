import React, { useState, useEffect, useRef } from "react";
import { useLang } from "../i18n.jsx";

/* ═══════════════════════════════════════════
   Small helpers
═══════════════════════════════════════════ */
function ContextInput({ value, onChange }) {
  const t = useLang();
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(String(value ?? 0));
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value ?? 0));
  }, [value]);
  const update = event => {
    const next = event.target.value;
    setDraft(next);
    if (next === "") return;
    const parsed = Number(next);
    if (Number.isFinite(parsed)) onChange(Math.max(0, Math.min(50, parsed)));
  };
  const commit = () => {
    if (draft === "") {
      setDraft("0");
      onChange(0);
    } else {
      setDraft(String(Math.max(0, Math.min(50, Number(draft) || 0))));
    }
  };
  return <label title={t("context_title")}
    style={{ display:"flex", alignItems:"center", gap:5, flex:"0 0 auto", minWidth:118, whiteSpace:"nowrap",
      color:"var(--pl-text-5)", fontSize:10 }}>
    <span>{t("context_label")} ±</span>
    <input ref={inputRef} type="number" min={0} max={50} value={draft}
      onChange={update} onBlur={commit}
      style={{ width:48, background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
        borderRadius:6, color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:11,
        padding:"3px 5px", textAlign:"center" }} />
  </label>;
}

function Btn({ children, onClick, active, title, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      style={{ background: active ? "var(--pl-btn-active-bg)" : "var(--pl-bg-input)",
               border:`0.5px solid ${active ? "var(--pl-btn-active-border)":"var(--pl-border)"}`,
               borderRadius:6, color: active ? "var(--pl-btn-active-text)":"var(--pl-text-3)",
               fontFamily:"inherit", fontSize:11, padding:"4px 9px",
               cursor: disabled ? "not-allowed":"pointer",
               opacity: disabled ? 0.4 : 1, whiteSpace:"nowrap" }}>
      {children}
    </button>
  );
}

function Sep() {
  return <span style={{ width:"0.5px", background:"var(--pl-text-8)", alignSelf:"stretch" }} />;
}


export { ContextInput, Btn, Sep };
