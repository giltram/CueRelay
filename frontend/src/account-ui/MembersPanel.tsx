import { useEffect, useState } from 'react';
import { type AccountRequest, type Member, type Organization } from './api';
import { Modal } from './Modal';

export function MembersPanel({ request: api, currentUserId, isDev, organization, onChanged, onLeave }: {
  request: AccountRequest; currentUserId: number; isDev: boolean;
  organization: Organization; onChanged: () => void; onLeave: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState(organization.name);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const base = `/organizations/${organization.id}`;
  const canManageMember = (member: Member) => organization.can_manage
    && (isDev || member.role !== 'organizer' || member.user_id === currentUserId);
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
      <form className="member-form" onSubmit={event => { event.preventDefault(); void run(() => api(base, 'PATCH', { name })); }}>
        <label>组织名称<input value={name} maxLength={100} required onChange={event => setName(event.target.value)} /></label>
        <button disabled={busy}>保存名称</button>
      </form>
      <form className="member-form" onSubmit={event => { event.preventDefault(); void run(async () => {
        await api(`${base}/members`, 'POST', { username }); setUsername('');
      }); }}>
        <label>添加成员<input value={username} placeholder="请输入用户名" required onChange={event => setUsername(event.target.value)} /></label>
        <button disabled={busy}>添加</button>
      </form>
    </>}
    <table><thead><tr><th>账号</th><th>角色</th><th>操作</th></tr></thead><tbody>
      {members.map(member => <tr key={member.id}>
        <td>{member.display_name || member.username} ({member.username}){!member.is_active && ' · 已停用'}</td>
        <td>{canManageMember(member) ? <select aria-label={`${member.username}角色`} disabled={busy} value={member.role} onChange={event => {
          void run(() => api(`${base}/members/${member.id}`, 'PATCH', { role: event.target.value }));
        }}><option value="organizer">organizer</option><option value="member">member</option></select> : member.role}</td>
        <td>{canManageMember(member) && <button disabled={busy} onClick={() => {
          if (member.user_id === currentUserId) onLeave();
          else { setError(''); setRemoving(member); }
        }}>移除</button>}</td>
      </tr>)}
    </tbody></table>
    {organization.role && <button disabled={busy} onClick={onLeave}>退出此组织</button>}
    {error && !removing && <p className="error" role="alert">{error}</p>}
    {removing && <Modal title="移除成员" onClose={() => { if (!busy) setRemoving(null); }}>
      <div className="account-form">
        <p>确认将 {removing.display_name || removing.username}（{removing.username}）移出 {organization.name}？该账号将失去此组织的访问权限。</p>
        <div className="controls">
          <button disabled={busy} onClick={() => setRemoving(null)}>取消</button>
          <button disabled={busy} onClick={() => void run(async () => {
            await api(`${base}/members/${removing.id}`, 'DELETE', {}); setRemoving(null);
          })}>确认移除</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Modal>}
  </div>;
}
