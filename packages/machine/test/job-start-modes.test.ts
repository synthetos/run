/**
 * T-S133. Job start matches the preview (OD-19, owner 2026-11-08; SAFETY §4.4a Start): when a file moves before it sets a mode
 * the preview assumes (`G90`, `G21`, `G17`, `G91.1`) and the board holds another, run writes that mode before the
 * first line, reads it back, and checks the file from there; a file that sets its own modes first gets nothing.
 * The session against the edge-next model, which another program has left in other modes before connect.
 */
import type { Response } from '@synthetos/protocol';
import type { SentLine } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { fileStartNeeds } from '../src/session/fileModes.ts';
import { forecastStartModes, jobModesWritableIn, planStartModes, startModesLine, startModesStep, startModesText, startNeeds } from '../src/session/jobModes.ts';
import { liveStart, onJobMotionAnswer, onJobMotionTimeout, onJobPrepAnswer, onJobStop, type JobLayerTx } from '../src/session/job.ts';
import { checkAlarm, type MotionTx } from '../src/session/motion.ts';
import { DEFAULT_TIMINGS, type SessionState } from '../src/session/types.ts';
import { EN_APPROVED, JOBS_RELEASE, confirmFor, jobLines, load, runUntil, writes } from './jobHarness.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT } from './simTransport.ts';

const CONFIG = { release: JOBS_RELEASE, manifest: EN_APPROVED, timings: DEFAULT_TIMINGS };

/** A board another program left in `lines`' modes (fed straight to the model before connect). */
async function leftIn(lines: readonly string[]): Promise<Harness> {
  const h = harness('en', { device: { start: 'ready', rxm: 0 }, session: { manifest: EN_APPROVED, release: JOBS_RELEASE } });
  for (const line of lines) for (const b of new TextEncoder().encode(`${line}\n`)) h.device.receive(b, false);
  await h.run(500);
  void h.session.connect(PORT);
  await h.run(3000);
  expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  return h;
}

function tx(s: SessionState): JobLayerTx {
  const t: JobLayerTx = { s, config: CONFIG, set: (patch) => (t.s = { ...t.s, ...patch }), emit: () => {}, arm: () => {}, cancel: () => {} };
  return t;
}

/** Motion lines and job lines written from `from` (no GETs, no rt lines). */
function lines(h: Harness, from: number): string[] {
  return writes(h)
    .slice(from)
    .filter((w) => !w.startsWith('{') && w !== '\\x05');
}

async function startAndRun(h: Harness, text: string): Promise<number> {
  await load(h, text);
  expect(h.session.snapshot.job?.report?.blocks).toEqual([]);
  const from = writes(h).length;
  expect(h.session.startJob([], confirmFor(h))).toEqual({ allowed: true });
  await runUntil(h, () => h.session.snapshot.job?.phase === 'done' || h.session.snapshot.job?.phase === 'failed', 30_000);
  return from;
}

