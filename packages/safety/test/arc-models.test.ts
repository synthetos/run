/**
 * Codex P0-10 #1 and #2: the sanitiser's arc decisions checked against the
 * corrected firmware models (packages/testkit, bf3b2e5), which transcribe each
 * dialect's `_compute_arc()` in float32 (EN ead63997 plan_arc.c:291-377, TG
 * d041839 plan_arc.c:243-330). The sanitiser's own arc helper is not used as
 * the oracle.
 *
 * For every case the ORIGINAL line runs on one model and the SANITISED lines
 * on a fresh one from the same state. When the sanitiser accepts, both runs
 * must succeed, trace the same path length, end at the same place, and the
 * advertised overrun bound must equal the length the firmware model ran.
 * Path length is measured by sampling the model's position every 10 ms.
 */
import { TINYG_440, TINYG_EN, type Dialect } from '@synthetos/protocol';
import { overrunBound, sanitizeJob, type MotionModel, type StartState } from '../src/index.ts';
import { TinyG440Model, TinyGEdgeNextModel, createSim, type Sim } from '@synthetos/testkit';
import { describe, expect, it } from 'vitest';

type AnySim = Sim<TinyGEdgeNextModel> | Sim<TinyG440Model>;

const ZERO = { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 };
const MOTION: MotionModel = {
  ceilingSeconds: 5,
  k: 0.5,
  maxVelocity: { X: 20000, Y: 20000, Z: 5000, A: 20000, B: 20000, C: 20000 },
  feedrateMax: { X: 20000, Y: 20000, Z: 5000, A: 20000, B: 20000, C: 20000 },
  rotary: { A: { mode: 1 }, B: { mode: 1 }, C: { mode: 1 } },
};

interface Setup {
  /** Machine position before the line. */
  readonly park: readonly [number, number, number];
  /** G92 origin offset (the models do not implement G10 or G54 offsets; G92 shifts work coordinates the same way). */
  readonly g92: readonly [number, number, number];
}

const ORIGIN: Setup = { park: [0, 0, 0], g92: [0, 0, 0] };

function startState(s: Setup): StartState {
  const g92 = { ...ZERO, X: s.g92[0], Y: s.g92[1], Z: s.g92[2] };
  return {
    units: 'G21',
    distance: 'G90',
    arcDistance: 'G91.1',
    plane: 'G17',
    motion: 'G0',
    wcs: 'G54',
    machine: { ...ZERO, X: s.park[0], Y: s.park[1], Z: s.park[2] },
    wcsOffsets: { G54: ZERO, G55: ZERO, G56: ZERO, G57: ZERO, G58: ZERO, G59: ZERO },
    g92: { offsets: g92, active: s.g92.some((v) => v !== 0) },
    toolOffset: ZERO,
    g28: ZERO,
    g30: ZERO,
  };
}

interface Outcome {
  readonly statuses: number[];
  readonly length: number;
  readonly end: number[];
}

function statusesOf(lines: readonly string[]): number[] {
  const out: number[] = [];
  for (const line of lines) {
    try {
      const v = JSON.parse(line) as { r?: unknown; f?: number[] };
      if (v.r !== undefined && Array.isArray(v.f)) out.push(v.f[1] as number);
    } catch {
      // not JSON
    }
  }
  return out;
}

function settle(sim: AnySim): void {
  for (let i = 0; i < 100_000; i++) {
    sim.clock.advance(10);
    if (i > 5 && sim.device.snapshot().motionState === 'stop') return;
  }
  throw new Error('the model never stopped');
}

function model(dialect: Dialect, setup: Setup): AnySim {
  const sim: AnySim = dialect === TINYG_EN ? createSim(new TinyGEdgeNextModel()) : createSim(new TinyG440Model());
  const lines = [`G90 G0 X${setup.park[0]} Y${setup.park[1]} Z${setup.park[2]}`, 'G54 G90 G21 G17'];
  if (setup.g92.some((v) => v !== 0)) lines.push(`G92 X${setup.park[0] - setup.g92[0]} Y${setup.park[1] - setup.g92[1]} Z${setup.park[2] - setup.g92[2]}`);
  for (const line of lines) {
    sim.host.take();
    sim.host.sendLine(line);
    settle(sim);
    expect(statusesOf(sim.host.take()), line).toEqual([0]);
  }
  return sim;
}

/** Runs `lines` one after the other, sampling the path length. */
function execute(sim: AnySim, lines: readonly string[]): Outcome {
  const statuses: number[] = [];
  let length = 0;
  let prev = sim.device.snapshot().position.slice(0, 3);
  for (const line of lines) {
    sim.host.take();
    sim.host.sendLine(line);
    for (let i = 0; i < 100_000; i++) {
      sim.clock.advance(10);
      const p = sim.device.snapshot().position.slice(0, 3);
      length += Math.hypot((p[0] as number) - (prev[0] as number), (p[1] as number) - (prev[1] as number), (p[2] as number) - (prev[2] as number));
      prev = p;
      if (i > 5 && sim.device.snapshot().motionState === 'stop') break;
    }
    statuses.push(...statusesOf(sim.host.take()));
  }
  return { statuses, length, end: prev };
}

