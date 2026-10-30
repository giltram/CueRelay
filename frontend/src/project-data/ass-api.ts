import { diagnosticFetch, responseRequestId } from '../diagnostics/http';
import type { AssDocument, SplitRequest, SplitResult } from '../contracts/subtitles';
import { documentV2 } from './document-version';

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = await response.json().catch(() => null);
  const message = body?.issues?.map((issue: { line?: number; message: string }) =>
    `${issue.line ? `第 ${issue.line} 行：` : ''}${issue.message}`).join('\n');
  throw Object.assign(new Error(message || body?.detail || `ASS 转换失败（HTTP ${response.status}）`), { requestId: responseRequestId(response) });
}

export async function loadEmptyDocument(): Promise<AssDocument> {
  const response = await checked(await diagnosticFetch('/api/ass/empty'));
  return documentV2((await response.json()).document);
}

export async function importAss(file: File): Promise<AssDocument> {
  if (file.size > 1024 * 1024) throw new Error('ASS 文件不能超过 1MiB，原件仍保留在本地');
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error('仅支持 UTF-8 ASS（可含 BOM），请保留原件并另存编码后重试');
  }
  const response = await checked(await diagnosticFetch('/api/ass/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }),
  }));
  return documentV2((await response.json()).document);
}

/** Also used for preview: one backend serializer, no frontend ASS generation. */
export async function exportAss(document: AssDocument, signal?: AbortSignal): Promise<string> {
  const response = await checked(await diagnosticFetch('/api/ass/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document }), signal,
  }));
  return response.text();
}

export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Allow the browser to consume the URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Same backend split rules as persisted projects; local mode has no storage. */
export async function splitAss(request: SplitRequest): Promise<SplitResult> {
  const response = await checked(await diagnosticFetch('/api/ass/split', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  }));
  return response.json();
}
