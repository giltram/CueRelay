// Reuse maintained standalone checks; report scripts separately from unified app scenes.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { test, expect, fixtures } from '../regression/helpers.mjs';
const execute = promisify(execFile);

test('media existing file handle timeline and rendered PCM specialists', async ({ baseURL }, info) => {
  test.setTimeout(240000);
  const results = [];
  for (const [script, variable] of [['video-restore', 'VIDEO_RESTORE_URL'], ['audio-timeline', 'AUDIO_TIMELINE_URL'], ['audio-audition', 'AUDIO_AUDITION_URL']]) {
    if (process.env.CUERELAY_SPECIALIST && process.env.CUERELAY_SPECIALIST !== script) continue;
    const started = performance.now();
    try {
      const result = await execute('node', [`browser-tests/${script}.mjs`], {
        cwd: new URL('..', import.meta.url), env: { ...process.env, [variable]: baseURL, BROWSER_TEST_CHANNEL: 'bundled', BROWSER_TEST_USERNAME: fixtures.username, BROWSER_TEST_PASSWORD: fixtures.password }, timeout: 180000, maxBuffer: 4 * 1024 * 1024,
      });
      await writeFile(info.outputPath(`${script}.log`), result.stdout + result.stderr);
      results.push({ script, exit: 0, seconds: (performance.now() - started) / 1000 });
    } catch (error) {
      await writeFile(info.outputPath(`${script}.log`), `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error}`);
      results.push({ script, exit: error.code ?? 1, seconds: (performance.now() - started) / 1000 });
    }
  }
  await writeFile(info.outputPath('specialists.json'), JSON.stringify(results, null, 2));
  expect(results.length).toBe(process.env.CUERELAY_SPECIALIST ? 1 : 3);
  expect(results.filter(result => result.exit !== 0)).toEqual([]);
});
