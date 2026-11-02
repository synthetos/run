/** Shared fixtures for the gcode tests (ROADMAP TB-02). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Dialect } from '@synthetos/protocol';
import { sanitizeJob, type MotionModel, type SanitizeOptions, type SanitizeResult, type SentLine, type StartState } from '@synthetos/safety';
import { interpretJob, type InterpretOptions, type JobAnalysis } from '../src/index.ts';

const ZERO = { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 } as const;

/** A board whose whole state is known: at machine zero, G54 with zero offsets, G21 G90 G17 G0. */
export function start(machine: Partial<Record<'X' | 'Y' | 'Z' | 'A' | 'B' | 'C', number>> = {}): StartState {
  return {
    units: 'G21',
    distance: 'G90',
    arcDistance: 'G91.1',
    plane: 'G17',
    motion: 'G0',
    wcs: 'G54',
    machine: { ...ZERO, ...machine },
    wcsOffsets: { G54: ZERO, G55: ZERO, G56: ZERO, G57: ZERO, G58: ZERO, G59: ZERO },
    g92: { offsets: ZERO, active: false },
    toolOffset: ZERO,
    g28: ZERO,
    g30: ZERO,
    defaults: { units: 'G21', distance: 'G90', plane: 'G17', wcs: 'G54' },
  };
}

/** Fast enough that ordinary moves are never split. */
export const MOTION: MotionModel = {
  ceilingSeconds: 20,
  k: 1,
  maxVelocity: { X: 1e6, Y: 1e6, Z: 1e6, A: 1e6, B: 1e6, C: 1e6 },
  feedrateMax: { X: 1e6, Y: 1e6, Z: 1e6, A: 1e6, B: 1e6, C: 1e6 },
  rotary: { A: { mode: 1 }, B: { mode: 1 }, C: { mode: 1 } },
  linear: { X: 1, Y: 1, Z: 1 },
};

/** Sanitises then interprets, the only path the app uses. */
export function analyse(
  text: string,
  dialect: Dialect,
  options: { sanitize?: Partial<SanitizeOptions>; interpret?: InterpretOptions; start?: StartState } = {},
): { sanitized: SanitizeResult; analysis: JobAnalysis } {
  const st = options.start ?? start();
  const sanitized = sanitizeJob(text, dialect, { motion: MOTION, start: st, ...options.sanitize });
  const analysis = interpretJob(sanitized, dialect, {
    start: st,
    ...(options.sanitize?.optionalStop === undefined ? {} : { optionalStop: options.sanitize.optionalStop }),
    ...options.interpret,
  });
  return { sanitized, analysis };
}

/**
 * Lines as the interpreter would receive them had a sanitiser check been
 * missing: used only to prove the interpreter's own dialect checks.
 */
export function unchecked(bodies: readonly string[], dialect: Dialect, barriers: readonly number[] = []): SanitizeResult {
  const lines: SentLine[] = bodies.map((body, i) => ({
    n: i + 1,
    text: `N${String(i + 1)} ${body}`,
    body,
    sourceLine: i + 1,
    origin: 'file',
    barrier: barriers.includes(i + 1),
    holdback: false,
    motion: null,
  }));
  return {
    lines,
    report: { dialect: dialect.id, blocked: false, entries: [], splits: [], longestMoveSeconds: 0, endState: { spindle: 'off', mist: false, flood: false } },
  };
}

export function rules(a: JobAnalysis, severity: string = 'block'): string[] {
  return a.findings.filter((f) => f.severity === severity).map((f) => f.rule);
}

/** A file from the repository's `test-fixtures/`. */
export function fixture(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../test-fixtures/${path}`, import.meta.url)), 'latin1');
}

/** Machine-coordinate vertices as [x, y, z] triples. */
export function points(a: JobAnalysis): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < a.kinds.length; i++) out.push([a.vertices[i * 3] as number, a.vertices[i * 3 + 1] as number, a.vertices[i * 3 + 2] as number]);
  return out;
}
