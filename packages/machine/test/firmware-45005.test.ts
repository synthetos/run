import { expect, it } from 'vitest';
import { jobHarness, start, runUntil, writes, JOBS_RELEASE } from './jobHarness.ts';
import { SETTING_LINE, settingRefusal, checkWrite } from '../src/index.ts';
const fb = 450.05;
const options = { device: { build: { fb, fv: 0.97, hv: 8, layout: 10003 } }, session: { manifest: { environment: 'staging' as const, builds: [{ channel: 'bench' as const, dialect: 'tinyg-en' as const, fb, fbs: null, commit: 'e'.repeat(40), note: 'test' }] } } };
it('450.05 fake serial: N99 Run throughout trailing dwell cannot complete the job early', async () => {
  const h = await jobHarness(options);
  expect(h.session.snapshot.classification).toMatchObject({ mode: 'full', dialectId: 'tinyg-en' });
  await start(h, 'G21 G90\nG4 P2');
  await h.run(800);
  expect(h.device.snapshot()).toMatchObject({ stat: 5, plannerAvailable: 32 });
  expect(h.session.snapshot.job?.phase).not.toBe('done');
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 6000)).toBe(true);
});
it('450.05 N109: while moving settings never reach the wire, and the setting gate rejects batching', async () => {
  const h = await jobHarness(options);
  await start(h, 'G21 G90\nG1 X50 F60');
  await h.run(500);
  const before = writes(h).length;
  expect(h.session.request({ intent: 'settingsWrite', key: 'xvm', value: 1234 }).allowed).toBe(false);
  await h.run(200);
  expect(writes(h).slice(before).some(line => line.includes('1234'))).toBe(false);
  expect(SETTING_LINE.test('{"mfo":1,"xvm":1234}\n')).toBe(false);
  expect(checkWrite(h.session.state, h.session.state, JOBS_RELEASE, new TextEncoder().encode('{"mfo":1,"xvm":1234}\n'), 'settingsWrite')).toMatchObject({ kind: 'denied' });
  expect(SETTING_LINE.test('{"xvm":1234}\n')).toBe(true);
  for (const key of ['spph', 'spde', 'coph', 'mfo', 'mfoe', 'm48e', 'mfc', 'mcp', 'mfe']) expect(settingRefusal('tinyg-en', key, 1, {}, fb)).not.toBeNull();
});