interface Case {
  readonly name: string;
  readonly dialect: Dialect;
  readonly setup: Setup;
  readonly line: string;
  /** Expected firmware path length of the original line (mm), when the firmware runs it. */
  readonly firmwareMm?: number;
  /** Expected sanitiser decision. */
  readonly accepted: boolean;
}

const C10 = 2 * Math.PI * 10;
const OFFSET: Setup = { park: [15, 7, 1], g92: [5, 7, 1] };
/** The 440.21 model has no G92 (ModelGapError): a non-zero start with work = machine. */
const PARKED: Setup = { park: [15, 7, 1], g92: [0, 0, 0] };

const CASES: readonly Case[] = [
  { name: 'EN Codex repro G3 X0.000001: full circle', dialect: TINYG_EN, setup: ORIGIN, line: 'G3 X0.000001 Y0 I0 J10 F600', firmwareMm: C10, accepted: true },
  { name: 'EN G2 X0.000001: full circle', dialect: TINYG_EN, setup: ORIGIN, line: 'G2 X0.000001 Y0 I0 J10 F600', firmwareMm: C10, accepted: true },
  { name: 'EN coincident plus P1: two turns', dialect: TINYG_EN, setup: ORIGIN, line: 'G2 X0 Y-0.000001 I-10 J0 P1 F600', firmwareMm: 2 * C10, accepted: true },
  { name: 'TG equal angles plus P1: one turn', dialect: TINYG_440, setup: ORIGIN, line: 'G2 X0 Y-0.000001 I-10 J0 P1 F600', firmwareMm: C10, accepted: true },
  { name: 'EN contrast 0.0002 mm: tiny arc', dialect: TINYG_EN, setup: ORIGIN, line: 'G3 X0.0002 Y0 I0 J10 F600', firmwareMm: 0.0002, accepted: true },
  { name: 'EN offset helix full circle', dialect: TINYG_EN, setup: OFFSET, line: 'G2 I10 Z-2 F600', firmwareMm: Math.hypot(C10, 2), accepted: true },
  { name: 'TG parked helix full circle', dialect: TINYG_440, setup: PARKED, line: 'G2 I10 Z-1 F600', firmwareMm: Math.hypot(C10, 2), accepted: true },
  { name: 'EN offset half circle', dialect: TINYG_EN, setup: OFFSET, line: 'G2 X30 Y0 I10 J0 F600', firmwareMm: Math.PI * 10, accepted: true },
  { name: 'TG parked half circle', dialect: TINYG_440, setup: PARKED, line: 'G3 X35 Y7 I10 J0 F600', firmwareMm: Math.PI * 10, accepted: true },
  { name: 'EN incremental full circle with offsets', dialect: TINYG_EN, setup: OFFSET, line: 'G91 G3 I-10 J0 F600', firmwareMm: C10, accepted: true },
  { name: 'TG incremental helix full circle, P1 is one turn', dialect: TINYG_440, setup: PARKED, line: 'G91 G2 I0 J10 Z3 P1 F600', firmwareMm: Math.hypot(C10, 3), accepted: true },
  { name: 'EN X1000 float32-coincident end point', dialect: TINYG_EN, setup: { park: [1000, 0, 0], g92: [0, 0, 0] }, line: 'G3 X1000.00003 Y0 I0 J10 F600', firmwareMm: C10, accepted: false },
  { name: 'EN just outside fp_EQ (alarm 159)', dialect: TINYG_EN, setup: ORIGIN, line: 'G3 X0.000011 Y0 I0 J10 F600', accepted: false },
  { name: 'TG equal angles (201)', dialect: TINYG_440, setup: ORIGIN, line: 'G2 X0 Y-0.000001 I-10 J0 F600', accepted: false },
  { name: 'TG equal angles helix (linear travel only)', dialect: TINYG_440, setup: ORIGIN, line: 'G3 X0 Y-0.000001 Z1 I-10 J0 F600', firmwareMm: 1, accepted: false },
  { name: 'TG branch cut G2 X0 Y0 I0 J10 (full circle on TG)', dialect: TINYG_440, setup: ORIGIN, line: 'G2 X0 Y0 I0 J10 F600', firmwareMm: C10, accepted: false },
];

describe('sanitised arcs run the path the firmware models run (Codex P0-10 #1, #2)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const original = execute(model(c.dialect, c.setup), [c.line]);
      if (c.firmwareMm !== undefined) {
        expect(original.statuses).toEqual([0]);
        expect(original.length).toBeCloseTo(c.firmwareMm, 1);
      } else {
        expect(original.statuses.every((s) => s === 0)).toBe(false);
      }
      const r = sanitizeJob(`${c.line}\n`, c.dialect, { motion: MOTION, start: startState(c.setup) });
      expect(!r.report.blocked, JSON.stringify(r.report.entries)).toBe(c.accepted);
      if (!c.accepted) return;
      const sent = execute(model(c.dialect, c.setup), r.lines.map((l) => l.body));
      expect(sent.statuses.every((s) => s === 0), JSON.stringify(sent.statuses)).toBe(true);
      expect(sent.length).toBeCloseTo(original.length, 1);
      sent.end.forEach((v, i) => expect(v).toBeCloseTo(original.end[i] as number, 3));
      const bound = overrunBound(r.lines).mmUpperBound;
      expect(bound).toBeGreaterThanOrEqual(original.length - 0.05);
      expect(bound).toBeLessThanOrEqual(original.length + 0.05);
    });
  }
});
