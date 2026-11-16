/** Expand prose only. Resource keys, plural suffixes, interpolation and technical tokens stay exact. */
export function pseudolocalize(text: string): string {
  const protectedParts = /(<code\b[^>]*>[\s\S]*?<\/code>|\{\{[\s\S]*?\}\}|<[^>]+>|\\[Nnhbisu](?:0\/1)?|\b(?:CueRelay|Aegisub|Noto Sans SC|WebCodecs|WebAssembly|OffscreenCanvas|Worker|PlayRes[XY]?|ScaledBorderAndShadow|BorderStyle|Alignment|Layer|Margin[LRV]|Fontname|Fontsize|Default|Comment|Dialogue|UTF-8|SHA-256|[A-Z][A-Z0-9_+./-]*|[A-Za-z]+(?:\+[A-Za-z0-9]+)+|\d+(?:[.:–-]\d+)*(?:ms|px|MiB|Hz)?|https?:\/\/\S+)\b)/g;
  const accents: Record<string, string> = { a: 'á', e: 'ë', i: 'ï', o: 'ô', u: 'ü', A: 'Á', E: 'Ë', I: 'Ï', O: 'Ô', U: 'Ü' };
  return '⟦' + text.split(protectedParts).map((part, index) => index % 2 ? part
    : part.replace(/[aeiouAEIOU]/g, char => accents[char].repeat(3))).join('') + '⟧';
}
export function pseudoResource<T>(value: T): T {
  if (typeof value === 'string') return pseudolocalize(value) as T;
  return Object.fromEntries(Object.entries(value as object).map(([key, text]) => [key, pseudoResource(text)])) as T;
}
