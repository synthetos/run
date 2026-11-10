/**
 * The firmware time model in the app (docs/design/ANALYZE.md slice 2): the board's planner settings become the
 * model's profile (in millimetres, never guessed), the G-code worker times its last file, a late answer never lands
 * on another file or other settings, and the headline and "What to fix" use it.
 */
import { describe, expect, it } from 'vitest';
import type { Estimate, PlannerProfile } from '@synthetos/advisor';
import { createGcodeHandler } from '../src/gcode-worker/handler.ts';
import { createGcodePreviewClient, type WorkerLike } from '../src/gcode-worker/client.ts';
import { analyseBytes, type PreviewResult } from '../src/gcode-worker/pipeline.ts';
import type { FromGcodeWorker, ToGcodeWorker } from '../src/gcode-worker/protocol.ts';
import { motorSteps, type BoardReading } from '../src/workspace/analysisInputs.ts';
import { estimateFor, motionView, planEstimate, requestEstimate } from '../src/workspace/analysisState.ts';
import { plannerProfile } from '../src/workspace/plannerInputs.ts';
import { fixesFor } from '../src/workspace/views/analyze/findings.ts';
import { chips, headline, helpLines, subLine } from '../src/workspace/views/analyze/headlineText.ts';
import { SPEED_SHARE, speedCause, speedFix } from '../src/workspace/views/analyze/speedFix.ts';

const AXIS = { vm: 16000, fr: 16000, jm: 5000, jd: 0.01 };
const PROFILE: PlannerProfile = { axes: { X: { ...AXIS, stepsPerUnit: 40 }, Y: { ...AXIS, stepsPerUnit: 40 }, Z: { vm: 1000, fr: 1000, jm: 50, jd: 0.01, stepsPerUnit: 755.9293 } }, ja: 2_000_000, ct: 0.01 };
const READING: BoardReading = { dialect: 'tinyg-en', boardId: 'EN-1', unit: 1, vm: { X: 16000, Y: 16000, Z: 1000 }, fr: { X: 16000, Y: 16000, Z: 1000 }, jm: { X: 5000, Y: 5000, Z: 50 }, jd: { X: 0.01, Y: 0.01, Z: 0.01 }, ja: 2_000_000, ct: 0.01, spu: { X: 40, Y: 40, Z: 755.9293 }, at: 1 };
const preview = (text: string): PreviewResult => analyseBytes(new TextEncoder().encode(text), { dialect: 'tinyg-en', mode: 'full' }).result;

/** A worker that runs the real handler in-process. */
function worker(): WorkerLike {
  const w: WorkerLike = { onmessage: null, onerror: null, postMessage: (m: ToGcodeWorker) => void handle(m), terminate: () => {} };
  const handle = createGcodeHandler((m) => { w.onmessage?.({ data: m } as MessageEvent<FromGcodeWorker>); });
  return w;
}

describe('the planner settings from the board', () => {
  it('are the board’s, converted from inches, and none when any is missing', () => {
    expect(plannerProfile(READING)).toEqual(PROFILE);
    const inch = plannerProfile({ ...READING, unit: 0, vm: { X: 100, Y: 100, Z: 10 }, ct: 0.0004 });
    expect(inch?.axes.X.vm).toBeCloseTo(2540, 9);
    expect(inch?.ct).toBeCloseTo(0.01016, 9);
    expect(inch?.axes.X.stepsPerUnit).toBeCloseTo(40 / 25.4, 9);
    expect(plannerProfile(null)).toBeNull();
    expect(plannerProfile({ ...READING, unit: null })).toBeNull();
    const { ja: _ja, ...noJa } = READING;
    expect(plannerProfile(noJa)).toBeNull();
    expect(plannerProfile({ ...READING, jd: { X: 0.01, Y: 0.01 } })).toBeNull();
    // A zero jerk or rate (a board that does not report it reads as 0) is not a setting to time with.
    expect(plannerProfile({ ...READING, jm: { X: 0, Y: 5000, Z: 50 } })).toBeNull();
    expect(plannerProfile({ ...READING, ct: 0 })).toBeNull();
    expect(plannerProfile({ ...READING, jd: { X: 0, Y: 0, Z: 0 } })?.axes.X.jd).toBe(0);
    const { spu: _spu, ...noSteps } = READING;
    expect(plannerProfile(noSteps)?.axes.X.stepsPerUnit).toBeUndefined();
  });

  it('take the largest motor on an axis for steps per unit (two Y motors)', () => {
    const s = { '1ma': 0, '1sa': 1.8, '1mi': 8, '1tr': 40, '2ma': 1, '2sa': 1.8, '2mi': 8, '2tr': 40, '3ma': 1, '3sa': 1.8, '3mi': 16, '3tr': 40, '4ma': 2 };
    expect(motorSteps(s)).toEqual({ X: 40, Y: 80 });
  });
});

