import React from "react";
import { useLang } from "../i18n.jsx";

/* ═══════════════════════════════════════════
   Small helpers
═══════════════════════════════════════════ */
function CollapsibleToolbarRow({ label, children }) {
  const t = useLang();
  return (
    <details open className="pl-toolbar-row" style={{ position:"relative", paddingLeft:28, minHeight:24 }}>
      <summary title={t("toolbar_toggle", label)} aria-label={t("toolbar_toggle", label)}
        style={{ position:"absolute", top:0, left:0, width:24, height:24, padding:"4px 5px",
          color:"var(--pl-text-3)", cursor:"pointer", borderRadius:4, fontSize:12 }} />
      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", minWidth:0 }}>
        {children}
      </div>
    </details>
  );
}

function ContextInput({ value, onChange }) {
  const t = useLang();
  const normalized = Math.max(0, Math.min(50, Number(value) || 0));
  const buttonStyle = { background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
    color:"var(--pl-text-4)", fontFamily:"inherit", fontSize:13, width:25, height:25,
    padding:0, cursor:"pointer" };
  return <label title={t("context_title")}
    style={{ display:"flex", alignItems:"center", gap:5, flex:"0 0 auto", minWidth:118, whiteSpace:"nowrap",
      color:"var(--pl-text-5)", fontSize:10 }}>
    <span>{t("context_label")} ±</span>
    <span style={{ display:"inline-flex", alignItems:"center" }}>
      <button type="button" onClick={() => onChange(Math.max(0, normalized - 1))} disabled={normalized === 0}
        aria-label={t("context_decrease")} style={{ ...buttonStyle, borderRadius:"6px 0 0 6px", opacity:normalized === 0 ? .4 : 1 }}>−</button>
      <input type="number" min={0} max={50} value={normalized}
        onChange={event => onChange(Math.max(0, Math.min(50, Number(event.target.value) || 0)))}
        style={{ width:38, height:25, boxSizing:"border-box", appearance:"textfield", background:"var(--pl-bg-input)",
          border:"0.5px solid var(--pl-border)", borderLeft:"none", borderRight:"none", color:"var(--pl-text-2)",
          fontFamily:"inherit", fontSize:11, padding:"3px 4px", textAlign:"center", outline:"none" }} />
      <button type="button" onClick={() => onChange(Math.min(50, normalized + 1))} disabled={normalized === 50}
        aria-label={t("context_increase")} style={{ ...buttonStyle, borderRadius:"0 6px 6px 0", opacity:normalized === 50 ? .4 : 1 }}>+</button>
    </span>
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

function ExtraSearches({ searches, onChange, validity = [], onNavigate }) {
  const t = useLang();
  const update = (index, patch) => onChange(searches.map((search, i) => i === index ? { ...search, ...patch } : search));
  const remove = index => onChange(searches.filter((_, i) => i !== index));
  const add = () => {
    if (searches.length < 3) onChange([...searches, { text:"", useRegex:false }]);
  };
  return (
    <>
      <Btn onClick={add} disabled={searches.length >= 3} title={searches.length >= 3 ? t("extra_search_limit") : t("extra_search_add_title")}>
        + {t("extra_search_add")}
      </Btn>
      {searches.map((search, index) => {
        const valid = validity[index] !== false;
        return (
          <div key={index} style={{ display:"flex", flex:"1 1 180px", minWidth:150, maxWidth:320 }}>
            <span aria-hidden="true" style={{ width:6, flexShrink:0, borderRadius:"6px 0 0 6px",
              background:`var(--pl-search-hit-${index + 2}-border)` }} />
            <input value={search.text} onChange={event => update(index, { text:event.target.value })}
              onKeyDown={event => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onNavigate?.(index, event.shiftKey ? "prev" : "next");
              }}
              placeholder={search.useRegex ? t("search_regex_ph") : t("extra_search_ph", index + 2)}
              title={valid ? t("extra_search_title", index + 2) : t("search_regex_invalid_title")}
              style={{ flex:1, minWidth:0, background:"var(--pl-bg-input)",
                border:`0.5px solid ${valid ? "var(--pl-border)" : "var(--pl-error-border)"}`, borderLeft:"none",
                color:valid ? "var(--pl-text-2)" : "var(--pl-error-text)", fontFamily:"inherit",
                fontSize:12, padding:"4px 8px", outline:"none" }} />
            <button onClick={() => update(index, { useRegex:!search.useRegex })} title={t("search_regex_btn_title")}
              style={{ background:search.useRegex ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                border:`0.5px solid ${search.useRegex ? "var(--pl-border-focus)" : "var(--pl-border)"}`, borderLeft:"none",
                color:search.useRegex ? "var(--pl-accent-hover)" : "var(--pl-text-5)", fontFamily:"monospace",
                fontSize:11, padding:"4px 7px", cursor:"pointer", fontWeight:search.useRegex ? 700 : 400 }}>.*</button>
            <button onClick={() => remove(index)} title={t("extra_search_remove")}
              aria-label={t("extra_search_remove")}
              style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderLeft:"none",
                borderRadius:"0 6px 6px 0", color:"var(--pl-text-5)", fontSize:14, padding:"2px 7px", cursor:"pointer" }}>×</button>
          </div>
        );
      })}
    </>
  );
}

