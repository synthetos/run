/**
 * At a manual tool change only Z can be re-zeroed (H74 as amended 2026-11-08): an X, Y or A zero would shift the rest
 * of the job, which was checked at Start against the old offsets. Go to zero, G92 and the coordinate system are
 * refused there by the allow-matrix. The session against the edge-next model.
 */
import { describe, expect, it } from 'vitest';
import { TOOL_CHANGE_JOG_A, TOOL_CHANGE_ZERO } from '../src/index.ts';
import { jobHarness, load, runUntil, confirmFor } from './jobHarness.ts';

const TC = ['G21 G90', 'G1 X2 F600', 'T1 M6', 'G1 X0', 'M30'].join('\n');

async function atToolChange() {
  const h = await jobHarness({ rxm: 1 });
  await load(h, TC);
  h.session.startJob([], confirmFor(h));
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'toolChange', 20_000)).toBe(true);
  return h;
}

describe('Set zero at a manual tool change', () => {
  it('X, Y, A or several axes are refused with the reason; Z alone is allowed and the job stays at the change', async () => {
    const h = await atToolChange();
    for (const axes of [['x'], ['y'], ['a'], ['x', 'y', 'z'], ['z', 'x']] as const) {
      expect(h.session.request({ intent: 'setWorkZero', axes: [...axes] })).toMatchObject({ allowed: false, reason: TOOL_CHANGE_ZERO });
    }
    expect(h.session.request({ intent: 'setWorkZero', axes: ['z'] })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.state.motion === null && h.session.state.queue.length === 0, 10_000);
    expect(h.session.snapshot.base).toBe('PROGRAM_PAUSED');
    expect(h.session.snapshot.job?.phase).toBe('toolChange');
  });

  it('Go to zero, a temporary offset, a coordinate system and an A jog are refused there; X, Y and Z jogs are not', async () => {
    const h = await atToolChange();
    expect(h.session.request({ intent: 'jog', axes: { a: 1 }, distanceMm: 1, feed: 600 })).toMatchObject({ allowed: false, reason: TOOL_CHANGE_JOG_A });
    expect(h.session.request({ intent: 'jog', axes: { x: 1, a: -1 }, distanceMm: 1, feed: 600 })).toMatchObject({ allowed: false, reason: TOOL_CHANGE_JOG_A });
    expect(h.session.request({ intent: 'jog', axes: { z: 1 }, distanceMm: 1, feed: 600 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.state.motion === null, 10_000);
    expect(h.session.request({ intent: 'goToZero', axes: ['z'], safeZ: 0 }).allowed).toBe(false);
    expect(h.session.request({ intent: 'tempOffset', axes: ['z'] }).allowed).toBe(false);
    expect(h.session.request({ intent: 'selectCoordSystem', system: 2 }).allowed).toBe(false);
  });
});
