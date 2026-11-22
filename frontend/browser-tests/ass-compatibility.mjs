/** Independent installed libass/WASM oracle. No server/browser/network required. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { codec } from './ass-codec.mjs';

// JASSUB's generated browser module expects these globals even with pool size 0.
// Only the fetch transport is replaced by local bytes; the parser and renderer
// are the installed, unmodified WASM engine. No fonts/URLs from ASS are fetched.
globalThis.self = globalThis;
self.name = '';
globalThis.Worker = Worker;
const wasm = readFileSync(new URL('../node_modules/jassub/dist/wasm/jassub-worker.wasm', import.meta.url));
globalThis.fetch = async () => new Response(wasm, { headers: { 'Content-Type': 'application/wasm' } });
const { default: WASM } = await import('../node_modules/jassub/dist/wasm/jassub-worker.js');
const module = await WASM({ __poolSize: 0, __out: () => {} });
const renderer = new module.JASSUB(640, 360, 'noto sans sc');
renderer.setThreads(1);
const font = readFileSync(new URL('../src/ass-preview/fonts/NotoSansSC-Regular.otf', import.meta.url));
const pointer = module._malloc(font.length);
self.HEAPU8RAW.set(font, pointer);
renderer.addFont('compatibility-font', pointer, font.length);
renderer.reloadFonts();

function track(source) {
  renderer.createTrackMem(source);
  return { styles: renderer.getStyles(), events: renderer.getEvents() };
}
function render(time = 2) {
  return renderer.rawRender(time, 1).map(image => {
    const hash = createHash('sha256');
    for (let y = 0; y < image.h; y++) {
      const start = image.bitmap + y * image.stride;
      hash.update(self.HEAPU8RAW.subarray(start, start + image.w));
    }
    return { w: image.w, h: image.h, x: image.dst_x, y: image.dst_y, color: image.color, hash: hash.digest('hex') };
  });
}
function roundtrip(source) {
  const parsed = codec('parse', { source });
  assert.equal(parsed.status, 200);
  assertModelStyles(source, parsed.body.document);
  const exported = codec('export', { document: parsed.body.document });
  assert.equal(exported.status, 200);
  assertModelStyles(exported.body.text, parsed.body.document);
  return exported.body.text;
}
function assertModelStyles(source, document) {
  const actual = track(source);
  assert.equal(actual.events.length, document.cues.length);
  for (const [index, cue] of document.cues.entries()) {
    const expected = document.styles.find(style => style.id === cue.style_id);
    assert.ok(expected, 'model style_id must resolve');
    const renderedStyle = actual.styles[actual.events[index].Style];
    assert.equal(renderedStyle.Name, expected.name, `cue ${index}: model/engine style identity`);
    assert.equal(renderedStyle.FontSize, Number(expected.fields.Fontsize), `cue ${index}: actual font size`);
    assert.equal(renderedStyle.FontName, expected.fields.Fontname, `cue ${index}: actual font name`);
  }
}
function rejects(source) {
  const result = codec('parse', { source });
  assert.equal(result.status, 422);
  assert.equal(result.body.document, undefined);
}

try {
  const basic = readFileSync(new URL('../../backend/ass_format/fixtures/basic.ass', import.meta.url), 'utf8');
  // A zero-duration cue remains in the ASS track but has no visible interval.
  // Extending it must restore rendering without rebuilding a special draft row.
  const zeroDocument = codec('parse', { source: basic }).body.document;
  zeroDocument.cues = [{ ...zeroDocument.cues[0], start_ms: 3000, end_ms: 3000 }];
  const zeroExport = codec('export', { document: zeroDocument });
  assert.equal(zeroExport.status, 200);
  assert.equal(track(zeroExport.body.text).events.length, 1);
  for (const time of [2.99, 3, 3.01]) assert.deepEqual(render(time), []);
  zeroDocument.cues[0].end_ms = 5000;
  const extendedExport = codec('export', { document: zeroDocument });
  assert.equal(extendedExport.status, 200);
  track(extendedExport.body.text);
  assert(render(3).length > 0);

  const canonical = track(basic);
  const canonicalImages = render();
  assert.ok(canonicalImages.length > 0, 'font-backed actual render must produce images');

  // F1: accepting/canonicalizing lowercase keys would change actual rendering.
  const lower = basic.replaceAll('PlayResX:', 'playresx:').replaceAll('PlayResY:', 'playresy:');
  track(lower);
  assert.notDeepEqual(render(), canonicalImages);
  rejects(lower);

  // F2: model-distinct names would alias to the same renderer style name.
  const alias = basic.replaceAll('Emphasis', '*Default');
  const aliased = track(alias);
  assert.deepEqual(aliased.styles.slice(1).map(style => style.Name), ['Default', 'Default']);
  assert.equal(aliased.events[0].Style, aliased.events[1].Style);
  rejects(alias);

  // F3: Python-only forms really disagree with the rendering engine.
  for (const [value, rendererValue] of [['2_8', 2], ['２８', 0]]) {
    const source = basic.replace(',28,', `,${value},`);
    assert.equal(track(source).styles[1].FontSize, rendererValue);
    rejects(source);
  }
  for (const [value, rendererValue] of [['28', 28], ['+28', 28], ['28.', 28], ['.5', 0.5], ['2.8e1', 28], ['28E+0', 28]]) {
    const source = basic.replace(',28,', `,${value},`);
    assert.equal(track(source).styles[1].FontSize, rendererValue);
    assert.equal(track(roundtrip(source)).styles[1].FontSize, rendererValue);
  }

  // F4: leading ASCII whitespace resolves correctly; trailing whitespace
  // silently falls back to Default. The old audit only tested Default itself.
  const spaced = basic.replaceAll(',Default,', ', \tDefault,').replaceAll(',Emphasis,', ', Emphasis,');
  assert.deepEqual(track(spaced).events, canonical.events);
  assert.deepEqual(track(roundtrip(spaced)).events, canonical.events);

  const trailing = basic.replaceAll(',Emphasis,', ',Emphasis ,');
  const fallback = track(trailing);
  assert.equal(fallback.events[1].Style, fallback.events[0].Style);
  rejects(trailing);

  // R1: Unicode whitespace must survive until validation; Python stripping used
  // to promote invalid script settings to effective ones on unedited export.
  for (const source of [
    basic.replaceAll('PlayResX:', '\u00a0PlayResX:').replaceAll('PlayResY:', '\u00a0PlayResY:'),
    basic.replace('PlayResX: 640', 'PlayResX: \u00a0640').replace('PlayResY: 360', 'PlayResY: \u00a0360'),
  ]) {
    track(source);
    assert.notDeepEqual(render(2), canonicalImages);
    rejects(source);
  }

  // R2: cover the affected Emphasis event at 3.6s, after Default has ended.
  const unicodeNumber = basic.replace(',28,', ',\u00a028,');
  assert.equal(track(unicodeNumber).styles[1].FontSize, 0);
  assert.notDeepEqual(render(2), canonicalImages);
  rejects(unicodeNumber);
  track(basic);
  const emphasisImages = render(3.6);
  assert.ok(emphasisImages.length > 0);
  for (const name of ['Emphasis ', '\u00a0Emphasis', 'Emphasis\u00a0']) {
    const source = basic.replace('Style: Emphasis,', `Style: ${name},`);
    const actual = track(source);
    assert.equal(actual.events[1].Style, actual.events[0].Style);
    assert.notDeepEqual(render(3.6), emphasisImages);
    rejects(source);
  }
  const trailingFont = basic.replaceAll(',Local Test Font,', ',Local Test Font ,');
  assert.equal(track(trailingFont).styles[1].FontName, 'Local Test Font ');
  rejects(trailingFont);

  // Preserve verified safe ASCII syntax padding.
  const padded = basic.split('\n').map(line => {
    if (/^(PlayResX|PlayResY|ScaledBorderAndShadow):/u.test(line)) {
      const [key, value] = line.split(':');
      return ` \t${key}: \t${value.trim()} \t`;
    }
    if (line.startsWith('Style: ')) {
      return ' \tStyle: ' + line.slice(7).split(',').map((value, index) =>
        index < 2 ? ` \t${value}` : ` \t${value} \t`).join(',');
    }
    return line;
  }).join('\n');
  assert.deepEqual(track(padded), canonical);
  assert.deepEqual(track(roundtrip(padded)), canonical);
  assert.deepEqual(render(3.6), emphasisImages);

  // R3: equal roundtrip images cannot prove that the model's selected style is
  // used. Default variants alias; ordinary foo/Foo identities remain distinct.
  for (const name of ['default', 'DEFAULT', 'DeFaUlT']) {
    const source = basic.replaceAll('Emphasis', name);
    const actual = track(source);
    assert.deepEqual(actual.styles.slice(1).map(style => style.Name), ['Default', name]);
    assert.equal(actual.events[1].Style, actual.events[0].Style);
    rejects(source);
  }
  const caseDistinct = basic.replaceAll('Default', 'foo').replaceAll('Emphasis', 'Foo');
  const distinct = track(caseDistinct);
  assert.deepEqual(distinct.events.map(event => distinct.styles[event.Style].Name), ['foo', 'Foo']);
  roundtrip(caseDistinct);

  // Static overrides: compare actual glyph masks/colors/positions against
  // authored equivalent instructions, rather than only comparing codec output.
  const header = basic.split('Dialogue:')[0].replace(',1,2,0,2,', ',1,2,3,2,');
  const body = (text, style = 'Default') => header + `Dialogue: 0,0:00:01.00,0:00:03.00,${style},,0,0,0,,${text}\n`;
  const images = (text, style) => { track(body(text, style)); return render(2); };
  const equivalent = (left, right, style) => {
    const actual = images(left, style);
    assert.ok(actual.length > 0, left);
    assert.deepEqual(actual, images(right, style), `${left}: effective glyphs/color/position`);
    track(roundtrip(body(left, style)));
    assert.deepEqual(render(2), actual, `${left}: ASS roundtrip render`);
  };
  equivalent('{\\c&H0000FF&}Test', '{\\1c&H0000FF&}Test');
  equivalent('{\\c&HFF&\\c&H00FF00&}Test', '{\\c&H00FF00&}Test');
  equivalent('{\\2c&H123456&}Test', 'Test'); // no karaoke
  equivalent('{\\2a&HFF&}Test', '{\\2a&HFF&}Test'); // engine may change mask composition
  equivalent('{\\c&HFF&\\c}Test', 'Test');
  equivalent('{\\alpha&HFF&\\alpha}Test', 'Test');
  equivalent('{\\1c&HFF&\\1c\\1a&H80&\\1a}Test', 'Test');
  for (const component of [2, 3, 4]) {
    equivalent(`{\\${component}c&H123456&\\${component}c}Test`, 'Test');
    equivalent(`{\\${component}a&H80&\\${component}a}Test`, 'Test');
  }
  equivalent('{\\alpha&H80&\\1a&H00&}Test', '{\\1a&H00&\\2a&H80&\\3a&H80&\\4a&H80&}Test');
  equivalent('{\\an7\\pos(100,80)\\c&HFF&\\alpha&H80&\\b1\\i1\\u1\\s1}A{\\r}B',
    '{\\an7\\pos(100,80)\\c&HFF&\\alpha&H80&\\b1\\i1\\u1\\s1}A{\\c\\alpha\\b0\\i0\\u0\\s0}B');
  equivalent('{\\an7\\pos(100.5,80)\\r}Test', '{\\an7\\pos(100.5,80)}Test');
  equivalent('{\\c&HFF&\\alpha&H80&\\b0}A{\\r}B',
    '{\\c&HFF&\\alpha&H80&\\b0}A{\\c\\alpha\\b1}B', 'Emphasis');
  assert.deepEqual(images('{\\1a&H00&\\alpha&HFF&}Test'), []);
  assert.ok(images('{\\alpha&HFF&\\1a&H00&}Test').length > 0);
  const plainImages = images('Test');
  for (const tag of ['c&H0000FF&', '3c&H00FF00&', '4c&HFF0000&', 'alpha&H80&', '3a&H80&', '4a&HFF&']) {
    assert.notDeepEqual(images(`{\\${tag}}Test`), plainImages, `${tag}: must affect visible pixels`);
  }
  const positioned = images('{\\an7\\pos(100,80)}Test');
  assert.deepEqual(images('{\\an7\\pos(120,110)}Test'), positioned.map(tile => ({ ...tile, x: tile.x + 20, y: tile.y + 30 })));
  assert.ok(Math.min(...images('{\\an7}Test').map(tile => tile.y)) < Math.min(...images('Test').map(tile => tile.y)));
  for (const text of ['{\\an7\\r\\an2}Test', '{\\pos(1,2)\\r\\pos(3,4)}Test', '{\\rDefault}Test']) rejects(body(text));

  const root = new URL('../../backend/ass_format/fixtures/compatibility/', import.meta.url);
  const expected = JSON.parse(readFileSync(new URL('expected.json', root), 'utf8'));
  for (const [filename, semantics] of Object.entries(expected.valid)) {
    const source = readFileSync(new URL(filename, root), 'utf8');
    const before = track(source);
    assert.deepEqual(before.events.map(event => ({ start_ms: event.Start, end_ms: event.Start + event.Duration,
      text: event.Text, style: before.styles[event.Style].Name })), semantics.cues.map(cue => ({ ...cue,
      // libass trims ASCII line-end whitespace; the DTO/output deliberately
      // retain it, as independently asserted by the Python corpus tests.
      text: cue.text.replace(/[ \t]+$/u, '') })), filename);
    assert.deepEqual(before.events.map(event => event.Layer), semantics.cues.length ? [2, 2, 0, 0] : [], filename);
    const images = render(2.5);
    const after = track(roundtrip(source));
    assert.deepEqual(after, before, `${filename}: engine styles/hidden event fields/order`);
    assert.deepEqual(render(2.5), images, `${filename}: actual glyph images`);
  }
  console.log('ASS compatibility: audit evidence, static colors/alpha/alignment/position/reset rendering and 5 corpus glyph-image roundtrips passed');
} finally {
  renderer.quitLibrary();
  renderer.delete();
}
