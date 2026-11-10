/** Shared fixtures for the planner model tests: TG's results and the fixtures through run's own sanitiser and interpreter. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { interpretJob } from '@synthetos/gcode';
import { TINYG_EN } from '@synthetos/protocol';
import { sanitizeJob, type MotionModel, type StartState } from '@synthetos/safety';
import { simulate, type PlanResult, type PlannerProfile } from '../src/index.ts';

export const DIR = fileURLToPath(new URL('./fixtures/planner-timing/', import.meta.url));

export interface ResultBlock {
  readonly n: number;
  readonly kind: string;
  readonly time_s: number;
  readonly head_s?: number;
  readonly body_s?: number;
  readonly tail_s?: number;
  readonly exit_limit?: string;
}
export interface ResultFile {
  readonly name: string;
  readonly host: { readonly duration_s: number; readonly blocks: readonly ResultBlock[] };
}
export interface Results {
  readonly profile: { readonly name: string; readonly axes: Record<string, { vm: number; fr: number; jm: number; jd: number }>; readonly ja: number; readonly ct: number; readonly motors: readonly { axis: string; steps_per_unit: number }[] };
  readonly files: readonly ResultFile[];
}

/** The board settings of a TG profile as the model reads them. */
export function profileOf(r: Results['profile']): PlannerProfile {
  const axis = (a: 'x' | 'y' | 'z') => {
    const s = r.axes[a] as { vm: number; fr: number; jm: number; jd: number };
    const spu = Math.max(...r.motors.filter((m) => m.axis === a).map((m) => m.steps_per_unit));
    return { vm: s.vm, fr: s.fr, jm: s.jm, jd: s.jd, ...(Number.isFinite(spu) ? { stepsPerUnit: spu } : {}) };
  };
  return { axes: { X: axis('x'), Y: axis('y'), Z: axis('z') }, ja: r.ja, ct: r.ct };
}

const ZERO = { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 } as const;
const START: StartState = {
  units: 'G21', distance: 'G90', arcDistance: 'G91.1', plane: 'G17', motion: 'G0', wcs: 'G54', machine: ZERO,
  wcsOffsets: { G54: ZERO, G55: ZERO, G56: ZERO, G57: ZERO, G58: ZERO, G59: ZERO }, g92: { offsets: ZERO, active: false },
  toolOffset: ZERO, g28: ZERO, g30: ZERO, defaults: { units: 'G21', distance: 'G90', plane: 'G17', wcs: 'G54' },
};
/** Fast enough that the sanitiser splits nothing: the firmware saw these files line for line. */
const FAST = { X: 1e9, Y: 1e9, Z: 1e9, A: 1e9, B: 1e9, C: 1e9 };
const MOTION: MotionModel = { ceilingSeconds: 20, k: 1, maxVelocity: FAST, feedrateMax: FAST, rotary: { A: { mode: 1 }, B: { mode: 1 }, C: { mode: 1 } }, linear: { X: 1, Y: 1, Z: 1 } };

/** The model's plan of a fixture through run's own sanitiser and interpreter, or why it cannot be timed. */
export function planFixture(text: string, profile: PlannerProfile): { ok: true; result: PlanResult } | { ok: false; reason: string } {
  const sanitized = sanitizeJob(text, TINYG_EN, { motion: MOTION, start: START });
  const analysis = interpretJob(sanitized, TINYG_EN, { start: START });
  if (analysis.blocked) return { ok: false, reason: `run blocks it: ${analysis.findings.filter((f) => f.severity === 'block').map((f) => f.rule).slice(0, 2).join(', ')}` };
  return simulate(analysis.events, profile);
}

/** One profile's results file. */
export function results(name: string): Results {
  return JSON.parse(readFileSync(`${DIR}results/${name}`, 'utf8')) as Results;
}
