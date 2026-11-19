// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Visual jump chain: Your computer → hop → hop → destination.
// Each hop has its own user, port, key and password (optionally saved in the vault);
// the first one may instead be a command (ProxyCommand: AWS SSM, IAP, cloudflared, tsh).
import React from "react";
import { useLang } from "../i18n.jsx";
import { emptyHop, chainSummary, chainProblem, MAX_HOPS } from "../jumpChain.mjs";

const smallBtn = {
  background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:5,
  color:"var(--pl-text-4)", fontFamily:"inherit", fontSize:11, padding:"4px 8px", cursor:"pointer",
};

export function JumpChainEditor({ jumps, onChange, destination, inputStyle, configuredHosts = [],
                                  allowKeyFiles = true, onPickKey, vaultUnlocked = false, chainResult = null }) {
  const t = useLang();
  const update = (index, patch) => onChange(jumps.map((hop, i) => i === index ? { ...hop, ...patch } : hop));
  const remove = index => onChange(jumps.filter((_, i) => i !== index));
  const move = (index, delta) => {
    const next = [...jumps];
    const [hop] = next.splice(index, 1);
    next.splice(index + delta, 0, hop);
    onChange(next);
  };
  const problem = chainProblem(jumps);
  const stepFor = hop => chainResult?.steps?.find(step => step.label && hop.host && step.label.includes(hop.host));

  return (
    <fieldset style={{ border:"0.5px solid var(--pl-border)", borderRadius:6, padding:"8px 10px 10px", margin:"0 0 10px" }}>
      <legend style={{ color:"var(--pl-text-3)", fontSize:11, fontWeight:700, padding:"0 4px" }}>{t("jump_title")}</legend>
      <div style={{ color:"var(--pl-text-5)", fontSize:10, marginBottom:8, wordBreak:"break-word" }}>
        {chainSummary(jumps, destination, t("jump_origin"))}
      </div>

      {jumps.map((hop, index) => {
        const step = stepFor(hop);
        return (
          <div key={index} style={{ border:"0.5px solid var(--pl-border-soft)", borderRadius:6, padding:8, marginBottom:8,
                                    background:"var(--pl-bg-input)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6, flexWrap:"wrap" }}>
              <span style={{ color:"var(--pl-text-4)", fontSize:11, fontWeight:700 }}>{t("jump_hop", index + 1)}</span>
              <select value={hop.type} onChange={e => update(index, { type:e.target.value })}
                style={{ ...inputStyle, width:"auto", padding:"3px 6px", fontSize:11 }}>
                <option value="tunnel">{t("jump_type_tunnel")}</option>
                <option value="command" disabled={index !== 0}>{t("jump_type_command")}</option>
              </select>
              {step && (
                <span style={{ fontSize:10, color: step.ok ? "var(--pl-status-live)" : "var(--pl-error-text)" }}>
                  {step.ok ? `✓ ${step.ms} ms${step.newKey ? ` · ${t("jump_new_key")}` : ""}` : `✗ ${step.error}`}
                </span>
              )}
              <span style={{ marginLeft:"auto", display:"flex", gap:4 }}>
                <button type="button" style={smallBtn} disabled={index === 0} onClick={() => move(index, -1)} title={t("jump_up")}>↑</button>
                <button type="button" style={smallBtn} disabled={index === jumps.length - 1} onClick={() => move(index, 1)} title={t("jump_down")}>↓</button>
                <button type="button" style={{ ...smallBtn, color:"var(--pl-error-text)" }} onClick={() => remove(index)} title={t("jump_remove")}>✕</button>
              </span>
            </div>

            {hop.type === "command" ? (
              <>
                <input style={inputStyle} value={hop.command || ""} onChange={e => update(index, { command:e.target.value })}
                  placeholder="aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p" />
                <div style={{ color:"var(--pl-status-warn)", fontSize:10, marginTop:4 }}>{t("jump_command_warning")}</div>
              </>
            ) : (
              <>
                <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 70px", gap:6, marginBottom:6 }}>
                  <input style={inputStyle} value={hop.host} list={`jump-hosts-${index}`} onChange={e => update(index, { host:e.target.value })}
                    placeholder={t("jump_host")} />
                  <datalist id={`jump-hosts-${index}`}>{configuredHosts.map(host => <option key={host} value={host} />)}</datalist>
                  <input style={inputStyle} value={hop.user} onChange={e => update(index, { user:e.target.value })} placeholder={t("remote_user")} />
                  <input style={inputStyle} value={hop.port} inputMode="numeric" aria-label={t("jump_port")}
                    onChange={e => update(index, { port:e.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="22" />
                </div>
                <div style={{ display:"grid", gridTemplateColumns: allowKeyFiles ? "1fr auto 1fr" : "1fr", gap:6, alignItems:"center" }}>
                  {allowKeyFiles && <>
                    <input style={inputStyle} value={hop.identityFile} onChange={e => update(index, { identityFile:e.target.value })}
                      placeholder={`${t("remote_key")} (${t("jump_optional")})`} />
                    <button type="button" style={smallBtn} onClick={async () => { const fp = await onPickKey?.(); if (fp) update(index, { identityFile:fp }); }}>
                      {t("remote_key_pick")}
                    </button>
                  </>}
                  <input style={inputStyle} type="password" value={hop.password || ""} autoComplete="off"
                    onChange={e => update(index, { password:e.target.value, ...(e.target.value ? {} : { rememberPassword:false }) })}
                    placeholder={hop.vaultCredentialId && !hop.password ? t("jump_password_saved") : `${t("remote_password")} (${t("jump_optional")})`} />
                </div>
                {hop.password && (
                  <label title={vaultUnlocked ? "" : t("vault_unlock_before_save")}
                    style={{ display:"flex", gap:6, alignItems:"center", color:"var(--pl-text-4)", fontSize:10, marginTop:6 }}>
                    <input type="checkbox" checked={!!hop.rememberPassword} disabled={!vaultUnlocked}
                      onChange={e => update(index, { rememberPassword:e.target.checked })} />
                    {t("remote_save_password")}
                  </label>
                )}
              </>
            )}
          </div>
        );
      })}

      {problem === "command-first" && <div role="alert" style={{ color:"var(--pl-error-text)", fontSize:10, marginBottom:6 }}>{t("jump_command_first")}</div>}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <button type="button" style={smallBtn} disabled={jumps.length >= MAX_HOPS} onClick={() => onChange([...jumps, emptyHop()])}>
          + {t("jump_add")}
        </button>
        <span style={{ color:"var(--pl-text-6)", fontSize:10 }}>{t("jump_hint")}</span>
      </div>
    </fieldset>
  );
}
