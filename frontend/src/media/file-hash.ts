import { sha256 } from '@noble/hashes/sha2.js';

/** Read bounded chunks, never the entire media file. Used inside a dedicated Worker. */
export async function hashBlob(blob: Blob, progress: (ratio: number) => void, signal?: AbortSignal, chunkSize = 4 * 1024 * 1024): Promise<string> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error('Invalid hash chunk size');
  const hash = sha256.create();
  try {
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      signal?.throwIfAborted();
      const bytes = await blob.slice(offset, offset + chunkSize).arrayBuffer();
      signal?.throwIfAborted();
      hash.update(new Uint8Array(bytes));
      progress(Math.min(1, (offset + bytes.byteLength) / blob.size));
    }
    return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
  } finally { hash.destroy(); }
}
