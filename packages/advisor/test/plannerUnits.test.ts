/**
 * The planner model's parts on hand-made cases (docs/design/ANALYZE.md slice 2): the firmware branches the fixtures
 * do not reach, each named by what the firmware does there.
 */
import { describe, expect, it } from 'vitest';
import { TAPE_FLAG, TAPE_KIND, estimateOf, simulate, timeShares, type PlannerProfile, type ProgramTape } from '../src/index.ts';
import { arcSegments } from '../src/planner/arcs.ts';
import { junctionVmax, makeBlock, moveTime, type JerkCache, type MoveInput } from '../src/planner/block.ts';
import { MIN_SEGMENT_TIME } from '../src/planner/constants.ts';
import { PlannerQueue, exitLimit, sectionTime } from '../src/planner/queue.ts';
import { calculateTrapezoid, type Zoid } from '../src/planner/trapezoid.ts';

const axis = { vm: 6000, fr: 3000, jm: 50, jd: 0.01 };
const PROFILE: PlannerProfile = { axes: { X: { ...axis, stepsPerUnit: 80 }, Y: axis, Z: { ...axis, fr: 600, vm: 600, stepsPerUnit: 400 } }, ja: 200000, ct: 0.01 };
const cache = (): JerkCache => ({ jerk: 0, recipJerk: 0, cbrtJerk: 0 });
const move = (delta: readonly [number, number, number], feed = 1200, extra: Partial<MoveInput> = {}): MoveInput => ({ n: 1, kind: 'feed', delta, feed, exactStop: false, ...extra });

interface Ev {
  readonly k: number;
  readonly f?: number;
  readonly d?: readonly [number, number, number];
  readonly feed?: number;
  readonly sec?: number;
  readonly arc?: readonly [number, number, number, number, number];
  /** The sent line, when two events share one (a command and the move on its line). */
  readonly sent?: number;
}

function tape(events: readonly Ev[]): ProgramTape {
  const n = events.length;
  const arcs: number[] = [];
  const t = { count: n, kinds: new Uint8Array(n), flags: new Uint8Array(n), sent: new Uint32Array(n), source: new Uint32Array(n), lengthMm: new Float64Array(n), delta: new Float64Array(n * 3), feed: new Float64Array(n).fill(Number.NaN), spindle: new Float64Array(n), tool: new Int32Array(n), seconds: new Float64Array(n), arcIndex: new Int32Array(n).fill(-1), arcs: new Float64Array(0) };
  events.forEach((e, i) => {
    t.kinds[i] = e.k;
    t.flags[i] = e.f ?? 0;
    t.sent[i] = e.sent ?? i;
    t.source[i] = (e.sent ?? i) + 1;
    t.delta.set(e.d ?? [0, 0, 0], i * 3);
    if (e.feed !== undefined) t.feed[i] = e.feed;
    t.seconds[i] = e.sec ?? 0;
    if (e.arc !== undefined) {
      t.arcIndex[i] = arcs.length / 5;
      arcs.push(...e.arc);
    }
  });
  return { ...t, arcs: Float64Array.from(arcs) };
}

