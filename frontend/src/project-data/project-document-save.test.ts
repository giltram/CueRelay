import { expect, it, vi } from 'vitest';
import type { ProjectDetail, ProjectSaveRequest, ProjectSummary } from '../contracts/projects';
import type { AssDocument } from '../contracts/subtitles';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { saveProjectDocument } from './project-document-save';

const conflict = () => Object.assign(new Error('当前输入已保留'), { code: 'project_conflict' });
function setup() {
  const base: AssDocument = { schema_version: 2, source: 'ASS source', script: { ...testScript },
    styles: [testStyle('Default'), testStyle('Unused')],
    cues: [{ id: 'cue', text: '原字幕', start_ms: 0, end_ms: 2000, style_id: 'Default' }] };
  const document = { ...base, cues: [{ ...base.cues[0], text: '本地修改', end_ms: 3000 }] };
  const latest: ProjectDetail = { id: 1, organization_id: 1, name: '项目', description: '', status: 'active', revision: 2,
    created_at: '', updated_at: '', updated_by: { username: 'member' }, archived_at: null, archived_by: null,
    media: { sha256: 'a'.repeat(64), size: 100, duration_ms: 8000 }, document: structuredClone(base) };
  latest.document.styles[0].fields.Fontsize = '55';
  latest.document.script.play_res_x = 1280;
  const input: ProjectSaveRequest = { document, baseDocument: base, revision: 1, requiredStyleIds: ['Default'] };
  const api = { get: vi.fn(async () => latest),
    save: vi.fn(async (project: ProjectSummary, _document: AssDocument) => ({ ...project, revision: project.revision + 1 })) };
  return { base, document, latest, input, api };
}

it('preserves the original snapshot and skips reads for a successful ordinary save', async () => {
  const { latest, input, api } = setup();
  const result = await saveProjectDocument(api, latest, input);
  expect(api.get).not.toHaveBeenCalled();
  expect(api.save).toHaveBeenCalledExactlyOnceWith({ ...latest, revision: 1 }, input.document);
  expect(result.document).toBe(input.document);
});

it('retries with authoritative styles/script and all local cue edits', async () => {
  const { base, document, latest, input, api } = setup();
  api.save.mockRejectedValueOnce(conflict());
  const result = await saveProjectDocument(api, latest, input);
  expect(api.get).toHaveBeenCalledExactlyOnceWith(1);
  expect(api.save).toHaveBeenNthCalledWith(2, latest, result.document);
  expect(result.document.cues).toBe(document.cues);
  expect(result.document.styles).toBe(latest.document.styles);
  expect(result.document.script).toBe(latest.document.script);
  expect(result.project.revision).toBe(3);
  expect(base.styles[0].fields.Fontsize).toBe('28');
  expect(document.styles).toBe(base.styles);
});

it('preserves local deletion, insertion, assignment and order when the server cues are unchanged', async () => {
  const { latest, input, api } = setup();
  input.document = { ...input.document, cues: [{ ...input.document.cues[0], id: 'new', style_id: 'Unused' }] };
  input.requiredStyleIds = ['Default', 'Unused'];
  api.save.mockRejectedValueOnce(conflict());
  expect((await saveProjectDocument(api, latest, input)).document.cues).toBe(input.document.cues);
});

it('accepts equivalent cues and local definitions reordered by PostgreSQL JSONB', async () => {
  const { latest, input, api } = setup();
  const reverseKeys = (value: object) => Object.fromEntries(Object.entries(value).reverse());
  latest.document.cues = latest.document.cues.map(cue => reverseKeys(cue) as typeof cue);
  input.document = { ...input.document, styles: input.document.styles.map(style => ({ ...style, fields: reverseKeys(style.fields) as typeof style.fields })) };
  api.save.mockRejectedValueOnce(conflict());
  const result = await saveProjectDocument(api, latest, input);
  expect(result.document.cues).toBe(input.document.cues);
  expect(api.save).toHaveBeenCalledTimes(2);
});

it.each(['text', 'time', 'insert', 'delete', 'assignment', 'source', 'localStyles', 'localScript', 'localSource', 'archived'])(
  'does not relabel a conflicting %s snapshot with the new revision', async change => {
    const { latest, input, api } = setup();
    if (change === 'text') latest.document.cues[0].text = '远端修改';
    if (change === 'time') latest.document.cues[0].end_ms = 2500;
    if (change === 'insert') latest.document.cues.push({ ...latest.document.cues[0], id: 'new' });
    if (change === 'delete') latest.document.cues = [];
    if (change === 'assignment') latest.document.cues[0].style_id = 'Unused';
    if (change === 'source') latest.document.source = 'different source';
    if (change === 'localStyles') input.document = { ...input.document, styles: [] };
    if (change === 'localScript') input.document = { ...input.document, script: { ...testScript, play_res_x: 1920 } };
    if (change === 'localSource') input.document = { ...input.document, source: 'different source' };
    if (change === 'archived') latest.status = 'archived';
    const error = conflict();
    api.save.mockRejectedValueOnce(error);
    await expect(saveProjectDocument(api, latest, input)).rejects.toBe(error);
    expect(api.save).toHaveBeenCalledTimes(1);
  },
);

it.each(['current', 'history'])('rejects removal of a style used by %s cues before a second write', async where => {
  const { latest, input, api } = setup();
  if (where === 'current') input.document.cues[0].style_id = 'Unused';
  else input.requiredStyleIds = ['Default', 'Unused'];
  latest.document.styles.pop();
  api.save.mockRejectedValueOnce(conflict());
  await expect(saveProjectDocument(api, latest, input)).rejects.toThrow('撤销历史使用的样式已被删除');
  expect(api.save).toHaveBeenCalledTimes(1);
});

it('accepts deletion of styles that neither current edits nor history use', async () => {
  const { latest, input, api } = setup();
  latest.document.styles.pop();
  api.save.mockRejectedValueOnce(conflict());
  expect((await saveProjectDocument(api, latest, input)).document.styles).toBe(latest.document.styles);
});

it.each(['request_failed', 'project_archived', 'permission_denied', 'account_changed', undefined])(
  'never retries an error with code %s or an unknown commit outcome', async code => {
    const { latest, input, api } = setup();
    const error = Object.assign(new Error('failed'), { code });
    api.save.mockRejectedValueOnce(error);
    await expect(saveProjectDocument(api, latest, input)).rejects.toBe(error);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.save).toHaveBeenCalledTimes(1);
  },
);

it('stops at the second conflict without mutating the local draft', async () => {
  const { latest, input, api } = setup();
  const before = structuredClone(input);
  const error = conflict();
  api.save.mockRejectedValue(error);
  await expect(saveProjectDocument(api, latest, input)).rejects.toBe(error);
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(input).toEqual(before);
});

it('does not attempt a second write when reading the latest snapshot fails', async () => {
  const { latest, input, api } = setup();
  const error = new Error('offline');
  api.save.mockRejectedValueOnce(conflict());
  api.get.mockRejectedValueOnce(error);
  await expect(saveProjectDocument(api, latest, input)).rejects.toBe(error);
  expect(api.save).toHaveBeenCalledTimes(1);
});
