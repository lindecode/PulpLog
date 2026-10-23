// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n.jsx";
import { buildResultText, copyResultText, fmtBytes, fmtNum, getModelLabel, getModelName, isChatModel } from "../utils.mjs";
import { buildChatMessages, buildContextSnapshot, effectiveContextTokens } from "../aiChat.mjs";
import { selectedLogRows } from "./LogRow.jsx";
import { Btn } from "./SharedUI.jsx";
import { Markdown } from "./Markdown.jsx";

const MAX_PROMPT_LINES = 2000;
const MAX_PROMPT_CHARS = 220000;
// Rows considered for the Ollama snapshot; the token budget usually keeps far fewer.
const MAX_AI_CANDIDATE_ROWS = 20000;
const WIDTH_KEY = "pulplog.ai.width";
const TABLE_KEY = "pulplog.ai.tableFormat";
const MIN_WIDTH = 380;
const DEFAULT_WIDTH = 680;

const AiSettingsCtx = createContext({ ollamaUrl:"", ollamaModel:"", ollamaContextTokens:16384, savePref:() => {} });

function redactSecrets(text) {
  return String(text || "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(authorization:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED_TOKEN]")
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]");
}

const joinCriteria = (main, extras) => [main, ...(extras || []).map(item => item?.text)].filter(Boolean).join(" → ");

function buildMetadata({ t, sourceLabel, filter, extraFilters, search, extraSearches, timeRange, stats, scope }) {
  const timeText = timeRange?.enabled
    ? `${timeRange.date || t("analysis_time_today")} ${timeRange.from || "*"}..${timeRange.to || "*"}`
    : t("analysis_none");
  const levelText = ["error", "warn", "info", "debug", "trace"]
    .map(key => `${key.toUpperCase()}: ${fmtNum(stats?.[key] || 0)}`)
    .join(", ");
  return [
    `${t("analysis_prompt_context")}:`,
    `- ${t("analysis_prompt_source")}: ${sourceLabel || t("analysis_unknown")}`,
    `- ${t("analysis_prompt_scope")}: ${scope}`,
    `- ${t("analysis_prompt_filter")}: ${joinCriteria(filter, extraFilters) || t("analysis_none")}`,
    `- ${t("analysis_prompt_search")}: ${joinCriteria(search, extraSearches) || t("analysis_none")}`,
    `- ${t("analysis_prompt_time")}: ${timeText}`,
    `- ${t("analysis_prompt_levels")}: ${levelText}`,
  ].join("\n");
}

