/**
 * The job analysis report (docs/design/ANALYZE.md slice 1): motion facts from the event tape with no questionnaire,
 * unknown kept unknown, one operation with its feed regimes, density and slow sections, and the motion time at
 * programmed speeds with its evidence.
 */
import { describe, expect, it } from 'vitest';
import { DENSE_LINES_PER_SECOND, DENSE_RULES, TAPE_FLAG, TAPE_KIND, analyzeProgram, densityBuckets, motionTime, type Evidence, type MotionInputs, type ProgramTape } from '../src/index.ts';

interface Ev {
  readonly k: number;
  readonly f?: number;
  readonly line: number;
  readonly sent?: number;
  readonly d?: readonly [number, number, number];
  readonly len?: number;
  readonly feed?: number;
  readonly s?: number;
  readonly tool?: number;
  readonly sec?: number;
}

/** A tape from plain events (each its own sent line unless `sent` says otherwise). */
function tape(events: readonly Ev[]): ProgramTape {
  const n = events.length;
  const t = { count: n, kinds: new Uint8Array(n), flags: new Uint8Array(n), sent: new Uint32Array(n), source: new Uint32Array(n), lengthMm: new Float64Array(n), delta: new Float64Array(n * 3), feed: new Float64Array(n).fill(Number.NaN), spindle: new Float64Array(n).fill(Number.NaN), tool: new Int32Array(n).fill(-1), seconds: new Float64Array(n) };
  events.forEach((e, i) => {
    t.kinds[i] = e.k;
    t.flags[i] = e.f ?? 0;
    t.sent[i] = e.sent ?? i;
    t.source[i] = e.line;
    const d = e.d ?? [0, 0, 0];
    t.delta.set(d, i * 3);
    t.lengthMm[i] = e.len ?? Math.hypot(...d);
    if (e.feed !== undefined) t.feed[i] = e.feed;
    if (e.s !== undefined) t.spindle[i] = e.s;
    if (e.tool !== undefined) t.tool[i] = e.tool;
    t.seconds[i] = e.sec ?? 0;
  });
  return t;
}

const L = TAPE_KIND.LINE;
const rapid = (line: number, d: readonly [number, number, number]): Ev => ({ k: L, f: TAPE_FLAG.RAPID, line, d });
const cut = (line: number, d: readonly [number, number, number], feed?: number, extra: Partial<Ev> = {}): Ev => ({ k: L, line, d, ...(feed === undefined ? {} : { feed }), ...extra });
const board = (vm: number | null): Evidence<number> => ({ value: vm, source: 'board', label: 'Board settings', units: 'mm/min', observedAt: 5 });
const inputs = (x: number | null, y: number | null = x, z: number | null = x): MotionInputs => ({ rapid: { X: board(x), Y: board(y), Z: board(z) } });

