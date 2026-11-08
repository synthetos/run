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
import { jobModesWritableIn, planStartModes, startModesLine, startModesText } from '../src/session/jobModes.ts';
import { onJobMotionAnswer, onJobMotionTimeout, onJobPrepAnswer, type JobLayerTx } from '../src/session/job.ts';
import { DEFAULT_TIMINGS, type SessionState } from '../src/session/types.ts';
import { EN_APPROVED, JOBS_RELEASE, CONFIRM, jobLines, load, runUntil, writes } from './jobHarness.ts';
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
  expect(h.session.startJob([], CONFIRM)).toEqual({ allowed: true });
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
    expect(h.session.startJob([], CONFIRM)).toEqual({ allowed: true });
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
    h.session.startJob([], CONFIRM);
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
    h.session.startJob([], CONFIRM);
    expect(await runUntil(h, () => h.session.state.job?.startModes?.written === true, 5000, 1)).toBe(true);
    return h;
  }

  function tx(s: SessionState): JobLayerTx {
    const t: JobLayerTx = { s, config: CONFIG, set: (patch) => (t.s = { ...t.s, ...patch }), emit: () => {}, arm: () => {}, cancel: () => {} };
    return t;
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
    expect(planStartModes({ ...s, values: { ...s.values, ...held, admo: { value: 0, status: 0, at: 0 } } }, arc)).toEqual(['arcDistance']);
    expect(planStartModes({ ...s, values: { ...s.values, ...held, dist: { value: null, status: 100, at: 0 } } }, [{ ...arc[0], body: 'G1 X1' } as SentLine])).toEqual(['distance']);
    const noArcs = { ...s, dialect: { ...(s.dialect as NonNullable<typeof s.dialect>), gcode: { ...(s.dialect as NonNullable<typeof s.dialect>).gcode, job: null } } };
    expect(planStartModes({ ...noArcs, values: { ...s.values, ...held, admo: { value: 0, status: 0, at: 0 } } }, arc)).toEqual([]);
    expect(jobModesWritableIn(s, 'G90')).toBe(false);
  });
});
