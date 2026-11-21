import { expect, it } from 'vitest';
import { subtitleExportFilename } from './export-filename';

it('shares safe names and local timestamps while keeping ASS as the backup default', () => {
  const at = new Date(2026, 10, 21, 12, 3, 4);
  expect(subtitleExportFilename('项目:/名称', at, 'srt')).toBe('项目__名称_2026-11-21_12-03-04.srt');
  expect(subtitleExportFilename('项目:/名称', at)).toBe('项目__名称_2026-11-21_12-03-04.ass');
  expect(subtitleExportFilename(undefined, at, 'srt')).toBe('cuerelay_2026-11-21_12-03-04.srt');
});
