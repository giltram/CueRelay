/** Correlation IDs only, never credentials. Diagnostic startup must also work without randomUUID. */
export function diagnosticId(): string {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* fallback */ }
  const bytes = new Uint8Array(16);
  try { globalThis.crypto.getRandomValues(bytes); }
  catch { for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256); }
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