describe('the move time and the block', () => {
  it('takes the slowest of the feed, the axis rates and the motor pulse rate; rapids ignore F', () => {
    expect(moveTime(PROFILE, move([10, 0, 0], 1200))).toEqual({ minutes: 10 / 1200, axisCapped: false });
    expect(moveTime(PROFILE, move([0, 0, 10], 1200))).toEqual({ minutes: 10 / 600, axisCapped: true });
    expect(moveTime(PROFILE, move([10, 0, 0], 0, { kind: 'rapid' })).axisCapped).toBe(false);
    // 400 steps/mm at 50 kHz × 90%: 6750 mm/min, under Z's vm of 600 here, so the motor is not the limit...
    expect(moveTime(PROFILE, move([0, 0, 10], 0, { kind: 'rapid' })).minutes).toBeCloseTo(10 / 600, 12);
    // ...but at 4000 steps/mm it is.
    const fine = { ...PROFILE, axes: { ...PROFILE.axes, Z: { ...PROFILE.axes.Z, vm: 10000, stepsPerUnit: 4000 } } };
    expect(moveTime(fine, move([0, 0, 10], 0, { kind: 'rapid' })).minutes).toBeCloseTo((10 * 4000) / (60 * 50000 * 0.9), 12);
  });

  it('corners: straight on, reversal, and a right angle by the junction acceleration', () => {
    expect(junctionVmax(PROFILE, [1, 0, 0], [1, 0, 0])).toBe(10_000_000);
    expect(junctionVmax(PROFILE, [1, 0, 0], [-1, 0, 0])).toBe(0);
    const right = junctionVmax(PROFILE, [1, 0, 0], [0, 1, 0]);
    const s = Math.SQRT1_2;
    expect(right).toBeCloseTo(Math.sqrt(((0.01 * s) / (1 - s)) * 200000), 2);
  });

  it('drops a move with no length, or too short in time (its travel joins the next), and reuses near-equal jerk terms', () => {
    const c = cache();
    expect(makeBlock(PROFILE, move([0, 0, 0]), c, [0, 0, 0], false, 0)).toBeNull();
    const first = makeBlock(PROFILE, move([10, 0, 0]), c, [0, 0, 0], false, 0);
    expect(first?.jerk).toBe(50e6);
    expect(makeBlock(PROFILE, move([0.00001, 0, 0], 3000), c, [1, 0, 0], true, 0)).toBeNull();
    // A tiny move is kept when, from the run entry, it would still last a segment; from a fast entry it is dropped.
    expect(makeBlock(PROFILE, move([0.02, 0, 0], 3000), c, [1, 0, 0], true, 0)).not.toBeNull();
    expect(makeBlock(PROFILE, move([0.02, 0, 0], 3000), c, [1, 0, 0], true, 3000)).toBeNull();
    const before = { ...c };
    makeBlock(PROFILE, move([10, 0.0000001, 0]), c, [1, 0, 0], true, 0);
    expect(c).toEqual(before);
  });

  it('tags axis caps, corners after a move and exact stops; an exact stop enters and leaves at rest', () => {
    const c = cache();
    const z = makeBlock(PROFILE, move([0, 0, 10], 3000), c, [1, 0, 0], true, 0);
    expect(z?.tags).toBe(0x01 | 0x02);
    const exact = makeBlock(PROFILE, move([10, 0, 0], 1200, { exactStop: true }), c, [1, 0, 0], true, 0);
    expect(exact).toMatchObject({ tags: 0x04, entryVmax: 0, exitVmax: 0, replannable: false });
    expect(makeBlock(PROFILE, move([0, 10, 0]), c, [1, 0, 0], false, 0)?.tags).toBe(0);
  });
});

describe('the trapezoid', () => {
  const zoid = (length: number, entry: number, exit: number, cruiseVmax = 3000): Zoid => {
    const jerk = 50e6;
    const z: Zoid = { length, cruiseVmax, deltaVmax: length ** 0.66666666 * Math.cbrt(jerk), recipJerk: 1 / jerk, cbrtJerk: Math.cbrt(jerk), entryVelocity: entry, cruiseVelocity: cruiseVmax, exitVelocity: exit, headLength: 0, bodyLength: 0, tailLength: 0, naiiveMoveTime: 0 };
    calculateTrapezoid(z);
    return z;
  };

  it('a move shorter than a minimum segment is all body at the speed that fills one', () => {
    const z = zoid(0.05, 1500, 1500); // 2 ms at its average speed
    expect(z.bodyLength).toBe(0.05);
    expect(z.cruiseVelocity).toBeCloseTo(0.05 / (2501 / 60e6), 6);
  });

  it('a single-segment move from rest runs at half its velocity reach', () => {
    const z = zoid(0.1, 0, 3000); // 4 ms at its average speed: one nominal segment
    expect(z.cruiseVelocity).toBeCloseTo(z.deltaVmax / 2, 9);
    expect(z.exitVelocity).toBeCloseTo(z.deltaVmax, 9);
  });

  it('cruises a move already at speed, and keeps the entry as cruise when no head or tail is left', () => {
    expect(zoid(50, 2999, 2999).bodyLength).toBe(50);
    // A body shorter than a segment after a head too small to keep: body and tail become one tail.
    const bt = zoid(23.3, 2990, 0);
    expect([bt.headLength, bt.bodyLength, bt.tailLength]).toEqual([0, 0, 23.3]);
    // ...and the mirror: a head with a body too short for a segment becomes one head.
    const hb = zoid(23.3, 0, 2990);
    expect([hb.headLength, hb.bodyLength, hb.tailLength]).toEqual([23.3, 0, 0]);
    const z = zoid(40, 2000, 2000, 2001.5);
    expect(z.bodyLength).toBe(40);
  });
});

