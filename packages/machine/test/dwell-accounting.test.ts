import { expect, it } from 'vitest';
import { TinyGEdgeNextModel } from '@synthetos/testkit';
import { jobHarness, start, runUntil, writes } from './jobHarness.ts';

const candidate = (fb: number) => ({ device: { build: { fb, fv: 0.97, hv: 8, layout: 10002 } }, session: {
  manifest: { environment: 'staging' as const, builds: [{ channel: 'bench' as const, dialect: 'tinyg-en' as const, fb, fbs: null, commit: 'e'.repeat(40), note: 'test only' }] },
} });

for (const fb of [450.01, 450.02, 450.04]) {
  it(`${fb}: typed G4 cannot finish early or admit another move while its dwell is pending`, async () => {
    const h = await jobHarness(candidate(fb));
    expect(h.session.request({ intent: 'typedMove', line: 'G4 P2' }).allowed).toBe(true);
    await h.run(800);
    if (fb >= 450.02) expect(h.device.snapshot().plannerAvailable).toBe(32);
    expect(h.session.snapshot.motion).not.toBeNull();
    expect(h.session.request({ intent: 'typedMove', line: 'G1 X1 F100' }).allowed).toBe(false);
    expect(h.session.state.dwellWait).toBeDefined();
    expect(await runUntil(h, () => h.session.snapshot.notices.typed?.kind === 'done', 6000)).toBe(true);
    expect(h.session.state.dwellWait).toBeNull();
  });
}
it('trailing dwell after queued motion cannot spend its budget while waiting to start', async () => {
  const h = await jobHarness(candidate(450.04));
  await start(h, 'G21 G90\nG1 X10 F120\nG4 P2');
  await h.run(5500);
  expect(h.session.snapshot.job?.phase).not.toBe('done');
  expect(h.device.snapshot().plannerAvailable).toBe(32);
  await h.run(800);
  expect(h.session.snapshot.job?.phase).not.toBe('done');
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 5000)).toBe(true);
});
it('multiple trailing dwells are accounted together', async () => {
  const h = await jobHarness(candidate(450.04));
  await start(h, 'G21 G90\nG4 P1\nG4 P1');
  await h.run(1500);
  expect(h.session.snapshot.job?.phase).not.toBe('done');
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 5000)).toBe(true);
});
it('a program-stop barrier after G4 eventually confirms without sending past it', async () => {
  const h = await jobHarness(candidate(450.04));
  await start(h, 'G21 G90\nG4 P1\nM0\nG1 X1 F60\nM30');
  await h.run(500);
  expect(h.session.snapshot.job?.phase).not.toBe('programStop');
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'programStop', 5000)).toBe(true);
  expect(h.device.snapshot().position[0]).toBe(0);
});
it('Stop cancels a long typed dwell promptly and a later move is not delayed by its old budget', async () => {
  const h = await jobHarness(candidate(450.04));
  expect(h.session.request({ intent: 'typedMove', line: 'G4 P20' }).allowed).toBe(true);
  await h.run(500);
  expect(h.session.request({ intent: 'stopJob' }).allowed).toBe(true);
  expect(await runUntil(h, () => h.session.snapshot.motion === null, 2500)).toBe(true);
  expect(h.session.state.dwellWait).toBeNull();
  expect(writes(h)).toContain('%');
  expect(h.session.request({ intent: 'typedMove', line: 'G1 X1 F600' }).allowed).toBe(true);
  expect(await runUntil(h, () => h.session.snapshot.notices.typed?.kind === 'done', 2500)).toBe(true);
});
it('a refused dwell adds no wait', async () => {
  const h = await jobHarness(candidate(450.04));
  (h.device as TinyGEdgeNextModel).injectRefusal(/^G4 /, 106, 1);
  h.session.request({ intent: 'typedMove', line: 'G4 P20' });
  await h.run(800);
  expect(h.session.state.dwellWait == null).toBe(true);
});
it('Pause before a queued dwell starts cannot consume its completion wait', async () => {
  const h = await jobHarness(candidate(450.04));
  await start(h, 'G21 G90\nG1 X5 F120\nG4 P2');
  await h.run(500);
  h.session.request({ intent: 'feedhold' });
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'paused')).toBe(true);
  await h.run(3000);
  expect(h.session.request({ intent: 'resume' }).allowed).toBe(true);
  await h.run(2500);
  expect(h.session.snapshot.job?.phase).not.toBe('done');
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 6000)).toBe(true);
});
it('Stop cancels a trailing job dwell without waiting out its budget', async () => {
  const h = await jobHarness(candidate(450.04));
  await start(h, 'G21 G90\nG4 P20');
  await h.run(500);
  expect(h.session.request({ intent: 'stopJob' }).allowed).toBe(true);
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped', 2500)).toBe(true);
  expect(h.session.state.dwellWait).toBeNull();
});

it('modal-only acknowledgements cannot evict a still-running dwell from the idle guard', async () => {
  const h = await jobHarness(candidate(450.04));
  // G90 changes the model immediately: it consumes no planner slot. More than plannerBlocks+1
  // ACKs can therefore follow the hidden dwell without proving that it finished.
  await start(h, ['G21 G90', 'G4 P20', ...Array.from({ length: 40 }, () => 'G90')].join('\n'));
  await h.run(1000);
  expect(writes(h).filter(line => line.includes('G90')).length).toBeGreaterThanOrEqual(40);
  expect(h.device.snapshot().plannerAvailable).toBe(32);
  expect(h.session.snapshot.job?.phase).not.toBe('done');
  expect(h.session.state.dwellWait?.durationMs).toBe(20_000);
});
