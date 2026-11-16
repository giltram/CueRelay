import { shortcutName } from '../i18n/shortcuts';
import { useMessageState, useLocale } from '../i18n/react';
import { describe, MessageError } from "../contracts/messages";
import { msg, t } from "../i18n";
import { HeaderNotice } from '../page-ui/PageLayout';
import { captureDiagnosticOrigin, reportFailure } from '../diagnostics/errors';
import { useState } from 'react';
import { type AccountRequest, type Settings } from './api';
import { bindingFor, effectiveBindings, shortcutDefaults, timingActions, validateOverrides, type ShortcutOverrides, type TimingShortcut } from '../workspace-ui/timing-shortcuts';

type ShortcutDrafts = Partial<Record<TimingShortcut, string>>;

function formatShortcutDrafts(overrides: ShortcutOverrides): ShortcutDrafts {
  return Object.fromEntries(Object.entries(overrides).map(([action, bindings]) => [action, bindings.join(', ')]));
}

function parseShortcutDrafts(drafts: ShortcutDrafts): ShortcutOverrides {
  return Object.fromEntries(Object.entries(drafts).map(([action, text]) => [action, text.split(',').map(key => key.trim()).filter(Boolean)]));
}

export function PersonalPanel({ request: api, settings, onSettings }: {
  request: AccountRequest;
  settings: Settings; onSettings: (changes: Partial<Settings>) => void;
}) {
  useLocale();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [shortcutDrafts, setShortcutDrafts] = useState<ShortcutDrafts>(() => formatShortcutDrafts(settings.shortcut_overrides));
  const [audioMode, setAudioMode] = useState(settings.audio_display_mode);
  const [mouseBoundary, setMouseBoundary] = useState(settings.mouse_sets_cue_boundary);
  const [recording, setRecording] = useState<TimingShortcut | null>(null);
  const [message, setMessage] = useMessageState('');
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    const origin = captureDiagnosticOrigin();
    setMessage(''); setBusy(true);
    try { await action(); setMessage(msg("accountUi.saved")); } catch (reason) { reportFailure('account-ui', 'handled_error', reason, origin); setMessage(reason as Error); }
    finally { setBusy(false); }
  }
  return <div className="account-form">
    <form className="account-form" onSubmit={event => { event.preventDefault(); void run(async () => {
      if (newPassword !== confirmation) throw new MessageError(describe("accountUi.theNewPasswordsDoNotMatch", "两次输入的新密码不一致。"));
      await api('/auth/password', 'POST', { old_password: oldPassword, new_password: newPassword, new_password_confirmation: confirmation });
      setOldPassword(''); setNewPassword(''); setConfirmation('');
    }); }}>
      <label>{t("accountUi.currentPassword")}<input type="password" autoComplete="current-password" maxLength={1024} value={oldPassword} required onChange={event => setOldPassword(event.target.value)} /></label>
      <label>{t("accountUi.newPassword")}<input type="password" autoComplete="new-password" placeholder={t("accountUi.atLeast15Characters")} minLength={15} maxLength={1024} value={newPassword} required onChange={event => setNewPassword(event.target.value)} /></label>
      <label>{t("accountUi.confirmNewPassword")}<input type="password" autoComplete="new-password" placeholder={t("accountUi.enterTheNewPasswordAgain")} minLength={15} maxLength={1024} value={confirmation} required onChange={event => setConfirmation(event.target.value)} /></label>
      <button disabled={busy}>{t("accountUi.changePassword")}</button>
    </form>
    <h2>{t("accountUi.audioDisplay")}</h2>
    <form className="account-form" onSubmit={event => { event.preventDefault(); void run(async () => {
      const result = await api<Settings>('/me/settings', 'PATCH', { audio_display_mode: audioMode });
      setAudioMode(result.audio_display_mode); onSettings({ audio_display_mode: result.audio_display_mode });
    }); }}>
      <label>{t("accountUi.audioDisplayMode")}<select aria-label={t("accountUi.audioDisplayMode")} value={audioMode} disabled={busy} onChange={event => setAudioMode(event.target.value as Settings['audio_display_mode'])}>
        <option value="spectrum">{t("accountUi.spectrum")}</option><option value="waveform">{t("accountUi.waveform")}</option>
      </select></label>
      <p>{t("accountUi.afterSavingReturnToTheWorkspaceToApply")}</p>
      <button disabled={busy}>{t("accountUi.saveDisplaySettings")}</button>
    </form>
    <h2>{t("accountUi.shortcuts")}</h2>
    <label className="personal-checkbox"><input type="checkbox" checked={mouseBoundary} disabled={busy} onChange={event => setMouseBoundary(event.target.checked)} />{t("accountUi.setSubtitleBoundariesWithMouseClicks")}</label>
    <label>{shortcutName('toggle-text-focus')}
      <select aria-label={t("accountUi.toggleSubtitleInputFocus")} disabled={busy}
        value={shortcutDrafts['toggle-text-focus'] ?? shortcutDefaults['toggle-text-focus'].bindings[0]}
        onChange={event => setShortcutDrafts({ ...shortcutDrafts, 'toggle-text-focus': event.target.value })}>
        {shortcutDefaults['toggle-text-focus'].allowed_bindings.map(binding => <option key={binding} value={binding}>{binding}</option>)}
      </select>
    </label>
    <p>{t("accountUi.anOverrideReplacesAllBindingsForTheAction")}</p>
    {timingActions.filter(action => action !== 'toggle-text-focus').map(action => <div className="shortcut-row" key={action}>
      <label>{shortcutName(action)}<input disabled={busy} aria-label={t("accountUi.valueBinding", { v0: shortcutName(action) })} value={shortcutDrafts[action] ?? effectiveBindings(action, parseShortcutDrafts(shortcutDrafts)).join(', ')}
        onChange={event => setShortcutDrafts({ ...shortcutDrafts, [action]: event.target.value })} /></label>
      <button disabled={busy} onClick={() => setRecording(action)}>{recording === action ? t("accountUi.pressAKey") : t("accountUi.record")}</button>
      <button disabled={busy} onClick={() => { const next = { ...shortcutDrafts }; delete next[action]; setShortcutDrafts(next); }}>{t("accountUi.restoreDefault")}</button>
    </div>)}
    {recording && <input disabled={busy} aria-label={t("accountUi.recordShortcut")} autoFocus readOnly value={t("accountUi.pressAKeyCombinationEscToCancel")} onKeyDown={event => {
      event.preventDefault(); event.stopPropagation();
      if (busy) return;
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
      if (event.code === 'Escape') { setRecording(null); return; }
      if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(event.code)) return;
      const next = { ...shortcutDrafts, [recording]: bindingFor(event) };
      const problem = validateOverrides(parseShortcutDrafts(next));
      if (problem) { setMessage(problem); return; }
      setShortcutDrafts(next); setRecording(null); setMessage(msg("accountUi.unsaved"));
    }} />}
    <div className="controls"><button disabled={busy} onClick={() => { setShortcutDrafts({}); setRecording(null); }}>{t("accountUi.restoreAllDefaults")}</button>
      <button disabled={busy} onClick={() => void run(async () => {
        const overrides = parseShortcutDrafts(shortcutDrafts);
        const problem = validateOverrides(overrides); if (problem) throw new MessageError(problem);
        const result = await api<Settings>('/me/settings', 'PATCH', { shortcut_overrides: overrides, mouse_sets_cue_boundary: mouseBoundary });
        setShortcutDrafts(formatShortcutDrafts(result.shortcut_overrides)); setMouseBoundary(result.mouse_sets_cue_boundary);
        onSettings({ shortcut_overrides: result.shortcut_overrides, mouse_sets_cue_boundary: result.mouse_sets_cue_boundary });
      })}>{t("accountUi.saveShortcuts")}</button></div>
    {message && <HeaderNotice aria-label={t("accountUi.personalSettingsFeedback")}>{message}</HeaderNotice>}
  </div>;
}
