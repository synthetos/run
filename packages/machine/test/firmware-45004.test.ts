import { TinyGEdgeNextModel } from '@synthetos/testkit';
import { expect, it } from 'vitest';
import { jobHarness, start, runUntil, load, writes } from './jobHarness.ts';
import { Driver, EN_READY_BANNER } from './sessionDriver.ts';
const candidate = { fb: 450.04, fv: 0.97, hv: 8, layout: 10002 };
const manifest = { environment: 'staging' as const, builds: [{ channel: 'bench' as const, dialect: 'tinyg-en' as const, fb: 450.04, fbs: null, commit: 'e'.repeat(40), note: 'test only' }] };
const options = { device: { build: candidate }, session: { manifest } };

it('450.04 classifies only with test approval; hold stops outputs and resume waits for firmware spin-up', async () => {
  const h = await jobHarness(options);
  expect(h.session.snapshot.classification?.mode).toBe('full');
  await start(h, 'G21 G90\nM3 S1000\nG1 X50 F300\nM5\nM30');
  await h.run(1000);
  h.session.request({ intent: 'feedhold' });
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'paused')).toBe(true);
  expect(h.device.snapshot().spindle).toBe('off');
  const heldPosition = h.device.snapshot().position;
  expect(h.session.request({ intent: 'resume' })).toEqual({ allowed: true });
  await h.run(500);
  expect(h.device.snapshot()).toMatchObject({ hold: 6, spindle: 'cw' });
  expect(h.device.snapshot().position).toEqual(heldPosition);
  expect(h.session.snapshot.job?.phase).not.toBe('failed');
  await h.run(600);
  expect(h.device.snapshot()).toMatchObject({ hold: 0, spindle: 'cw' });
  expect(h.device.snapshot().position[0]).toBeGreaterThan(heldPosition[0]!);
  h.session.request({ intent: 'stopJob' });
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped')).toBe(true);
  expect(h.device.snapshot().spindle).toBe('off');
});
it('N104: missing arc centres are blocked before any job or typed movement is sent', async () => {
  const h = await jobHarness(options);
  const from = writes(h).length;
  await load(h, 'G21 G90\nG2 X1 Y1 F100');
  expect(h.session.snapshot.job?.phase).toBe('blocked');
  h.session.loadJob(null);
  expect(h.session.request({ intent: 'typedMove', line: 'G2 X1 Y1 F100' }).allowed).toBe(false);
  expect(writes(h).slice(from).every(w => w.startsWith('{'))).toBe(true);
});
it('N93: READY on 450.04 waits at least half a second before retrying the initial probe', () => {
  for (const fb of [450.02, 450.04]) {
    const d = new Driver(); d.open(); d.written();
    const effects = d.line(EN_READY_BANNER.replace('450.01', String(fb)));
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'armTimer', id: 'settle', ms: fb >= 450.04 ? 500 : 300 }));
    expect(d.writing).toBeUndefined();
    d.fire('settle');
    expect(d.lines().at(-1)).toBe('{sr:null}');
  }
});

it('450.04 spph=0 resumes motion without the spindle spin-up delay', async () => {
  const h = await jobHarness({ ...options, device: { build: candidate, eeprom: { __layout: 10002, spph: 0, spde: 10 } } });
  await start(h, 'G21 G90\nM3 S1000\nG1 X50 F300\nM5\nM30');
  await h.run(1000);
  h.session.request({ intent: 'feedhold' });
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'paused')).toBe(true);
  expect(h.device.snapshot().spindle).toBe('cw');
  const heldPosition = h.device.snapshot().position;
  expect(h.session.request({ intent: 'resume' })).toEqual({ allowed: true });
  await h.run(100);
  expect(h.device.snapshot()).toMatchObject({ hold: 0, spindle: 'cw' });
  expect(h.device.snapshot().position[0]).toBeGreaterThan(heldPosition[0]!);
});
it('N104: a controller refusal 157 holds a streaming job and explains the refused line', async () => {
  const h = await jobHarness(options);
  (h.device as TinyGEdgeNextModel).injectRefusal(/^N3 /, 157, 1);
  await start(h, 'G21 G90\nG1 X10 F300\nG1 X20\nM30');
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'refused')).toBe(true);
  expect(h.session.snapshot.job?.refused).toMatchObject({ line: 3, status: 157 });
  expect(h.session.snapshot.job?.message).toContain('the arc centre is missing or at its start');
  expect(h.device.snapshot().machineState).not.toBe('alarm');
});
it('N104: a typed move refused with 157 explains the line without entering alarm', async () => {
  const h = await jobHarness(options);
  (h.device as TinyGEdgeNextModel).injectRefusal(/^G1 /, 157, 1);
  expect(h.session.request({ intent: 'typedMove', line: 'G1 X1 F100' }).allowed).toBe(true);
  await h.run(1000);
  expect(h.session.snapshot.notices.motion?.text).toContain('the arc centre is missing or at its start');
  expect(h.device.snapshot().machineState).not.toBe('alarm');
});