describe('the queue and the exit limit', () => {
  it('names why each exit is what it is', () => {
    const b = { entry: 0, cruise: 1000, exit: 0, bodyS: 1, tailS: 1 };
    const aline = (entryVmax: number) => ({ type: 'aline', entryVmax }) as never;
    expect(exitLimit(b, undefined)).toBe('end');
    expect(exitLimit({ ...b, exit: 500 }, undefined)).toBe('lookahead');
    expect(exitLimit(b, { type: 'command', n: 1, seconds: 0 })).toBe('stop');
    expect(exitLimit({ ...b, exit: 300 }, aline(300))).toBe('junction');
    expect(exitLimit(b, aline(300))).toBe('end');
    expect(exitLimit({ ...b, exit: 1000 }, aline(5000))).toBe('cruise');
    expect(exitLimit({ entry: 100, cruise: 800, exit: 800, bodyS: 0, tailS: 0 }, aline(5000))).toBe('accel');
    expect(exitLimit({ ...b, exit: 400, entry: 400 }, aline(5000))).toBe('lookahead');
    expect(exitLimit({ ...b, exit: 400 }, { type: 'dwell', n: 1, seconds: 1 })).toBe('lookahead');
  });

  it('runs nothing from an empty queue; a section never runs in less than one minimum segment', () => {
    expect(sectionTime(0, 100, 100)).toBe(0);
    expect(sectionTime(0.01, 3000, 3000)).toBe(MIN_SEGMENT_TIME);
    expect(sectionTime(10, 0, 600)).toBeCloseTo(20 / 600, 12);
    const q = new PlannerQueue();
    q.drainOne();
    expect(q.done).toEqual([]);
    const c = cache();
    // A 0.1 mm piece between two long moves at speed: one segment, at least the minimum.
    for (const d of [[50, 0, 0], [0.1, 0, 0], [50, 0, 0]] as const) q.addMove(makeBlock(PROFILE, move(d, 3000), c, [1, 0, 0], true, 0) as never);
    q.drainAll();
    expect(q.done[1]?.seconds).toBeGreaterThanOrEqual(MIN_SEGMENT_TIME * 60);
    expect(q.done[1]?.causes).toContain('min_segment');
  });
});