describe('job start: the modes the preview assumes', () => {
  it('a board left in G91, a file with no G90: G90 goes before the first line, is read back, and the file runs absolute', async () => {
    const h = await leftIn(['G21 G91']);
    expect(h.session.snapshot.boardModes).toMatchObject({ dist: 1, units: 1, text: 'Relative, mm' });
    await load(h, 'G1 X5 F600\nG1 X2\nM30');
    // The check already says what Start will write.
    expect(h.session.snapshot.job?.startModes).toBe('Run sets absolute mode before the first line, as the preview shows.');
    const from = writes(h).length;
    expect(h.session.startJob([], confirmFor(h))).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 30_000);
    const w = lines(h, from);
    expect(w[0]).toBe('G90');
    expect(w.slice(1, 3)).toEqual(['N1 G1 X5 F600', 'N2 G1 X2']);
    // Absolute: X ends at 2, not 7.
    expect(h.device.snapshot().position[0]).toBeCloseTo(2, 3);
    // The read-back came between G90 and the first line.
    const all = writes(h).slice(from);
    const g90 = all.indexOf('G90');
    expect(all.slice(g90 + 1, all.indexOf('N1 G1 X5 F600'))).toContain('{"dist":null}');
    expect(h.session.snapshot.job?.events.some((e) => e.text.startsWith('Run sets absolute mode before the first line, as the preview shows. Writing G90'))).toBe(true);
  });

  it('a job that ends in G91 with no M30 leaves the board relative; the card says so, and the next file gets G90 first', async () => {
    const h = await leftIn([]);
    await startAndRun(h, 'G21 G91\nG1 X1 F600\nG1 X1');
    expect(h.session.snapshot.job?.phase).toBe('done');
    // Unknown while the job's lines ran; read again after it (jobOffsets.ts).
    await runUntil(h, () => h.session.state.job?.offsetsReread === true && h.session.state.queue.length === 0 && h.session.state.writing === null, 5000);
    expect(h.session.snapshot.boardModes.text).toBe('Relative, mm');
    const from = await startAndRun(h, 'G1 X5 F600\nM30');
    expect(lines(h, from).slice(0, 2)).toEqual(['G90', 'N1 G1 X5 F600']);
    expect(h.device.snapshot().position[0]).toBeCloseTo(5, 3);
  });

  it('a file that sets G90 and G21 before it moves gets nothing extra, whatever the board holds', async () => {
    const h = await leftIn(['G20 G91']);
    await load(h, 'G90 G21\nG1 X5 F600\nM30');
    expect(h.session.snapshot.job?.startModes).toBeNull();
    const from = await startAndRun(h, 'G90 G21\nG1 X5 F600\nM30');
    expect(lines(h, from)[0]).toBe('N1 G90 G21');
    expect(h.device.snapshot().position[0]).toBeCloseTo(5, 3);
  });

  it('a board left in inches, a file with no units: G21 goes first, so X5 is 5 mm', async () => {
    const h = await leftIn(['G20']);
    const from = await startAndRun(h, 'G90\nG1 X5 F600\nM30');
    expect(lines(h, from)[0]).toBe('G21');
    expect(h.device.snapshot().position[0]).toBeCloseTo(5, 3);
  });

  it('an inches file sets its own units: nothing is written, and it runs in inches', async () => {
    const h = await leftIn(['G21 G91']);
    const from = await startAndRun(h, 'G20 G90\nG1 X1 F10\nM30');
    expect(lines(h, from)[0]).toBe('N1 G20 G90');
    expect(h.device.snapshot().position[0]).toBeCloseTo(25.4, 2);
  });

  it('a board in G91, inches and G18 with a file of arcs that sets none: G90 G21 G17 in one line', async () => {
    const h = await leftIn(['G20 G91 G18']);
    await load(h, 'G0 X0 Y0\nG2 X10 Y0 I5 J0 F600\nM30');
    expect(h.session.snapshot.job?.startModes).toBe('Run sets absolute mode, millimetres and the XY plane before the first line, as the preview shows.');
    const from = writes(h).length;
    h.session.startJob([], confirmFor(h));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 30_000);
    expect(lines(h, from)[0]).toBe('G90 G21 G17');
    expect(h.device.snapshot().position[0]).toBeCloseTo(10, 2);
  });

  it('a board already in the preview\'s modes: nothing is written even for a file that sets none', async () => {
    const h = await leftIn([]);
    const from = await startAndRun(h, 'G1 X3 F600\nM30');
    expect(lines(h, from)[0]).toBe('N1 G1 X3 F600');
    expect(jobLines(h, from)).toHaveLength(2);
  });
});

