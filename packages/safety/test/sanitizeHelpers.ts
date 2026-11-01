/** Shared fixtures for the sanitiser tests (ROADMAP P0-10). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Dialect } from '@synthetos/protocol';
import { sanitizeJob, type MotionModel, type SanitizeOptions, type SanitizeResult, type StartState } from '../src/index.ts';

const ZERO = { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 } as const;

/** A board whose whole state is known: at machine zero, G54 with zero offsets, G21 G90 G17 G0. */
export const START: StartState = Object.freeze<StartState>({
  units: 'G21',
  distance: 'G90',
  arcDistance: 'G91.1',
  plane: 'G17',
  motion: 'G0',
  wcs: 'G54',
  machine: ZERO,
  wcsOffsets: { G54: ZERO, G55: ZERO, G56: ZERO, G57: ZERO, G58: ZERO, G59: ZERO },
  g92: { offsets: ZERO, active: false },
  toolOffset: ZERO,
  g28: ZERO,
  g30: ZERO,
  defaults: { units: 'G21', distance: 'G90', plane: 'G17', wcs: 'G54' },
});

/** Every rotary axis in standard mode (degrees). */
export const STANDARD_ROTARY: MotionModel['rotary'] = Object.freeze({ A: { mode: 1 }, B: { mode: 1 }, C: { mode: 1 } });

/** Fast enough that ordinary corpus moves are never split (the split tests use their own model). */
export const MOTION: MotionModel = Object.freeze<MotionModel>({
  ceilingSeconds: 5,
  k: 0.5,
  maxVelocity: { X: 20000, Y: 20000, Z: 5000, A: 20000, B: 20000, C: 20000 },
  feedrateMax: { X: 20000, Y: 20000, Z: 5000, A: 20000, B: 20000, C: 20000 },
  rotary: STANDARD_ROTARY,
});

/** A motion model whose rapid (vm) and feed (fr) limits are both `limits`. */
export function sameLimits(base: MotionModel, limits: MotionModel['maxVelocity']): MotionModel {
  return { ...base, maxVelocity: limits, feedrateMax: limits };
}

export function run(input: string | Iterable<string>, dialect: Dialect, options: Partial<SanitizeOptions> = {}): SanitizeResult {
  return sanitizeJob(input, dialect, { motion: MOTION, start: START, ...options });
}

/** Block rule ids in report order. */
export function blocks(result: SanitizeResult): string[] {
  return result.report.entries.filter((e) => e.severity === 'block').map((e) => e.rule);
}

export function bodies(result: SanitizeResult): string[] {
  return result.lines.map((l) => l.body);
}

/** A file from `test-fixtures/cam/`, as exact bytes (latin-1 keeps a raw 0x18). */
export function corpus(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../test-fixtures/cam/${name}`, import.meta.url)), 'latin1');
}

/**
 * fast-check runs per property. Mutation testing (vitest.stryker.config.ts)
 * lowers it to keep the run inside CI's time limit; every normal run uses
 * the full count.
 */
export function runs(full: number): number {
  const reduced = Number(process.env['RUN_PROPERTY_RUNS']);
  return Number.isInteger(reduced) && reduced > 0 ? Math.min(reduced, full) : full;
}
