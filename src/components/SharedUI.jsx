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

function Btn({ children, onClick, active, title, disabled, variant }) {
  let bg = active ? "var(--pl-btn-active-bg)" : "var(--pl-bg-input)";
  let border = active ? "var(--pl-btn-active-border)" : "var(--pl-border)";
  let color = active ? "var(--pl-btn-active-text)" : "var(--pl-text-3)";

  if (active && variant === "accent") {
    bg = "var(--pl-accent)";
    border = "var(--pl-accent-hover)";
    color = "var(--pl-bg-app)";
  }

  return (
    <button onClick={onClick} title={title} disabled={disabled}
      style={{ background: bg, border: `0.5px solid ${border}`,
               borderRadius:6, color: color,
               fontFamily:"inherit", fontSize:11, padding:"4px 9px",
               cursor: disabled ? "not-allowed":"pointer",
               opacity: disabled ? 0.4 : 1, whiteSpace:"nowrap" }}>
      {children}
    </button>
  );
}

function TimeRangeFilter({ value, onChange, invalid, availableDates = [] }) {
  const t = useLang();
  const enabled = !!value?.enabled;
  const update = patch => onChange({ includeUndated:true, ...value, ...patch });
  const inputStyle = {
    width:112, background:"var(--pl-bg-input)",
    border:`0.5px solid ${invalid ? "var(--pl-error-border)" : "var(--pl-border)"}`,
    borderRadius:6, color: invalid ? "var(--pl-error-text)" : "var(--pl-text-2)",
    fontFamily:"inherit", fontSize:11, padding:"4px 7px", outline:"none",
  };

  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
      <Btn active={enabled} onClick={() => update({ enabled:!enabled })} title={t("time_filter_title")}>
        {t("time_filter_btn")}
      </Btn>
      {enabled && (
        <>
          {availableDates.length > 0 && (
            <select
              value={value?.date || ""}
              onChange={event => update({ date:event.target.value })}
              title={t("time_date_title")}
              style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                borderRadius:6, color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:11,
                padding:"4px 7px", outline:"none", maxWidth:150 }}>
              <option value="">{t("time_date_today")}</option>
              {availableDates.map(date => <option key={date} value={date}>{date}</option>)}
            </select>
          )}
          <input
            type="time"
            step="1"
            value={value?.from || ""}
            onChange={event => update({ from:event.target.value })}
            placeholder={t("time_from_ph")}
            title={t("time_input_title")}
            style={inputStyle}
          />
          <input
            type="time"
            step="1"
            value={value?.to || ""}
            onChange={event => update({ to:event.target.value })}
            placeholder={t("time_to_ph")}
            title={t("time_input_title")}
            style={inputStyle}
          />
          <Btn onClick={() => onChange({ enabled:true, date:"", from:"", to:"", includeUndated:true })} title={t("time_clear_title")}>
            {t("time_clear_btn")}
          </Btn>
        </>
      )}
    </div>
  );
}

function Sep() {
  return <span style={{ width:"0.5px", background:"var(--pl-text-8)", alignSelf:"stretch" }} />;
}


export { ContextInput, TimeRangeFilter, Btn, Sep };
