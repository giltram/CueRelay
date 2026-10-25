import { useEffect, useMemo, useState } from 'react';
import type { AssDocument, Cue, StyleResult } from '../contracts/subtitles';
import type { JsonRequest } from '../contracts/http';
import type { ImportStyle, ProjectStyle, StyleField, StyleFields, StyleOperation, StyleUsage } from '../contracts/styles';
import { Modal } from '../account-ui/Modal';
import { StyleSamplePreview } from '../ass-preview/StyleSamplePreview';
import { localStyleOperation, templateApi } from '../project-data/styles-api';
import { StyleFieldsEditor, ScriptSettingsEditor } from './StyleFieldsEditor';
import { TemplateImportSelection } from './TemplateImportSelection';
import { assColor, chosenFields, sampleStyleDocument, uniqueStyleName } from './style-fields';

type Mode = 'edit' | 'create' | 'copy' | 'batch' | 'script' | 'import' | 'assign';

export function ProjectStyleManager({ document, cueRows, selectedCueId, editable, persisted, request, organizationId, canManageTemplates, projectName,
  onApply, onClose }: {
  document: AssDocument; cueRows: readonly Cue[]; selectedCueId: string | null; editable: boolean; persisted: boolean;
  request?: JsonRequest; organizationId?: number; canManageTemplates?: boolean; projectName?: string;
  onApply: (operation: StyleOperation) => Promise<StyleResult>; onClose: () => void;
}) {
  const [activeId, setActiveId] = useState(document.cues.find(c => c.id === selectedCueId)?.style_id ?? document.styles[0].id);
  const active = document.styles.find(style => style.id === activeId) ?? document.styles[0];
  const [name, setName] = useState(active.name);
  const [fields, setFields] = useState<StyleFields>(active.fields);
  const [mode, setMode] = useState<Mode>('edit');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [batchFields, setBatchFields] = useState<StyleField[]>([]);
  const [script, setScript] = useState(document.script);
  const [imports, setImports] = useState<ImportStyle[]>([]);
  const [cueIds, setCueIds] = useState<string[]>(selectedCueId ? [selectedCueId] : []);
  const [usage, setUsage] = useState<StyleUsage>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [usageError, setUsageError] = useState('');
  const sampleFields = mode === 'batch' ? { ...active.fields, ...chosenFields(fields, batchFields) } : fields;
  const sample = useMemo(() => sampleStyleDocument(document, active, sampleFields, mode === 'script' ? script : document.script), [document, active, fields, batchFields, mode, script]);
  useEffect(() => {
    let current = true;
    void localStyleOperation(document, { type: 'inspect' }).then(result => { if (current) { setUsage(result.usage); setUsageError(''); } })
      .catch(reason => { if (current) setUsageError(reason.message); });
    return () => { current = false; };
  }, [document]);
  function choose(style: ProjectStyle) {
    setActiveId(style.id); setName(style.name); setFields(style.fields); setMode('edit'); setConfirmDelete(false); setError(''); setMessage('');
  }
  async function perform(operation: StyleOperation) {
    setPending(true); setError(''); setMessage(''); setConfirmDelete(false);
    try {
      const result = await onApply(operation);
      setUsage(result.usage); setSelected([]);
      const next = operation.type === 'create' || operation.type === 'copy' || operation.type === 'import' || operation.type === 'import_many' ? result.document.styles.at(-1)!
        : result.document.styles.find(s => s.id === active.id) ?? result.document.styles[0];
      if (operation.type === 'import_many' || operation.type === 'import') setImports([]);
      choose(next);
      setMessage(persisted ? '项目样式已保存。' : '样式已应用到本地文档，请及时导出。');
    } catch (reason) { setError((reason as Error).message); }
    finally { setPending(false); }
  }
  const applyLabel = persisted ? '应用并保存' : '应用到本地文档';
  const disabled = pending || !editable;
  return <Modal title={persisted ? '项目样式管理' : '本地样式管理'} onClose={pending ? undefined : onClose}>
    <div className="style-manager">
      <p className="hint">{persisted ? '修改使用项目已保存的字幕快照；工作区未保存的字幕和时间输入不会被提交。已打开的工作区需重新加载项目后使用新样式。'
        : '本地样式保留在当前页面，导出 ASS 后可复用。'}{!editable && ' 当前只读。'}</p>
      <div className="style-manager-layout">
        <section className="style-list" aria-label="样式列表">
          <label>搜索样式<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <p className="hint">已选 {selected.length} 个样式 · 共 {document.styles.length} 个</p>
          <div className="style-list-rows">{document.styles.filter(style => style.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(style => <div key={style.id} className="style-list-row" data-active={style.id === active.id || undefined}>
            <input type="checkbox" aria-label={`选择样式 ${style.name}`} disabled={pending} checked={selected.includes(style.id)}
              onChange={event => { setConfirmDelete(false); setSelected(event.target.checked ? [...selected, style.id] : selected.filter(id => id !== style.id)); }} />
            <button type="button" disabled={pending} onClick={() => { choose(style); if (mode === 'assign') setMode('assign'); }}>
              <span className="style-swatch" style={{ backgroundColor: assColor(style.fields.PrimaryColour)?.rgb }} aria-hidden="true" />
              <span>{style.name}<small>{document.cues.filter(c => c.style_id === style.id).length} 条字幕{usage[style.id]?.comments ? ` · ${usage[style.id].comments} 条 Comment` : ''}</small></span>
            </button>
          </div>)}</div>
          {usageError && <p role="alert" className="hint">使用数检查失败：{usageError}</p>}
          <div className="controls">
            <button disabled={disabled} onClick={() => { setMode('create'); setName(uniqueStyleName('新样式', document.styles)); setFields(active.fields); setConfirmDelete(false); }}>新建</button>
            <button disabled={disabled} onClick={() => { setMode('copy'); setName(uniqueStyleName(active.name, document.styles)); setFields(active.fields); setConfirmDelete(false); }}>复制当前样式</button>
            <button disabled={disabled || !selected.length} onClick={() => { setMode('batch'); setFields(active.fields); setBatchFields([]); setConfirmDelete(false); }}>批量编辑</button>
            <button disabled={disabled || !selected.length || selected.some(id => (usage[id]?.cues ?? 0) + (usage[id]?.comments ?? 0) > 0)} onClick={() => setConfirmDelete(true)}>删除所选</button>
          </div>
          {confirmDelete && <div className="confirm"><p>删除所选 {selected.length} 个样式？此操作{persisted ? '立即保存' : '应用到本地文档'}。</p><div className="controls">
            <button disabled={disabled} onClick={() => void perform({ type: 'delete', ids: selected })}>确认删除样式</button>
            <button disabled={pending} onClick={() => setConfirmDelete(false)}>取消删除</button>
          </div></div>}
        </section>
        <section className="style-detail" aria-label="样式属性">
          <div className="controls">
            <button disabled={pending} aria-pressed={mode === 'edit'} onClick={() => choose(active)}>当前样式</button>
            <button disabled={pending} aria-pressed={mode === 'script'} onClick={() => { setMode('script'); setScript(document.script); }}>脚本设置</button>
            <button disabled={pending || !persisted || !request || !organizationId} aria-pressed={mode === 'import'} onClick={() => setMode('import')}>从组织导入</button>
            <button disabled={pending} aria-pressed={mode === 'assign'} onClick={() => setMode('assign')}>为字幕指定样式</button>
          </div>
          {error && <p role="alert" className="error">{error}</p>}
          {message && <p role="status">{message}</p>}
          {mode !== 'import' && <StyleSamplePreview document={sample} />}
          <fieldset disabled={disabled}>
            {mode === 'import' && request && organizationId ? <>
              <TemplateImportSelection request={request} organizationId={organizationId} value={imports} onChange={setImports} existing={document.styles} />
              <p className="hint">已选 {imports.length} 个模板；一次导入并保存，任一模板校验失败时整批不保存。</p>
              <button className="primary" disabled={!imports.length} onClick={() => void perform({ type: 'import_many', imports })}>{applyLabel}</button>
            </> : mode === 'script' ? <>
              <ScriptSettingsEditor value={script} onChange={setScript} />
              <button className="primary" onClick={() => void perform({ type: 'script', script })}>{applyLabel}</button>
            </> : mode === 'assign' ? <>
              <p>将所选字幕指定为「{active.name}」。点击左侧样式名称可更换目标样式。</p>
              <div className="controls"><button type="button" onClick={() => setCueIds(document.cues.map(c => c.id))}>选择全部字幕</button>
                <button type="button" onClick={() => setCueIds([])}>清除字幕选择</button></div>
              <div className="style-cue-list">{cueRows.map((cue, index) => <label key={cue.id} className="style-check">
                <input type="checkbox" aria-label={`分配第 ${index + 1} 行`} checked={cueIds.includes(cue.id)} onChange={event => setCueIds(event.target.checked ? [...cueIds, cue.id] : cueIds.filter(id => id !== cue.id))} />
                {index + 1}. {cue.text.slice(0, 60) || '（empty）'}
              </label>)}</div>
              <button className="primary" disabled={!cueIds.length} onClick={() => void perform({ type: 'assign', cue_ids: cueIds, style_id: active.id })}>{applyLabel}（{cueIds.length} 行）</button>
            </> : <>
              {mode === 'batch' ? <p>仅修改勾选属性，保留 {selected.length} 个样式的其余属性与颜色。预览展示当前样式应用所选属性后的效果。</p>
                : <label>样式名称<input aria-label="样式名称" value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>}
              {mode === 'edit' && active.origin && <p className="hint">来源快照：{active.origin.template_id} · v{active.origin.revision}。模板更新或删除不影响此样式。</p>}
              <StyleFieldsEditor value={fields} onChange={setFields} selected={mode === 'batch' ? batchFields : undefined}
                onToggle={field => setBatchFields(batchFields.includes(field) ? batchFields.filter(item => item !== field) : [...batchFields, field])} />
              <div className="controls"><button className="primary" disabled={mode === 'batch' && (!selected.length || !batchFields.length)} onClick={() => void perform(mode === 'batch'
                ? { type: 'batch', ids: selected, fields: chosenFields(fields, batchFields) }
                : mode === 'create' ? { type: 'create', name, fields } : { type: mode === 'copy' ? 'copy' : 'update', id: active.id, name, fields })}>{applyLabel}</button>
                {request && organizationId && canManageTemplates && mode !== 'batch' && <button onClick={() => {
                  setPending(true); setError('');
                  void templateApi(request, organizationId).create({ name, fields, reference: document.script, source_label: projectName ? `${projectName} / ${active.name}`.slice(0, 500) : '本地工作区' })
                    .then(() => setMessage('组织模板已保存，项目样式保持独立。')).catch(reason => setError(reason.message)).finally(() => setPending(false));
                }}>另存为组织模板</button>}
              </div>
            </>}
          </fieldset>
        </section>
      </div>
    </div>
  </Modal>;
}
