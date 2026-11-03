/**
 * Offset writes and status 13 (firmware bug hunt, 2026-11-02): back-to-back G10 L2/L20 can be refused with
 * status 13 (buffer full) even when each reply is awaited; the cause is not known yet. Until it is, Set work zero
 * and G54..G59 write the line again after about 0.5 s, at most 3 attempts in all, and log each refusal.
 */
import type { TinyGEdgeNextModel } from '@synthetos/testkit';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { MOTION_LIMITS } from '../src/index.ts';
import { EN_APPROVED } from './jobHarness.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT, shown } from './simTransport.ts';

async function connected(): Promise<Harness> {
  const h = harness('en', { device: { start: 'ready' }, session: { manifest: EN_APPROVED, release: PHASE_2_RELEASE } });
  void h.session.connect(PORT);
  await h.run(3000);
  return h;
}

const g10 = (h: Harness): string[] => (h.transports.at(-1)?.writes ?? []).map(shown).filter((w) => w.startsWith('G10') || /^G5[4-9]/.test(w));

describe('offset writes refused with status 13', () => {
  it('Set work zero is written again after a status 13 and then succeeds, with each refusal logged', async () => {
    const h = await connected();
    (h.device as TinyGEdgeNextModel).injectRefusal(/^G10/, 13, 1);
    expect(h.session.request({ intent: 'setWorkZero', axes: ['x'] })).toEqual({ allowed: true });
    await h.run(3000);
    expect(g10(h)).toEqual(['G10 L20 P1 X0\\n', 'G10 L20 P1 X0\\n']);
    expect(h.session.snapshot.notices.change).toMatchObject({ kind: 'done' });
    expect(h.session.log().filter((l) => l.text.includes('status 13 (buffer full), attempt 1 of 3'))).toHaveLength(1);
    expect(h.session.snapshot.motion).toBeNull();
  });

  it('gives up after 3 attempts with a plain message; G54..G59 are retried the same way', async () => {
    const h = await connected();
    (h.device as TinyGEdgeNextModel).injectRefusal(/^G10/, 13, 3);
    h.session.request({ intent: 'setWorkZero', axes: ['x', 'y'] });
    await h.run(4000);
    expect(g10(h)).toHaveLength(MOTION_LIMITS.offsetAttempts);
    expect(h.session.snapshot.notices.change).toMatchObject({ kind: 'refused', text: expect.stringContaining('3 times (status 13') });
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.session.log().some((l) => l.text.includes('3 times; not written'))).toBe(true);
    (h.device as TinyGEdgeNextModel).injectRefusal(/^G55/, 13, 1);
    h.session.request({ intent: 'selectCoordSystem', system: 2 });
    await h.run(3000);
    expect(g10(h).slice(-2)).toEqual(['G55\\n', 'G55\\n']);
    expect(h.session.snapshot.live.coor).toBe(2);
  });

  it('another status on an offset write is refused at once (no retry)', async () => {
    const h = await connected();
    (h.device as TinyGEdgeNextModel).injectRefusal(/^G10/, 106, 1);
    h.session.request({ intent: 'setWorkZero', axes: ['x'] });
    await h.run(3000);
    expect(g10(h)).toHaveLength(1);
    expect(h.session.snapshot.notices.change).toMatchObject({ kind: 'refused' });
  });
});