describe('the motion report', () => {
  it('gives distances, the feed time at programmed speeds, dwells and stops from the file alone', () => {
    const r = analyzeProgram(tape([
      { k: TAPE_KIND.COMMAND, line: 1 },
      rapid(2, [0, 0, 5]),
      cut(3, [0, 0, -6], 300),
      cut(4, [60, 0, 0], 600),
      { k: TAPE_KIND.ARC, line: 5, d: [0, 0, 0], len: 31.4, feed: 600 },
      { k: TAPE_KIND.DWELL, line: 6, sec: 2 },
      { k: TAPE_KIND.BARRIER, line: 7 },
      { k: TAPE_KIND.TOOL_CHANGE, line: 8, tool: 2 },
    ]));
    expect(r.lines).toBe(8);
    expect(r.feedMm).toMatchObject({ value: 6 + 60 + 31.4, source: 'file', units: 'mm' });
    expect(r.rapidMm.value).toBe(5);
    expect(r.arcs).toBe(1);
    expect(r.feedSeconds.value).toBeCloseTo(1.2 + 6 + 3.14, 9);
    expect(r.dwellSeconds.value).toBe(2);
    expect(r.dwells).toBe(1);
    expect(r.stopLines).toEqual([7]);
    expect(r.toolChangeLines).toEqual([8]);
    expect(r.coverage).toEqual({ events: 8, supported: 8, reasons: [] });
    expect(Array.from(r.rapidDeltas)).toEqual([0, 0, 5]);
    expect(r.moveLengths).toEqual({ moves: 3, under01: 0, median: 31.4, quarter: 6 });
    expect(analyzeProgram(tape([cut(1, [0.05, 0, 0], 100), cut(2, [0, 0, 0], 100), cut(3, [1, 0, 0], 100, { f: TAPE_FLAG.ROTARY })])).moveLengths).toEqual({ moves: 1, under01: 1, median: 0.05, quarter: 0.05 });
    expect(analyzeProgram(tape([])).moveLengths).toEqual({ moves: 0, under01: 0, median: null, quarter: null });
  });

  it('keeps an unknown feed unknown, never zero, and says why', () => {
    const r = analyzeProgram(tape([cut(1, [10, 0, 0]), cut(2, [10, 0, 0], 600), cut(3, [10, 0, 0], 600, { f: TAPE_FLAG.ROTARY }), { k: TAPE_KIND.UNMODELLED, f: TAPE_FLAG.UNCERTAIN, line: 4 }]));
    expect(r.feedSeconds.value).toBeNull();
    expect(r.knownFeedSeconds).toBe(1);
    expect(r.untimedMoves).toBe(2);
    expect(r.coverage.supported).toBe(2);
    expect(r.coverage.reasons).toEqual(['1 feed move has no feed rate.', '1 move turns a rotary axis. These are not timed.', '1 line could not be modelled.', 'Positions from line 4 may not match the file.']);
    const many = analyzeProgram(tape([cut(1, [1, 0, 0]), cut(2, [1, 0, 0]), rapid(3, [0, 0, 1]), { ...rapid(4, [1, 0, 0]), f: TAPE_FLAG.RAPID | TAPE_FLAG.ROTARY }, { k: TAPE_KIND.UNMODELLED, line: 5 }, { k: TAPE_KIND.UNMODELLED, line: 6 }]));
    expect(many.coverage.reasons).toEqual(['2 feed moves have no feed rate.', '1 move turns a rotary axis. These are not timed.', '2 lines could not be modelled.']);
    expect(many.untimedRapids).toBe(1);
    expect(analyzeProgram(tape([])).lines).toBe(0);
  });

  it('times rapids only from known rapid speeds, the slowest axis share setting each move', () => {
    const r = analyzeProgram(tape([rapid(1, [100, 0, 0]), rapid(2, [100, 100, 10]), cut(3, [60, 0, 0], 600), { k: TAPE_KIND.DWELL, line: 4, sec: 1 }, { k: TAPE_KIND.BARRIER, line: 5 }]));
    const known = motionTime(r, inputs(6000, 6000, 600));
    // 100/6000 min, then max(100/6000, 100/6000, 10/600) min.
    expect(known.rapidSeconds).toMatchObject({ source: 'board', label: 'Board settings', observedAt: 5 });
    expect(known.rapidSeconds.value).toBeCloseTo(1 + 1, 9);
    expect(known.totalSeconds).toBeCloseTo(6 + 2 + 1, 9);
    expect(known.manualStops).toBe(1);
    expect(known.missing).toEqual([]);
    const unknownZ = motionTime(r, inputs(6000, 6000, null));
    expect(unknownZ.rapidSeconds.value).toBeNull();
    expect(unknownZ.totalSeconds).toBeNull();
    expect(unknownZ.knownSeconds).toBe(6 + 1);
    expect(unknownZ.missing).toEqual(['Rapid speeds are not known. Connect your machine to improve the time estimate.']);
    const none = motionTime(r, inputs(null));
    expect(none.rapidSeconds).toMatchObject({ value: null, label: 'Board settings' });
    expect(motionTime(r, inputs(0)).rapidSeconds.value).toBeNull();
    const noObserved: MotionInputs = { rapid: { X: { value: 6000, source: 'profile', label: 'Machine profile', units: 'mm/min' }, Y: board(null), Z: board(null) } };
    expect(motionTime(analyzeProgram(tape([rapid(1, [10, 0, 0])])), noObserved).rapidSeconds).toEqual({ value: 0.1, source: 'profile', label: 'Machine profile', units: 's' });
  });

  it('says what is missing when feeds or rotary rapids are not timed', () => {
    const r = analyzeProgram(tape([cut(1, [1, 0, 0]), cut(2, [1, 0, 0]), { ...rapid(3, [1, 0, 0]), f: TAPE_FLAG.RAPID | TAPE_FLAG.ROTARY }]));
    const m = motionTime(r, inputs(6000));
    expect(m.missing).toEqual(['2 feed moves are not timed.', 'Rapids that turn a rotary axis are not timed.']);
    expect(m.rapidSeconds.value).toBeNull();
    expect(motionTime(analyzeProgram(tape([cut(1, [1, 0, 0])])), inputs(6000)).missing).toEqual(['1 feed move is not timed.']);
  });
});

