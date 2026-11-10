import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { uiDocument } from './ass-codec.mjs';

export function performanceDocument(count) {
  const document = uiDocument();
  document.cues = Array.from({ length: count }, (_, index) => ({ id: `new-${index}`,
    start_ms: index * 500, end_ms: index * 500 + 450, style_id: document.styles[0].id,
    text: `target${index + 1}end 性能测量 ${index % 4 === 0 ? '多行文本\\N'.repeat(4) : '普通字幕'}` }));
  return document;
}

/** Only synthetic media is generated here. Real files stay outside version control. */
export function performanceVideo(directory) {
  const file = join(directory, 'short.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    'color=c=black:s=320x180:r=25:d=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-ac', '2', '-movflags', '+faststart', file]);
  return file;
}

/** Identity is disposable; ASS still goes through the real local HTTP serializer. */
export async function installPerformanceFixtures(context, document, errors) {
  await context.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (['/api/ass/export', '/api/ass/import', '/api/ass/inspect'].includes(path)) return route.continue();
    const fixtures = {
      '/api/auth/session': { user: { id: 1, username: 'performance-fixture', is_dev: false } },
      '/api/organizations': { organizations: [] },
      '/api/me/settings': { handbook_seen: true, shortcut_overrides: {}, audio_display_mode: 'spectrum' },
      '/api/ass/empty': { document },
    };
    if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
    errors.push(`unexpected ${route.request().method()} ${path}`); return route.abort();
  });
}
