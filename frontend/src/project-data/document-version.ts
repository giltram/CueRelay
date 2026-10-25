import type { AssDocument } from '../contracts/subtitles';

/** Fail explicitly on mixed deployments before mounting or replacing an editor. */
export function documentV2(value: unknown): AssDocument {
  const doc = value as AssDocument | null;
  if (!doc || doc.schema_version !== 2 || typeof doc.source !== 'string' || !doc.script
    || !Array.isArray(doc.styles) || !doc.styles.length || !doc.styles.every(s => s && typeof s.id === 'string' && typeof s.name === 'string' && s.fields)
    || !Array.isArray(doc.cues) || !doc.cues.every(cue => cue && typeof cue.style_id === 'string')) {
    throw new Error('字幕文档需要 v2 样式契约；请同步升级前后端并完成数据库迁移。当前稿件已保留。');
  }
  return doc;
}
