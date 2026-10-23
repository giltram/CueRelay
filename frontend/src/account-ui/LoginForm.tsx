import { useState } from 'react';
import { type AccountApi, type User } from './api';

export function LoginForm({ api, onLogin, expectedUsername }: { api: AccountApi; onLogin: (user: User) => void; expectedUsername?: string }) {
  const [username, setUsername] = useState(expectedUsername || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <form className="account-form" onSubmit={event => {
    event.preventDefault(); setBusy(true); setError('');
    void api.signIn(username, password).then(result => { setPassword(''); onLogin(result.user); })
      .catch(reason => setError(reason.message)).finally(() => setBusy(false));
  }}>
    {expectedUsername && <p>本地工作区属于 {expectedUsername}。同账号登录可继续；更换账号前需要处理当前稿件。</p>}
    <label>用户名<input autoComplete="username" value={username} required onChange={event => setUsername(event.target.value)} /></label>
    <label>密码<input autoComplete="current-password" type="password" value={password} required onChange={event => setPassword(event.target.value)} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={busy} type="submit">{busy ? '登录中…' : '登录'}</button>
  </form>;
}
