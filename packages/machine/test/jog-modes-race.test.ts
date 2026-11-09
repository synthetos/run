/**
 * The modes a motion puts back come from a polled read, never from the last pushed report (SAFETY §4.2, §4.5b, H50).
 *
 * A jog writes `G21 G91` pieces and ends with `G90`. The board's filtered status report prints `si` ms after a change,
 * so the last report a jog leaves behind can still show its own `G91` after its closing `G90` was answered. A second
 * jog started inside that window once took `dist` 1 from the report as "the mode the board had", and ended with `G91`:
 * the board was left in relative mode, and the next typed `G1 X10` would move 10 mm from wherever the tool was.
 */
import type { ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import type { SessionIntent } from '../src/index.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT, shown } from './simTransport.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

async function connected(): Promise<Harness> {
  const h = harness('en', { device: { start: 'ready' }, session: { manifest: EN_APPROVED, release: PHASE_2_RELEASE } });
  void h.session.connect(PORT);
  await h.run(3000);
  return h;
}

function writes(h: Harness): string[] {
  return (h.transports.at(-1)?.writes ?? []).map(shown);
}

/** Motion lines and realtime bytes after `from` (no GETs). */
function motionWrites(h: Harness, from: number): string[] {
  return writes(h)
    .slice(from)
    .filter((w) => !w.startsWith('{') && w !== '\\x05');
}

/** Runs until the session is back at idle with no motion, in small steps, and returns at once. */
async function untilIdle(h: Harness): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    const s = h.session.snapshot;
    if (s.motion === null && s.base === 'IDLE_UNHOMED') return;
    await h.run(1);
  }
  throw new Error('the session never came back to idle');
}

// 5 mm at 1000 mm/min is two 2.5 mm pieces and about 300 ms of travel: the first report prints during the move.
const STEP_X: SessionIntent = { intent: 'jog', axes: { x: 1 }, distanceMm: 5, feed: 1000 };
const HOLD_Y: SessionIntent = { intent: 'jog', axes: { y: 1 }, distanceMm: null, feed: 1000 };

describe('the modes a jog puts back', () => {
  it('a hold jog started while the last report still shows the previous jog’s G91 ends with G90', async () => {
    const h = await connected();
    expect(h.session.request(STEP_X).allowed).toBe(true);
    await untilIdle(h);
    // The race: the step's G90 is answered, but the latest pushed report is still the one from during the step.
    expect(motionWrites(h, 0).at(-1)).toBe('G90\\n');
    expect(h.session.snapshot.live.dist).toBe(1);

    const from = writes(h).length;
    expect(h.session.request(HOLD_Y).allowed).toBe(true);
    for (let i = 0; i < 4; i++) {
      await h.run(150);
      h.session.request({ intent: 'jog', renew: true });
    }
    expect(h.session.request({ intent: 'feedhold', release: true }).allowed).toBe(true);
    await untilIdle(h);
    await h.run(500);
    const w = motionWrites(h, from);
    expect(w.slice(w.indexOf('!'))).toEqual(['!', '%', 'G90\\n']);
  });

  it('a step started in the same window ends with G90 too', async () => {
    const h = await connected();
    h.session.request(STEP_X);
    await untilIdle(h);
    expect(h.session.snapshot.live.dist).toBe(1);
    const from = writes(h).length;
    expect(h.session.request(STEP_X).allowed).toBe(true);
    await untilIdle(h);
    await h.run(500);
    expect(motionWrites(h, from)).toEqual(['G21\\n', 'G21 G91 G1 X5 F1000\\n', 'G90\\n']);
  });
});
