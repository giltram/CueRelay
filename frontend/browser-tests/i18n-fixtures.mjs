import { createHash } from 'node:crypto';
import { codec, uiDocument } from './ass-codec.mjs';

/** Isolated UI fixtures; conversion uses the real Python codec and actual JASSUB/Workers. */
export async function installI18nFixtures(context, bytes) {
  const source = uiDocument(['Default', '用户样式 User style']);
  source.cues = Array.from({ length: 230 }, (_, index) => ({ id: `new-line-${index}`, start_ms: index * 20,
    end_ms: index * 20 + 300, text: index === 0 ? '用户内容 User content' : `Line ${index + 1}`, style_id: source.styles[0].id }));
  const state = {
    user: { id: 1, username: 'language-user-one', is_dev: false }, anonymous: false,
    preferences: { 1: 'zh-CN', 2: 'en' }, writes: [], inspections: 0, exports: 0, settingsGate: null,
    org: { id: 1, name: '组织 Organization', role: 'organizer', can_manage: true },
  };
  const timestamp = '2026-11-15T00:00:00Z';
  state.project = { id: 7, organization_id: 1, name: '用户项目 User project', description: 'Project description', status: 'active', revision: 1,
    updated_at: timestamp, created_at: timestamp, archived_at: null, archived_by: null, updated_by: state.user,
    document: source, media: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), duration_ms: 8000 } };
  const table = { id: '00000000-0000-4000-8000-000000000008', name: '组织术语表', project_count: 2, revision: 1 };
  state.template = { id: '00000000-0000-4000-8000-000000000009', name: '用户模板 User template', fields: source.styles[0].fields,
    reference: source.script, source_label: 'fixture.ass', revision: 1, created_at: timestamp, updated_at: timestamp, updated_by: state.user };
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const data = method === 'GET' ? null : request.postDataJSON();
    const reply = json => route.fulfill({ json });
    const reject = (code, message, reason) => route.fulfill({ status: 400, json: { error: { code, message, reason, params: {} } } });
    if (path === '/api/auth/session') return reply({ user: state.anonymous ? null : state.user });
    if (path === '/api/organizations') return reply({ organizations: [state.org] });
    if (path === '/api/auth/login') { state.anonymous = false; return reply({ user: state.user }); }
    if (path === '/api/me/settings') {
      const actor = Number(request.headers()['x-cuerelay-user']) || state.user.id;
      if (method === 'PATCH') {
        const gate = state.settingsGate;
        state.writes.push({ path, actor, data });
        if (gate) await gate;
        if (data.language_preference) state.preferences[actor] = data.language_preference;
      }
      return reply({ language_preference: state.preferences[actor], handbook_seen: true, shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true });
    }
    if (path === '/api/auth/password') return reject('invalid_request', '旧密码不正确。', 'server.theCurrentPasswordIsIncorrect');
    if (path === '/api/organizations/1') return reply({ organization: state.org });
    if (path === '/api/organizations/1/members') return reply({ members: [{ id: 1, user_id: 1, username: state.user.username, is_active: true, role: 'organizer' }, { id: 2, user_id: 2, username: 'another-member', is_active: true, role: 'member' }] });
    if (path === '/api/organizations/1/style-templates') return reply({ templates: [state.template] });
    if (path.endsWith('/glossary')) return reply({ association_version: 1, table, uses_organization_default: true,
      archived: false, entries: [{ id: 'term-one', original: '用户原词', translation: 'User translation', note: 'User note', revision: 1 }], total: 1, page: 1, has_more: false, empty: false });
    if (path === '/api/organizations/1/projects') return reply({ projects: [state.project], total: 1, page: 1, has_more: false });
    if (path === '/api/organizations/1/projects/7') return reply({ project: state.project });
    if (path.endsWith('/document')) {
      state.writes.push({ path, data });
      return reject('invalid_request', '项目名称不能为空。', 'server.projectNameIsRequired');
    }
    if (path === '/api/ass/empty') return reply({ document: uiDocument() });
    if (path.startsWith('/api/ass/')) {
      const action = { export: 'export', inspect: 'inspect', styles: 'styles', import: 'parse', clipboard: 'clipboard', split: 'split' }[path.split('/').at(-1)];
      if (action === 'inspect') state.inspections++;
      if (action === 'export') state.exports++;
      if (!action) throw new Error(`Unexpected conversion ${path}`);
      const result = codec(action, data);
      return action === 'export' && result.status === 200
        ? route.fulfill({ contentType: 'text/plain', body: result.body.text }) : route.fulfill({ status: result.status, json: result.body });
    }
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  });
  return { state, errors };
}

export function instrumentMedia() {
  window.__mediaCounts = { workers: 0, terminated: 0, urls: 0, revoked: 0, loads: 0 };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); window.__mediaCounts.workers++; }
    terminate() { window.__mediaCounts.terminated++; return super.terminate(); }
  };
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL, load = HTMLMediaElement.prototype.load;
  URL.createObjectURL = function (...args) { window.__mediaCounts.urls++; return create.apply(this, args); };
  URL.revokeObjectURL = function (...args) { window.__mediaCounts.revoked++; return revoke.apply(this, args); };
  HTMLMediaElement.prototype.load = function (...args) { window.__mediaCounts.loads++; return load.apply(this, args); };
  if (!window.FileSystemFileHandle) return;
  FileSystemFileHandle.prototype.queryPermission = async () => 'granted';
  FileSystemFileHandle.prototype.requestPermission = async () => 'granted';
  window.showOpenFilePicker = async () => {
    const root = await navigator.storage.getDirectory();
    window.__pickedHandle = await root.getFileHandle('video.mp4');
    return [window.__pickedHandle];
  };
}
