import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Marked, type Tokens } from 'marked';
import { compileHandbook } from './handbook-markdown';
import defaults from '../../shared/timing-shortcuts.json';

const exampleTable = '| 功能 | 默认键位 |\n| --- | --- |\n| 提交并下一条 | `G` |\n| 撤销 | `Cmd+Z` |';

describe('build-time handbook Markdown', () => {
  it('compiles editable prose, stable chapter anchors and standard Markdown tables', () => {
    const content = compileHandbook(`新手**说明**。\n\n## 自定义章节 {#custom}\n\n> 保留时间草稿。\n\n${exampleTable}\n\n## 交接 {#handoff}\n\n| 操作 | 结果 |\n| --- | --- |\n| 保存 | 已应用内容 |`);
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
  });

  it('keeps the complete shortcut table readable as plain Markdown and aligned with shared defaults', () => {
    const source = readFileSync(new URL('../src/handbook-ui/handbook.md', import.meta.url), 'utf8');
    const start = source.lastIndexOf('## ', source.indexOf('{#shortcuts}'));
    const next = source.indexOf('\n## ', start + 3);
    const section = source.slice(start, next < 0 ? undefined : next);
    const tables = new Marked({ gfm: true }).lexer(section).filter((token): token is Tokens.Table => token.type === 'table');
    expect(tables).toHaveLength(1);
    const table = tables[0];
    expect(table.header.map(cell => cell.text)).toEqual(['功能', '默认键位']);
    expect(table.rows).toHaveLength(44);
    for (const { label, bindings } of Object.values(defaults)) {
      const displays = bindings.map(binding => binding.replace(/Meta/g, 'Cmd').replace(/Key([A-Z])/g, '$1')
        .replace(/Digit(\d)/g, '$1').replace(/NumpadEnter/g, '小键盘 Enter').replace(/Space/g, '空格'));
      let rows = table.rows.filter(row => row[0].text.startsWith(label));
      // Editorial labels may differ from settings; bound actions still have one
      // identifiable row containing their complete physical-key aliases.
      if (!rows.length && displays.length) rows = table.rows.filter(row => displays.every(key => row[1].text.includes(`\`${key}\``)));
      expect(rows, label).toHaveLength(1);
      const keys = rows[0][1].text;
      if (!bindings.length) expect(keys).toContain('默认未绑定');
      for (const display of displays) expect(keys, label).toContain(`\`${display}\``);
    }
    const html = compileHandbook(section).chapters[0].html;
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html.match(/<tr>/g)).toHaveLength(45);
    expect(section).not.toContain('<!-- timing-shortcuts -->');
  });

  it('compiles the actual handbook without leftover JSX or heading metadata', () => {
    const source = readFileSync(new URL('../src/handbook-ui/handbook.md', import.meta.url), 'utf8');
    const content = compileHandbook(source);
    const chapterIds = [...source.matchAll(/^## .+? \{#([a-z][a-z0-9-]*)\}$/gm)].map(match => match[1]);
    expect(content.chapters.map(chapter => chapter.id)).toEqual(chapterIds);
    expect(content.chapters.find(chapter => chapter.id === 'shortcuts')?.html).toContain('<code>\\N</code>');
    expect(content.chapters[0].html).toContain('<strong>');
    expect(content.chapters.every(chapter => !chapter.html.includes('**'))).toBe(true);
    expect(JSON.stringify(content)).not.toMatch(/className|\{#|timing-shortcuts/);
  });

  it.each([
    ['缺少锚点', `## 标题\n\n${exampleTable}`, /稳定锚点/],
    ['重复锚点', `## 第一节 {#same}\n\n${exampleTable}\n\n## 第二节 {#same}`, /锚点重复/],
    ['没有章节', exampleTable, /至少需要一个/],
    ['原始 HTML', `## 标题 {#title}\n\n${exampleTable}\n\n<script>alert(1)</script>`, /不支持原始 HTML/],
  ])('rejects %s during the build rather than shipping broken content', (_name, source, error) => {
    expect(() => compileHandbook(source)).toThrow(error);
  });
});