describe('a whole tape', () => {
  it('stops at queued commands, adds dwells, and segments arcs in each plane', () => {
    const r = simulate(tape([
      { k: TAPE_KIND.LINE, d: [10, 0, 0], feed: 1200 },
      { k: TAPE_KIND.COMMAND, f: TAPE_FLAG.SYNC },
      { k: TAPE_KIND.COMMAND },
      { k: TAPE_KIND.DWELL, sec: 0.5 },
      { k: TAPE_KIND.LINE, f: TAPE_FLAG.RAPID, d: [0, 10, 0] },
      { k: TAPE_KIND.ARC, d: [0, 0, 0], feed: 600, arc: [0, 5, 0, Math.PI, 0] },
      { k: TAPE_KIND.ARC, d: [0, 0, 0], feed: 600, arc: [1, 5, 0, -Math.PI / 2, 2] },
      { k: TAPE_KIND.ARC, d: [0, 0, 0], feed: 600, arc: [2, 5, 0, Math.PI / 2, -1] },
      { k: TAPE_KIND.TOOL_CHANGE },
      { k: TAPE_KIND.BARRIER },
      { k: TAPE_KIND.LINE, d: [1, 0, 0], feed: 600, f: TAPE_FLAG.EXACT_STOP },
      { k: TAPE_KIND.COMMAND, f: TAPE_FLAG.SYNC, sent: 20 },
      { k: TAPE_KIND.LINE, d: [50, 0, 0], feed: 3000, sent: 20 },
      { k: TAPE_KIND.LINE, d: [0.00002, 0, 0], feed: 3000, sent: 21 },
      { k: TAPE_KIND.LINE, d: [50, 0, 0], feed: 3000, sent: 22 },
    ]), PROFILE);
    if (!r.ok) throw new Error(r.reason);
    expect(r.result.dwellS).toBe(0.5);
    expect(r.result.blocks[0]?.exitLimit).toBe('stop');
    expect(r.result.blocks.filter((b) => b.kind === 'arc-seg').length).toBeGreaterThan(3);
    expect(r.result.seconds).toBeCloseTo(r.result.motionS + 0.5, 9);
    // The 0.00002 mm move is dropped, as the firmware drops it: its travel joins the next block.
    expect(r.result.blocks.find((b) => b.n === 23)?.lengthMm).toBeCloseTo(50.00002, 4);
    expect(r.result.blocks.some((b) => b.n === 22)).toBe(false);
  });

  it('says why it cannot time a tape instead of guessing', () => {
    expect(simulate(tape([{ k: TAPE_KIND.UNMODELLED }]), PROFILE)).toEqual({ ok: false, reason: 'line 1 could not be modelled' });
    expect(simulate(tape([{ k: TAPE_KIND.LINE, f: TAPE_FLAG.ROTARY, d: [1, 0, 0], feed: 100 }]), PROFILE)).toEqual({ ok: false, reason: 'line 1 turns a rotary axis' });
    expect(simulate(tape([{ k: TAPE_KIND.LINE, d: [1, 0, 0] }]), PROFILE)).toEqual({ ok: false, reason: 'line 1 has no feed rate' });
  });

  it('chords: as few as the chordal tolerance and the 10 ms minimum allow, helix travel shared out', () => {
    const half = arcSegments(PROFILE, { plane: 0, radius: 10, theta: 0, travel: Math.PI, linear: 0 }, 600);
    expect(half.length).toBe(Math.floor((Math.PI * 10) / Math.sqrt(4 * 0.01 * (20 - 0.01))));
    const helix = arcSegments(PROFILE, { plane: 0, radius: 10, theta: 0, travel: Math.PI, linear: -6 }, 6000);
    expect(helix.every((d) => Math.abs(d[2] - -6 / helix.length) < 1e-12)).toBe(true);
    // Z's 600 mm/min caps a steep helix's time, so more chords fit the 10 ms minimum.
    expect(arcSegments(PROFILE, { plane: 0, radius: 1, theta: 0, travel: Math.PI / 8, linear: -10 }, 6000).length).toBeGreaterThan(1);
  });
});

describe('where the time goes', () => {
  it('splits speeding up and slowing down from cruising, by the firmware tags, and passes a refusal on', () => {
    const sim = simulate(tape([{ k: TAPE_KIND.LINE, d: [50, 0, 0], feed: 3000 }, { k: TAPE_KIND.LINE, d: [0, 0.5, 0], feed: 3000 }]), PROFILE);
    const e = estimateOf(sim);
    if (!e.ok || !sim.ok) throw new Error('not timed');
    const s = e.shares;
    expect(s.changingS + s.cruisingS).toBeCloseTo(s.motionS, 9);
    expect(s.changingBy.junction).toBeGreaterThan(0);
    expect(s.changingBy.short).toBeGreaterThan(0);
    expect(timeShares(sim.result)).toEqual(s);
    expect(estimateOf({ ok: false, reason: 'line 3 turns a rotary axis' })).toEqual({ ok: false, reason: 'line 3 turns a rotary axis' });
    expect(estimateOf({ ok: true, result: { ...sim.result, seconds: Number.POSITIVE_INFINITY } })).toEqual({ ok: false, reason: 'the machine settings give no finite time' });
  });
});
