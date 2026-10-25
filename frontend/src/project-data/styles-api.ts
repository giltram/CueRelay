import type { JsonRequest } from '../contracts/http';
import type { AssDocument, StyleResult } from '../contracts/subtitles';
import type { StyleOperation, StyleTemplate, TemplateInput } from '../contracts/styles';

export function templateApi(request: JsonRequest, organizationId: number) {
  const base = `/organizations/${organizationId}/style-templates`;
  return {
    list: async () => (await request<{ templates: StyleTemplate[] }>(base)).templates,
    create: async (input: TemplateInput) => (await request<{ template: StyleTemplate }>(base, 'POST', input)).template,
    update: async (template: StyleTemplate, input: TemplateInput) =>
      (await request<{ template: StyleTemplate }>(`${base}/${template.id}`, 'PUT', { ...input, revision: template.revision })).template,
    delete: (template: StyleTemplate) => request(`${base}/${template.id}`, 'DELETE', { revision: template.revision }),
  };
}

/** Stateless local transform/inspection; template import requires the protected project API. */
export async function localStyleOperation(document: AssDocument, operation: Exclude<StyleOperation, { type: 'import' }> | { type: 'inspect' }): Promise<StyleResult> {
  const response = await fetch('/api/ass/styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document, operation }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.issues?.map((issue: { message: string }) => issue.message).join('\n') || '样式操作失败');
  return body;
}
