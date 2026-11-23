import { useEffect, useRef, useState } from 'react';
import type { ProjectReference } from '../contracts/projects';
import type { projectApi } from '../project-data/projects-api';
import { readSrtFile } from '../project-data/subtitle-api';
import { newestReference } from '../project-data/reference-snapshot';
import { t, msg } from '../i18n';
import { useLocale, useMessageState } from '../i18n/react';
import { ReferenceFileField } from './ReferenceFileField';

export function ProjectReferenceSettings({ api, projectId, reference, enabled, editable }: {
  api: ReturnType<typeof projectApi>; projectId: number; reference?: ProjectReference; enabled: boolean; editable: boolean;
}) {
  useLocale();
  const [saved, setSaved] = useState(reference);
  const [pending, setPending] = useState<{ name: string; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [message, setMessage] = useMessageState('');
  const lifetime = useRef(0);
  useEffect(() => { lifetime.current++; setBusy(false); return () => { lifetime.current++; }; }, [api, projectId, enabled]);
  useEffect(() => { setSaved(current => newestReference(current, reference)); }, [reference]);
  async function write(source: string | null) {
    if (!enabled || !editable || busy || !saved) return;
    const epoch = lifetime.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.replaceReference(projectId, saved.version, source);
      if (epoch !== lifetime.current) return;
      setSaved(current => newestReference(current, result));
      // Completing this upload is independent of accepting its reference snapshot.
      setPending(null); setMessage(msg('reference.saved'));
    } catch (reason) { if (epoch === lifetime.current) setError(reason as Error); }
    finally { if (epoch === lifetime.current) setBusy(false); }
  }
  return <section className="account-form" aria-label={t('reference.title')}>
    <h2>{t('reference.title')}</h2>
    <p className="hint">{t('reference.help')}</p>
    <p>{saved?.cues === null || !saved ? t('reference.none') : t('reference.count', { count: saved.cues.length })}</p>
    {editable && <div className="controls">
      <ReferenceFileField disabled={!enabled || busy} onFile={file => {
        const epoch = lifetime.current;
        setBusy(true); setError(''); setMessage('');
        void readSrtFile(file).then(source => { if (epoch === lifetime.current) setPending({ name: file.name, source }); })
          .catch(reason => { if (epoch === lifetime.current) setError(reason); })
          .finally(() => { if (epoch === lifetime.current) setBusy(false); });
      }} />
      {pending && <><span>{pending.name}</span><button disabled={!enabled || busy} onClick={() => void write(pending.source)}>{t('reference.upload')}</button></>}
      {saved?.cues !== null && saved && <button disabled={!enabled || busy} onClick={() => void write(null)}>{t('reference.clear')}</button>}
    </div>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
