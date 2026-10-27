// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import React, { useEffect, useState } from "react";
import { useLang } from "../i18n.jsx";

const defaults = { ollama:"http://127.0.0.1:11434", vllm:"http://127.0.0.1:8000/v1" };
const fieldStyle = { background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:5,
  color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:11, padding:"6px 8px", minWidth:0 };
const labelStyle = { display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, color:"var(--pl-text-3)", fontSize:11 };

function normalizeUrl(value, provider) {
  const url = new URL(value.trim() || defaults[provider]);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  url.pathname = url.pathname.replace(/\/+$/, "") || (provider === "vllm" ? "/v1" : "/");
  return url.toString().replace(/\/+$/, "");
}

export function AiProviderSettings({ settings, onTogglePref }) {
  const t = useLang();
  const provider = settings.aiProvider || "ollama";
  return <div style={{ display:"flex", flexDirection:"column", gap:10, borderTop:"1px solid var(--pl-border-soft)", paddingTop:14 }}>
    <label style={labelStyle}>
      <span style={{ flex:1 }}>{t("pref_ai_provider")}</span>
      <select value={provider} style={fieldStyle} onChange={event => onTogglePref("aiProvider", event.target.value)}>
        <option value="ollama">Ollama</option><option value="vllm">vLLM</option>
      </select>
    </label>
    <ProviderFields key={provider} provider={provider} settings={settings} onTogglePref={onTogglePref} />
  </div>;
}

