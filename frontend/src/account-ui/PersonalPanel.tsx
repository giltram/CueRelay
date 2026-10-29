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
  settings: Settings; onSettings: (settings: Settings) => void;
}) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [shortcutDrafts, setShortcutDrafts] = useState<ShortcutDrafts>(() => formatShortcutDrafts(settings.shortcut_overrides));
  const [audioMode, setAudioMode] = useState(settings.audio_display_mode);
  const [mouseBoundary, setMouseBoundary] = useState(settings.mouse_sets_cue_boundary);
  const [recording, setRecording] = useState<TimingShortcut | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    setMessage(''); setBusy(true);
    try { await action(); setMessage('已保存'); } catch (reason) { setMessage((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="account-form">
    <form className="account-form" onSubmit={event => { event.preventDefault(); void run(async () => {
      if (newPassword !== confirmation) throw new Error('两次输入的新密码不一致。');
      await api('/auth/password', 'POST', { old_password: oldPassword, new_password: newPassword, new_password_confirmation: confirmation });
      setOldPassword(''); setNewPassword(''); setConfirmation('');
    }); }}>
      <label>旧密码<input type="password" autoComplete="current-password" maxLength={1024} value={oldPassword} required onChange={event => setOldPassword(event.target.value)} /></label>
      <label>新密码<input type="password" autoComplete="new-password" placeholder="至少 15 个字符" minLength={15} maxLength={1024} value={newPassword} required onChange={event => setNewPassword(event.target.value)} /></label>
      <label>确认新密码<input type="password" autoComplete="new-password" placeholder="再次输入新密码" minLength={15} maxLength={1024} value={confirmation} required onChange={event => setConfirmation(event.target.value)} /></label>
      <button disabled={busy}>修改密码</button>
    </form>
    <h2>音频显示</h2>
    <form className="account-form" onSubmit={event => { event.preventDefault(); void run(async () => {
      const result = await api<Settings>('/me/settings', 'PATCH', { audio_display_mode: audioMode });
      setAudioMode(result.audio_display_mode); onSettings(result);
    }); }}>
      <label>音频显示模式<select aria-label="音频显示模式" value={audioMode} disabled={busy} onChange={event => setAudioMode(event.target.value as Settings['audio_display_mode'])}>
        <option value="spectrum">Spectrum（频谱）</option><option value="waveform">Waveform（波形）</option>
      </select></label>
      <p>保存后切回工作区即可生效。</p>
      <button disabled={busy}>保存显示设置</button>
    </form>
    <h2>快捷键</h2>
    <label className="personal-checkbox"><input type="checkbox" checked={mouseBoundary} disabled={busy} onChange={event => setMouseBoundary(event.target.checked)} />鼠标点击设置字幕边界</label>
    <p>覆盖会替换该动作的全部绑定。录制一个键位，或用逗号填写多个物理键码；留空表示禁用。支持字母、数字、Enter、Space 和 Shift+字母/数字。删除行还支持 Ctrl/Meta+Delete/Backspace（Meta 为 Cmd）；撤销 / 重做、播放头及拆分动作还支持 Ctrl/Meta/Alt/Shift 组合。</p>
    {timingActions.map(action => <div className="shortcut-row" key={action}>
      <label>{shortcutDefaults[action].label}<input disabled={busy} aria-label={`${shortcutDefaults[action].label}绑定`} value={shortcutDrafts[action] ?? effectiveBindings(action, parseShortcutDrafts(shortcutDrafts)).join(', ')}
        onChange={event => setShortcutDrafts({ ...shortcutDrafts, [action]: event.target.value })} /></label>
      <button disabled={busy} onClick={() => setRecording(action)}>{recording === action ? '请按键…' : '录制'}</button>
      <button disabled={busy} onClick={() => { const next = { ...shortcutDrafts }; delete next[action]; setShortcutDrafts(next); }}>恢复默认</button>
    </div>)}
    {recording && <input disabled={busy} aria-label="录制快捷键" autoFocus readOnly value="按下组合键（Esc 取消）" onKeyDown={event => {
      event.preventDefault(); event.stopPropagation();
      if (busy) return;
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
      if (event.code === 'Escape') { setRecording(null); return; }
      if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(event.code)) return;
      const next = { ...shortcutDrafts, [recording]: bindingFor(event) };
      const problem = validateOverrides(parseShortcutDrafts(next));
      if (problem) { setMessage(problem); return; }
      setShortcutDrafts(next); setRecording(null); setMessage('待保存');
    }} />}
    <div className="controls"><button disabled={busy} onClick={() => { setShortcutDrafts({}); setRecording(null); }}>全部恢复默认</button>
      <button disabled={busy} onClick={() => void run(async () => {
        const overrides = parseShortcutDrafts(shortcutDrafts);
        const problem = validateOverrides(overrides); if (problem) throw new Error(problem);
        const result = await api<Settings>('/me/settings', 'PATCH', { shortcut_overrides: overrides, mouse_sets_cue_boundary: mouseBoundary });
        setShortcutDrafts(formatShortcutDrafts(result.shortcut_overrides)); setMouseBoundary(result.mouse_sets_cue_boundary); onSettings(result);
      })}>保存快捷键</button></div>
    {message && <p role="status">{message}</p>}
  </div>;
}
