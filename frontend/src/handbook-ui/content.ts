/** Build output consumed by the page; no Markdown parser is shipped to browsers. */
export interface HandbookContent {
  introduction: string;
  chapters: { id: string; title: string; html: string }[];
}
