import { useEffect, useState } from 'react';
import { type AccountRequest, type Member, type Organization } from './api';

export function MembersPanel({ request: api, currentUserId, organization, onChanged, onLeave }: {
  request: AccountRequest; currentUserId: number;
  organization: Organization; onChanged: () => void; onLeave: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState(organization.name);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/organizations/${organization.id}`;
  async function load() { setMembers((await api<{ members: Member[] }>(`${base}/members`)).members); }
  useEffect(() => { void load().catch(reason => setError(reason.message)); }, [organization.id]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); await load(); onChanged(); } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="account-form">
    <p>{organization.name} · {organization.role || 'dev'}。组织上下文不保存或转移本地字幕。</p>
    {organization.can_manage && <>
      <form className="controls" onSubmit={event => { event.preventDefault(); void run(() => api(base, 'PATCH', { name })); }}>
        <label>组织名称<input value={name} maxLength={100} required onChange={event => setName(event.target.value)} /></label>
        <button disabled={busy}>保存名称</button>
      </form>
      <form className="controls" onSubmit={event => { event.preventDefault(); void run(async () => {
        await api(`${base}/members`, 'POST', { username }); setUsername('');
      }); }}>
        <label>准确用户名<input value={username} required onChange={event => setUsername(event.target.value)} /></label>
        <button disabled={busy}>添加已有账号</button>
      </form>
    </>}
    <table><thead><tr><th>账号</th><th>角色</th><th>操作</th></tr></thead><tbody>
      {members.map(member => <tr key={member.id}>
        <td>{member.display_name || member.username} ({member.username}){!member.is_active && ' · 已停用'}</td>
        <td>{organization.can_manage ? <select aria-label={`${member.username}角色`} disabled={busy} value={member.role} onChange={event => {
          void run(() => api(`${base}/members/${member.id}`, 'PATCH', { role: event.target.value }));
        }}><option value="organizer">organizer</option><option value="member">member</option></select> : member.role}</td>
        <td>{organization.can_manage && <button disabled={busy} onClick={() => {
          if (member.user_id === currentUserId) onLeave();
          else void run(() => api(`${base}/members/${member.id}`, 'DELETE', {}));
        }}>移除</button>}</td>
      </tr>)}
    </tbody></table>
    {organization.role && <button disabled={busy} onClick={onLeave}>退出此组织</button>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
