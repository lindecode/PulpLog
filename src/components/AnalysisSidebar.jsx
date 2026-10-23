// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n.jsx";
import { buildResultText, copyResultText, fmtBytes, fmtNum } from "../utils.mjs";
import { selectedLogRows } from "./LogRow.jsx";
import { Btn } from "./SharedUI.jsx";

const MAX_PROMPT_LINES = 2000;
const MAX_PROMPT_CHARS = 220000;

function redactSecrets(text) {
  return String(text || "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(authorization:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED_TOKEN]")
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]");
}

function buildPrompt({ t, sourceLabel, filter, search, timeRange, stats, rows, scope, task, lineLimitHit, charLimitHit }) {
  const logText = rows.map(item => `${item.origLine}\t${item.raw}`).join("\n");
  const timeText = timeRange?.enabled
    ? `${timeRange.date || t("analysis_time_today")} ${timeRange.from || "*"}..${timeRange.to || "*"}`
    : t("analysis_none");
  const levelText = ["error", "warn", "info", "debug", "trace"]
    .map(key => `${key.toUpperCase()}: ${fmtNum(stats?.[key] || 0)}`)
    .join(", ");

  return [
    t("analysis_prompt_intro"),
    "",
    t(`analysis_task_${task}`),
    "",
    `${t("analysis_prompt_context")}:`,
    `- ${t("analysis_prompt_source")}: ${sourceLabel || t("analysis_unknown")}`,
    `- ${t("analysis_prompt_scope")}: ${scope}`,
    `- ${t("analysis_prompt_filter")}: ${filter || t("analysis_none")}`,
    `- ${t("analysis_prompt_search")}: ${search || t("analysis_none")}`,
    `- ${t("analysis_prompt_time")}: ${timeText}`,
    `- ${t("analysis_prompt_levels")}: ${levelText}`,
    `- ${t("analysis_prompt_rows")}: ${fmtNum(rows.length)}${lineLimitHit ? ` (${t("analysis_limited_lines", MAX_PROMPT_LINES)})` : ""}${charLimitHit ? ` (${t("analysis_limited_size", fmtBytes(MAX_PROMPT_CHARS))})` : ""}`,
    "",
    `${t("analysis_prompt_logs")}:`,
    "```log",
    logText,
    "```",
  ].join("\n");
}

function limitRows(rows) {
  const limitedRows = [];
  let chars = 0;
  let charLimitHit = false;
  for (const item of rows.slice(0, MAX_PROMPT_LINES)) {
    const next = `${item.origLine}\t${item.raw}\n`;
    if (chars + next.length > MAX_PROMPT_CHARS) {
      charLimitHit = true;
      break;
    }
    chars += next.length;
    limitedRows.push(item);
  }
  return {
    rows: limitedRows,
    lineLimitHit: rows.length > MAX_PROMPT_LINES,
    charLimitHit,
  };
}