describe('the estimate', () => {
  it('comes from the worker for its last file; none before a file is loaded', async () => {
    const client = createGcodePreviewClient(worker);
    expect(await client.estimate(PROFILE)).toEqual({ ok: false, reason: 'No file is loaded.' });
    await client.load(new Blob(['G21 G90\nG1 X100 F2000\nG0 Z5\nM30\n']), { dialect: 'tinyg-en', mode: 'full' });
    const e = await client.estimate(PROFILE);
    expect(e.ok).toBe(true);
    if (e.ok) expect(e.seconds).toBeGreaterThan(3); // at least 100 mm at 2000 mm/min
    const handler = createGcodeHandler(() => {});
    await handler({ type: 'estimate', id: 1, profile: PROFILE }); // a fresh worker has no tape: answered, not thrown
  });

  it('is kept with the file and settings it was asked for; a late answer for others is dropped', async () => {
    const a = preview('G21 G90\nG1 X10 F600\nM30\n');
    const b = preview('G21 G90\nG1 X20 F600\nM30\n');
    let release: (e: Estimate) => void = () => {};
    const slow = (): Promise<Estimate> => new Promise((r) => { release = r; });
    requestEstimate({ name: 'a', bytes: a.bytes, preview: a, estimate: slow }, PROFILE);
    expect(estimateFor(a, PROFILE)).toBeNull();
    const fast: Estimate = { ok: false, reason: 'test' };
    requestEstimate({ name: 'b', bytes: b.bytes, preview: b, estimate: () => Promise.resolve(fast) }, PROFILE);
    await Promise.resolve();
    release({ ok: true, seconds: 1, motionS: 1, dwellS: 0, shares: { motionS: 1, changingS: 0, cruisingS: 1, changingBy: { axis_cap: 0, junction: 0, exact_stop: 0, short: 0, min_segment: 0 } } });
    await Promise.resolve();
    expect(estimateFor(b, PROFILE)).toEqual(fast);
    expect(estimateFor(a, PROFILE)).toBeNull();
    expect(estimateFor(b, { ...PROFILE, ja: 1 })).toBeNull();
    // Asked again for the same file and settings: the held answer stands.
    requestEstimate({ name: 'b', bytes: b.bytes, preview: b, estimate: slow }, PROFILE);
    expect(planEstimate.value?.estimate).toEqual(fast);
    requestEstimate(null, PROFILE);
    requestEstimate({ name: 'c', bytes: b.bytes }, PROFILE);
    expect(estimateFor(undefined, PROFILE)).toBeNull();
  });
});

