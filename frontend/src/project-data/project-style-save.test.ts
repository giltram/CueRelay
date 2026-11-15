import { expect, it, vi } from 'vitest';
import type { ProjectDetail, ProjectSummary } from '../contracts/projects';
import type { StyleOperation } from '../contracts/styles';
import type { AssDocument } from '../contracts/subtitles';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { saveProjectStyles } from './project-style-save';

const update: StyleOperation = { type: 'update', id: 'Default', name: 'Default', fields: { Fontsize: '55' } };
const conflict = () => Object.assign(new Error('当前输入已保留'), { code: 'project_conflict' });

function setup() {
  const project: ProjectDetail = {
    id: 1, organization_id: 1, name: '项目', description: '', status: 'active', revision: 1,
    created_at: '', updated_at: '', updated_by: { username: 'member' }, archived_at: null, archived_by: null,
    media: { sha256: 'a'.repeat(64), size: 100, duration_ms: 8000 },
    document: { schema_version: 2, source: 'ASS source', script: { ...testScript }, styles: [testStyle('Default')],
      cues: [{ id: 'cue', start_ms: 0, end_ms: 2000, text: '原字幕', style_id: 'Default' }] },
  };
  const latest = structuredClone(project);
  latest.revision = 2;
  latest.name = '服务器新名称';
  latest.document.cues[0].text = '已保存的新字幕';
  latest.document.cues[0].end_ms = 3000;
  const api = {
    get: vi.fn(async () => latest),
    styles: vi.fn(async (base: ProjectSummary, document: AssDocument, _operation: StyleOperation) =>
      ({ project: { ...base, revision: base.revision + 1 }, document, usage: {} })),
  };
  return { project, latest, api };
}

it('saves directly without an extra read when the baseline is current', async () => {
  const { project, api } = setup();
  const result = await saveProjectStyles(api, project, update);
  expect(api.get).not.toHaveBeenCalled();
  expect(api.styles).toHaveBeenCalledExactlyOnceWith(project, project.document, update);
  expect(result.project.revision).toBe(2);
});

it('ignores JSONB key ordering when comparing unchanged style definitions', async () => {
  const { project, latest, api } = setup();
  const style = latest.document.styles[0];
  style.fields = Object.fromEntries(Object.entries(style.fields).reverse()) as typeof style.fields;
  api.styles.mockRejectedValueOnce(conflict());
  await saveProjectStyles(api, project, update);
  expect(api.styles).toHaveBeenCalledTimes(2);
});

it.each<StyleOperation>([
  update,
  { type: 'batch', ids: ['Default'], fields: { Fontsize: '55' } },
  { type: 'create', name: 'New', fields: testStyle('Default').fields },
  { type: 'copy', id: 'Default', name: 'Copy', fields: {} },
  { type: 'delete', ids: ['Unused'] },
  { type: 'script', script: { ...testScript, play_res_x: 1280 } },
  { type: 'assign', cue_ids: ['cue'], style_id: 'Other' },
  { type: 'import', template_id: 'template', revision: 1, name: 'Imported', mode: 'copy' },
  { type: 'import_many', imports: [{ type: 'import', template_id: 'template', revision: 1, name: 'Imported', mode: 'scale' }] },
])('retries $type against the latest complete subtitle snapshot', async operation => {
  const { project, latest, api } = setup();
  api.styles.mockRejectedValueOnce(conflict());
  const result = await saveProjectStyles(api, project, operation);
  expect(api.get).toHaveBeenCalledExactlyOnceWith(project.id);
  expect(api.styles).toHaveBeenNthCalledWith(2, latest, latest.document, operation);
  expect(result.project.name).toBe(latest.name);
  expect(result.project.revision).toBe(3);
  expect(result.document).toBe(latest.document);
  expect(project.document.cues[0].text).toBe('原字幕');
});

it.each(['source', 'styles', 'script', 'archived'] as const)('does not retry a changed %s baseline', async change => {
  const { project, latest, api } = setup();
  if (change === 'source') latest.document.source += '\n';
  if (change === 'styles') latest.document.styles[0].fields.Fontsize = '57';
  if (change === 'script') latest.document.script.play_res_x = 1280;
  if (change === 'archived') latest.status = 'archived';
  const error = conflict();
  api.styles.mockRejectedValueOnce(error);
  await expect(saveProjectStyles(api, project, update)).rejects.toBe(error);
  expect(api.styles).toHaveBeenCalledTimes(1);
});

it.each(['removed', 'reassigned'] as const)('does not retry assignment when a target cue is %s', async change => {
  const { project, latest, api } = setup();
  if (change === 'removed') latest.document.cues = [];
  else latest.document.cues[0].style_id = 'Other';
  const error = conflict();
  api.styles.mockRejectedValueOnce(error);
  await expect(saveProjectStyles(api, project, { type: 'assign', cue_ids: ['cue'], style_id: 'Other' })).rejects.toBe(error);
  expect(api.styles).toHaveBeenCalledTimes(1);
});

it.each(['request_failed', 'template_conflict', 'project_archived', 'permission_denied', undefined])(
  'does not retry failures with code %s or an unknown commit outcome', async code => {
    const { project, api } = setup();
    const error = Object.assign(new Error('failed'), { code });
    api.styles.mockRejectedValueOnce(error);
    await expect(saveProjectStyles(api, project, update)).rejects.toBe(error);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.styles).toHaveBeenCalledTimes(1);
  },
);

it('stops after a second revision conflict', async () => {
  const { project, api } = setup();
  const error = conflict();
  api.styles.mockRejectedValue(error);
  await expect(saveProjectStyles(api, project, update)).rejects.toBe(error);
  expect(api.styles).toHaveBeenCalledTimes(2);
  expect(api.get).toHaveBeenCalledTimes(1);
});

it('does not write if reading the latest project fails', async () => {
  const { project, api } = setup();
  api.styles.mockRejectedValueOnce(conflict());
  const error = new Error('read failed');
  api.get.mockRejectedValueOnce(error);
  await expect(saveProjectStyles(api, project, update)).rejects.toBe(error);
  expect(api.styles).toHaveBeenCalledTimes(1);
});