function AnalysisSidebar({ sourceLabel, filter, search, timeRange, visibleItems, sourceItems, selection, stats, onClose }) {
  const t = useLang();
  const [redact, setRedact] = useState(true);
  const [task, setTask] = useState("summary");
  const [tab, setTab] = useState("prompt"); // "prompt" | "diagnosis"

  // Ollama dynamic state
  const [ollamaStatus, setOllamaStatus] = useState({ available: false, models: [], error: null });
  const [checkingOllama, setCheckingOllama] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [diagnosisText, setDiagnosisText] = useState("");
  const [generationError, setGenerationError] = useState(null);

  const stopStreamRef = useRef(null);

  const selectedRows = useMemo(
    () => selectedLogRows(sourceItems || [], selection?.lines || new Set()),
    [sourceItems, selection],
  );
  const baseRows = selectedRows.length
    ? selectedRows
    : (visibleItems || []).filter(item => !item.separator);
  const scope = selectedRows.length ? t("analysis_scope_selection") : t("analysis_scope_visible");
  const { rows: limitedRows, lineLimitHit, charLimitHit } = limitRows(baseRows);
  const rows = redact
    ? limitedRows.map(item => ({ ...item, raw: redactSecrets(item.raw) }))
    : limitedRows;
  const prompt = useMemo(() => buildPrompt({
    t, sourceLabel, filter, search, timeRange, stats, rows, scope, task, lineLimitHit, charLimitHit,
  }), [t, sourceLabel, filter, search, timeRange, stats, rows, scope, task, lineLimitHit, charLimitHit]);
  const visibleExport = useMemo(() => buildResultText({
    source: sourceLabel,
    filter,
    timeRange,
    items: rows,
    total: sourceItems?.filter(item => !item.separator).length || rows.length,
  }), [sourceLabel, filter, timeRange, rows, sourceItems]);

  const refreshOllama = useCallback(async () => {
    if (!window.electronAPI?.getOllamaStatus) return;
    setCheckingOllama(true);
    try {
      const status = await window.electronAPI.getOllamaStatus();
      setOllamaStatus(status);
      if (status?.available && Array.isArray(status.models) && status.models.length > 0) {
        setSelectedModel(prev => {
          if (prev && status.models.some(m => m.name === prev)) return prev;
          return status.models[0].name;
        });
      }
    } catch (err) {
      setOllamaStatus({ available: false, models: [], error: err.message });
    } finally {
      setCheckingOllama(false);
    }
  }, []);

  useEffect(() => {
    refreshOllama();
    return () => {
      if (stopStreamRef.current) {
        stopStreamRef.current();
        stopStreamRef.current = null;
      }
    };
  }, [refreshOllama]);

  const handleStartAnalysis = useCallback(() => {
    if (!selectedModel || !window.electronAPI?.streamOllama) return;
    setDiagnosisText("");
    setGenerationError(null);
    setIsGenerating(true);
    setTab("diagnosis");

    const stopFn = window.electronAPI.streamOllama(
      { model: selectedModel, prompt },
      {
        onChunk: chunk => {
          setDiagnosisText(prev => prev + chunk);
        },
        onDone: () => {
          setIsGenerating(false);
          stopStreamRef.current = null;
        },
        onError: err => {
          setIsGenerating(false);
          setGenerationError(err);
          stopStreamRef.current = null;
        },
      },
    );

    stopStreamRef.current = stopFn;
  }, [selectedModel, prompt]);

  const handleStopAnalysis = useCallback(() => {
    if (stopStreamRef.current) {
      stopStreamRef.current();
      stopStreamRef.current = null;
    }
    setIsGenerating(false);
  }, []);

  return (
    <aside style={{ position:"absolute", top:96, right:10, bottom:32, width:"min(420px, calc(100% - 20px))",
      zIndex:20, display:"flex", flexDirection:"column", gap:10, padding:12,
      background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:8,
      boxShadow:"0 12px 40px rgba(0,0,0,.55)", fontFamily:"inherit" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ color:"var(--pl-text-1)", fontSize:13, fontWeight:700 }}>{t("analysis_title")}</div>
        <button type="button" onClick={onClose} title={t("close")}
          style={{ marginLeft:"auto", background:"none", border:0, color:"var(--pl-text-5)", cursor:"pointer",
            fontFamily:"inherit", fontSize:14 }}>x</button>
      </div>

      <div style={{ color:"var(--pl-text-5)", fontSize:10, lineHeight:1.5 }}>
        {t("analysis_scope_detail", scope, fmtNum(baseRows.length), fmtBytes(prompt.length))}
      </div>

      {/* Ollama dynamic model bar */}
      <div style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:6,
        padding:"6px 8px", display:"flex", flexDirection:"column", gap:6 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:10 }}>
          <span style={{
            display:"inline-block", width:7, height:7, borderRadius:"50%",
            background: ollamaStatus.available ? "var(--pl-status-info, #4caf50)" : "var(--pl-text-5, #777)",
          }} />
          <span style={{ color:"var(--pl-text-3)", fontWeight:600 }}>{t("analysis_ollama_badge")}</span>
          <span style={{ color:"var(--pl-text-5)", marginLeft:"auto" }}>
            {checkingOllama ? "..." : (ollamaStatus.available ? t("analysis_ollama_active") : t("analysis_ollama_offline"))}
          </span>
          <button type="button" onClick={refreshOllama} disabled={checkingOllama}
            title={t("analysis_ollama_refresh")}
            style={{ background:"none", border:0, color:"var(--pl-text-4)", cursor:"pointer", fontSize:11, padding:0 }}>
            ↻
          </button>
        </div>

        {ollamaStatus.available && ollamaStatus.models?.length > 0 ? (
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <label style={{ color:"var(--pl-text-5)", fontSize:10 }}>{t("analysis_ollama_models")}:</label>
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
              disabled={isGenerating}
              style={{ flex:1, background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border)",
                borderRadius:4, color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:11, padding:"3px 6px" }}>
              {ollamaStatus.models.map(m => (
                <option key={m.name} value={m.name}>{m.name} ({m.details?.parameter_size || fmtBytes(m.size)})</option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{ color:"var(--pl-text-5)", fontSize:9, lineHeight:1.3 }}>
            {t("analysis_ollama_hint")}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:4, borderBottom:"0.5px solid var(--pl-border)", paddingBottom:4 }}>
        <button type="button" onClick={() => setTab("prompt")}
          style={{ background: tab === "prompt" ? "var(--pl-bg-input)" : "none",
            border:"0.5px solid", borderColor: tab === "prompt" ? "var(--pl-border)" : "transparent",
            borderRadius:4, color: tab === "prompt" ? "var(--pl-text-1)" : "var(--pl-text-5)",
            cursor:"pointer", fontFamily:"inherit", fontSize:10, padding:"3px 8px" }}>
          {t("analysis_ollama_tab_prompt")}
        </button>
        <button type="button" onClick={() => setTab("diagnosis")}
          style={{ background: tab === "diagnosis" ? "var(--pl-bg-input)" : "none",
            border:"0.5px solid", borderColor: tab === "diagnosis" ? "var(--pl-border)" : "transparent",
            borderRadius:4, color: tab === "diagnosis" ? "var(--pl-text-1)" : "var(--pl-text-5)",
            cursor:"pointer", fontFamily:"inherit", fontSize:10, padding:"3px 8px", display:"flex", alignItems:"center", gap:4 }}>
          {t("analysis_ollama_tab_result")}
          {isGenerating && <span style={{ width:6, height:6, borderRadius:"50%", background:"var(--pl-accent)", animation:"pulse 1s infinite" }} />}
        </button>
      </div>

      {tab === "prompt" ? (
        <>
          <select value={task} onChange={event => setTask(event.target.value)}
            disabled={isGenerating}
            style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:6,
              color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:11, padding:"6px 8px" }}>
            <option value="summary">{t("analysis_task_label_summary")}</option>
            <option value="root_cause">{t("analysis_task_label_root_cause")}</option>
            <option value="searches">{t("analysis_task_label_searches")}</option>
            <option value="report">{t("analysis_task_label_report")}</option>
          </select>

          <label style={{ display:"flex", alignItems:"center", gap:8, color:"var(--pl-text-4)", fontSize:11 }}>
            <input type="checkbox" checked={redact} onChange={event => setRedact(event.target.checked)} />
            {t("analysis_redact")}
          </label>

          {(lineLimitHit || charLimitHit) && (
            <div style={{ color:"var(--pl-status-warn)", background:"var(--pl-diag-warn-bg)",
              border:"0.5px solid var(--pl-status-warn)", borderRadius:6, padding:"7px 8px", fontSize:10 }}>
              {t("analysis_limited_notice")}
            </div>
          )}

          <textarea readOnly value={prompt}
            style={{ flex:1, minHeight:120, resize:"none", background:"var(--pl-bg-input)",
              border:"0.5px solid var(--pl-border)", borderRadius:6, color:"var(--pl-text-3)",
              fontFamily:"inherit", fontSize:10, lineHeight:1.45, padding:9, outline:"none" }} />

          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            {ollamaStatus.available && ollamaStatus.models?.length > 0 && (
              <Btn onClick={handleStartAnalysis} disabled={!rows.length || isGenerating}
                style={{ background:"var(--pl-accent)", color:"#fff", fontWeight:600 }}>
                {t("analysis_ollama_run")}
              </Btn>
            )}
            <Btn onClick={() => copyResultText(prompt)} disabled={!rows.length} title={t("analysis_copy_prompt_title")}>
              {t("analysis_copy_prompt")}
            </Btn>
            <Btn onClick={() => copyResultText(visibleExport)} disabled={!rows.length} title={t("copy_results_title")}>
              {t("copy_results")}
            </Btn>
          </div>
        </>
      ) : (
        <>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {isGenerating ? (
              <>
                <span style={{ color:"var(--pl-accent)", fontSize:11 }}>{t("analysis_ollama_analyzing")}</span>
                <Btn onClick={handleStopAnalysis} style={{ marginLeft:"auto" }}>
                  {t("analysis_ollama_stop")}
                </Btn>
              </>
            ) : (
              ollamaStatus.available && ollamaStatus.models?.length > 0 && (
                <Btn onClick={handleStartAnalysis} disabled={!rows.length}
                  style={{ background:"var(--pl-accent)", color:"#fff", fontWeight:600 }}>
                  {t("analysis_ollama_run")}
                </Btn>
              )
            )}
          </div>

          {generationError && (
            <div style={{ color:"var(--pl-status-warn)", background:"var(--pl-diag-warn-bg)",
              border:"0.5px solid var(--pl-status-warn)", borderRadius:6, padding:"7px 8px", fontSize:10 }}>
              {t("analysis_ollama_error_prefix")} {generationError}
            </div>
          )}

          <textarea readOnly value={diagnosisText || (isGenerating ? "..." : "")}
            placeholder={isGenerating ? t("analysis_ollama_analyzing") : t("analysis_ollama_hint")}
            style={{ flex:1, minHeight:160, resize:"none", background:"var(--pl-bg-input)",
              border:"0.5px solid var(--pl-border)", borderRadius:6, color:"var(--pl-text-3)",
              fontFamily:"inherit", fontSize:11, lineHeight:1.5, padding:9, outline:"none", whiteSpace:"pre-wrap" }} />

          <div style={{ display:"flex", gap:8 }}>
            <Btn onClick={() => copyResultText(diagnosisText)} disabled={!diagnosisText}>
              {t("analysis_ollama_copy_result")}
            </Btn>
          </div>
        </>
      )}
    </aside>
  );
}

export { AnalysisSidebar };