describe('the start-modes step when the board does not take them', () => {
  /** A Start on a board in G91, stopped with the start-modes line being written. */
  async function writingG90(): Promise<Harness> {
    const h = await leftIn(['G21 G91']);
    await load(h, 'G1 X5 F600\nM30');
    h.session.startJob([], confirmFor(h));
    expect(await runUntil(h, () => h.session.state.job?.startModes?.written === true, 5000, 1)).toBe(true);
    return h;
  }


  it('a refused line or no answer ends the start with nothing of the job sent', async () => {
    const h = await writingG90();
    const refused = tx(h.session.state);
    expect(onJobMotionAnswer(refused, 'G90', 30, 1)).toBe(true);
    expect(refused.s.job?.phase).toBe('failed');
    expect(refused.s.job?.message).toBe('The job did not start: the controller refused G90 (status 30).');
    expect(refused.s.queue.some((q) => q.purpose === 'jobPrep' || q.purpose === 'motion')).toBe(false);
    expect(refused.s.base).toBe('IDLE_UNHOMED');
    const silent = tx(h.session.state);
    onJobMotionTimeout(silent, 'G90', 1);
    expect(silent.s.job?.message).toBe('The job did not start: the controller did not answer G90 in time.');
    // Answered with status 0: the read-back decides.
    const ok = tx(h.session.state);
    expect(onJobMotionAnswer(ok, 'G90', 0, 1)).toBe(true);
    expect(ok.s.job?.phase).toBe('checking');
  });

  it('a read-back that still says G91 ends the start', async () => {
    const h = await writingG90();
    const t = tx({ ...h.session.state, queue: [], writing: null });
    onJobPrepAnswer(t, { token: 'dist', purpose: 'jobPrep' }, { r: { dist: 1 }, footer: { rev: 2, status: 0, rx: 8 } } as unknown as Response, 2);
    expect(t.s.job?.phase).toBe('failed');
    expect(t.s.job?.message).toBe('The board did not confirm G90 after run wrote G90: nothing of the job was sent.');
  });
});

describe('N5: the board modes while a job runs', () => {
  it('unknown again when a job resumes after a tool change (the jog set them meanwhile)', async () => {
    const h = await leftIn([]);
    await load(h, 'G21 G90\nG1 X2 F600\nT1 M6\nG1 X0\nM30');
    h.session.startJob([], confirmFor(h));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'toolChange', 20_000);
    h.session.request({ intent: 'jog', axes: { z: 1 }, distanceMm: 1, feed: 600 });
    await runUntil(h, () => h.session.state.motion === null && h.session.snapshot.base === 'PROGRAM_PAUSED', 10_000);
    expect(h.session.snapshot.boardModes.dist).toBe(0); // the jog's own closing G90 (the job's G90 here)
    expect(h.session.request({ intent: 'resume' })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'running', 10_000, 1);
    expect(h.session.snapshot.boardModes).toMatchObject({ units: undefined, dist: undefined, text: 'Not read yet' });
  });
});

describe('M1: every value the check uses is read again after the start modes', () => {
  it('a board in G20 with G54 and G55 offsets: after G21 the check uses them in mm, with no false tool offset', async () => {
    const h = await leftIn(['G20', 'G10 L2 P1 X2', 'G10 L2 P2 Y1']);
    await load(h, 'G90\nG1 X5 F600\nG55\nG1 X1 Y1\nM30');
    h.session.startJob([], confirmFor(h));
    await runUntil(h, () => ['running', 'done', 'failed', 'blocked'].includes(h.session.state.job?.phase ?? ''), 10_000, 1);
    const start = liveStart(h.session.state);
    expect(start.units).toBe('G21');
    expect(start.wcsOffsets?.G54?.X).toBeCloseTo(50.8, 3);
    expect(start.wcsOffsets?.G55?.Y).toBeCloseTo(25.4, 3);
    for (const a of ['X', 'Y', 'Z'] as const) expect(start.toolOffset?.[a] ?? 0).toBeCloseTo(0, 3);
    // And the axis settings the motion model uses came back in mm too (the x group, read again).
    expect(h.session.state.values['x']?.at).toBeGreaterThan(h.session.state.job?.startedAt as number);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 30_000);
    // G55 X1 Y1 in mm from the G55 zero (X0, Y 1 in): machine X 1, Y 25.4 + 1.
    expect(h.device.snapshot().position[0]).toBeCloseTo(1, 2);
    expect(h.device.snapshot().position[1]).toBeCloseTo(26.4, 2);
  });
});

