import { useEffect, useMemo, useState } from 'react';
import type { JsonRequest } from '../contracts/http';
import type { ImportStyle, StyleTemplate } from '../contracts/styles';
import { templateApi } from '../project-data/styles-api';
import { uniqueStyleName } from './style-fields';

/** Selected revisions are frozen; refreshing explicitly clears selections. */
export function TemplateImportSelection({ request, organizationId, value, onChange, existing = [] }: {
  request: JsonRequest; organizationId: number; value: ImportStyle[]; onChange: (value: ImportStyle[]) => void; existing?: readonly { name: string }[];
}) {
  const api = useMemo(() => templateApi(request, organizationId), [request, organizationId]);
  const [templates, setTemplates] = useState<StyleTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void api.list().then(items => { if (active) setTemplates(items); }).catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, version]);
  const update = (id: string, patch: Partial<ImportStyle>) => onChange(value.map(item => item.template_id === id ? { ...item, ...patch } : item));
  return <section className="style-import" aria-label="组织模板导入">
    <div className="controls"><label>搜索模板<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button type="button" onClick={() => { onChange([]); setVersion(v => v + 1); }}>重新加载模板</button></div>
    {loading && <p role="status">正在加载模板…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="style-template-list">{templates.filter(item => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(template => {
      const selected = value.find(item => item.template_id === template.id);
      return <div className="style-template-option" key={template.id}>
        <label className="style-check"><input type="checkbox" checked={Boolean(selected)} onChange={event => onChange(event.target.checked
          ? [...value, { type: 'import', template_id: template.id, revision: template.revision,
            name: uniqueStyleName(template.name, [...existing, ...value]), mode: 'copy' }]
          : value.filter(item => item.template_id !== template.id))} />{template.name}</label>
        <span className="hint">{template.fields.Fontname} · {template.fields.Fontsize} · {template.reference.play_res_x}×{template.reference.play_res_y} · v{template.revision}</span>
        {selected && <div className="style-field-grid">
          <label>导入后的名称<input aria-label={`导入名称 ${template.name}`} value={selected.name} maxLength={100} onChange={event => update(template.id, { name: event.target.value })} /></label>
          <label>适配方式<select aria-label={`适配方式 ${template.name}`} value={selected.mode} onChange={event => update(template.id, { mode: event.target.value as 'copy' | 'scale' })}>
            <option value="copy">原样复制</option><option value="scale">按 PlayRes 等比缩放</option>
          </select></label>
        </div>}
      </div>;
    })}</div>
    {!loading && !error && templates.length === 0 && <p className="hint">暂无组织模板，可在组织设置中创建。</p>}
    <p className="hint">导入生成独立快照，后续模板修改不会影响项目。等比缩放要求相同宽高比、明确 PlayRes 且双方 ScaledBorderAndShadow 为 yes；否则请选择原样复制后人工调整。字幕行自身的边距覆写保持原样。刷新模板会清除当前选择。</p>
  </section>;
}
