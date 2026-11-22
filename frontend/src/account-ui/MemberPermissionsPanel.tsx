import { useEffect, useState } from 'react';
import type { AccountRequest } from './api';
import { memberPermissionKeys, type BusinessPermission, type EffectivePermissions } from '../contracts/permissions';
import { HeaderNotice } from '../page-ui/PageLayout';
import { t } from '../i18n';
import { useLocale, useMessageState } from '../i18n/react';

interface Configuration { permissions: EffectivePermissions; revision: number }
const groups: { title: 'permissionsProjects' | 'permissionsContent' | 'permissionsOrganization'; keys: BusinessPermission[] }[] = [
  { title: 'permissionsProjects', keys: ['create_project', 'edit_project', 'archive_project', 'restore_project'] },
  { title: 'permissionsContent', keys: ['edit_subtitles', 'manage_project_styles', 'fork_project_glossary', 'edit_project_glossary', 'use_organization_glossary'] },
  { title: 'permissionsOrganization', keys: ['edit_organization_glossary', 'create_style_template', 'edit_style_template', 'delete_style_template', 'rename_organization'] },
];

/** Explicit full replacement + CAS. Background context refresh never replaces a draft. */
export function MemberPermissionsPanel({ request, organizationId, onChanged }: {
  request: AccountRequest; organizationId: number; onChanged: () => void;
}) {
  useLocale();
  const [config, setConfig] = useState<Configuration | null>(null);
  const [draft, setDraft] = useState<EffectivePermissions | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useMessageState('');
  const [saved, setSaved] = useState(false);
  const path = `/organizations/${organizationId}/member-permissions`;
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    void request<Configuration>(path).then(value => { if (active) { setConfig(value); setDraft(value.permissions); } })
      .catch(reason => { if (active) setError(reason); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [request, path, retry]);
  const changed = config && draft && memberPermissionKeys.some(key => draft[key] !== config.permissions[key]);
  return <form className="account-form member-permissions" aria-label={t('accountUi.memberPermissions')} onSubmit={event => {
    event.preventDefault(); if (!config || !draft || busy) return;
    setBusy(true); setError(''); setSaved(false);
    void request<Configuration>(path, 'PUT', { revision: config.revision, permissions: draft })
      .then(value => { setConfig(value); setDraft(value.permissions); setSaved(true); onChanged(); })
      .catch(setError).finally(() => setBusy(false));
  }}>
    <h2>{t('accountUi.memberPermissions')}</h2>
    <p className="hint">{t('accountUi.memberPermissionsScope')}</p>
    {draft && groups.map(group => <fieldset className="account-form" key={group.title} disabled={busy}>
      <legend>{t(`accountUi.${group.title}`)}</legend>
      {group.keys.map(key => <label className="permission-option" key={key}>
        <input type="checkbox" checked={draft[key]} onChange={event => { setDraft({ ...draft, [key]: event.target.checked }); setSaved(false); }} />
        {t(`accountUi.permission_${key}`)}
      </label>)}
    </fieldset>)}
    {error && <HeaderNotice role="alert" className="header-error">{error}</HeaderNotice>}
    {saved && <p role="status">{t('accountUi.permissionsSaved')}</p>}
    <div className="controls">
      <button className="primary" disabled={busy || !changed}>{t('accountUi.savePermissions')}</button>
      <button type="button" disabled={busy} onClick={() => { setSaved(false); setRetry(value => value + 1); }}>{t('accountUi.reloadPermissions')}</button>
    </div>
  </form>;
}
