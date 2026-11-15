import { expect, it } from 'vitest';
import type { JsonRequest } from '../contracts/http';
import type { GlossaryEntry } from '../contracts/glossary';
import { glossaryApi } from './api';

it('sends only writable entry fields even when initialized from a server entry', async () => {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  const request: JsonRequest = async <T>(path: string, method?: string, body?: unknown) => {
    calls.push({ path, method, body }); return {} as T;
  };
  const entry: GlossaryEntry = { id: 'entry', original: 'Alice', translation: '爱丽丝', note: '主角', revision: 3,
    updated_by: { username: 'member' }, updated_at: '2026-11-13T00:00:00Z' };
  const token = { association_version: 2, glossary_id: 'table' };
  await glossaryApi(request, 1, 7).save(token, entry, entry);
  expect(calls[0]).toEqual({ path: '/organizations/1/projects/7/glossary/table/entries/entry', method: 'PUT', body: {
    association_version: 2, glossary_id: 'table', original: 'Alice', translation: '爱丽丝', note: '主角', revision: 3,
  } });
  await glossaryApi(request, 1).save({ association_version: 1, glossary_id: 'table' }, entry, entry);
  expect(calls[1].path).toBe('/organizations/1/glossary/table/entries/entry');
  expect(calls[1].body).not.toHaveProperty('updated_by');
  expect(calls[1].body).not.toHaveProperty('id');
});