describe('operations', () => {
  it('is one operation with plunge, ramp and cut regimes, whether or not a heading names it', () => {
    const moves = [rapid(2, [0, 0, 5]), cut(3, [0, 0, -6], 200, { tool: 1, s: 18000 }), cut(4, [30, 0, 0], 800, { tool: 1 }), cut(5, [3, 0, -1], 800, { tool: 1 }), cut(6, [10, 0, 0], 800, { tool: 1 }), cut(7, [0, 0, -1], 200, { tool: 1 })];
    const plain = analyzeProgram(tape(moves));
    const named = analyzeProgram(tape(moves), { headings: [{ line: 1, name: 'Pocket' }] });
    expect(plain.operations).toHaveLength(1);
    expect(named.operations).toHaveLength(1);
    expect(plain.operations[0]?.name).toBe('Tool 1');
    expect(named.operations[0]?.name).toBe('Pocket');
    const op = named.operations[0];
    expect(op).toMatchObject({ tool: 1, fromLine: 3, toLine: 7 });
    expect(op?.regimes.map((r) => [r.kind, r.feed, r.moves])).toEqual([['plunge', 200, 2], ['cut', 800, 2], ['ramp', 800, 1]]);
    expect(op?.regimes[0]?.spindle).toBe(18000);
    expect(op?.seconds).toBeCloseTo((7 / 200 + 40 / 800 + Math.hypot(3, 1) / 800) * 60, 9);
    // Plain and named give the same time and distance: a comment never changes the motion.
    expect(plain.feedSeconds.value).toBe(named.feedSeconds.value);
  });

  it('splits at tool changes and headings, joins spans with the same name and tool, and keeps unknown feeds unknown', () => {
    const r = analyzeProgram(tape([
      cut(2, [10, 0, 0], 600),
      { k: TAPE_KIND.TOOL_CHANGE, line: 3 },
      cut(4, [10, 0, 0], 600),
      cut(6, [10, 0, 0], 600, { tool: 2 }),
      cut(8, [10, 0, 0], 600, { tool: 2 }),
      cut(10, [10, 0, 0], undefined, { tool: 2 }),
      cut(11, [10, 0, 0], undefined, { tool: 2 }),
      cut(13, [10, 0, 0], 300, { tool: 2 }),
    ]), { headings: [{ line: 7, name: 'Profile' }, { line: 5, name: 'Pocket' }, { line: 9, name: 'Pocket' }, { line: 12, name: 'Profile' }] });
    expect(r.operations.map((o) => o.name)).toEqual(['Whole file', 'After the tool change', 'Pocket', 'Profile']);
    const pocket = r.operations[2];
    expect(pocket).toMatchObject({ fromLine: 6, toLine: 11, seconds: null });
    expect(pocket?.spans).toEqual([{ fromLine: 6, toLine: 6 }, { fromLine: 10, toLine: 11 }]);
    expect(pocket?.regimes.map((g) => [g.feed, g.moves, g.seconds])).toEqual([[600, 1, 1], [null, 2, null]]);
    expect(r.operations[3]?.regimes[0]?.feed).toBe(600);
  });
});

