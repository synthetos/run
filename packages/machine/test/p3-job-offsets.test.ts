/**
 * The offsets read again once a job ends (jobOffsets.ts): a job's own G10, G92 or M30 changes the board's work
 * offsets without a read, so the values the zero check before the next Start uses (`ofs`, the page's boardZero),
 * the offsets panel and the DRO's total are read again, once, when the board is quiet.
 */
import { describe, expect, it } from 'vitest';
import { droView } from '../src/index.ts';
import { jobHarness, runUntil, start, writes } from './jobHarness.ts';

describe('the work offsets after a job', () => {
  it('done: a G10 L2 the job ran is in the ofs and g54 read after it, read once', async () => {
    const h = await jobHarness({ rxm: 0 });
    const before = await start(h, 'G21 G90\nG10 L2 P1 X7 Y8 Z-1\nG0 X1\nM30');
    expect(h.session.state.values['ofs']?.value).toMatchObject({ x: 0, y: 0, z: 0 });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done' && h.session.state.job?.offsetsReread === true && h.session.state.queue.length === 0 && !h.session.state.expected.some((e) => !e.late));
    const s = h.session.state;
    expect(s.values['ofs']?.value).toMatchObject({ x: 7, y: 8, z: -1 });
    expect(s.values['g54']?.value).toMatchObject({ x: 7, y: 8, z: -1 });
    expect(s.values['ofs']?.at).toBeGreaterThanOrEqual(s.job?.endedAt as number);
    const after = writes(h).slice(before);
    const end = after.indexOf('N4 M30');
    expect(after.slice(end).filter((w) => w === '{"ofs":null}')).toHaveLength(1);
    expect(after.slice(end).filter((w) => /^\{"(unit|coor|g92|g5[4-9])":null\}$/.test(w))).toEqual(['{"unit":null}', '{"coor":null}', '{"g92":null}', '{"g54":null}', '{"g55":null}', '{"g56":null}', '{"g57":null}', '{"g58":null}', '{"g59":null}']);
    // Nothing more once read.
    const count = writes(h).length;
    await h.run(2000);
    expect(writes(h).slice(count).filter((w) => w.endsWith(':null}') && !w.startsWith('{"sr"'))).toEqual([]);
  });

  it('stopped: the G92 the board keeps after Stop job is read back, and the readout says so', async () => {
    const h = await jobHarness({ rxm: 0 });
    const moves = Array.from({ length: 30 }, (_, i) => `G1 X${String(i % 2 === 0 ? 10 : 0)} F3000`);
    await start(h, ['G21 G90', 'G0 X5', 'G92 X0', ...moves, 'M30'].join('\n'));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 8);
    expect(h.session.stopJob()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped' && h.session.state.job?.offsetsReread === true && h.session.state.queue.length === 0 && !h.session.state.expected.some((e) => !e.late));
    const s = h.session.snapshot;
    expect(s.values['g92']?.value).toMatchObject({ x: 5 });
    expect(s.values['ofs']?.value).toMatchObject({ x: 5 });
    expect(droView(s, s.live.lastRxAt as number).marker?.g92).toBe(true);
  });
});
