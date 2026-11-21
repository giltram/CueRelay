/** SRT conversion transport and file-format dispatch. No parsing or editor state. */
import type { AssDocument } from '../contracts/subtitles';
import { describe, MessageError, messagesFromWire } from '../contracts/messages';
import { diagnosticFetch, responseRequestId } from '../diagnostics/http';
import { documentV2 } from './document-version';
import { importAss } from './ass-api';

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = await response.json().catch(() => null);
  const message = body?.issues?.length ? messagesFromWire(body.issues) : body?.detail
    || describe('srt.conversionFailed', 'SRT 转换失败（HTTP {{status}}）', { status: response.status });
  throw Object.assign(new MessageError(message), { requestId: responseRequestId(response) });
}

export async function importSubtitleFile(file: File): Promise<AssDocument> {
  if (/\.ass$/i.test(file.name)) return importAss(file);
  if (!/\.srt$/i.test(file.name)) throw new MessageError(describe('srt.fileType', '请选择 .ass 或 .srt 字幕文件。'));
  if (file.size > 1024 * 1024) throw new MessageError(describe('srt.tooLarge', 'SRT 文本不能超过 1MiB。'));
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
  } catch {
    throw new MessageError(describe('srt.encoding', '仅支持 UTF-8 SRT（可含 BOM）；请保留原件并另存编码后重试。'));
  }
  const response = await checked(await diagnosticFetch('/api/srt/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }),
  }));
  return documentV2((await response.json()).document);
}

export async function exportSrt(document: AssDocument, signal?: AbortSignal): Promise<string> {
  const response = await checked(await diagnosticFetch('/api/srt/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document }), signal,
  }));
  return response.text();
}