function buildPrompt({ t, metadata, rows, task, lineLimitHit, charLimitHit }) {
  const logText = rows.map(item => `${item.origLine}\t${item.raw}`).join("\n");
  return [
    t("analysis_prompt_intro"),
    "",
    t(`analysis_task_${task}`),
    "",
    metadata,
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

// Answer-as-table is on by default; only an explicit "0" turns it off.
function readStoredTableFormat() {
  try { return localStorage.getItem(TABLE_KEY) !== "0"; } catch { return true; }
}

function readStoredWidth() {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return value >= MIN_WIDTH ? value : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

const iconBtn = { background:"none", border:0, color:"var(--pl-text-5)", cursor:"pointer", fontFamily:"inherit",
  fontSize:13, padding:"2px 5px", borderRadius:4 };

const tabBtn = active => ({
  background: active ? "var(--pl-bg-input)" : "none",
  border:"0.5px solid", borderColor: active ? "var(--pl-border)" : "transparent",
  borderRadius:5, color: active ? "var(--pl-text-1)" : "var(--pl-text-5)",
  cursor:"pointer", fontFamily:"inherit", fontSize:11, padding:"4px 10px",
});

const accentBtn = disabled => ({
  background:"var(--pl-accent)", border:"0.5px solid var(--pl-accent-hover)", borderRadius:6,
  color:"var(--pl-bg-app)", fontFamily:"inherit", fontSize:11, fontWeight:700, padding:"6px 12px",
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, whiteSpace:"nowrap",
});

const fmtCtx = tokens => `${Math.round(tokens / 1024)}K`;

const QUICK_TASKS = ["summary", "root_cause", "searches", "report"];

function AnalysisSidebar({ open = true, anchorRef, sourceLabel, filter, extraFilters, search, extraSearches, timeRange,
  visibleItems, sourceItems, selection, stats, onClose, onJumpToLine }) {
  const t = useLang();
  const aiSettings = useContext(AiSettingsCtx);
  const [redact, setRedact] = useState(true);
  const [tableFormat, setTableFormat] = useState(readStoredTableFormat);
  const [task, setTask] = useState("summary");
  const [tab, setTab] = useState("chat"); // "chat" | "context"

  const [ollamaStatus, setOllamaStatus] = useState({ available:false, models:[], error:null, url:"" });
  const [checkingOllama, setCheckingOllama] = useState(false);
  const [selectedModel, setSelectedModel] = useState(aiSettings.ollamaModel || "");
  const [messages, setMessages] = useState([]); // { id, role, content, label?, streaming?, error?, stopped?, meta? }
  const [snapshot, setSnapshot] = useState(null);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const [width, setWidth] = useState(readStoredWidth);
  const [maximized, setMaximized] = useState(false);
  const [top, setTop] = useState(96);

  const stopStreamRef = useRef(null);
  const pendingRef = useRef({ id:null, text:"" });
  const rafRef = useRef(0);
  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const inputRef = useRef(null);
  const asideRef = useRef(null);

  /* ── scope & prompt (only computed while visible) ── */
  const selectedRows = useMemo(
    () => open ? selectedLogRows(sourceItems || [], selection?.lines || new Set()) : [],
    [open, sourceItems, selection],
  );
  const baseRows = useMemo(() => {
    if (!open) return [];
    return selectedRows.length ? selectedRows : (visibleItems || []).filter(item => !item.separator);
  }, [open, selectedRows, visibleItems]);
  const scope = selectedRows.length ? t("analysis_scope_selection") : t("analysis_scope_visible");
  const metadata = useMemo(() => buildMetadata({
    t, sourceLabel, filter, extraFilters, search, extraSearches, timeRange, stats, scope,
  }), [t, sourceLabel, filter, extraFilters, search, extraSearches, timeRange, stats, scope]);
  const contextSignature = `${scope}|${baseRows.length}|${baseRows[0]?.origLine}|${baseRows[baseRows.length - 1]?.origLine}|${redact}|${metadata}`;

  const external = useMemo(() => {
    if (!open || tab !== "context") return null;
    const { rows: limitedRows, lineLimitHit, charLimitHit } = limitRows(baseRows);
    const rows = redact ? limitedRows.map(item => ({ ...item, raw: redactSecrets(item.raw) })) : limitedRows;
    return {
      rows, lineLimitHit, charLimitHit,
      prompt: buildPrompt({ t, metadata, rows, task, lineLimitHit, charLimitHit }),
    };
  }, [open, tab, baseRows, redact, t, metadata, task]);

  /* ── Ollama status & model ── */
  const chatModels = useMemo(() => (ollamaStatus.models || []).filter(isChatModel), [ollamaStatus.models]);
  const activeModel = chatModels.find(m => getModelName(m) === selectedModel) || null;
  const contextTokens = effectiveContextTokens(aiSettings.ollamaContextTokens, activeModel?.contextLength);
  const canChat = ollamaStatus.available && !!activeModel && !!window.electronAPI?.streamOllamaChat;

  const refreshOllama = useCallback(async () => {
    if (!window.electronAPI?.getOllamaStatus) return;
    setCheckingOllama(true);
    try {
      const status = await window.electronAPI.getOllamaStatus();
      setOllamaStatus(status);
      const usable = (status?.models || []).filter(isChatModel);
      if (status?.available && usable.length) {
        setSelectedModel(prev => {
          const wanted = prev || aiSettings.ollamaModel;
          if (wanted && usable.some(m => getModelName(m) === wanted)) return wanted;
          return getModelName(usable[0]);
        });
      }
    } catch (err) {
      setOllamaStatus({ available:false, models:[], error:err.message, url:aiSettings.ollamaUrl });
    } finally {
      setCheckingOllama(false);
    }
  }, [aiSettings.ollamaModel, aiSettings.ollamaUrl]);

  // Re-check whenever the panel opens or the server URL changes in settings.
  useEffect(() => { if (open) refreshOllama(); }, [open, aiSettings.ollamaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseModel = name => {
    setSelectedModel(name);
    if (name !== snapshot?.model) setSnapshot(null);
    aiSettings.savePref?.("ollamaModel", name);
  };

  /* ── streaming ── */
  const flushPending = useCallback(() => {
    rafRef.current = 0;
    const { id, text } = pendingRef.current;
    if (!id || !text) return;
    pendingRef.current = { id, text:"" };
    setMessages(prev => prev.map(m => m.id === id ? { ...m, content: m.content + text } : m));
  }, []);

  const finishMessage = useCallback((id, patch) => {
    cancelAnimationFrame(rafRef.current);
    flushPending();
    setMessages(prev => prev.map(m => m.id === id ? { ...m, streaming:false, ...patch } : m));
    setIsGenerating(false);
    stopStreamRef.current = null;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [flushPending]);

  useEffect(() => () => {
    stopStreamRef.current?.();
    cancelAnimationFrame(rafRef.current);
  }, []);

  const makeSnapshot = useCallback(() => {
    const candidates = baseRows.slice(-MAX_AI_CANDIDATE_ROWS);
    const rows = redact ? candidates.map(item => ({ ...item, raw: redactSecrets(item.raw) })) : candidates;
    const built = buildContextSnapshot({
      instructions: t("analysis_system"),
      metadata,
      rows,
      contextTokens,
      describeRows: included => `- ${t("analysis_prompt_rows")}: ${t("analysis_rows_included", fmtNum(included), fmtNum(baseRows.length))}`,
    });
    return { ...built, total: baseRows.length, scope, signature: contextSignature, model: selectedModel };
  }, [baseRows, redact, t, metadata, contextTokens, scope, contextSignature, selectedModel]);

  const send = useCallback((content, label) => {
    const text = String(content || "").trim();
    if (!text || isGenerating || !canChat) return;
    let snap = snapshot;
    if (!snap || snap.contextTokens !== contextTokens || snap.model !== selectedModel) {
      snap = makeSnapshot();
      setSnapshot(snap);
    }
    const stamp = Date.now();
    const userMsg = { id:`u${stamp}`, role:"user", content:text, label };
    const assistantId = `a${stamp}`;
    const history = [...messages.filter(m => !m.error && m.content.trim()), userMsg]
      .map(({ role, content: body }) => ({ role, content: body }));
    // The format request only travels with the question being sent; the chat shows the plain question.
    if (tableFormat) history[history.length - 1].content += `\n\n${t("analysis_table_instruction")}`;

    setMessages(prev => [...prev, userMsg, { id:assistantId, role:"assistant", content:"", streaming:true }]);
    setInput("");
    setIsGenerating(true);
    setTab("chat");
    stickToBottomRef.current = true;
    pendingRef.current = { id:assistantId, text:"" };

    stopStreamRef.current = window.electronAPI.streamOllamaChat(
      { model:selectedModel, messages:buildChatMessages(snap, history), maxContext:activeModel?.contextLength || 0 },
      {
        onChunk: chunk => {
          if (pendingRef.current.id !== assistantId) return;
          pendingRef.current.text += chunk;
          if (!rafRef.current) rafRef.current = requestAnimationFrame(flushPending);
        },
        onDone: meta => finishMessage(assistantId, { meta }),
        onError: err => finishMessage(assistantId, { error:String(err || "") }),
      },
    );
  }, [isGenerating, canChat, snapshot, contextTokens, selectedModel, makeSnapshot, messages, tableFormat, t, activeModel, flushPending, finishMessage]);

  const toggleTableFormat = value => {
    setTableFormat(value);
    try { localStorage.setItem(TABLE_KEY, value ? "1" : "0"); } catch {}
  };

  const stop = useCallback(() => {
    const id = pendingRef.current.id;
    stopStreamRef.current?.();
    if (id) finishMessage(id, { stopped:true });
  }, [finishMessage]);

  const newConversation = useCallback(() => {
    if (isGenerating) stop();
    setMessages([]);
    setSnapshot(null);
    pendingRef.current = { id:null, text:"" };
    inputRef.current?.focus();
  }, [isGenerating, stop]);

  const refreshContext = () => setSnapshot(canChat ? makeSnapshot() : null);

  const copyConversation = () => copyResultText(messages
    .filter(m => m.content)
    .map(m => `### ${m.role === "user" ? t("analysis_you") : selectedModel}\n\n${m.content}`)
    .join("\n\n"));

  /* ── layout: follow the toolbar height, resizable width ── */
  useLayoutEffect(() => {
    const el = anchorRef?.current;
    if (!el) return undefined;
    const update = () => setTop(el.offsetTop + el.offsetHeight + 6);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchorRef]);

  const startResize = event => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = asideRef.current?.offsetWidth || width;
    const maxWidth = (asideRef.current?.parentElement?.clientWidth || window.innerWidth) - 20;
    let latest = startWidth;
    const move = e => {
      latest = Math.max(MIN_WIDTH, Math.min(maxWidth, startWidth + (startX - e.clientX)));
      setWidth(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      try { localStorage.setItem(WIDTH_KEY, String(Math.round(latest))); } catch {}
    };
    document.body.style.cursor = "ew-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ── auto-scroll while streaming unless the user scrolled up ── */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, tab, open]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const contextChanged = !!snapshot && snapshot.signature !== contextSignature;
  // Default questions, in the UI language; ones already asked in this conversation are hidden.
  const pendingSuggestions = useMemo(() => {
    const list = t(selectedRows.length ? "analysis_suggested_selection" : "analysis_suggested");
    const asked = new Set(messages.filter(m => m.role === "user").map(m => m.content));
    return (Array.isArray(list) ? list : []).filter(question => !asked.has(question));
  }, [t, selectedRows.length, messages]);
  const statusText = checkingOllama ? "…"
    : ollamaStatus.available ? t("analysis_ollama_active")
    : t("analysis_ollama_offline_short");

  return (
    <aside ref={asideRef} aria-hidden={!open}
      style={{ position:"absolute", top, right:10, bottom:32, left: maximized ? 10 : "auto",
        width: maximized ? "auto" : `min(${width}px, calc(100% - 20px))`,
        zIndex:20, display: open ? "flex" : "none", flexDirection:"column", gap:8, padding:"10px 12px 12px",
        background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:8,
        boxShadow:"0 12px 40px rgba(0,0,0,.55)", fontFamily:"inherit" }}>

      {!maximized && (
        <div onPointerDown={startResize} title={t("analysis_resize_title")}
          style={{ position:"absolute", left:-3, top:0, bottom:0, width:7, cursor:"ew-resize", zIndex:1 }} />
      )}

      {/* header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <div style={{ color:"var(--pl-text-1)", fontSize:13, fontWeight:700 }}>{t("analysis_title")}</div>
        <span title={ollamaStatus.available ? ollamaStatus.url : `${ollamaStatus.url || ""} ${ollamaStatus.error || ""}`}
          style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:10, color:"var(--pl-text-5)" }}>
          <span style={{ width:7, height:7, borderRadius:"50%",
            background: ollamaStatus.available ? "var(--pl-status-live)" : "var(--pl-text-7)" }} />
          {statusText}
        </span>
        {ollamaStatus.available && chatModels.length > 0 && (
          <select value={selectedModel} onChange={e => chooseModel(e.target.value)} disabled={isGenerating}
            title={t("analysis_ollama_models")}
            style={{ flex:"0 1 240px", minWidth:120, background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
              borderRadius:5, color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:11, padding:"3px 6px" }}>
            {chatModels.map(m => {
              const name = getModelName(m);
              return <option key={name} value={name}>{getModelLabel(m)}</option>;
            })}
          </select>
        )}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:2 }}>
          <button type="button" onClick={refreshOllama} disabled={checkingOllama} title={t("analysis_ollama_refresh")} style={iconBtn}>↻</button>
          <button type="button" onClick={() => setMaximized(v => !v)}
            title={maximized ? t("analysis_restore") : t("analysis_maximize")} style={iconBtn}>
            {maximized ? "⤡" : "⤢"}
          </button>
          <button type="button" onClick={onClose} title={t("close")} style={iconBtn}>✕</button>
        </div>
      </div>

      {/* tabs */}
      <div style={{ display:"flex", alignItems:"center", gap:4, borderBottom:"0.5px solid var(--pl-border)", paddingBottom:6 }}>
        <button type="button" onClick={() => setTab("chat")} style={tabBtn(tab === "chat")}>{t("analysis_tab_chat")}</button>
        <button type="button" onClick={() => setTab("context")} style={tabBtn(tab === "context")}>{t("analysis_tab_context")}</button>
        {tab === "chat" && messages.length > 0 && (
          <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
            <Btn onClick={copyConversation} title={t("analysis_copy_chat_title")}>{t("analysis_copy_chat")}</Btn>
            <Btn onClick={newConversation} title={t("analysis_new_chat_title")}>{t("analysis_new_chat")}</Btn>
          </div>
        )}
      </div>

      {tab === "chat" ? (
        <>
          <div ref={scrollRef} onScroll={onScroll}
            style={{ flex:1, minHeight:0, overflowY:"auto", display:"flex", flexDirection:"column", gap:12, paddingRight:4 }}>
            {!ollamaStatus.available && !checkingOllama ? (
              <OfflineNotice t={t} status={ollamaStatus} onRetry={refreshOllama} />
            ) : ollamaStatus.available && !chatModels.length ? (
              <Notice>{t("analysis_ollama_no_chat_models")}<br />{t("analysis_ollama_hint")}</Notice>
            ) : messages.length === 0 ? (
              <EmptyChat t={t} disabled={!canChat || !baseRows.length} suggestions={pendingSuggestions}
                onAsk={question => send(question)}
                onTask={key => send(t(`analysis_task_${key}`), t(`analysis_task_label_${key}`))} />
            ) : messages.map(message => (
              <ChatMessage key={message.id} t={t} message={message} model={selectedModel} onJumpToLine={onJumpToLine} />
            ))}
          </div>

          {/* context status */}
          <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:10, color:"var(--pl-text-6)", flexWrap:"wrap" }}>
            <span style={{ minWidth:0 }}>
              {snapshot
                ? t("analysis_ctx_snapshot", fmtNum(snapshot.included), fmtNum(snapshot.total), fmtNum(snapshot.tokens), fmtCtx(snapshot.contextTokens))
                : t("analysis_ctx_pending", fmtNum(baseRows.length), scope, fmtCtx(contextTokens))}
            </span>
            {snapshot?.truncated && <span style={{ color:"var(--pl-status-warn)" }}>{t("analysis_ctx_truncated")}</span>}
            {contextChanged && (
              <button type="button" onClick={refreshContext} disabled={isGenerating}
                style={{ background:"none", border:0, padding:0, color:"var(--pl-accent-hover)", cursor:"pointer",
                  fontFamily:"inherit", fontSize:10, textDecoration:"underline" }}>
                {t("analysis_ctx_changed")}
              </button>
            )}
            <label title={t("analysis_table_format_title")}
              style={{ marginLeft:"auto", display:"inline-flex", alignItems:"center", gap:5, color:"var(--pl-text-4)",
                fontSize:11, cursor:"pointer", whiteSpace:"nowrap" }}>
              <input type="checkbox" checked={tableFormat} onChange={event => toggleTableFormat(event.target.checked)} />
              {t("analysis_table_format")}
            </label>
          </div>

          {/* composer */}
          {messages.length > 0 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {pendingSuggestions.slice(0, 3).map(question => (
                <Chip key={question} suggestion disabled={!canChat || isGenerating} onClick={() => send(question)}>
                  {question}
                </Chip>
              ))}
              {QUICK_TASKS.map(key => (
                <Chip key={key} disabled={!canChat || isGenerating}
                  onClick={() => send(t(`analysis_task_${key}`), t(`analysis_task_label_${key}`))}>
                  {t(`analysis_task_label_${key}`)}
                </Chip>
              ))}
            </div>
          )}
          <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send(input);
                }
              }}
              disabled={!canChat}
              placeholder={canChat ? t("analysis_chat_ph") : t("analysis_chat_ph_disabled")}
              rows={Math.min(8, Math.max(2, input.split("\n").length))}
              style={{ flex:1, resize:"none", background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                borderRadius:6, color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:12, lineHeight:1.45,
                padding:"7px 9px", outline:"none" }} />
            {isGenerating ? (
              <button type="button" onClick={stop} style={{ ...accentBtn(false), background:"var(--pl-error-bg)",
                borderColor:"var(--pl-error-border)", color:"var(--pl-error-text)" }}>{t("analysis_ollama_stop")}</button>
            ) : (
              <button type="button" onClick={() => send(input)} disabled={!canChat || !input.trim() || !baseRows.length}
                title={t("analysis_send_title")} style={accentBtn(!canChat || !input.trim() || !baseRows.length)}>
                {t("analysis_send")}
              </button>
            )}
          </div>
        </>
      ) : (
        <div style={{ flex:1, minHeight:0, overflowY:"auto", display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ color:"var(--pl-text-5)", fontSize:10, lineHeight:1.5 }}>
            {t("analysis_scope_detail", scope, fmtNum(baseRows.length), fmtBytes(external?.prompt.length || 0))}
          </div>
          <label style={{ display:"flex", alignItems:"center", gap:8, color:"var(--pl-text-4)", fontSize:11 }}>
            <input type="checkbox" checked={redact} onChange={event => setRedact(event.target.checked)} />
            {t("analysis_redact")}
          </label>

          <SectionTitle>{t("analysis_ollama_h")}</SectionTitle>
          <div style={{ color:"var(--pl-text-5)", fontSize:10, lineHeight:1.5 }}>
            {snapshot
              ? t("analysis_ctx_snapshot", fmtNum(snapshot.included), fmtNum(snapshot.total), fmtNum(snapshot.tokens), fmtCtx(snapshot.contextTokens))
              : t("analysis_ctx_pending", fmtNum(baseRows.length), scope, fmtCtx(contextTokens))}
          </div>
          {snapshot && (
            <details>
              <summary style={{ cursor:"pointer", color:"var(--pl-text-4)", fontSize:11 }}>{t("analysis_ctx_view")}</summary>
              <textarea readOnly value={snapshot.system}
                style={{ marginTop:6, width:"100%", boxSizing:"border-box", height:220, resize:"vertical", background:"var(--pl-bg-input)",
                  border:"0.5px solid var(--pl-border)", borderRadius:6, color:"var(--pl-text-3)",
                  fontFamily:"inherit", fontSize:10, lineHeight:1.45, padding:9, outline:"none" }} />
            </details>
          )}

          <SectionTitle>{t("analysis_external_h")}</SectionTitle>
          <select value={task} onChange={event => setTask(event.target.value)}
            style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:6,
              color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:11, padding:"6px 8px" }}>
            {QUICK_TASKS.map(key => <option key={key} value={key}>{t(`analysis_task_label_${key}`)}</option>)}
          </select>
          {(external?.lineLimitHit || external?.charLimitHit) && (
            <Notice warn>{t("analysis_limited_notice")}</Notice>
          )}
          <textarea readOnly value={external?.prompt || ""}
            style={{ flex:1, minHeight:160, resize:"none", background:"var(--pl-bg-input)",
              border:"0.5px solid var(--pl-border)", borderRadius:6, color:"var(--pl-text-3)",
              fontFamily:"inherit", fontSize:10, lineHeight:1.45, padding:9, outline:"none" }} />
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <Btn onClick={() => copyResultText(external?.prompt || "")} disabled={!baseRows.length} title={t("analysis_copy_prompt_title")}>
              {t("analysis_copy_prompt")}
            </Btn>
            <Btn onClick={() => copyResultText(buildResultText({
              source: sourceLabel, filter, timeRange, items: external?.rows || [],
              total: sourceItems?.filter(item => !item.separator).length || 0,
            }))} disabled={!baseRows.length} title={t("copy_results_title")}>
              {t("copy_results")}
            </Btn>
          </div>
        </div>
      )}
    </aside>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginTop:4 }}>{children}</div>;
}

