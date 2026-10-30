import type { Context, CueFields, EventData, SafeError, TimeDraft } from './schema';

/** No free-form error messages: libraries/servers can echo passwords, filenames or bodies. */
export function safeError(value: unknown): SafeError {
  let type = 'Error', stack: string[] = [];
  try {
    if (value instanceof Error) {
      if (['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'NotAllowedError', 'QuotaExceededError', 'DataCloneError', 'AudioExtractionError', 'ApiError', 'ResponseUnknownError', 'InvalidStateError', 'NotSupportedError', 'SecurityError', 'NotReadableError', 'OperationError', 'TimeoutError'].includes(value.name)) type = value.name;
      // Retain source positions only; never the first line, function arguments, URL query or absolute path.
      stack = (value.stack || '').split('\n').slice(1, 13).flatMap(line => {
        const match = line.match(/(?:\/src\/([\w/.-]+\.[jt]sx?)|\/assets\/([\w.-]+\.js)):(\d+):(\d+)/);
        return match ? [`${match[1] ? `src/${match[1]}` : `assets/${match[2]}`}:${match[3]}:${match[4]}`] : [];
      });
    }
  } catch { /* Hostile error getters never escape the diagnostic boundary. */ }
  return { type, message: type === 'AbortError' ? '操作已取消' : '模块报告错误；未采集原始错误文本', stack };
}
export function safeText(value: string, limit = 4096): string {
  return value.slice(0, limit)
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[credential]')
    .replace(/\b(password|passwd|cookie|session(?:[_-]?id)?|csrf(?:[_-]?token)?|authorization|api[ _-]?key|lease[ _-]?token|token)\b\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[credential]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[credential]')
    .replace(/(?:https?|file|blob):\/\/[^\s<>"']+/gi, '[url]')
    .replace(/(?:[A-Za-z]:\\|\/(?:Users|home|private|tmp)\/)[^\s<>"']+/g, '[path]');
}
/** Route templates, never query strings, search terms, usernames or arbitrary paths. */
export function safeRoute(path: string): string {
  const clean = path.split(/[?#]/)[0];
  if (!/^\/(?:api\/)?(?:auth\/(?:session|login|logout|password|me)|me\/settings|ass\/(?:empty|import|export|split|styles)|organizations(?:\/\d+(?:\/(?:members(?:\/\d+)?|leave|style-templates(?:\/\d+)?|projects(?:\/\d+(?:\/(?:document|split|styles|archive|restore))?)?))?)?)$/.test(clean)) return 'other';
  return clean.replace(/\/\d+(?=\/|$)/g, '/:id');
}
export function safeContext(context: Context): Context {
  return { page: /^[a-z-]{1,40}$/.test(context.page) ? context.page : 'unknown',
    ...(Number.isSafeInteger(context.organizationId) ? { organizationId: context.organizationId } : {}),
    ...(Number.isSafeInteger(context.projectId) ? { projectId: context.projectId } : {}) };
}
const cue = (v: CueFields): CueFields => ({ text: safeText(v.text), start_ms: v.start_ms, end_ms: v.end_ms, style_id: safeText(v.style_id, 100) });
const draft = (v: TimeDraft): TimeDraft => ({ startText: safeText(v.startText, 40), endText: safeText(v.endText, 40), selectedId: v.selectedId && safeText(v.selectedId, 100) });
const fieldNames = new Set(['name', 'Fontname', 'Fontsize', 'PrimaryColour', 'SecondaryColour', 'OutlineColour', 'BackColour', 'Bold', 'Italic', 'Underline', 'StrikeOut', 'ScaleX', 'ScaleY', 'Spacing', 'Angle', 'BorderStyle', 'Outline', 'Shadow', 'Alignment', 'MarginL', 'MarginR', 'MarginV', 'Encoding', 'play_res_x', 'play_res_y', 'scaled_border_and_shadow']);
export function safeData(input: EventData): EventData {
  const out: EventData = {};
  for (const key of ['status', 'durationMs', 'revision', 'count'] as const) if (typeof input[key] === 'number' && Number.isFinite(input[key])) out[key] = input[key];
  for (const key of ['operationId', 'requestId', 'method', 'reason', 'cueId', 'styleId'] as const) if (typeof input[key] === 'string') out[key] = safeText(input[key], 100);
  if (input.route) out.route = safeRoute(input.route);
  if (input.before) out.before = cue(input.before);
  if (input.after) out.after = cue(input.after);
  if (input.draftBefore) out.draftBefore = draft(input.draftBefore);
  if (input.draftAfter) out.draftAfter = draft(input.draftAfter);
  if (input.error) out.error = { type: /^[A-Za-z]{1,40}$/.test(input.error.type) ? input.error.type : 'Error', message: '模块报告错误；未采集原始错误文本', stack: input.error.stack.filter(line => /^(?:src\/[\w/.-]+\.[jt]sx?|assets\/[\w.-]+\.js):\d+:\d+$/.test(line)).slice(0, 12) };
  if (input.fields) out.fields = Object.fromEntries(Object.entries(input.fields).filter(([key]) => fieldNames.has(key)).slice(0, 40).map(([key, value]) => [key, typeof value === 'string' ? safeText(value, 200) : value]));
  return out;
}
