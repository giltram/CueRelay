import { useMessageState, useLocale } from '../i18n/react';
import { t } from "../i18n";
import { captureDiagnosticOrigin, reportFailure } from '../diagnostics/errors';
import { HeaderNotice } from '../page-ui/PageLayout';
import { useState } from 'react';
import { type AccountApi, type User } from './api';

export function LoginForm({ api, onLogin, expectedUsername, feedbackInHeader = false }: {
  api: AccountApi; onLogin: (user: User) => void; expectedUsername?: string; feedbackInHeader?: boolean;
}) {
  useLocale();
  const [username, setUsername] = useState(expectedUsername || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(false);
  return <form className="account-form" onSubmit={event => {
    const origin = captureDiagnosticOrigin();
    event.preventDefault(); setBusy(true); setError('');
    void api.signIn(username, password).then(result => { setPassword(''); onLogin(result.user); })
      .catch(reason => { reportFailure('account-ui', 'handled_error', reason, origin); setError(reason); }).finally(() => setBusy(false));
  }}>
    {expectedUsername && <p>{t("accountUi.workspaceOwner", { username: expectedUsername })}</p>}
    <label>{t("accountUi.username")}<input autoComplete="username" value={username} required onChange={event => setUsername(event.target.value)} /></label>
    <label>{t("accountUi.password")}<input autoComplete="current-password" type="password" value={password} required onChange={event => setPassword(event.target.value)} /></label>
    {error && (feedbackInHeader ? <HeaderNotice className="header-error" role="alert">{error}</HeaderNotice> : <p className="error" role="alert">{error}</p>)}
    <button className="primary" disabled={busy} type="submit">{busy ? t("accountUi.signingIn") : t("accountUi.signIn")}</button>
  </form>;
}