function ProviderFields({ provider, settings, onTogglePref }) {
  const t = useLang();
  const urlSetting = `${provider}Url`;
  const [url, setUrl] = useState(settings[urlSetting] || defaults[provider]);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(true);
  const [credential, setCredential] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { setUrl(settings[urlSetting] || defaults[provider]); }, [settings[urlSetting], provider]);
  let endpoint = "";
  try { endpoint = normalizeUrl(url, provider); } catch {}
  useEffect(() => {
    let disposed = false;
    setCredential(null); setResult(null);
    if (endpoint) window.electronAPI.getAiCredentialState({ provider, url:endpoint }).then(state => {
      if (disposed) return;
      setCredential(state); setRemember(state.configured ? state.persisted : state.canPersist);
    }).catch(() => { if (!disposed) setResult({ ok:false, text:t("ai_settings_failed") }); });
    return () => { disposed = true; };
  }, [provider, endpoint, t]);

  const commitUrl = () => {
    if (!endpoint) return;
    setUrl(endpoint);
    if (endpoint !== settings[urlSetting]) onTogglePref(urlSetting, endpoint);
  };
  const credentialsChanged = state => {
    setCredential(state); setApiKey(""); setShowKey(false);
    setRemember(state.configured ? state.persisted : state.canPersist);
    onTogglePref("aiCredentialRevision", state.revision);
  };
  const apply = async test => {
    if (!endpoint || busy) return;
    setBusy(true); setResult(null); commitUrl();
    try {
      if (apiKey) credentialsChanged(await window.electronAPI.setAiCredential({ provider, url:endpoint, key:apiKey, remember }));
      if (test) {
        const status = await window.electronAPI.testAiConnection({ provider, url:endpoint });
        setResult({ ok:status.available, text:status.available ? t("ai_test_ok", status.models.length) : status.error || t("ai_test_failed") });
      } else setResult({ ok:true, text:t("ai_key_saved") });
    } catch { setResult({ ok:false, text:t("ai_settings_failed") }); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setResult(null);
    try {
      credentialsChanged(await window.electronAPI.setAiCredential({ provider, url:endpoint, key:"", remember:false }));
      setResult({ ok:true, text:t("ai_key_removed") });
    } catch { setResult({ ok:false, text:t("ai_settings_failed") }); }
    finally { setBusy(false); }
  };
  const remote = endpoint && !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(new URL(endpoint).hostname);
  const keyValid = apiKey.length <= 8192 && !/[^\x21-\x7e]/.test(apiKey);
  return <>
    <label style={labelStyle}>
      <span style={{ flexBasis:110 }}>{t("ai_server_url")}</span>
      <input value={url} onChange={event => setUrl(event.target.value)} onBlur={commitUrl} disabled={busy}
        onKeyDown={event => { if (event.key === "Enter") commitUrl(); }}
        aria-invalid={!endpoint} title={!endpoint ? t("pref_ai_url_invalid") : undefined}
        placeholder={defaults[provider]} style={{ ...fieldStyle, flex:"1 1 220px" }} />
      <button type="button" title={t("ai_restore_url")} aria-label={t("ai_restore_url")} disabled={busy}
        onClick={() => { setUrl(defaults[provider]); onTogglePref(urlSetting, defaults[provider]); }}
        style={{ ...fieldStyle, cursor:"pointer", width:28, height:28, padding:0 }}>&#8634;</button>
    </label>
    {!endpoint && <div role="alert" style={{ color:"var(--pl-error-text)", fontSize:10 }}>{t("pref_ai_url_invalid")}</div>}
    <label style={labelStyle}>
      <span style={{ flexBasis:110 }}>{t("ai_api_key")}</span>
      <input type={showKey ? "text" : "password"} value={apiKey} onChange={event => setApiKey(event.target.value)}
        autoComplete="off" spellCheck={false} maxLength={8192} disabled={busy} aria-invalid={!keyValid}
        title={!keyValid ? t("ai_key_invalid") : undefined}
        placeholder={t(credential?.configured ? "ai_key_replace" : "ai_key_optional")}
        style={{ ...fieldStyle, flex:"1 1 220px" }} />
    </label>
    {!keyValid && <div role="alert" style={{ color:"var(--pl-error-text)", fontSize:10 }}>{t("ai_key_invalid")}</div>}
    <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", fontSize:10, color:"var(--pl-text-4)" }}>
      <label><input type="checkbox" checked={showKey} disabled={!apiKey || busy} onChange={event => setShowKey(event.target.checked)} /> {t("ai_show_key")}</label>
      <label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}
        disabled={busy || !credential?.canPersist || (credential?.configured && !apiKey)} /> {t("ai_remember_key")}</label>
      <span>{credential && t(credential.configured ? credential.persisted ? "ai_key_encrypted" : "ai_key_session" : "ai_key_none")}</span>
    </div>
    {credential && !credential.canPersist && <div style={{ color:"var(--pl-status-warn)", fontSize:10 }}>{t("ai_key_session_only")}</div>}
    {remote && <div style={{ color:"var(--pl-status-warn)", fontSize:10 }}>{t("pref_ollama_remote_warning")}</div>}
    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
      <button type="button" style={fieldStyle} disabled={busy || !endpoint || !keyValid || !apiKey} onClick={() => apply(false)}>{t("ai_save_key")}</button>
      <button type="button" style={fieldStyle} disabled={busy || !endpoint || !credential?.configured} onClick={remove}>{t("ai_remove_key")}</button>
      <button type="button" style={fieldStyle} disabled={busy || !endpoint || !keyValid || !credential} onClick={() => apply(true)}>
        {t(busy ? "ai_testing" : apiKey ? "ai_save_test" : "ai_test")}
      </button>
    </div>
    {result && <div role="status" style={{ fontSize:11, overflowWrap:"anywhere", color:result.ok ? "var(--pl-status-live)" : "var(--pl-error-text)" }}>{result.text}</div>}
    <label style={labelStyle}>
      <span style={{ flex:1 }} title={t("pref_ollama_context_title")}>{t("pref_ollama_context")}</span>
      <select value={settings.ollamaContextTokens || 16384} style={fieldStyle}
        onChange={event => onTogglePref("ollamaContextTokens", Number(event.target.value))}>
        {[4096, 8192, 16384, 32768, 65536, 131072].map(value => <option key={value} value={value}>{value / 1024}K tokens</option>)}
      </select>
    </label>
  </>;
}