function Notice({ children, warn }) {
  return (
    <div style={{ color: warn ? "var(--pl-status-warn)" : "var(--pl-text-4)",
      background: warn ? "var(--pl-diag-warn-bg)" : "var(--pl-bg-input)",
      border:`0.5px solid ${warn ? "var(--pl-status-warn)" : "var(--pl-border)"}`, borderRadius:6,
      padding:"8px 10px", fontSize:11, lineHeight:1.5 }}>
      {children}
    </div>
  );
}

function OfflineNotice({ t, status, onRetry }) {
  return (
    <Notice warn>
      <div style={{ fontWeight:700, marginBottom:4 }}>{t("analysis_ollama_offline", status.url || "")}</div>
      {status.error && <div style={{ fontSize:10, opacity:.85, marginBottom:6 }}>{status.error}</div>}
      <div style={{ color:"var(--pl-text-4)", marginBottom:8 }}>{t("analysis_ollama_hint")}</div>
      <Btn onClick={onRetry}>{t("analysis_ollama_refresh")}</Btn>
    </Notice>
  );
}

function Chip({ children, onClick, disabled, suggestion }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      style={{ background: suggestion ? "color-mix(in srgb, var(--pl-accent) 10%, var(--pl-bg-input))" : "var(--pl-bg-input)",
        border:`0.5px solid ${suggestion ? "color-mix(in srgb, var(--pl-accent) 40%, var(--pl-border))" : "var(--pl-border)"}`,
        borderRadius:12, color: suggestion ? "var(--pl-text-2)" : "var(--pl-text-4)", textAlign:"left",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        fontFamily:"inherit", fontSize:10, lineHeight:1.4, padding:"3px 9px" }}>
      {children}
    </button>
  );
}

