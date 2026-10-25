import { useEffect, useMemo, useState } from 'react';
import type { AssDocument } from '../contracts/subtitles';
import type { JsonRequest } from '../contracts/http';
import type { StyleTemplate, TemplateInput } from '../contracts/styles';
import { importAss, loadEmptyDocument } from '../project-data/ass-api';
import { templateApi } from '../project-data/styles-api';
import { Modal } from '../account-ui/Modal';
import { StyleSamplePreview } from '../ass-preview/StyleSamplePreview';
import { ScriptSettingsEditor, StyleFieldsEditor } from './StyleFieldsEditor';
import { assColor, sampleStyleDocument } from './style-fields';

export function OrganizationStyleLibrary({ request, organizationId, canManage, enabled }: {
  request: JsonRequest; organizationId: number; canManage: boolean; enabled: boolean;
}) {
  const api = useMemo(() => templateApi(request, organizationId), [request, organizationId]);
  const [templates, setTemplates] = useState<StyleTemplate[]>([]);
  const [base, setBase] = useState<AssDocument | null>(null);
  const [imported, setImported] = useState<AssDocument | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ template?: StyleTemplate; input: TemplateInput } | null>(null);
  const [deleting, setDeleting] = useState<StyleTemplate | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true); setError('');
    void Promise.all([api.list(), loadEmptyDocument()]).then(([items, document]) => { if (active) { setTemplates(items); setBase(document); } })
      .catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, refresh, enabled]);
  const patch = (value: Partial<TemplateInput>) => setEditor(current => current ? { ...current, input: { ...current.input, ...value } } : current);
  return <section className="organization-style-library" aria-label="组织样式库">
    <h2>组织样式库</h2>
    <p className="hint">模板供项目复制使用；编辑或删除模板不会修改已有项目。{!canManage && ' 模板由 organizer / dev 管理。'}</p>
    <div className="controls"><label>搜索组织样式<input type="search" disabled={!enabled} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button disabled={!enabled || busy} onClick={() => setRefresh(v => v + 1)}>重新加载样式库</button>
      {canManage && <button disabled={!enabled || busy || !base} onClick={() => {
        setError(''); setEditor({ input: { name: '', fields: base!.styles[0].fields, reference: base!.script, source_label: '' } });
      }}>新建模板</button>}
    </div>
    {canManage && <label className="style-file-import">从 ASS 提取样式模板<input aria-label="从 ASS 提取样式模板" type="file" accept=".ass" disabled={!enabled || busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      setBusy(true); setError('');
      void importAss(file).then(document => { setImported(document); setSourceLabel(file.name.slice(0, 500)); })
        .catch(reason => setError(reason.message)).finally(() => setBusy(false));
    }} /></label>}
    {loading && <p role="status">正在加载样式库…</p>}
    {error && !editor && !deleting && <p className="error" role="alert">{error}</p>}
    {imported && <div className="style-import-candidates"><p>来源：{sourceLabel} · 选择一个样式创建模板；引用原件不会自动更新模板。</p>
      <div className="controls">{imported.styles.map(style => <button key={style.id} disabled={busy || !enabled} onClick={() => {
        setEditor({ input: { name: style.name, fields: style.fields, reference: imported.script, source_label: sourceLabel } }); setError('');
      }}>使用「{style.name}」</button>)}<button onClick={() => setImported(null)}>结束提取</button></div>
    </div>}
    <div className="style-library-table"><table><thead><tr><th>模板</th><th>参考分辨率</th><th>来源 / 更新</th><th>操作</th></tr></thead>
      <tbody>{templates.filter(t => t.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(template => <tr key={template.id}>
        <td><span className="style-swatch" style={{ backgroundColor: assColor(template.fields.PrimaryColour)?.rgb }} aria-hidden="true" />{template.name}
          <p className="hint">{template.fields.Fontname} · {template.fields.Fontsize}</p></td>
        <td>{template.reference.play_res_x}×{template.reference.play_res_y}</td>
        <td>{template.source_label || '手动创建'}<p className="hint">{template.updated_by.username} · v{template.revision}</p></td>
        <td><div className="controls"><button disabled={busy || !enabled} onClick={() => { setError(''); setEditor({ template, input: { name: template.name, fields: template.fields, reference: template.reference, source_label: template.source_label } }); }}>{canManage ? '编辑模板' : '查看模板'}</button>
          {canManage && <button disabled={busy || !enabled} onClick={() => { setDeleting(template); setError(''); }}>删除模板</button>}</div></td>
      </tr>)}</tbody></table></div>
    {!loading && !templates.length && <p className="hint">暂无模板。</p>}
    {editor && base && <Modal title={editor.template ? `${canManage ? '编辑' : '查看'}组织模板` : '新建组织模板'} onClose={busy ? undefined : () => setEditor(null)}>
      <form className="account-form" onSubmit={event => {
        event.preventDefault(); if (!canManage || !enabled) return;
        setBusy(true); setError('');
        void (editor.template ? api.update(editor.template, editor.input) : api.create(editor.input))
          .then(() => { setEditor(null); setRefresh(v => v + 1); }).catch(reason => setError(reason.message)).finally(() => setBusy(false));
      }}>
        <StyleSamplePreview document={sampleStyleDocument(base, base.styles[0], editor.input.fields, editor.input.reference)} />
        <fieldset disabled={busy || !canManage || !enabled} className="account-form">
          <label>模板名称<input aria-label="模板名称" required maxLength={100} value={editor.input.name} onChange={event => patch({ name: event.target.value })} /></label>
          <label>来源说明<input aria-label="模板来源说明" maxLength={500} value={editor.input.source_label} onChange={event => patch({ source_label: event.target.value })} /></label>
          <ScriptSettingsEditor value={editor.input.reference} label="模板参考脚本分辨率" onChange={reference => patch({ reference })} />
          <StyleFieldsEditor value={editor.input.fields} onChange={fields => patch({ fields })} />
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="controls"><button type="button" disabled={busy} onClick={() => setEditor(null)}>关闭模板</button>
          {canManage && <button className="primary" disabled={busy || !enabled}>保存模板</button>}</div>
      </form>
    </Modal>}
    {deleting && <Modal title="删除组织模板" onClose={busy ? undefined : () => setDeleting(null)}>
      <p>删除「{deleting.name}」？已有项目中的样式副本不受影响。</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="controls"><button disabled={busy} onClick={() => setDeleting(null)}>取消</button>
        <button disabled={busy || !enabled || !canManage} onClick={() => {
          setBusy(true); setError('');
          void api.delete(deleting).then(() => { setDeleting(null); setRefresh(v => v + 1); }).catch(reason => setError(reason.message)).finally(() => setBusy(false));
        }}>确认删除模板</button></div>
    </Modal>}
  </section>;
}