function ExtraFilters({ filters, onChange, validity = [] }) {
  const t = useLang();
  const update = (index, patch) => onChange(filters.map((filter, i) => i === index ? { ...filter, ...patch } : filter));
  const remove = index => onChange(filters.filter((_, i) => i !== index));
  const add = () => {
    if (filters.length < 3) onChange([...filters, { text:"", useRegex:false }]);
  };
  return (
    <>
      <Btn onClick={add} disabled={filters.length >= 3} title={filters.length >= 3 ? t("extra_filter_limit") : t("extra_filter_add_title")}>
        + {t("extra_filter_add")}
      </Btn>
      {filters.map((filter, index) => {
        const valid = validity[index] !== false;
        return <div key={index} style={{ display:"flex", flex:"1 1 180px", minWidth:150, maxWidth:320 }}>
          <input value={filter.text} onChange={event => update(index, { text:event.target.value })}
            placeholder={filter.useRegex ? t("regex_ph") : t("extra_filter_ph", index + 2)}
            title={valid ? t("extra_filter_title", index + 2) : t("regex_invalid")}
            style={{ flex:1, minWidth:0, background:"var(--pl-bg-input)",
              border:`0.5px solid ${valid ? "var(--pl-border)" : "var(--pl-error-border)"}`, borderRadius:"6px 0 0 6px",
              color:valid ? "var(--pl-text-2)" : "var(--pl-error-text)", fontFamily:"inherit", fontSize:12,
              padding:"4px 8px", outline:"none" }} />
          <button onClick={() => update(index, { useRegex:!filter.useRegex })} title={t("regex_btn_title")}
            style={{ background:filter.useRegex ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
              border:`0.5px solid ${filter.useRegex ? "var(--pl-border-focus)" : "var(--pl-border)"}`, borderLeft:"none",
              color:filter.useRegex ? "var(--pl-accent-hover)" : "var(--pl-text-5)", fontFamily:"monospace",
              fontSize:11, padding:"4px 7px", cursor:"pointer", fontWeight:filter.useRegex ? 700 : 400 }}>.*</button>
          <button onClick={() => remove(index)} title={t("extra_filter_remove")} aria-label={t("extra_filter_remove")}
            style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderLeft:"none",
              borderRadius:"0 6px 6px 0", color:"var(--pl-text-5)", fontSize:14, padding:"2px 7px", cursor:"pointer" }}>×</button>
        </div>;
      })}
    </>
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


export { CollapsibleToolbarRow, ContextInput, TimeRangeFilter, ExtraSearches, ExtraFilters, Btn, Sep };
