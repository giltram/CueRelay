import { useState } from 'react';
import { type AccountRequest, type Settings, type User } from './api';
import { bindingFor, shortcutDefaults, timingActions, validateOverrides, type ShortcutOverrides, type TimingShortcut } from '../workspace-ui/timing-shortcuts';

export function PersonalPanel({ request: api, user, settings, onSettings, onUser }: {
  request: AccountRequest;
  user: User; settings: Settings; onSettings: (settings: Settings) => void; onUser: (user: User) => void;
}) {
  const [name, setName] = useState(user.display_name);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [overrides, setOverrides] = useState<ShortcutOverrides>(settings.shortcut_overrides);
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
      const result = await api<{ user: User }>('/auth/me', 'PATCH', { display_name: name }); onUser(result.user);
    }); }}>
      <label>显示名<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
      <button disabled={busy}>保存资料</button>
    </form>
    <form className="account-form" onSubmit={event => { event.preventDefault(); void run(async () => {
      await api('/auth/password', 'POST', { old_password: oldPassword, new_password: newPassword });
      setOldPassword(''); setNewPassword('');
    }); }}>
      <label>旧密码<input type="password" autoComplete="current-password" maxLength={1024} value={oldPassword} required onChange={event => setOldPassword(event.target.value)} /></label>
      <label>新密码<input type="password" autoComplete="new-password" placeholder="至少 15 个字符" minLength={15} maxLength={1024} value={newPassword} required onChange={event => setNewPassword(event.target.value)} /></label>
      <button disabled={busy}>修改密码</button>
    </form>
    <h2>快捷键</h2>
    <p>覆盖会替换该动作的全部绑定。录制一个键位，或用逗号填写多个物理键码；留空表示禁用。支持 Shift+字母/数字，其他修饰键为保留组合。</p>
    {timingActions.map(action => <div className="shortcut-row" key={action}>
      <label>{shortcutDefaults[action].label}<input aria-label={`${shortcutDefaults[action].label}绑定`} value={(overrides[action] ?? shortcutDefaults[action].bindings).join(', ')}
        onChange={event => setOverrides({ ...overrides, [action]: event.target.value.split(',').map(key => key.trim()).filter(Boolean) })} /></label>
      <button onClick={() => setRecording(action)}>{recording === action ? '请按键…' : '录制'}</button>
      <button onClick={() => { const next = { ...overrides }; delete next[action]; setOverrides(next); }}>恢复默认</button>
    </div>)}
    {recording && <input aria-label="录制快捷键" autoFocus readOnly value="按下组合键（Esc 取消）" onKeyDown={event => {
      event.preventDefault(); event.stopPropagation();
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
      if (event.code === 'Escape') { setRecording(null); return; }
      if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(event.code)) return;
      const next = { ...overrides, [recording]: [bindingFor(event)] };
      const problem = validateOverrides(next);
      if (problem) { setMessage(problem); return; }
      setOverrides(next); setRecording(null); setMessage('待保存');
    }} />}
    <div className="controls"><button onClick={() => { setOverrides({}); setRecording(null); }}>全部恢复默认</button>
      <button disabled={busy} onClick={() => void run(async () => {
        const problem = validateOverrides(overrides); if (problem) throw new Error(problem);
        const result = await api<Settings>('/me/settings', 'PATCH', { shortcut_overrides: overrides });
        setOverrides(result.shortcut_overrides); onSettings(result);
      })}>保存快捷键</button></div>
    {message && <p role="status">{message}</p>}
  </div>;
}
