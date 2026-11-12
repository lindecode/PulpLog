// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import React, { useCallback, useEffect, useState } from "react";
import { useLang } from "../i18n.jsx";
import { Btn } from "./SharedUI.jsx";

const field = { background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:5,
  color:"var(--pl-text-3)", fontFamily:"inherit", fontSize:11, padding:"6px 8px" };

export function CredentialVaultSettings() {
  const t = useLang();
  const [state, setState] = useState({ configured:false, unlocked:false, count:0 });
  const [entries, setEntries] = useState([]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.getVaultState) return;
    const next = await window.electronAPI.getVaultState();
    setState(next);
    setEntries(next.unlocked ? await window.electronAPI.listVaultCredentials() : []);
  }, []);
  useEffect(() => { refresh().catch(error => setError(error.message)); }, [refresh]);

  const run = async action => {
    setBusy(true); setError("");
    try { await action(); setPassword(""); setConfirmPassword(""); await refresh(); }
    catch (error) { setError(error?.message || String(error)); }
    finally { setBusy(false); }
  };
  const create = () => {
    if (password !== confirmPassword) { setError(t("vault_password_mismatch")); return; }
    run(() => window.electronAPI.createVault(password));
  };
  const forgot = () => {
    if (!window.confirm(t("vault_forgot_confirm"))) return;
    if (!window.confirm(t("vault_forgot_confirm_final"))) return;
    run(() => window.electronAPI.resetVault());
  };
  const deleteVault = () => {
    if (!window.confirm(t("vault_delete_all_confirm"))) return;
    if (!window.confirm(t("vault_delete_all_confirm_final"))) return;
    run(() => window.electronAPI.resetVault());
  };

  return <div style={{ border:"0.5px solid var(--pl-border)", borderRadius:7, padding:12, marginTop:4 }}>
    <div style={{ fontSize:11, fontWeight:700, color:"var(--pl-text-2)", marginBottom:5 }}>{t("vault_title")}</div>
    <div style={{ fontSize:10, color:"var(--pl-text-5)", lineHeight:1.5, marginBottom:10 }}>{t("vault_description")}</div>

    {!state.configured && <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
      <input type="password" value={password} onChange={event => setPassword(event.target.value)}
        placeholder={t("vault_master_password")} style={field} />
      <input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}
        placeholder={t("vault_confirm_password")} style={field} />
      <Btn onClick={create} disabled={busy || password.length < 12}>{t("vault_create")}</Btn>
    </div>}

    {state.configured && !state.unlocked && <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
      <input type="password" value={password} onChange={event => setPassword(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") run(() => window.electronAPI.unlockVault(password)); }}
        placeholder={t("vault_master_password")} style={field} />
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <Btn onClick={() => run(() => window.electronAPI.unlockVault(password))} disabled={busy || !password}>{t("vault_unlock")}</Btn>
        <button type="button" onClick={forgot} disabled={busy} style={{ border:0, background:"none", color:"var(--pl-error-text)", cursor:"pointer", fontSize:10 }}>
          {t("vault_forgot")}
        </button>
      </div>
      <div style={{ fontSize:9, color:"var(--pl-status-warn)", lineHeight:1.4 }}>{t("vault_forgot_help")}</div>
    </div>}

    {state.unlocked && <>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
        <span style={{ color:"var(--pl-status-live)", fontSize:10 }}>{t("vault_unlocked", entries.length)}</span>
        <Btn onClick={() => run(() => window.electronAPI.lockVault())} disabled={busy}>{t("vault_lock")}</Btn>
      </div>
      {entries.length === 0 ? <div style={{ fontSize:10, color:"var(--pl-text-6)" }}>{t("vault_empty")}</div>
        : <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          {entries.map(entry => <div key={entry.id} style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 8px", background:"var(--pl-bg-input)", borderRadius:5 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:"var(--pl-text-3)", fontSize:10, fontWeight:700 }}>{entry.label}</div>
              <div style={{ color:"var(--pl-text-6)", fontSize:9, overflow:"hidden", textOverflow:"ellipsis" }}>{entry.username}{entry.username && "@"}{entry.target}</div>
              {(entry.blocked || entry.authFailures > 0) && <div style={{ color:entry.blocked ? "var(--pl-error-text)" : "var(--pl-status-warn)", fontSize:9, marginTop:2 }}>
                {entry.blocked ? t("vault_credential_blocked") : t("vault_auth_failures", entry.authFailures)}
              </div>}
            </div>
            <button type="button" onClick={() => window.confirm(t("vault_delete_confirm")) && run(() => window.electronAPI.deleteVaultCredential(entry.id))}
              style={{ border:0, background:"none", color:"var(--pl-error-text)", cursor:"pointer", fontSize:10 }}>{t("vault_delete")}</button>
          </div>)}
        </div>}
      <button type="button" onClick={deleteVault} disabled={busy}
        style={{ marginTop:10, border:0, background:"none", color:"var(--pl-error-text)", cursor:"pointer", fontSize:10 }}>
        {t("vault_delete_all")}
      </button>
    </>}
    {error && <div role="alert" style={{ color:"var(--pl-error-text)", fontSize:10, marginTop:8 }}>{error}</div>}
  </div>;
}