function EmptyChat({ t, disabled, suggestions, onAsk, onTask }) {
  return (
    <div style={{ margin:"auto 0", display:"flex", flexDirection:"column", gap:10, alignItems:"stretch" }}>
      <div style={{ color:"var(--pl-text-4)", fontSize:12, lineHeight:1.5, textAlign:"center" }}>{t("analysis_chat_empty")}</div>
      <div style={{ display:"flex", flexDirection:"column", gap:6, alignItems:"flex-start" }}>
        <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1 }}>{t("analysis_suggested_h")}</div>
        {suggestions.map(question => (
          <Chip key={question} suggestion disabled={disabled} onClick={() => onAsk(question)}>{question}</Chip>
        ))}
      </div>
      <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700, letterSpacing:1, marginTop:4 }}>{t("analysis_quick_h")}</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))", gap:8 }}>
        {QUICK_TASKS.map(key => (
          <button key={key} type="button" disabled={disabled} onClick={() => onTask(key)}
            style={{ textAlign:"left", background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:8,
              padding:"9px 11px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily:"inherit" }}>
            <div style={{ color:"var(--pl-text-1)", fontSize:12, fontWeight:700, marginBottom:3 }}>{t(`analysis_task_label_${key}`)}</div>
            <div style={{ color:"var(--pl-text-5)", fontSize:10, lineHeight:1.4 }}>{t(`analysis_task_hint_${key}`)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatMessage({ t, message, model, onJumpToLine }) {
  const [copied, setCopied] = useState(false);
  if (message.role === "user") {
    return (
      <div style={{ alignSelf:"flex-end", maxWidth:"85%", background:"color-mix(in srgb, var(--pl-accent) 14%, var(--pl-bg-input))",
        border:"0.5px solid color-mix(in srgb, var(--pl-accent) 35%, var(--pl-border))", borderRadius:"10px 10px 2px 10px",
        padding:"7px 10px", color:"var(--pl-text-1)", fontSize:12, lineHeight:1.5, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
        {message.label ? <span style={{ fontWeight:700 }}>{message.label}</span> : message.content}
      </div>
    );
  }
  const meta = message.meta || {};
  const seconds = meta.evalDuration ? meta.evalDuration / 1e9 : 0;
  const copy = async () => {
    await copyResultText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <div style={{ fontSize:10, color:"var(--pl-text-6)", fontWeight:700 }}>{model}</div>
      {message.content
        ? <Markdown text={message.content} onJumpToLine={onJumpToLine} />
        : message.streaming && <div style={{ color:"var(--pl-accent)", fontSize:11 }}>{t("analysis_ollama_analyzing")}</div>}
      {message.streaming && message.content && <span style={{ color:"var(--pl-accent)", fontSize:11 }}>▍</span>}
      {message.error && (
        <Notice warn>{t("analysis_ollama_error_prefix")} {message.error}</Notice>
      )}
      {!message.streaming && (message.content || message.stopped) && (
        <div style={{ display:"flex", alignItems:"center", gap:10, fontSize:10, color:"var(--pl-text-6)" }}>
          {message.content && (
            <button type="button" onClick={copy}
              style={{ background:"none", border:0, padding:0, color:"var(--pl-text-5)", cursor:"pointer", fontFamily:"inherit", fontSize:10 }}>
              {copied ? t("analysis_copied") : t("analysis_copy")}
            </button>
          )}
          {meta.evalCount > 0 && seconds > 0 && (
            <span>{t("analysis_stats", fmtNum(meta.evalCount), (meta.evalCount / seconds).toFixed(1), (meta.totalDuration / 1e9).toFixed(1))}</span>
          )}
          {message.stopped && <span>{t("analysis_stopped")}</span>}
          {meta.doneReason === "length" && <span style={{ color:"var(--pl-status-warn)" }}>{t("analysis_truncated_answer")}</span>}
        </div>
      )}
    </div>
  );
}

export { AnalysisSidebar, AiSettingsCtx };