describe('the headline and "What to fix" with the estimate', () => {
  const NO_SOURCES = { live: null, saved: null, profile: null };
  const shares = (changing: number, by: Partial<Record<'axis_cap' | 'junction' | 'exact_stop' | 'short' | 'min_segment', number>>) => ({ motionS: 100, changingS: changing, cruisingS: 100 - changing, changingBy: { axis_cap: 0, junction: 0, exact_stop: 0, short: 0, min_segment: 0, ...by } });
  const est = (changing: number, by: Parameters<typeof shares>[1]): Estimate => ({ ok: true, seconds: 3725, motionS: 100, dwellS: 0, shares: shares(changing, by) });

  it('"About" and one short line; how it was found behind the (?); "At least" without it', () => {
    const r = preview('G21 G90\nT1 M6\nM0\nG0 X5\nG1 X100 F600\nM30\n');
    const view = motionView(r.analysis, NO_SOURCES);
    expect(headline(view, est(10, {}))).toBe('About 1 h 02 min');
    expect(headline(view, { ok: false, reason: 'x' })).toMatch(/^At least /);
    const base = { modelled: true, connected: false, reading: true };
    expect(subLine({ ...base, estimate: est(10, {}) })).toEqual({ kind: 'estimate', text: 'From your machine’s settings.' });
    expect(subLine({ ...base, estimate: { ok: false, reason: 'line 4 has no feed rate' } })).toEqual({ kind: 'no-estimate', text: 'No closer time: line 4 has no feed rate.' });
    expect(helpLines(view, est(10, {}), 'Board settings')).toEqual(['Timed with the firmware’s planner (TinyG 450.02).', 'Settings: Board settings.', 'Tool changes and pauses aren’t counted.']);
    expect(helpLines(motionView(preview('G21 G90\nG1 X1 F600\nM30\n').analysis, NO_SOURCES), est(10, {}), null)).toEqual(['Timed with the firmware’s planner (TinyG 450.02).']);
    // A timed rapid shows its time in the chip, and its source behind the (?).
    const timed = { ...view, time: { ...view.time, rapidSeconds: { ...view.time.rapidSeconds, value: 2, label: 'Board settings' } } };
    expect(chips(timed).find((c) => c.fact === 'rapid-time')?.text).toBe('5 mm rapids (2 s)');
    expect(helpLines(timed, null, null)).toContain('Rapids add about 2 s (Board settings).');
    expect(chips(motionView(preview('G21 G90\nG0 X0\nG1 X1 F600\nM30\n').analysis, NO_SOURCES)).map((c) => c.fact)).toEqual(['feed-mm', 'lines']);
  });

  it('a finding when speeding up and slowing down takes much of the time; the firmware’s tags behind Details', () => {
    const r = preview('G21 G90\nG1 X100 F600\nM30\n').analysis;
    expect(speedFix(est(SPEED_SHARE * 100 - 1, { short: 30 }), r, null)).toBeNull();
    expect(speedFix({ ok: false, reason: 'x' }, r, null)).toBeNull();
    expect(speedFix({ ...est(0, {}), shares: { ...shares(0, {}), motionS: 0 } } as Estimate, r, null)).toBeNull();
    const short = speedFix(est(62, { short: 40, min_segment: 10, junction: 30 }), r, null);
    expect(short).toMatchObject({ kind: 'speed', title: 'Mostly speeding up and slowing down (62%)', meaning: ['Moves are too short to reach feed.'], todo: ['Turn on arcs and smoothing in your CAM.'], linked: false });
    expect(short?.details).toEqual(['Short moves: 50% of the time.', 'Corners: 30% of the time.', 'A move can have more than one cause.', 'Smoothing tolerance: about 0.01 mm.']);
    expect(speedFix(est(45, { junction: 40, short: 5 }), r, null)).toMatchObject({ title: 'Often speeding up and slowing down (45%)', meaning: ['Corners slow it down.'] });
    expect(speedFix(est(50, { exact_stop: 40 }), r, null)?.todo).toEqual(['Use G64 where the part allows.']);
    expect(speedFix(est(50, { axis_cap: 40 }), r, null)?.meaning).toEqual(['One axis can’t keep up with the feed.']);
    expect(speedFix(est(50, {}), r, null)).toMatchObject({ meaning: ['Moves rarely reach feed.'], details: [] });
    expect(speedCause(null)).toBeNull();
    expect(fixesFor(r, null, est(62, { short: 50 }))[0]?.kind).toBe('speed');
  });

  it('links the short-move finding to the densest section', () => {
    const lines = ['G21 G90 G17', 'G0 X0 Y0', 'G1 Z-1 F600'];
    for (let i = 0; i < 1000; i++) lines.push(`G1 X${(i % 2) * 0.1} Y${(i * 0.05).toFixed(2)} F3000`);
    lines.push('M30');
    const r = preview(lines.join('\n')).analysis;
    const fix = speedFix(est(70, { short: 60 }), r, null);
    expect(fix?.linked).toBe(true);
    expect(fix?.line).toBe(r.density.regions[0]?.fromLine);
    // With the tiny-moves card, one card: the speed title and fix, the tiny numbers, links and sections; no repeat.
    const fixes = fixesFor(r, null, est(70, { short: 60 }));
    expect(fixes.map((f) => f.kind)).toEqual(['speed']);
    expect(fixes[0]?.meaning[0]).toBe('Moves are too short to reach feed.');
    expect(fixes[0]?.meaning[1]).toMatch(/moves are under 0\.1 mm\.$|short moves in lines/);
    expect(fixes[0]?.todo).toEqual(['Turn on arcs and smoothing in your CAM.']);
    expect(fixes[0]?.details.filter((d) => d.startsWith('Smoothing tolerance'))).toHaveLength(1);
    expect(fixes[0]?.regions).toEqual(r.density.regions);
    // Corners as the cause: two cards, each with its own fix.
    expect(fixesFor(r, null, est(70, { junction: 60 })).map((f) => f.kind)).toEqual(['tiny', 'speed']);
  });
});
