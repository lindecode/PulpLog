import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLang } from "../i18n.jsx";
import { useDebouncedValue, useRowSelection, useEscapeToClose } from "../hooks.mjs";
import { useRememberedState, useBatchedLines, useFilteredLogs } from "../logHooks.mjs";
import { classifyLines, countLevels, appendRecentItems } from "../logProcessing.mjs";
import { createLogWorkerClient } from "../logWorkerClient.mjs";
import { IS_ELECTRON, reportMetric, safeFileName, buildResultText, copyResultText, exportResultText, fmtBytes, fmtNum } from "../utils.mjs";
import { VirtualList, SelectedLineStatus } from "./VirtualList.jsx";
import { ContextInput, Btn, Sep } from "./SharedUI.jsx";

function RemotePicker({ onSelect, onClose, capabilities, profiles = [], onProfilesChange, initialConfig = null }) {
  const t = useLang();
  const [mode, setMode] = useState(() => initialConfig?.mode || (capabilities?.ssh?.available ? "ssh" : "ssh-native"));
  const [target, setTarget] = useState(initialConfig?.target || "");
  const [user, setUser] = useState(initialConfig?.user || "");
  const [port, setPort] = useState(initialConfig?.port || "");
  const [proxyJump, setProxyJump] = useState(initialConfig?.proxyJump || "");
  const [identityFile, setIdentityFile] = useState(initialConfig?.identityFile || "");
  const [password, setPassword] = useState(initialConfig?.password || "");
  const [passphrase, setPassphrase] = useState(initialConfig?.passphrase || "");
  const [fingerprint, setFingerprint] = useState(initialConfig?.fingerprint || "");
  const [trustHostForSession, setTrustHostForSession] = useState(false);
  const [distro, setDistro] = useState(initialConfig?.distro || "");
  const [filePath, setFilePath] = useState(initialConfig?.filePath || "");
  const [tailLines, setTailLines] = useState(initialConfig?.tailLines || 500);
  const [historyPreset, setHistoryPreset] = useState(() => initialConfig?.historyMode === "full" ? "full:100"
    : initialConfig?.historyMode === "bytes" ? `bytes:${initialConfig?.maxInitialMb || 50}`
    : `lines:${initialConfig?.tailLines || 500}`);
  const [advanced, setAdvanced] = useState(initialConfig?.mode === "ssh-native");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [profileName, setProfileName] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const sshCap = capabilities?.ssh;
  const wslCap = capabilities?.wsl;
  const wslDistros = wslCap?.distros || [];
  const isWindows = capabilities?.platform === "win32";
  const isMac = capabilities?.platform === "darwin";
  const selectedWslDistro = distro || wslDistros[0] || "";
  const configuredHosts = mode === "ssh" ? (sshCap?.hosts || [])
    : mode === "ssh-wsl" ? (wslCap?.sshHosts?.[selectedWslDistro] || []) : [];
  const wslDistrosKey = wslDistros.join("|");
  const modeAvailable = mode === "wsl" || mode === "ssh-wsl" ? wslCap?.available : mode === "ssh-native" ? true : sshCap?.available;
  const hasNativeAuth = mode !== "ssh-native" || (user.trim() && (password || identityFile.trim()));
  const hostAccepted = mode !== "ssh-native" || Boolean(fingerprint.trim() && trustHostForSession);
  const discoveringHost = mode === "ssh-native" && !fingerprint.trim();
  const canTest = modeAvailable && mode !== "wsl" && target.trim() && (discoveringHost || filePath.trim())
    && (mode !== "ssh-native" || discoveringHost || hasNativeAuth);
  const canSubmit = modeAvailable && filePath.trim() && (mode === "wsl" || target.trim()) && hasNativeAuth && hostAccepted;
  const selectedModeHelp = mode === "ssh" ? t("remote_mode_ssh_help")
    : mode === "ssh-wsl" ? t("remote_mode_ssh_wsl_help")
    : mode === "ssh-native" ? t("remote_mode_native_help") : t("remote_mode_wsl_help");
  const authenticationHelp = mode === "ssh" ? t("remote_auth_system")
    : mode === "ssh-wsl" ? t("remote_auth_wsl")
    : mode === "ssh-native" ? t("remote_auth_native") : t("remote_auth_local");

  useEffect(() => {
    if (!capabilities) return;
    if (mode === "ssh" && !sshCap?.available) setMode("ssh-native");
    if ((mode === "wsl" || mode === "ssh-wsl") && !wslCap?.available) setMode(sshCap?.available ? "ssh" : "ssh-native");
  }, [capabilities, mode, sshCap?.available, wslCap?.available]);

  useEffect(() => {
    if ((mode !== "wsl" && mode !== "ssh-wsl") || distro || wslDistros.length === 0) return;
    setDistro(wslDistros[0]);
  }, [mode, distro, wslDistrosKey]);

  const submit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSelect(connectionConfig());
    setPassword("");
    setPassphrase("");
  };

  const pickIdentityFile = async () => {
    if (!IS_ELECTRON) return;
    const fp = await window.electronAPI.openSshKeyDialog();
    if (fp) setIdentityFile(fp);
  };

  const connectionConfig = () => ({ mode, target:target.trim(), user:user.trim(), port:String(port).trim(),
    identityFile:identityFile.trim(), proxyJump:proxyJump.trim(), password, passphrase, fingerprint:fingerprint.trim(),
    trustHostForSession, distro:distro.trim(), filePath:filePath.trim(), tailLines,
    historyMode:historyPreset.split(":")[0], maxInitialMb:Number(historyPreset.split(":")[1]) || 100 });

  const loadProfile = (id) => {
    setSelectedProfile(id);
    setTestResult(null);
    const profile = profiles.find(item => item.id === id);
    if (!profile) return;
    setMode(profile.mode || "ssh"); setTarget(profile.target || ""); setUser(profile.user || "");
    setPort(profile.port || ""); setIdentityFile(profile.identityFile || "");
    setProxyJump(profile.proxyJump || "");
    setFingerprint(profile.fingerprint || ""); setDistro(profile.distro || "");
    setFilePath(profile.filePath || ""); setTailLines(profile.tailLines || 500);
    setHistoryPreset(profile.historyMode === "full" ? "full:100"
      : profile.historyMode === "bytes" ? `bytes:${profile.maxInitialMb || 50}`
      : `lines:${profile.tailLines || 500}`);
    setProfileName(profile.name || ""); setTrustHostForSession(false);
  };

  const saveProfile = () => {
    const name = profileName.trim() || target.trim() || distro.trim() || "SSH";
    const id = selectedProfile || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safe = { ...connectionConfig(), id, name };
    delete safe.password; delete safe.passphrase; delete safe.trustHostForSession;
    const next = [...profiles.filter(item => item.id !== id), safe];
    setSelectedProfile(id); setProfileName(name); onProfilesChange?.(next);
  };

  const deleteProfile = () => {
    if (!selectedProfile) return;
    onProfilesChange?.(profiles.filter(item => item.id !== selectedProfile));
    setSelectedProfile(""); setProfileName("");
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const result = await window.electronAPI.testRemoteConnection(connectionConfig());
      if (result?.ok) {
        if (result.fingerprint) setFingerprint(result.fingerprint);
        setTestResult({ ok:true, message:t("remote_test_ok") });
      } else {
        const message = result?.error || t("capability_unavailable");
        const detected = message.match(/SHA256:[A-Za-z0-9+/=_-]+/)?.[0];
        if (detected) {
          setFingerprint(detected); setAdvanced(true);
          setTestResult({ ok:true, message:t("remote_identity_found") });
        } else {
          setTestResult({ ok:false, message });
        }
      }
    } catch (error) {
      setTestResult({ ok:false, message:error?.message ?? String(error) });
    } finally { setTesting(false); }
  };

  const inputStyle = {
    background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)", borderRadius:6,
    color:"var(--pl-text-2)", fontFamily:"inherit", fontSize:12, padding:"7px 9px",
    outline:"none", width:"100%",
  };
  useEscapeToClose(onClose);

  return (
    <div onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
               display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("remote_title")}
        style={{ background:"var(--pl-bg-panel)", border:"0.5px solid var(--pl-border-strong)", borderRadius:10,
                 padding:"24px", width:"min(620px, calc(100vw - 32px))", maxHeight:"90vh", overflowY:"auto", fontFamily:"inherit",
                 boxShadow:"0 8px 40px rgba(0,0,0,.8)" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:16 }}>
          <span style={{ fontSize:14, color:"var(--pl-text-1)", fontWeight:700 }}>{t("remote_title")}</span>
          <button type="button" onClick={() => setShowHelp(value => !value)}
            aria-expanded={showHelp} title={t("remote_help")}
            style={{ marginLeft:"auto", background:showHelp ? "var(--pl-bg-hover)" : "none",
              border:"0.5px solid var(--pl-border)", borderRadius:6, color:"var(--pl-accent-hover)",
              cursor:"pointer", fontSize:10, fontFamily:"inherit", padding:"4px 8px" }}>? {t("remote_help")}</button>
          <button type="button" onClick={onClose}
            style={{ marginLeft:8, background:"none", border:"none",
                     color:"var(--pl-text-6)", cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>x</button>
        </div>

        {showHelp && <div style={{ marginBottom:14, padding:"10px 12px", border:"0.5px solid var(--pl-border-focus)",
          borderRadius:8, background:"var(--pl-bg-input)", color:"var(--pl-text-4)", fontSize:10, lineHeight:1.5 }}>
          <details open>
            <summary style={{ cursor:"pointer", color:"var(--pl-text-2)", fontWeight:700 }}>{t("remote_help_agents")}</summary>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:10, marginTop:8 }}>
              {[
                ["Windows / PowerShell", [["Start-Service ssh-agent", t("remote_cmd_start")], ["ssh-add $env:USERPROFILE\\.ssh\\id_ed25519", t("remote_cmd_add")], ["ssh-add -l", t("remote_cmd_list")], ["ssh-add -D", t("remote_cmd_remove")], ["Stop-Service ssh-agent", t("remote_cmd_stop")]]],
                [isWindows ? "Linux / WSL2" : isMac ? "macOS" : "Linux", isMac
                  ? [["ssh-add --apple-use-keychain ~/.ssh/id_ed25519", t("remote_cmd_add")], ["ssh-add -l", t("remote_cmd_list")], ["ssh-add -D", t("remote_cmd_remove")]]
                  : [['eval "$(ssh-agent -s)"', t("remote_cmd_start")], ["ssh-add ~/.ssh/id_ed25519", t("remote_cmd_add")], ["ssh-add -l", t("remote_cmd_list")], ["ssh-add -D", t("remote_cmd_remove")], ["ssh-agent -k", t("remote_cmd_stop")]]],
              ].map(([heading, commands]) => <div key={heading}>
                <div style={{ fontWeight:700, color:"var(--pl-text-3)", marginBottom:4 }}>{heading}</div>
                {commands.map(([command, tip]) => <div key={command} title={tip} style={{ display:"flex", alignItems:"center", gap:5, marginTop:3 }}>
                  <code style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    background:"var(--pl-bg-app)", borderRadius:4, padding:"3px 5px", color:"var(--pl-text-3)" }}>{command}</code>
                  <button type="button" onClick={() => copyResultText(command)} title={`${tip} ${t("remote_help_copy")}: ${command}`}
                    style={{ border:"0.5px solid var(--pl-border)", borderRadius:4, background:"transparent",
                      color:"var(--pl-text-5)", cursor:"pointer", fontSize:9, padding:"3px 5px" }}>{t("remote_help_copy")}</button>
                </div>)}
              </div>)}
            </div>
          </details>
          <details style={{ marginTop:8 }}>
            <summary style={{ cursor:"pointer", color:"var(--pl-text-2)", fontWeight:700 }}>{t("remote_help_config")}</summary>
            <p style={{ margin:"6px 0" }}>{t("remote_help_config_text")}</p>
            <pre style={{ margin:0, padding:7, overflowX:"auto", background:"var(--pl-bg-app)", borderRadius:5,
              color:"var(--pl-text-3)" }}>{`Host produccion\n  HostName servidor.ejemplo.com\n  User usuario\n  IdentityFile ~/.ssh/id_ed25519`}</pre>
          </details>
          <details style={{ marginTop:8 }}>
            <summary style={{ cursor:"pointer", color:"var(--pl-text-2)", fontWeight:700 }}>{t("remote_help_access")}</summary>
            <p style={{ margin:"6px 0 0" }}>{t("remote_help_access_text")}</p>
          </details>
        </div>}

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8, marginBottom:12 }}>
          <select style={inputStyle} value={selectedProfile} onChange={e => loadProfile(e.target.value)}>
            <option value="">{t("remote_profile_new")}</option>
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
          <input style={inputStyle} value={profileName} onChange={e => setProfileName(e.target.value)}
            placeholder={t("remote_profile_name")} />
          <button type="button" onClick={saveProfile} disabled={!filePath.trim() || (mode !== "wsl" && !target.trim())}
            style={{ ...inputStyle, width:"auto", cursor:"pointer" }}>{t("remote_profile_save")}</button>
        </div>
        {selectedProfile && (
          <div style={{ textAlign:"right", marginTop:-8, marginBottom:8 }}>
            <button type="button" onClick={deleteProfile} style={{ border:0, background:"none",
              color:"var(--pl-error-text)", cursor:"pointer", fontSize:10 }}>{t("remote_profile_delete")}</button>
          </div>
        )}

        <div style={{ color:"var(--pl-text-3)", fontSize:11, fontWeight:700, marginBottom:8 }}>
          {t("remote_connection_type")}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:8, marginBottom:14 }}>
          {[
            ["ssh", t("remote_mode_ssh"), sshCap, t("remote_mode_ssh_help")],
            ["ssh-wsl", t("remote_mode_ssh_wsl"), wslCap, t("remote_mode_ssh_wsl_help")],
            ["ssh-native", t("remote_mode_native"), { available:true }, t("remote_mode_native_help")],
            ["wsl", t("remote_mode_wsl"), wslCap, t("remote_mode_wsl_help")],
          ].filter(([key]) => isWindows || (key !== "ssh-wsl" && key !== "wsl")).map(([key, label, cap, help]) => (
            <button key={key} type="button" onClick={() => cap?.available && setMode(key)}
              disabled={!cap?.available}
              title={cap?.available ? help : `${help}\n\n${cap?.reason || t("capability_unavailable")}`}
              aria-label={`${label}. ${help}`}
              style={{ background: mode === key ? "var(--pl-bg-hover)" : "var(--pl-bg-input)", textAlign:"left",
                       border:`0.5px solid ${mode === key ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                       borderRadius:6, color: mode === key ? "var(--pl-accent-hover)" : cap?.available ? "var(--pl-text-5)" : "var(--pl-text-7)",
                       fontFamily:"inherit", fontSize:12, padding:"9px 11px",
                       cursor: cap?.available ? "pointer" : "not-allowed",
                       opacity: cap?.available ? 1 : 0.45,
                       fontWeight: mode === key ? 700 : 400 }}>
              <span style={{ display:"block" }}>{label}</span>
              <span style={{ display:"block", marginTop:3, fontSize:9, fontWeight:400,
                color:cap?.available ? "var(--pl-status-live)" : "var(--pl-text-7)" }}>
                {cap?.available ? `✓ ${t("remote_available")}` : `— ${t("remote_unavailable")}`}
              </span>
            </button>
          ))}
        </div>

        <div role="note" style={{ marginTop:-6, marginBottom:12, padding:"7px 9px",
          borderLeft:"2px solid var(--pl-accent)", background:"var(--pl-bg-input)",
          color:"var(--pl-text-4)", fontSize:10, lineHeight:1.5 }}>
          {selectedModeHelp}
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, padding:"9px 10px",
          border:"0.5px solid var(--pl-border)", borderRadius:6, background:"var(--pl-bg-input)" }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:"var(--pl-text-3)", fontSize:10, fontWeight:700, marginBottom:3 }}>{t("remote_auth_heading")}</div>
            <div style={{ color:"var(--pl-text-5)", fontSize:10, lineHeight:1.45 }}>{authenticationHelp}</div>
          </div>
          {mode === "ssh" && <span style={{ flexShrink:0, borderRadius:10, padding:"4px 8px", fontSize:9,
            color:sshCap?.agent?.keysLoaded ? "var(--pl-status-live)" : sshCap?.agent?.running ? "var(--pl-status-warn)" : "var(--pl-error-text)",
            background:sshCap?.agent?.keysLoaded ? "var(--pl-bg-hover)" : sshCap?.agent?.running ? "var(--pl-diag-warn-bg)" : "var(--pl-error-bg)",
            border:`0.5px solid ${sshCap?.agent?.keysLoaded ? "var(--pl-status-live)" : sshCap?.agent?.running ? "var(--pl-status-warn)" : "var(--pl-error-border)"}` }}>
            {sshCap?.agent?.running
              ? sshCap.agent.keysLoaded ? t("remote_agent_keys", sshCap.agent.keyCount) : t("remote_agent_empty")
              : t("remote_agent_off")}
          </span>}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:advanced ? "1fr 110px" : "1fr", gap:10, marginBottom:10 }}>
          {mode !== "wsl" ? (
            <>
              {(mode === "ssh" || mode === "ssh-wsl") && configuredHosts.length > 0 && (
                <select style={{ ...inputStyle, gridColumn:advanced ? "1 / -1" : undefined }}
                  aria-label={t("remote_config_alias")}
                  value={configuredHosts.includes(target) ? target : ""}
                  onChange={e => setTarget(e.target.value)}>
                  <option value="">{t("remote_config_manual")}</option>
                  {configuredHosts.map(host => <option key={host} value={host}>{host}</option>)}
                </select>
              )}
              <input style={inputStyle} value={target} onChange={e => setTarget(e.target.value)}
                placeholder={`${t("remote_host")} (prod-web, host)`} />
              {advanced && <input style={inputStyle} value={port} onChange={e => setPort(e.target.value)}
                placeholder={t("remote_port")} />}
            </>
          ) : (
            <>
              {wslDistros.length > 0 ? (
                <select style={inputStyle} value={distro} onChange={e => setDistro(e.target.value)}>
                  <option value="">Default</option>
                  {wslDistros.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              ) : (
                <input style={inputStyle} value={distro} onChange={e => setDistro(e.target.value)}
                  placeholder={`${t("remote_distro")} (Ubuntu)`} />
              )}
              <span />
            </>
          )}
        </div>

        <button type="button" onClick={() => setAdvanced(value => !value)}
          style={{ border:0, background:"none", color:"var(--pl-accent-hover)", cursor:"pointer",
                   fontSize:11, padding:"2px 0", marginBottom:8 }}>
          {advanced ? "▾" : "▸"} {t("remote_advanced")}
        </button>

        {advanced && mode !== "wsl" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 78px", gap:10, marginBottom:10 }}>
            <input style={inputStyle} value={user} onChange={e => setUser(e.target.value)}
              placeholder={`${t("remote_user")} (opcional)`} />
            {mode !== "ssh-wsl" ? <>
              <input style={inputStyle} value={identityFile} onChange={e => setIdentityFile(e.target.value)}
                placeholder={`${t("remote_key")} (opcional)`} />
              <button type="button" onClick={pickIdentityFile}
                style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                         borderRadius:6, color:"var(--pl-text-3)", fontFamily:"inherit",
                         fontSize:11, padding:"7px 8px", cursor:"pointer" }}>
                {t("remote_key_pick")}
              </button>
            </> : <span style={{ gridColumn:"span 2", color:"var(--pl-text-5)", fontSize:10, alignSelf:"center" }}>
              ~/.ssh/config · SSH Agent · llaves de WSL2
            </span>}
          </div>
        )}

        {advanced && (mode === "ssh" || mode === "ssh-wsl") && (
          <input style={{ ...inputStyle, marginBottom:10 }} value={proxyJump}
            onChange={e => setProxyJump(e.target.value)}
            placeholder={`${t("remote_proxy_jump")} (bastion, usuario@host)`} />
        )}

        {mode === "ssh-wsl" && (
          <div style={{ marginBottom:10 }}>
            {wslDistros.length > 0 ? (
              <select style={inputStyle} value={distro} onChange={e => setDistro(e.target.value)}>
                <option value="">WSL2 predeterminado</option>
                {wslDistros.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            ) : (
              <input style={inputStyle} value={distro} onChange={e => setDistro(e.target.value)}
                placeholder={`${t("remote_distro")} (Ubuntu)`} />
            )}
          </div>
        )}

        {advanced && mode === "ssh-native" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={`${t("remote_password")} (opcional)`} />
            <input style={inputStyle} type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
              placeholder={`${t("remote_passphrase")} (opcional)`} />
          </div>
        )}

        {advanced && mode === "ssh-native" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10, alignItems:"center", marginBottom:10 }}>
            <input style={inputStyle} value={fingerprint} onChange={e => setFingerprint(e.target.value)}
              placeholder={`${t("remote_fingerprint")} SHA256:...`} />
            <label style={{ display:"flex", alignItems:"center", gap:6, color:"var(--pl-text-4)", fontSize:10, whiteSpace:"nowrap" }}>
              <input type="checkbox" checked={trustHostForSession} onChange={e => setTrustHostForSession(e.target.checked)} />
              {t("remote_verify_host")}
            </label>
          </div>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"1fr minmax(190px, 240px)", gap:10, marginBottom:12 }}>
          <input style={inputStyle} value={filePath} onChange={e => setFilePath(e.target.value)}
            placeholder={`${t("remote_path")} (/var/log/app.log)`} />
          <select style={inputStyle} value={historyPreset} onChange={e => {
            setHistoryPreset(e.target.value);
            if (e.target.value.startsWith("lines:")) setTailLines(Number(e.target.value.split(":")[1]));
          }}>
            <option value="lines:500">{t("remote_history_500")}</option>
            <option value="lines:5000">{t("remote_history_5000")}</option>
            <option value="bytes:10">{t("remote_history_10mb")}</option>
            <option value="bytes:50">{t("remote_history_50mb")}</option>
            <option value="full:100">{t("remote_history_full")}</option>
          </select>
        </div>

        <div style={{ color:"var(--pl-text-5)", fontSize:10, lineHeight:1.5, marginBottom:18 }}>
          {t("remote_hint")}
          {!modeAvailable && (
            <div style={{ color:"var(--pl-error-border)", marginTop:6 }}>
              {mode === "wsl" || mode === "ssh-wsl" ? (wslCap?.reason || t("capability_unavailable")) : (sshCap?.reason || t("capability_unavailable"))}
            </div>
          )}
        </div>

        {testResult && (
          <div style={{ padding:"7px 9px", marginBottom:10, borderRadius:6, fontSize:11,
            color:testResult.ok ? "var(--pl-status-live)" : "var(--pl-error-text)",
            background:testResult.ok ? "var(--pl-bg-hover)" : "var(--pl-error-bg)" }}>
            {testResult.ok ? "✓ " : "⚠ "}{testResult.message}
          </div>
        )}

        {mode !== "wsl" && (
          <button type="button" onClick={testConnection} disabled={!canTest || testing}
            style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                     borderRadius:6, color:"var(--pl-text-3)", fontFamily:"inherit", fontSize:11,
                     padding:"7px 14px", cursor:canTest && !testing ? "pointer" : "not-allowed", marginRight:10 }}>
            {testing ? t("remote_testing") : discoveringHost ? t("remote_detect_identity") : t("remote_test")}
          </button>
        )}
        <button type="submit" disabled={!canSubmit}
          style={{ background: canSubmit ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                   border:`0.5px solid ${canSubmit ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                   borderRadius:6, color: canSubmit ? "var(--pl-accent-hover)" : "var(--pl-text-6)",
                   fontFamily:"inherit", fontSize:12, padding:"7px 20px",
                   cursor: canSubmit ? "pointer" : "not-allowed", marginRight:10 }}>
          {t("remote_open")}
        </button>
        <button type="button" onClick={onClose}
          style={{ background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)",
                   borderRadius:6, color:"var(--pl-text-4)", fontFamily:"inherit",
                   fontSize:11, padding:"7px 20px", cursor:"pointer" }}>
          {t("cancel")}
        </button>
      </form>
    </div>
  );
}

function RemoteTab({ tabKey, config, maxLiveLines, onConfigureConnection }) {
  const t = useLang();
  const selectionSource = `${config.mode || "remote"}-${config.filePath || "logs"}`;
  const [classified, setClassified] = useState([]);
  const [spawned,    setSpawned]   = useState(false);
  const [connected,  setConnected] = useState(false);
  const [error,      setError]     = useState(null);
  const [historyInfo,setHistoryInfo]= useState(null);
  const [historyProgress,setHistoryProgress]= useState(null);
  const [retryNonce, setRetryNonce]= useState(0);
  const [reconnectIn,setReconnectIn]= useState(0);
  const [filter,       setFilter]       = useRememberedState(tabKey, "filter", "");
  const [filterUseRegex, setFilterUseRegex] = useRememberedState(tabKey, "useRegex", false);
  const filterDebounced = useDebouncedValue(filter);
  const [context,      setContext]      = useRememberedState(tabKey, "context", 0);
  const [search,       setSearch]       = useRememberedState(tabKey, "search", "");
  const [searchUseRegex, setSearchUseRegex] = useRememberedState(tabKey, "searchUseRegex", false);
  const searchDebounced = useDebouncedValue(search);
  const [matchCursor,  setMatchCursor]  = useRememberedState(tabKey, "matchCursor", -1);
  const [filterRegexError, setFilterRegexError] = useState(false);
  const [searchRegexError, setSearchRegexError] = useState(false);
  const [bookmarks,  setBookmarks] = useRememberedState(tabKey, "bookmarks", () => new Set());
  const [bmCursor,   setBmCursor]  = useRememberedState(tabKey, "bmCursor", -1);

  const [showNums,   setShowNums]  = useRememberedState(tabKey, "showNums", true);
  const [autoScroll, setAutoScroll]= useRememberedState(tabKey, "autoScroll", true);
  const [lvl, setLvl] = useRememberedState(tabKey, "levels", () => ({
    error:true, warn:true, info:true, debug:true, trace:true, stack:true, plain:true,
  }));
  const { selection, setSelection, selectionRef } = useRowSelection(tabKey, classified);

  const listRef       = useRef(null);
  const nextLineRef   = useRef(1);
  const autoScrollRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const workerRef = useRef(null);
  const processingRef = useRef(Promise.resolve());
  const enqueueLines = useBatchedLines(incoming => {
    const startLine = nextLineRef.current;
    nextLineRef.current += incoming.length;
    return processingRef.current = processingRef.current
      .then(() => workerRef.current?.process(incoming, startLine)
        || { items:classifyLines(incoming, startLine) })
      .then(result => {
        setClassified(prev => appendRecentItems(prev, result.items, maxLiveLines));
        setConnected(true);
        if (autoScrollRef.current && selectionRef.current.lines.size === 0) listRef.current?.scrollToBottom();
      });
  }, 75, maxLiveLines);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);
  useEffect(() => {
    workerRef.current = createLogWorkerClient();
    return () => { workerRef.current?.terminate(); workerRef.current = null; };
  }, []);

  useEffect(() => {
    let disposed = false;
    let retryTimer = null;
    let countdownTimer = null;
    setReconnectIn(0);
    const scheduleReconnect = (message) => {
      if (disposed || !/(timed? ?out|timeout|reset|closed|econn|network|socket|disconnect|terminated|terminó)/i.test(message || "")) return;
      const seconds = Math.min(30, 2 ** Math.min(reconnectAttemptRef.current++, 5));
      setReconnectIn(seconds);
      countdownTimer = setInterval(() => setReconnectIn(value => Math.max(0, value - 1)), 1000);
      retryTimer = setTimeout(() => {
        clearInterval(countdownTimer);
        if (!disposed) setRetryNonce(value => value + 1);
      }, seconds * 1000);
    };
    const unwatch = window.electronAPI.streamRemoteLogs(retryNonce > 0 ? { ...config, resumeOnly:true } : config, {
      onSpawned() { reconnectAttemptRef.current = 0; setReconnectIn(0); setError(null); setSpawned(true); setConnected(true); },
      onLines(text) {
        enqueueLines(text.split("\n").filter(Boolean));
      },
      onHistory(data) { setHistoryInfo(data); setHistoryProgress(data.size > 0 ? 0 : null); },
      onProgress(data) { setHistoryProgress(data.percent >= 100 ? null : data.percent); },
      onEnd()      { setConnected(false); setError(t("remote_disconnected")); scheduleReconnect("connection terminated"); },
      onError(msg) { setError(msg); setConnected(false); scheduleReconnect(msg); },
    });
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(countdownTimer);
      unwatch?.();
    };
  }, [config, retryNonce]);

  const stats = useMemo(() => countLevels(classified), [classified]);
  const reconnectNeedsConfig = Boolean(config.password || config.passphrase)
    || /permission denied|authentication|password|passphrase|publickey/i.test(error || "");
  const reconnectNow = () => {
    if (reconnectNeedsConfig) {
      onConfigureConnection?.();
      return;
    }
    reconnectAttemptRef.current = 0;
    setReconnectIn(0);
    setError(null);
    setRetryNonce(value => value + 1);
  };

  const { filtered, filterRegexValid, searchRegexValid, matchOrigLines } =
    useFilteredLogs("remote", classified, filterDebounced, filterUseRegex, lvl, context, searchDebounced, searchUseRegex, reportMetric);

  const shownCount = useMemo(() => filtered.filter(x => !x.separator).length, [filtered]);

  const droppedCount = Math.max(0, nextLineRef.current - 1 - classified.length);

  useEffect(() => setFilterRegexError(!filterRegexValid), [filterRegexValid]);
  useEffect(() => setSearchRegexError(!searchRegexValid), [searchRegexValid]);

  const toggleBookmark = useCallback((origLine) => {
    setBookmarks(prev => {
      const next = new Set(prev);
      next.has(origLine) ? next.delete(origLine) : next.add(origLine);
      return next;
    });
  }, []);

  const sortedBookmarks = useMemo(() => [...bookmarks].sort((a, b) => a - b), [bookmarks]);

  const jumpBookmark = useCallback((direction) => {
    if (!sortedBookmarks.length) return;
    const next = direction === "next"
      ? (bmCursor >= sortedBookmarks.length - 1 ? 0 : bmCursor + 1)
      : (bmCursor <= 0 ? sortedBookmarks.length - 1 : bmCursor - 1);
    setBmCursor(next);
    const idx = filtered.findIndex(x => x.origLine >= sortedBookmarks[next]);
    if (idx >= 0) listRef.current?.scrollToIndex(idx);
  }, [sortedBookmarks, bmCursor, filtered]);

  const jumpMatch = useCallback((direction) => {
    if (!matchOrigLines.length) return;
    const next = direction === "next"
      ? (matchCursor >= matchOrigLines.length - 1 ? 0 : matchCursor + 1)
      : (matchCursor <= 0 ? matchOrigLines.length - 1 : matchCursor - 1);
    setMatchCursor(next);
    const idx = filtered.findIndex(x => x.origLine >= matchOrigLines[next]);
    if (idx >= 0) {
      listRef.current?.scrollToIndex(idx);
      const hitLine = filtered[idx].origLine;
      setSelection({ lines:new Set([hitLine]), active:hitLine, anchor:hitLine });
    }
  }, [matchOrigLines, matchCursor, filtered, setSelection]);

  const toggle = (key, event) => setLvl(p => {
    if (!event?.ctrlKey && !event?.metaKey) return { ...p, [key]: !p[key] };
    // Ctrl/Cmd+click "solos" this level; pressing it again while already
    // isolated restores every level instead of leaving everything hidden.
    const isolated = Object.keys(p).every(k => p[k] === (k === key));
    return Object.fromEntries(Object.keys(p).map(k => [k, isolated || k === key]));
  });
  const modeLabel = config.mode === "wsl"
    ? t("remote_mode_wsl")
    : config.mode === "ssh-wsl"
      ? t("remote_mode_ssh_wsl")
    : config.mode === "ssh-native"
      ? t("remote_mode_native")
      : t("remote_mode_ssh");
  const sshTarget = config.user && !String(config.target || "").includes("@")
    ? `${config.user}@${config.target}`
    : config.target;
  const targetLabel = config.mode === "wsl"
    ? (config.distro ? `${config.distro}:${config.filePath}` : config.filePath)
    : config.mode === "ssh-wsl" && config.distro
      ? `${config.distro} → ${sshTarget}:${config.filePath}`
      : `${sshTarget}:${config.filePath}`;

  const BADGES = [
    { key:"error", label:"ERROR", bg:"var(--pl-chip-error-bg)", fg:"var(--pl-chip-error-fg)", cnt:stats.error },
    { key:"warn",  label:"WARN",  bg:"var(--pl-chip-warn-bg)",  fg:"var(--pl-chip-warn-fg)",  cnt:stats.warn  },
    { key:"info",  label:"INFO",  bg:"var(--pl-chip-info-bg)",  fg:"var(--pl-chip-info-fg)",  cnt:stats.info  },
    { key:"debug", label:"DEBUG", bg:"var(--pl-chip-debug-bg)", fg:"var(--pl-chip-debug-fg)", cnt:stats.debug },
    { key:"trace", label:"TRACE", bg:"var(--pl-chip-trace-bg)", fg:"var(--pl-chip-trace-fg)", cnt:stats.trace },
    { key:"stack", label:"STACK", bg:"var(--pl-chip-stack-bg)", fg:"var(--pl-chip-stack-fg)", cnt:null        },
    { key:"plain", label:"PLAIN", bg:"var(--pl-chip-plain-bg)", fg:"var(--pl-chip-plain-fg)", cnt:null        },
  ];

  const copyResults = useCallback(() => {
    const text = buildResultText({ source: `${modeLabel} ${targetLabel}`, filter, items: filtered, total: classified.length });
    copyResultText(text);
  }, [modeLabel, targetLabel, filter, filtered, classified.length]);

  const exportResults = useCallback(() => {
    const source = `${modeLabel}-${targetLabel}`;
    const text = buildResultText({ source: `${modeLabel} ${targetLabel}`, filter, items: filtered, total: classified.length });
    exportResultText(`${safeFileName(source)}-filtered.log`, text);
  }, [modeLabel, targetLabel, filter, filtered, classified.length]);

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0, overflow:"hidden" }}>
      <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"7px 10px",
                    background:"var(--pl-bg-panel)", borderBottom:"0.5px solid var(--pl-border-soft)",
                    flexShrink:0 }}>

        {/* row 1: filter + search + context + match nav */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
          <span style={{ fontSize:11, color:"var(--pl-cat-remote)", background:"var(--pl-remote-badge-bg)",
                         border:"0.5px solid var(--pl-remote-badge-border)", borderRadius:6, padding:"3px 8px",
                         fontWeight:700, flexShrink:0, whiteSpace:"nowrap" }}>
            {modeLabel} {targetLabel}
          </span>

          <div style={{ display:"flex", flex:"1 1 120px", minWidth:60 }}>
            <input
              style={{ flex:1, minWidth:0, background:"var(--pl-bg-input)",
                       border:`0.5px solid ${filterRegexError ? "var(--pl-error-border)" : "var(--pl-border)"}`,
                       borderRadius:"6px 0 0 6px", color: filterRegexError ? "var(--pl-error-text)" : "var(--pl-text-2)",
                       fontFamily:"inherit", fontSize:12, padding:"4px 10px", outline:"none" }}
              placeholder={filterUseRegex ? t("regex_ph") : t("filter_ph")}
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <button onClick={() => setFilterUseRegex(p => !p)}
              title={t("regex_btn_title")}
              style={{ background: filterUseRegex ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                       border:`0.5px solid ${filterUseRegex ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                       borderLeft:"none", borderRadius:"0 6px 6px 0",
                       color: filterUseRegex ? "var(--pl-accent-hover)" : "var(--pl-text-5)",
                       fontFamily:"monospace", fontSize:11, padding:"4px 10px",
                       cursor:"pointer", fontWeight: filterUseRegex ? 700 : 400 }}>
              .*
            </button>
          </div>

          <ContextInput value={context} onChange={setContext} />

          <div style={{ display:"flex", flex:"1 1 120px", minWidth:60 }}>
            <input
              style={{ flex:1, minWidth:0, background:"var(--pl-bg-input)",
                       border:`0.5px solid ${searchRegexError ? "var(--pl-error-border)" : "var(--pl-border)"}`,
                       borderRadius:"6px 0 0 6px", color: searchRegexError ? "var(--pl-error-text)" : "var(--pl-text-2)",
                       fontFamily:"inherit", fontSize:12, padding:"4px 10px", outline:"none" }}
              placeholder={searchUseRegex ? t("search_regex_ph") : t("search_ph")}
              title={searchRegexError ? t("search_regex_invalid_title") : undefined}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                jumpMatch(e.shiftKey ? "prev" : "next");
              }}
            />
            <button onClick={() => setSearchUseRegex(p => !p)}
              title={t("search_regex_btn_title")}
              style={{ background: searchUseRegex ? "var(--pl-bg-hover)" : "var(--pl-bg-input)",
                       border:`0.5px solid ${searchUseRegex ? "var(--pl-border-focus)" : "var(--pl-border)"}`,
                       borderLeft:"none", borderRadius:"0 6px 6px 0",
                       color: searchUseRegex ? "var(--pl-accent-hover)" : "var(--pl-text-5)",
                       fontFamily:"monospace", fontSize:11, padding:"4px 10px",
                       cursor:"pointer", fontWeight: searchUseRegex ? 700 : 400 }}>
              .*
            </button>
          </div>

          {(filter || search) && matchOrigLines.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0, whiteSpace:"nowrap" }}>
              <Btn onClick={() => jumpMatch("prev")} title={t("match_prev_title")}>▲</Btn>
              <Btn onClick={() => jumpMatch("next")} title={t("match_next_title")}>▼</Btn>
              <span style={{ fontSize:10, color:"var(--pl-text-4)" }}>
                {t("match_count", matchCursor < 0 ? 0 : matchCursor + 1, matchOrigLines.length)}
              </span>
            </div>
          )}
        </div>

        {/* row 2: level chips + bookmarks + actions */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
        {BADGES.map(({ key, label, bg, fg, cnt }) => (
          <span key={key} onClick={event => toggle(key, event)} title={t("level_toggle_title")}
            style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11,
                     padding:"3px 7px", borderRadius:6, fontWeight:600,
                     cursor:"pointer", userSelect:"none",
                     background: lvl[key] ? bg : "var(--pl-bg-input)",
                     color:      lvl[key] ? fg : "var(--pl-text-6)",
                     border:     `1.5px solid ${lvl[key] ? bg : "var(--pl-border-soft)"}`,
                     opacity:    lvl[key] ? 1 : 0.45 }}>
            {label}
            {cnt > 0 && <span style={{ background:"var(--pl-badge-overlay)", borderRadius:4, padding:"0 4px", fontSize:10 }}>{fmtNum(cnt)}</span>}
          </span>
        ))}
        <Sep />
        <Btn onClick={() => jumpBookmark("prev")} disabled={!sortedBookmarks.length} title={t("bm_prev_title")}>◆ ↑</Btn>
        <Btn onClick={() => jumpBookmark("next")} disabled={!sortedBookmarks.length} title={t("bm_next_title")}>◆ ↓</Btn>
        {bookmarks.size > 0 && <span style={{ fontSize:10, color:"var(--pl-bookmark)", padding:"0 2px" }}>{t("bm_count", bookmarks.size)}</span>}
        {bookmarks.size > 0 && <Btn onClick={() => { setBookmarks(new Set()); setBmCursor(-1); }} title={t("bm_clear_title")}>{t("bm_clear_btn")}</Btn>}
        <Btn onClick={copyResults} disabled={!filtered.length} title={t("copy_results_title")}>{t("copy_results")}</Btn>
        <Btn onClick={exportResults} disabled={!filtered.length} title={t("export_results_title")}>{t("export_results")}</Btn>
        <Sep />
        <Btn active={autoScroll} onClick={() => setAutoScroll(p => !p)} title={t("autoscroll_title")}>↓ auto</Btn>
        <Btn active={showNums}   onClick={() => setShowNums(p => !p)}   title={t("linenums_title")}>#</Btn>
        <Btn onClick={() => listRef.current?.scrollToTop()}>{t("scroll_top")}</Btn>
        <Btn onClick={() => listRef.current?.scrollToBottom()}>{t("scroll_bottom")}</Btn>
        </div>
      </div>

      {error && (
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 14px", background:"var(--pl-error-bg)", borderBottom:"1px solid var(--pl-error-border)",
                      color:"var(--pl-error-text)", fontSize:12, flexShrink:0, fontFamily:"inherit" }}>
          <span style={{ flex:1, minWidth:0 }}>⚠ {error}
            {reconnectIn > 0 && <span style={{ marginLeft:10 }}>{t("remote_reconnecting", reconnectIn)}</span>}
          </span>
          <button type="button" onClick={reconnectNow}
            title={reconnectNeedsConfig ? t("remote_reconfigure") : t("remote_reconnect")}
            style={{ flexShrink:0, border:"0.5px solid var(--pl-error-border)", borderRadius:5,
              background:"var(--pl-bg-input)", color:"var(--pl-text-2)", cursor:"pointer", fontFamily:"inherit",
              fontSize:10, padding:"4px 8px" }}>
            {reconnectNeedsConfig ? t("remote_reconfigure") : t("remote_reconnect")}
          </button>
        </div>
      )}

      {historyInfo && historyInfo.mode !== "lines" && (
        <div style={{ padding:"5px 14px", background:"var(--pl-bg-hover)", borderBottom:"0.5px solid var(--pl-border-soft)",
          color:"var(--pl-text-4)", fontSize:10, flexShrink:0 }}>
          {historyInfo.size >= 0
            ? t("remote_history_loaded", historyInfo.size, historyInfo.limit)
            : t("remote_history_full")}
        </div>
      )}

      {historyProgress !== null && !error ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column",
          gap:12, color:"var(--pl-text-5)", fontSize:12 }}>
          <span>{t("remote_history_loading", historyProgress)}</span>
          <div style={{ width:"min(420px, 70%)", height:8, borderRadius:5, overflow:"hidden",
            background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)" }}>
            <div style={{ width:`${historyProgress}%`, height:"100%", transition:"width .15s ease",
              background:"var(--pl-accent)" }} />
          </div>
          {historyInfo && <span style={{ fontSize:10 }}>{fmtBytes(Math.min(historyInfo.size, historyInfo.limit))}</span>}
        </div>
      ) : classified.length === 0 && !error ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      flexDirection:"column", gap:10, color:"var(--pl-text-7)", fontSize:13 }}>
          <span style={{ fontSize:28, color:"var(--pl-cat-remote)", animation:"spin 1s linear infinite" }}>↻</span>
          {spawned ? t("remote_waiting") : t("docker_starting")}
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      color:"var(--pl-text-7)", fontSize:13 }}>
          {filterRegexError
            ? <><span style={{ color:"var(--pl-error-text)" }}>⚠</span> {t("regex_invalid")}</>
            : filter ? t("no_results", filter) : t("no_lines")}
        </div>
      ) : (
        <VirtualList
          items={filtered}
          sourceItems={classified}
          showNums={showNums}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
          selection={selection}
          setSelection={setSelection}
          listRef={listRef}
          stateKey={tabKey}
          selectionSource={selectionSource}
          onFilterText={setFilter}
          onJumpBookmark={jumpBookmark}
        />
      )}

      <div style={{ display:"flex", gap:14, padding:"4px 10px", background:"var(--pl-bg-footer)",
                    borderTop:"0.5px solid var(--pl-border-soft)", fontSize:10, flexShrink:0, alignItems:"center" }}>
        {[["var(--pl-error-border)",stats.error,"err"],["var(--pl-stat-warn)",stats.warn,"warn"],
          ["var(--pl-stat-info)",stats.info,"info"],["var(--pl-stat-debug)",stats.debug,"dbg"]].map(([c,n,l])=>(
          <span key={l} style={{ color:c }}>{fmtNum(n)} <span style={{color:"var(--pl-text-8)"}}>{l}</span></span>
        ))}
        {connected  && <span style={{ color:"var(--pl-status-live)" }}>{t("live")}</span>}
        {!connected && classified.length > 0 && <span style={{ color:"var(--pl-status-stopped)" }}>{t("stopped")}</span>}
        {droppedCount > 0 && <span style={{ color:"var(--pl-status-warn)" }}>{t("lines_discarded", droppedCount)}</span>}
        {bookmarks.size > 0 && <span style={{ color:"var(--pl-bookmark)" }}>◆ {bookmarks.size}</span>}
        <SelectedLineStatus selection={selection} visibleItems={filtered}
          onClear={() => setSelection({ lines:new Set(), active:null, anchor:null })} />
        <span style={{ marginLeft:"auto", color:"var(--pl-text-6)" }}>
          {t("lines", shownCount, classified.length)}
        </span>
      </div>
    </div>
  );
}


export { RemotePicker, RemoteTab };
