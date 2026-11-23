import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';
import { performanceVideo } from './performance-fixtures.mjs';

const stamp = ms => `00:00:${String(Math.floor(ms / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
export function referenceFixture(count) {
  const step = 25000 / count;
  const source = Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * step), end = index % 113 === 0 ? start : Math.floor(start + step * (index % 7 === 0 ? 4 : .8));
    const text = index % 97 === 0 ? '' : `reference ${index} 原生复制 ${index % 10 === 0 ? 'wrapping reference text '.repeat(24) + '\nsecond line' : 'short line'}`;
    return `${index + 1}\n${stamp(start)} --> ${stamp(end)}\n${text}`;
  }).join('\n\n');
  const parsed = JSON.parse(execFileSync(fileURLToPath(new URL('../../.venv/bin/python', import.meta.url)), ['-c',
    'import sys,json; from srt_format import parse_reference_srt; from ass_format import MAX_CUES,MAX_BYTES; source=sys.stdin.read(); print(json.dumps(dict(cues=parse_reference_srt(source),max_cues=MAX_CUES,max_bytes=MAX_BYTES)))'],
  { cwd: fileURLToPath(new URL('../../backend', import.meta.url)), input: source, encoding: 'utf8', timeout: 30000 }));
  assert.equal(parsed.cues.length, count); assert(count <= parsed.max_cues && Buffer.byteLength(source) <= parsed.max_bytes);
  return { cues: parsed.cues, metadata: { count, bytes: Buffer.byteLength(source), sha256: createHash('sha256').update(source).digest('hex'), maxCues: parsed.max_cues, maxBytes: parsed.max_bytes } };
}
export function referenceMedia(directory) {
  const file = performanceVideo(directory), bytes = readFileSync(file);
  return { file, media: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), duration_ms: 30000 } };
}
export async function installReferenceFixture(context, reference, media, unexpected) {
  const document = uiDocument();
  document.cues = Array.from({ length: 100 }, (_, index) => ({ id: `cue-${index}`, start_ms: index * 250,
    end_ms: index * 250 + 200, style_id: document.styles[0].id, text: `主字幕 ${index + 1}` }));
  let project = { id: 7, organization_id: 1, name: 'reference fixture', description: '', status: 'active', revision: 3,
    media, document, reference: { version: 1, cues: reference } };
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (await unavailableAssPreview(route)) return;
    const glossary = { association_version: 1, table: null, uses_organization_default: true, archived: false, entries: [], total: 0, page: 1, has_more: false, empty: true };
    const fixtures = {
      '/api/auth/session': { user: { id: 1, username: 'reference-fixture', is_dev: false } },
      '/api/organizations': { organizations: [{ id: 1, name: 'fixture', role: 'organizer', can_manage: true }] },
      '/api/me/settings': { handbook_seen: true, shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true },
      '/api/organizations/1/projects/7': { project }, '/api/organizations/1/projects': { projects: [], total: 0, page: 1, has_more: false },
      '/api/organizations/1/projects/7/glossary': glossary, '/api/organizations/1/glossary': glossary,
    };
    if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
    unexpected.push(`${route.request().method()} ${path}`); return route.abort();
  });
  return {
    async replace(page, cues) {
      project = { ...project, reference: { version: project.reference.version + 1, cues } };
      await this.refresh(page);
    },
    async refresh(page) {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/organizations/1/projects/7');
      await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await response; await settle(page);
    },
  };
}
export const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
export async function openReference(page, origin, file) {
  await page.goto(`${origin}/organizations/1/projects/7/workspace`);
  await page.locator('.video-stage input[type="file"]').setInputFiles(file);
  await page.getByRole('button', { name: '导入视频', exact: true }).waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  await settle(page);
}
export const referenceReading = page => page.locator('.reference-content').evaluate(container => {
  const box = container.getBoundingClientRect();
  const rows = [...container.querySelectorAll('p')];
  const first = rows.find(row => row.getBoundingClientRect().bottom > box.top && row.getBoundingClientRect().top < box.bottom);
  return { key: first?.dataset.referenceRow, inset: first ? box.top - first.getBoundingClientRect().top : null,
    top: container.scrollTop, height: container.scrollHeight, viewport: container.clientHeight, mounted: rows.length };
});
export const currentVisible = page => page.locator('.reference-content').evaluate(container => {
  const box = container.getBoundingClientRect();
  return [...container.querySelectorAll('[data-reference-current], [data-reference-unmatched]')]
    .some(row => { const rect = row.getBoundingClientRect(); return rect.top >= box.top - 1 && rect.top < box.bottom; });
});