describe('a Stop or an alarm while the start modes are written', () => {
  /** A Start on a board in G91 at the moment the start-modes line and the prep reads are queued. */
  async function queuedG90(): Promise<JobLayerTx & MotionTx> {
    const h = await leftIn(['G21 G91']);
    await load(h, 'G1 X5 F600\nM30');
    const s = h.session.state;
    const t = tx({ ...s, base: 'PREAMBLE', job: { ...(s.job as NonNullable<SessionState['job']>), phase: 'checking', startedAt: 1 } }) as JobLayerTx & MotionTx;
    const reads = ['dist', 'unit'].map((token) => ({ token, purpose: 'jobPrep' as const }));
    expect(startModesStep(t, 1, reads)).toEqual({ kind: 'wait' });
    expect(t.s.queue.map((q) => q.line ?? q.token)).toEqual(['G90', 'dist', 'unit']);
    return t;
  }

  it('Stop job with the line queued drops it and the reads; with it in flight, its answer starts nothing', async () => {
    const queued = await queuedG90();
    expect(onJobStop(queued, 2)).toBe(true);
    expect(queued.s.queue).toEqual([]);
    expect(queued.s.job?.phase).toBe('stopped');
    expect(queued.s.base).toBe('IDLE_UNHOMED');
    const inFlight = await queuedG90();
    inFlight.s = { ...inFlight.s, writing: { ...(inFlight.s.queue[0] as SessionState['queue'][number]), seq: 1 }, queue: inFlight.s.queue.slice(1) };
    onJobStop(inFlight, 2);
    expect(onJobMotionAnswer(inFlight, 'G90', 0, 3)).toBe(false); // no longer the job's: nothing follows from it
    expect(inFlight.s.job?.phase).toBe('stopped');
    expect(inFlight.s.queue).toEqual([]);
  });

  it('an alarm with the line queued drops it and fails the start (nothing of the job sent)', async () => {
    const t = await queuedG90();
    t.s = { ...t.s, live: { ...t.s.live, stat: 2 } };
    expect(checkAlarm(t, 2)).toBe(false);
    expect(t.s.base).toBe('ALARM');
    expect(t.s.queue.some((q) => q.line === 'G90')).toBe(false);
    expect(t.s.job?.phase).toBe('failed');
    // The prep reads still answered afterwards start nothing.
    onJobPrepAnswer(t, { token: 'dist', purpose: 'jobPrep' }, { r: { dist: 0 }, footer: { rev: 2, status: 0, rx: 8 } } as unknown as Response, 3);
    expect(t.s.job?.phase).toBe('failed');
  });

  it('N6: a mode that this board cannot read back is never written; the start ends', async () => {
    const h = await leftIn(['G21 G91']);
    await load(h, 'G1 X5 F600\nM30');
    const t = tx({ ...h.session.state, base: 'PREAMBLE', job: { ...(h.session.state.job as NonNullable<SessionState['job']>), phase: 'checking' } });
    const step = startModesStep(t, 1, []);
    expect(step).toEqual({ kind: 'refused', text: 'The job did not start: this board cannot read back G90, which the file relies on.' });
    expect(t.s.queue.some((q) => q.line === 'G90')).toBe(false);
  });
});

