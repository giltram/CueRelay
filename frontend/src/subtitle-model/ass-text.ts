/** Lexical projection for search only. The backend owns validity, ranges and
 * whole-line interactions; this never authorizes import, editing or export.
 * Unknown/incomplete syntax stays literal so replacement cannot repair it silently.
 */
const number = '[+-]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)';
const position = `pos\\([ \\t]*${number}[ \\t]*,[ \\t]*${number}[ \\t]*\\)`;
const color = '(?:[1-4]?c)(?:&H[0-9a-fA-F]{1,6}&)?';
const alpha = '(?:alpha|[1-4]a)(?:&H[0-9a-fA-F]{1,2}&?)?';
const block = new RegExp(`^(?:\\\\(?:[bius][01]|${color}|${alpha}|an[1-9]|${position}|r))+$`);

export function isProjectedAssBlock(content: string): boolean {
  return block.test(content);
}
