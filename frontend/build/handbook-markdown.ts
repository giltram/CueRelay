import { Marked, Renderer, type Token } from 'marked';
import type { HandbookContent } from '../src/handbook-ui/content.ts';

/** Compile the trusted repository handbook only, during Vite transforms/builds. */
export function compileHandbook(source: string): HandbookContent {
  const renderTable = new Renderer().table;
  const markdown = new Marked({ async: false, gfm: true, renderer: {
    html({ text }) {
      if (/^<!--[\s\S]*-->$/.test(text.trim())) return '';
      throw new Error('手册不支持原始 HTML，请使用 Markdown。');
    },
    table(token) { return `<div class="handbook-table-scroll">${renderTable.call(this, token)}</div>`; },
  } });
  const tokens = markdown.lexer(source);
  const content: HandbookContent = { introduction: '', chapters: [] };
  let body: Token[] = [];
  const flush = () => {
    const html = markdown.parser(body);
    const chapter = content.chapters.at(-1);
    if (chapter) chapter.html = html;
    else content.introduction = html;
    body = [];
  };
  for (const token of tokens) {
    if (token.type !== 'heading' || token.depth !== 2) { body.push(token); continue; }
    const heading = /^(.+?)\s+\{#([a-z][a-z0-9-]*)\}$/.exec(token.text);
    if (!heading) throw new Error(`手册二级标题必须带稳定锚点，例如 ## 标题 {#chapter-id}：${token.text}`);
    if (content.chapters.some(chapter => chapter.id === heading[2])) throw new Error(`手册锚点重复：${heading[2]}`);
    flush();
    content.chapters.push({ id: heading[2], title: heading[1], html: '' });
  }
  flush();
  if (!content.chapters.length) throw new Error('手册至少需要一个二级章节标题。');
  return content;
}