describe('fileModes on its own', () => {
  const L = (body: string, motion = false): Pick<SentLine, 'body' | 'origin' | 'motion'> => ({ body, origin: 'file', motion: motion ? { plannerLength: 1, boundMm: 1, seconds: 1 } : null });

  it('a mode set on the move\'s own line counts as set; F on the line that sets the units relies on the start units', () => {
    expect(fileStartNeeds([L('G90 G21 G1 X1', true)])).toEqual([]);
    expect(fileStartNeeds([L('G21 F100'), L('G90 G1 X1', true)])).toEqual(['units']);
    expect(fileStartNeeds([L('G92 X5'), L('G21 G90'), L('G1 X1', true)])).toEqual(['units']);
    expect(fileStartNeeds([L('G21 G90'), L('G3 X1 Y0 R2', true)])).toEqual(['plane', 'arcDistance']);
    expect(fileStartNeeds([L('G21 G90 G17 G91.1'), L('G2 X1 Y0 I1 J0', true)])).toEqual([]);
    // A G28 with the motion mode G2 is no arc; split segments are the file's moves, inserted lines carry no mode of its.
    expect(fileStartNeeds([L('G21 G90'), L('G2', false), L('G28 X0', true)])).toEqual([]);
    expect(fileStartNeeds([{ body: 'M5', origin: 'c14', motion: null }, { body: 'G1 X1', origin: 'split', motion: { plannerLength: 1, boundMm: 1, seconds: 1 } }])).toEqual(['distance', 'units']);
    expect(fileStartNeeds([{ body: 'G90 G21', origin: 'c22', motion: null }, L('G1 X1', true)])).toEqual(['distance', 'units']);
    expect(fileStartNeeds([L('M3 S1000')])).toEqual([]);
  });

  it('the line and the text for each set of modes', () => {
    expect(startModesLine(['distance', 'units', 'plane', 'arcDistance'])).toBe('G90 G21 G17 G91.1');
    expect(startModesText([])).toBeNull();
    expect(startModesText(['units'])).toBe('Run sets millimetres before the first line, as the preview shows.');
    expect(startModesText(['plane', 'arcDistance'])).toBe('Run sets the XY plane and arc centres relative to the start before the first line, as the preview shows.');
  });
});

describe('planStartModes and the write gate check', () => {
  it('the arc distance mode only on a dialect that has it; a mode not read counts as not held', async () => {
    const h = await leftIn([]);
    const s = h.session.state;
    const arc = [{ body: 'G2 X1 Y0 I1 J0', origin: 'file', motion: { plannerLength: 1, boundMm: 1, seconds: 1 } }] as unknown as SentLine[];
    const held = { unit: { value: 1, status: 0, at: 0 }, dist: { value: 0, status: 0, at: 0 }, plan: { value: 0, status: 0, at: 0 } };
    const plan = (state: SessionState, lines: readonly SentLine[]) => planStartModes(state, startNeeds(state, lines));
    expect(plan({ ...s, values: { ...s.values, ...held, admo: { value: 0, status: 0, at: 0 } } }, arc)).toEqual(['arcDistance']);
    expect(plan({ ...s, values: { ...s.values, ...held, dist: { value: null, status: 100, at: 0 } } }, [{ ...arc[0], body: 'G1 X1' } as SentLine])).toEqual(['distance']);
    const noArcs = { ...s, dialect: { ...(s.dialect as NonNullable<typeof s.dialect>), gcode: { ...(s.dialect as NonNullable<typeof s.dialect>).gcode, job: null } } };
    expect(plan({ ...noArcs, values: { ...s.values, ...held, admo: { value: 0, status: 0, at: 0 } } }, arc)).toEqual([]);
    // The card's forecast follows the board's modes as run knows them now (N4).
    expect(forecastStartModes({ ...s, boardModes: { units: 1, dist: 0 } }, ['distance', 'units', 'plane'])).toEqual(s.values['plan']?.value === 0 ? [] : ['plane']);
    expect(forecastStartModes({ ...s, boardModes: { units: 0, dist: undefined } }, ['distance', 'units'])).toEqual(['distance', 'units']);
    expect(jobModesWritableIn(s, 'G90')).toBe(false);
  });
});