describe('density and slow sections', () => {
  const short = (line: number, feed = 3000): Ev => cut(line, [0.5, 0, 0], feed); // 100 lines/s at 3000 mm/min

  it('counts feed lines per lines-per-second bucket', () => {
    const b = densityBuckets(tape([short(1), cut(2, [100, 0, 0], 600), cut(3, [1, 0, 0], 1200), cut(4, [1, 0, 0]), rapid(5, [1, 0, 0]), cut(6, [0.01, 0, 0], 600)]));
    expect(b.map((x) => [x.label, x.lines])).toEqual([['0–10 lines/s', 1], ['10–25 lines/s', 1], ['25–50 lines/s', 0], ['50–100 lines/s', 0], ['100–200 lines/s', 1], ['200+ lines/s', 1]]);
  });

  it('finds a dense section of many short lines; slower moves and lifts inside it do not end it; a stop does', () => {
    const run = Array.from({ length: 120 }, (_, i) => short(10 + i, 1500)); // 0.02 s each, 50 lines/s
    const lift = [rapid(200, [0, 0, 5]), rapid(201, [5, 0, 0]), cut(202, [0, 0, -5], 300)];
    const events = [cut(1, [100, 0, 0], 3000), ...run.slice(0, 60), cut(125, [50, 0, 0], 3000), { k: TAPE_KIND.COMMAND, line: 126 }, ...lift, ...run.slice(60), { k: TAPE_KIND.BARRIER, line: 300 }, ...run.slice(0, 60)];
    const r = analyzeProgram(tape(events));
    expect(r.density.threshold).toEqual({ value: DENSE_LINES_PER_SECOND, source: 'assumption', label: 'Assumed until the connection is measured', units: 'lines/s' });
    // The stop at line 300 ends the first section; the moves after it are a second one.
    expect(r.density.regions.map((x) => x.lines)).toEqual([120, 60]);
    const d = r.density.regions[0];
    expect(d).toMatchObject({ kind: 'dense', fromLine: 10, toLine: 129, lines: 120, feed: 1500 });
    expect(d?.linesPerSecond).toBeCloseTo(50, 9);
    expect(d?.meanMoveMm).toBeCloseTo(0.5, 9);
    expect(d?.fromSent).toBe(1);
    expect(analyzeProgram(tape(events), { denseLinesPerSecond: 200 }).density.regions).toEqual([]);
    // Too many other moves in a row end the run; neither half is long enough.
    const links = Array.from({ length: DENSE_RULES.gap + 1 }, (_, i) => cut(130 + i, [50, 0, 0], 3000));
    expect(analyzeProgram(tape([...run.slice(0, 90), ...links, ...run.slice(90)])).density.regions.map((x) => x.lines)).toEqual([90]);
    // A move with no feed ends it too.
    expect(analyzeProgram(tape([...run.slice(0, 60), cut(133, [1, 0, 0]), ...run.slice(60)])).density.regions.map((x) => x.lines)).toEqual([60, 60]);
    // A short burst is not a section.
    expect(analyzeProgram(tape(run.slice(0, 40))).density.regions).toEqual([]);
  });

  it('finds long stretches below half the main cutting feed', () => {
    const r = analyzeProgram(tape([cut(1, [1000, 0, 0], 1000), cut(2, [50, 0, 0], 100), cut(3, [50, 0, 0], 100), rapid(4, [10, 0, 0]), cut(5, [1, 0, 0], 100)]));
    expect(r.slow).toHaveLength(1);
    expect(r.slow[0]).toMatchObject({ kind: 'slow', fromLine: 2, toLine: 3, lines: 2, feed: 100, seconds: 60 });
    expect(analyzeProgram(tape([rapid(1, [1, 0, 0])])).slow).toEqual([]);
    expect(analyzeProgram(tape([{ ...cut(1, [10, 0, 0], 100), f: TAPE_FLAG.ROTARY }])).slow).toEqual([]);
  });
});

describe('performance', () => {
  it('reports on half a million events exactly, the same every time (the app times a million: test/analysis.test.ts)', () => {
    const n = 500_000;
    const t: ProgramTape = { count: n, kinds: new Uint8Array(n), flags: new Uint8Array(n), sent: new Uint32Array(n), source: new Uint32Array(n), lengthMm: new Float64Array(n), delta: new Float64Array(n * 3), feed: new Float64Array(n), spindle: new Float64Array(n), tool: new Int32Array(n), seconds: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
      t.sent[i] = i;
      t.source[i] = i + 1;
      const len = i % 100 < 50 ? 0.2 : 5;
      t.lengthMm[i] = len;
      t.delta[i * 3] = i % 2 === 0 ? len : -len;
      t.feed[i] = 3000;
      t.tool[i] = 1;
    }
    const r = analyzeProgram(t);
    expect(r.feedSeconds.value).toBeCloseTo((n / 2) * (0.2 / 3000) * 60 + (n / 2) * (5 / 3000) * 60, 3);
    expect(r.density.regions).toEqual([]); // bursts of 50 short moves, each 0.2 s: too short to matter
    expect(r.operations).toHaveLength(1);
    expect(analyzeProgram(t).feedSeconds.value).toBe(r.feedSeconds.value);
  });
});
