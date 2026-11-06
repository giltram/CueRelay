import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileHandbook } from './handbook-markdown';
import defaults from '../../shared/timing-shortcuts.json';

const marker = '<!-- timing-shortcuts -->';

describe('build-time handbook Markdown', () => {
  it('compiles editable prose, stable chapter anchors and the shared shortcut table', () => {
    const content = compileHandbook(`新手**说明**。\n\n## 自定义章节 {#custom}\n\n> 保留时间草稿。\n\n${marker}\n\n## 交接 {#handoff}\n\n| 操作 | 结果 |\n| --- | --- |\n| 保存 | 已应用内容 |`);
    expect(content.introduction).toContain('<strong>说明</strong>');
    expect(content.chapters.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: 'custom', title: '自定义章节' }, { id: 'handoff', title: '交接' },
    ]);
    expect(content.chapters[0].html).toContain('<blockquote>');
    expect(content.chapters[0].html).toContain(defaults.commit.label);
    expect(content.chapters[0].html).toContain('<code>G</code>');
    expect(content.chapters[0].html).toContain('<code>Cmd+Z</code>');
    expect(content.chapters[1].html).toContain('handbook-table-scroll');
    expect(content.chapters[1].html).toContain('<td>已应用内容</td>');
    expect(JSON.stringify(content)).not.toContain(marker);
  });

  it('compiles the actual handbook without leftover JSX or heading metadata', () => {
    const source = readFileSync(new URL('../src/handbook-ui/handbook.md', import.meta.url), 'utf8');
    const content = compileHandbook(source);
    expect(content.chapters).toHaveLength(6);
    expect(content.chapters.map(chapter => chapter.id)).toEqual(['first-cue', 'timing', 'shortcuts', 'aegisub', 'saving', 'styles']);
    expect(content.chapters[1].html).toContain('<code>\\N</code>');
    expect(content.chapters[0].html).toContain('<strong>准备片源与字幕。</strong>');
    expect(content.chapters.every(chapter => !chapter.html.includes('**'))).toBe(true);
    expect(JSON.stringify(content)).not.toMatch(/className|\{#|timing-shortcuts/);
  });

  it.each([
    ['缺少锚点', `## 标题\n\n${marker}`, /稳定锚点/],
    ['重复锚点', `## 第一节 {#same}\n\n${marker}\n\n## 第二节 {#same}`, /锚点重复/],
    ['缺少快捷键表格', '## 标题 {#title}', /只包含一个/],
    ['重复快捷键表格', `## 标题 {#title}\n\n${marker}\n\n${marker}`, /只包含一个/],
    ['没有章节', marker, /至少需要一个/],
    ['原始 HTML', `## 标题 {#title}\n\n${marker}\n\n<script>alert(1)</script>`, /不支持原始 HTML/],
  ])('rejects %s during the build rather than shipping broken content', (_name, source, error) => {
    expect(() => compileHandbook(source)).toThrow(error);
  });
});
