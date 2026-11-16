import { describe, expect, it } from 'vitest';
import {
  onJobMotionAnswer,
  onJobResume
} from '../src/session/job.ts';
import { jobHarness, runUntil, start, writes, zigzag } from './jobHarness.ts';
import { TC, model, ready, tx, why, withJob } from './jobLayerHarness.ts';

describe('T-S112: manual tool change (H74)', () => {
  it('stops before M6, drains, turns the spindle and coolant off, and resumes with the M6 line itself', async () => {
    const h = await jobHarness();
    const before = await start(h, TC);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'toolChange');
    const s = h.session.snapshot;
    expect(s.base).toBe('PROGRAM_PAUSED');
    expect(s.job?.toolChange).toMatchObject({ line: 5, tool: 2, spindle: 'cw', speed: 12000, restartsSpindle: false, moved: false });
    await h.run(500);
    const w = writes(h).slice(before);
    expect(w.some((x) => x.includes('M6'))).toBe(false);
    expect(w.slice(w.indexOf('N4 G1 X0'))).toEqual(expect.arrayContaining(['M5', 'M9']));
    expect(model(h).snapshot().spindle).toBe('off');
    // The spindle was on and the file does not restart it: C35 first.
    expect(h.session.request({ intent: 'resume' })).toMatchObject({ allowed: false, reason: expect.stringContaining('Run starts it (M3 S12000)') });
    // Jog to a change position (Z up), then resume: back at a safe height, spindle on, M6, on.
    expect(h.session.request({ intent: 'jog', axes: { z: 1 }, distanceMm: 5, feed: 600 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.motion === null && h.session.snapshot.base === 'PROGRAM_PAUSED');
    expect(h.session.snapshot.job?.toolChange?.moved).toBe(true);
    const at = writes(h).length;
    expect(h.session.request({ intent: 'resume', spindleRestart: true })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    const after = writes(h).slice(at).filter((x) => !x.startsWith('{"') && x !== '\\x05');
    // Explicit absolute millimetres first, the job's modes put back after the return (independent review 2026-11-03, R1).
    expect(after[0]).toBe('G90 G21');
    expect(after[1]).toMatch(/^G53 G0 Z[45](\.\d+)?$/);
    expect(after.slice(2, 6)).toEqual(['G53 G0 X0 Y0', 'G90', 'M3 S12000', 'N5 T2 M6']);
    expect(h.session.snapshot.job?.phase).toBe('done');
  });
});

describe('T-S112: manual tool change (H74)', () => {
  it('a jog during a tool change restores the job distance mode, not G90 (G91 file)', async () => {
    const h = await jobHarness();
    await start(h, ['G21 G91', 'G1 X2 F600', 'T1 M6', 'G1 X2', 'M30'].join('\n'));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'toolChange');
    const at = writes(h).length;
    h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 });
    await runUntil(h, () => h.session.snapshot.motion === null && h.session.snapshot.base === 'PROGRAM_PAUSED');
    expect(writes(h).slice(at)).toContain('G91');
  });
});

describe('T-S112: manual tool change (H74)', () => {
  it('only Resume and Stop job are offered at a breakpoint; motion intents are refused while a job runs', async () => {
    const h = await jobHarness();
    await start(h, zigzag(10), [6]);
    await h.run(200);
    expect(h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 }).allowed).toBe(false);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'breakpoint');
    expect(h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 })).toMatchObject({ allowed: false, reason: 'Only Resume and Stop job are offered at this stop.' });
  });
});

describe('the guards of the job decisions', () => {
  it('resume after a tool change: the position must be known, the speed must be known, the way back in range', async () => {
    const s = await ready();
    const tcState = (at: object, live: object, tc: object = {}) =>
      withJob({ ...s, live: { ...s.live, mpo: live as never } }, { phase: 'toolChange', toolChange: { index: 1, tool: 1, spindle: 'off', speed: null, mist: false, flood: false, restartsSpindle: true, at: at as never, units: 1, dist: 0, ...tc } });
    expect(why(onJobResume(tx(tcState({ x: 0, y: 0, z: 0 }, { x: 5 })).t, { intent: 'resume' }, 0))).toBe('The machine position is not known.');
    expect(why(onJobResume(tx(tcState({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { spindle: 'ccw', restartsSpindle: false })).t, { intent: 'resume', spindleRestart: true }, 0))).toBe('The spindle was on, but its speed is not known.');
    expect(why(onJobResume(tx(tcState({ x: 9999, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).t, { intent: 'resume' }, 0))).toBe('The way back is out of range.');
    const ok = tx(tcState({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { spindle: 'ccw', speed: 800, restartsSpindle: false, mist: true, flood: true }));
    expect(onJobResume(ok.t, { intent: 'resume', spindleRestart: true }, 0).allowed).toBe(true);
    expect(ok.t.s.queue.map((q) => q.line)).toEqual(['M4 S800', undefined, undefined, undefined, undefined]);
    expect(ok.t.s.job?.resumeSteps.map((x) => x.line)).toEqual(['M7', 'M8']);
    expect(onJobMotionAnswer(ok.t, 'M4 S800', 0, 1)).toBe(true);
    expect(onJobMotionAnswer(ok.t, 'M7', 132, 1)).toBe(true);
    expect(ok.t.s.job?.phase).toBe('toolChange');
    expect(onJobMotionAnswer(tx(s).t, 'M5', 0, 1)).toBe(false);
  });
});

describe('more of the job layer, through its edges', () => {
  it('resume: a control line still owed waits; no hold means no ~; a tool change with nothing to put back goes on at once', async () => {
    const s = await ready();
    expect(why(onJobResume(tx({ ...withJob(s, { phase: 'paused' }), expected: [{ token: 'stat', purpose: 'poll', late: false }] }).t, { intent: 'resume' }, 0))).toBe('The controller is still answering.');
    for (const phase of ['programStop', 'refused'] as const) {
      const r = tx({ ...withJob(s, { phase, confirmed: 2 }), live: { ...s.live, hold: 0 } });
      expect(onJobResume(r.t, { intent: 'resume', skip: true }, 0).allowed).toBe(true);
      expect(r.fx.some((e) => e.kind === 'writeRealtime')).toBe(false);
    }
    const tcState = withJob({ ...s, live: { ...s.live, mpo: {} } }, { phase: 'toolChange', toolChange: { index: 1, tool: null, spindle: 'off', speed: null, mist: false, flood: false, restartsSpindle: false, at: {}, units: 1, dist: 0 } });
    const r = tx(tcState);
    expect(onJobResume(r.t, { intent: 'resume' }, 0).allowed).toBe(true);
    expect(r.t.s.job?.phase).toBe('running');
    expect(r.t.s.job?.events.at(-2)?.text).toBe('Resuming after the tool change.');
    const ccw = tx(withJob({ ...s, live: { ...s.live, mpo: {} } }, { phase: 'toolChange', toolChange: { index: 1, tool: 1, spindle: 'ccw', speed: 500, mist: false, flood: false, restartsSpindle: false, at: {}, units: 1, dist: 0 } }));
    expect(why(onJobResume(ccw.t, { intent: 'resume' }, 0))).toMatch(/Run starts it \(M4 S500\)/);
  });
});
