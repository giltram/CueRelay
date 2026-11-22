import { afterEach, expect, it, vi } from 'vitest';
import { exportSrt, importSubtitleFile, readSrtFile } from './subtitle-api';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { formatMessage, applyLanguage } from '../i18n';

afterEach(() => { vi.unstubAllGlobals(); applyLanguage('zh-CN'); });
const document = { schema_version: 2 as const, source: '', script: testScript, styles: [testStyle('Default')], cues: [] };
const source = '7\r\n00:00:01,234 --> 00:00:02,340\r\n中文 😀\r\n下一行';

it('dispatches by extension, preserving UTF-8 BOM and CRLF, and reuses ASS transport', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ document })));
  vi.stubGlobal('fetch', fetch);
  for (const [name, endpoint] of [['字幕.SRT', '/api/srt/import'], ['字幕.ASS', '/api/ass/import']]) {
    for (const bom of ['', '\ufeff']) {
      expect(await importSubtitleFile(new File([bom + source], name))).toEqual(document);
      const [url, options] = fetch.mock.calls.at(-1)!;
      expect(url).toBe(endpoint);
      expect(JSON.parse(options.body)).toEqual({ source: bom + source });
    }
  }
});

it('rejects unsupported encodings, over-budget files and unknown formats before sending bytes', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const bytes of [[0xff, 0xfe, 0x31, 0], [0xc3, 0x28], [0xe4, 0xb8], [0xed, 0xa0, 0x80], [0xff]]) {
    await expect(importSubtitleFile(new File([new Uint8Array(bytes)], 'bad.srt'))).rejects.toThrow('UTF-8');
  }
  await expect(importSubtitleFile(new File([new Uint8Array(1024 * 1024 + 1)], 'large.srt'))).rejects.toThrow('1MiB');
  await expect(importSubtitleFile(new File([source], 'text.txt'))).rejects.toThrow('.ass 或 .srt');
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves localized block and source-line errors in both languages without a partial document', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ issues: [{
    code: 'unsupported_or_invalid_srt', line: 6, block: 2, message: '字幕块 2：时间错误',
    reason: 'srt.invalidTiming', params: { block: 2 },
  }] }, { status: 422 })));
  const error = await importSubtitleFile(new File([source], 'bad.srt')).catch(reason => reason);
  expect(formatMessage(error)).toContain('第 6 行：字幕块 2');
  applyLanguage('en');
  expect(formatMessage(error)).toContain('Line 6: Block 2');
});

it('exports exactly the supplied applied snapshot without persisting or mutating it', async () => {
  const before = structuredClone(document), controller = new AbortController();
  const fetch = vi.fn().mockResolvedValue(new Response(source)); vi.stubGlobal('fetch', fetch);
  expect(await exportSrt(document, controller.signal)).toBe(source);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/srt/export');
  expect(options.signal).toBe(controller.signal);
  expect(JSON.parse(options.body)).toEqual({ document });
  expect(document).toEqual(before);
});

it('decodes reference files without converting them into ASS or sending data before a project write', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const source = '\ufeff1\r\n00:00:00,001 --> 00:00:00,004\r\n{literal} \\N';
  expect(await readSrtFile(new File([source], 'ref.SRT'))).toBe(source);
  await expect(readSrtFile(new File([new Uint8Array([255])], 'ref.srt'))).rejects.toThrow('UTF-8');
  await expect(readSrtFile(new File(['text'], 'ref.ass'))).rejects.toThrow('.srt');
  await expect(readSrtFile(new File([new Uint8Array(1024*1024+1)], 'ref.srt'))).rejects.toThrow('1MiB');
  expect(fetch).not.toHaveBeenCalled();
});
