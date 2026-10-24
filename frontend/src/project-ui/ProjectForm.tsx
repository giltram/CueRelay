import { useEffect, useRef, useState } from 'react';
import type { Organization } from '../account-ui/api';
import { Modal } from '../account-ui/Modal';
import type { ProjectDetail, ProjectSummary, MediaManifest } from '../contracts/projects';
import { createMediaManifest } from '../media/media-manifest';
import { importAss } from '../project-data/ass-api';
import type { projectApi } from '../project-data/projects-api';

export function ProjectForm({ organization, api, project, onClose, onSaved }: {
  organization: Organization; api: ReturnType<typeof projectApi>; project?: ProjectSummary;
  onClose: () => void; onSaved: (project: ProjectDetail, video?: File) => void;
}) {
  const [baseProject, setBaseProject] = useState(project);
  const [latestMessage, setLatestMessage] = useState('');
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [media, setMedia] = useState<MediaManifest | null>(null);
  const selectedFile = useRef<File | undefined>(undefined);
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [assName, setAssName] = useState('');
  const [mode, setMode] = useState<'empty' | 'import'>('empty');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function inspect(file: File) {
    controller.current?.abort();
    const task = new AbortController(); controller.current = task;
    selectedFile.current = file;
    setBusy(true); setError(''); setMedia(null); setProgress(0); setFileName(file.name);
    try {
      const value = await createMediaManifest(file, task.signal, setProgress);
      if (!task.signal.aborted) setMedia(value);
    } catch (reason) { if (!task.signal.aborted) setError((reason as Error).message); }
    finally { if (controller.current === task) setBusy(false); }
  }
  return <Modal title={project ? '编辑项目' : '新建项目'} onClose={busy ? undefined : onClose}>
    <form className="account-form" onSubmit={event => {
      event.preventDefault(); setError('');
      if (!project && (!media || (mode === 'import' && source === null))) { setError('请完成视频校验并选择初始字幕。'); return; }
      setBusy(true);
      void (project ? api.update(baseProject!, name, description) : api.create({ name, description, media: media!, source: mode === 'empty' ? null : source }))
        .then(value => onSaved(value, project ? undefined : selectedFile.current)).catch(reason => setError(reason.message)).finally(() => setBusy(false));
    }}>
      <p>所属组织：{organization.name}</p>
      <label>项目名称<input disabled={busy} value={name} maxLength={100} required onChange={event => setName(event.target.value)} /></label>
      <label>项目说明<textarea aria-label="项目说明" disabled={busy} value={description} maxLength={2000} rows={3} onChange={event => setDescription(event.target.value)} /></label>
      {!project && <>
        <p>每个项目绑定一个固定视频和一份 ASS。只发送摘要和字幕，视频保留在本机。</p>
        <label>基准视频<input type="file" accept="video/*,.mkv" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; if (file) void inspect(file); event.target.value = '';
        }} /></label>
        {fileName && <p>{fileName} · {media ? '完整校验通过' : `校验进度 ${Math.round(progress * 100)}%`}</p>}
        {busy && controller.current && !media && <button type="button" onClick={() => { controller.current?.abort(); setBusy(false); setFileName(''); }}>取消校验</button>}
        <label>初始字幕<select aria-label="初始字幕" disabled={busy} value={mode} onChange={event => setMode(event.target.value as 'empty' | 'import')}>
          <option value="empty">空字幕</option><option value="import">导入 ASS</option>
        </select></label>
        {mode === 'import' && <label>ASS 文件<input type="file" accept=".ass" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; if (!file) return;
          setBusy(true); setError(''); setSource(null); setAssName('');
          void importAss(file).then(document => { setSource(document.source); setAssName(file.name); })
            .catch(reason => setError(reason.message)).finally(() => setBusy(false));
          event.target.value = '';
        }} /></label>}
        {mode === 'import' && assName && <p>{assName} · 字幕预检通过</p>}
      </>}
      {project && <button type="button" disabled={busy} onClick={() => {
        setBusy(true);
        void api.get(project.id).then(latest => {
          setBaseProject(latest); setError('');
          setLatestMessage(`当前服务器版本：${latest.name}；说明：${latest.description || '无'}。你的输入已保留，请核对后再保存。${latest.status === 'archived' ? '项目已归档，须恢复后才能修改。' : ''}`);
        }).catch(reason => setError(reason.message)).finally(() => setBusy(false));
      }}>刷新项目版本</button>}
      {latestMessage && <p role="status">{latestMessage}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="controls">
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="primary" disabled={busy || baseProject?.status === 'archived' || (!project && (!media || (mode === 'import' && source === null)))}>
          {busy ? '处理中…' : project ? '保存修改' : '创建并打开'}
        </button>
      </div>
    </form>
  </Modal>;
}
