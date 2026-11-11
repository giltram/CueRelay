import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { importAss } from './ass-api';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';

afterEach(() => vi.unstubAllGlobals());
const source = readFileSync(new URL('../../../backend/ass_format/fixtures/compatibility/text-and-metadata.ass', import.meta.url), 'utf8');
const document = { schema_version: 2, source, script: testScript, styles: [testStyle('Default')], cues: [] };

it('rejects malformed UTF-8 bytes before sending an import request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const bytes of [[0xc3, 0x28], [0xff], [0xe4, 0xb8], [0xed, 0xa0, 0x80]]) {
    await expect(importAss(new File([new Uint8Array(bytes)], 'invalid.ass'))).rejects.toThrow('仅支持 UTF-8');
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('passes UTF-8, BOM and original line endings intact to the codec', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ document })));
  vi.stubGlobal('fetch', fetch);
  for (const bom of ['', '\ufeff']) {
    const input = bom + source.replaceAll('\n', '\r\n');
    const result = await importAss(new File([input], 'valid.ass'));
    expect(result).toEqual(document);
    expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).source).toBe(input);
  }
});

it('rejects files over the byte budget before a request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(importAss(new File([new Uint8Array(1024 * 1024 + 1)], 'large.ass'))).rejects.toThrow('1MiB');
  expect(fetch).not.toHaveBeenCalled();
});

it('surfaces source-line errors and returns no replacement document', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ issues: [{ line: 5, message: '脚本设置键须为 PlayResX' }] }, { status: 422 })));
  await expect(importAss(new File([source], 'invalid.ass'))).rejects.toThrow('第 5 行：脚本设置键须为 PlayResX');
});
