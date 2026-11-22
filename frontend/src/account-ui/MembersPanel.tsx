import { permits } from '../contracts/permissions';
import { roleName } from '../i18n/shortcuts';
import { useMessageState, useLocale } from '../i18n/react';
import { t } from "../i18n";
import { HeaderNotice } from '../page-ui/PageLayout';
import { captureDiagnosticOrigin, reportFailure } from '../diagnostics/errors';
import { useEffect, useState } from 'react';
import { type AccountRequest, type Member, type Organization } from './api';
import { Modal } from '../page-ui/Modal';

export function MembersPanel({ request: api, currentUserId, isDev, organization, onChanged, onLeave }: {
  request: AccountRequest; currentUserId: number; isDev: boolean;
  organization: Organization; onChanged: () => void; onLeave: () => void;
}) {
  useLocale();
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState(organization.name);
  const [username, setUsername] = useState('');
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const base = `/organizations/${organization.id}`;
  const canManageMember = (member: Member) => organization.can_manage
    && (isDev || member.role !== 'organizer' || member.user_id === currentUserId);
  async function load() { setMembers((await api<{ members: Member[] }>(`${base}/members`)).members); }
  useEffect(() => { const origin = captureDiagnosticOrigin(); void load().catch(reason => { reportFailure('account-ui', 'handled_error', reason, origin); setError(reason); }); }, [organization.id]);
  async function run(action: () => Promise<unknown>) {
    const origin = captureDiagnosticOrigin();
    setBusy(true); setError('');
    try { await action(); await load(); onChanged(); } catch (reason) { reportFailure('account-ui', 'handled_error', reason, origin); setError(reason as Error); }
    finally { setBusy(false); }
  }
  return <div className="account-form">
    <p>{t("common.accountRole", { organization: organization.name, role: roleName(organization.role) })}</p>
    {permits(organization, 'rename_organization') && <>
      <form className="member-form" onSubmit={event => { event.preventDefault(); void run(() => api(base, 'PATCH', { name })); }}>
        <label>{t("accountUi.organizationName")}<input value={name} maxLength={100} required onChange={event => setName(event.target.value)} /></label>
        <button disabled={busy}>{t("accountUi.saveName")}</button>
      </form>
    </>}
    {organization.can_manage && <>
      <form className="member-form" onSubmit={event => { event.preventDefault(); void run(async () => {
        await api(`${base}/members`, 'POST', { username }); setUsername('');
      }); }}>
        <label>{t("accountUi.addMember")}<input value={username} placeholder={t("accountUi.enterAUsername")} required onChange={event => setUsername(event.target.value)} /></label>
        <button disabled={busy}>{t("accountUi.add")}</button>
      </form>
    </>}
    <table><thead><tr><th>{t("accountUi.account")}</th><th>{t("accountUi.role")}</th><th>{t("accountUi.action")}</th></tr></thead><tbody>
      {members.map(member => <tr key={member.id}>
        <td>{member.username}{!member.is_active && t("accountUi.deactivated")}</td>
        <td>{canManageMember(member) ? <select aria-label={t("accountUi.valueRole", { v0: member.username })} disabled={busy} value={member.role} onChange={event => {
          void run(() => api(`${base}/members/${member.id}`, 'PATCH', { role: event.target.value }));
        }}><option value="organizer">{roleName('organizer')}</option><option value="member">{roleName('member')}</option></select> : roleName(member.role)}</td>
        <td>{canManageMember(member) && <button disabled={busy} onClick={() => {
          if (member.user_id === currentUserId) onLeave();
          else { setError(''); setRemoving(member); }
        }}>{t("accountUi.remove")}</button>}</td>
      </tr>)}
    </tbody></table>
    {organization.role && <button disabled={busy} onClick={onLeave}>{t("accountUi.leaveThisOrganization")}</button>}
    {error && !removing && <HeaderNotice className="header-error" role="alert">{error}</HeaderNotice>}
    {removing && <Modal title={t("accountUi.removeMember")} onClose={() => { if (!busy) setRemoving(null); }}>
      <div className="account-form">
        <p>{t("accountUi.removeMemberConfirmation", { username: removing.username, organization: organization.name })}</p>
        <div className="controls">
          <button disabled={busy} onClick={() => setRemoving(null)}>{t("accountUi.cancel")}</button>
          <button disabled={busy} onClick={() => void run(async () => {
            await api(`${base}/members/${removing.id}`, 'DELETE', {}); setRemoving(null);
          })}>{t("accountUi.confirmRemoval")}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Modal>}
  </div>;
}
