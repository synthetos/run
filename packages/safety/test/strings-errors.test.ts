/**
 * Every parameter check in strings.ts names the parameter it refused.
 *
 * strings.ts throws `SafetyStringError` rather than render a warning or
 * confirmation with a value that cannot be shown safely (SAFETY §6). When a
 * caller passes a bad value, the error must say which one: a confirmation
 * that fails to render is a blocked action, and "machineName must not be
 * empty" is what lets the bug be found instead of guessed at.
 *
 * Generated: for every parametrised export and every parameter, the value is
 * replaced by one that its check refuses (an empty string, NaN, an empty list
 * entry, a Range with a non-finite end), and the error must start with that
 * parameter's name. Every other parameter stays valid, so the error cannot
 * come from somewhere else. Added in the Phase 0 safety conformance audit
 * (docs/safety/PHASE0_TRACEABILITY.md): mutation testing showed that a check
 * could lose its parameter name, or stop checking, without any test noticing.
 */
import { describe, expect, it } from 'vitest';
import * as S from '../src/strings.ts';

type Params = Record<string, unknown>;

/** Valid example parameters for every parametrised export. */
const VALID: Record<string, Params> = {
  w4: { seconds: 2 },
  w5: { distanceMm: 12.5, seconds: 3 },
  w5Hb: { seconds: 1 },
  w8: { machineName: 'Shop router', boardId: '2U29', firmware: 'edge-next 450.01', port: 'COM3' },
  w9: { axis: 'X' },
  w15: { dialect: 'EN' },
  w23: { machineName: 'Shop router', fromRevision: 3, toRevision: 4, device: 'Laptop', date: '2026-11-01' },
  w24: { kind: 'profile', device: 'Laptop', date: '2026-11-01' },
  w25: { fb: '449.01', reason: 'no capability tokens', advice: 'upgrade' },
  w31: { seconds: 30 },
  w33: { cause: 'tab frozen', seconds: 5 },
  w36: { setting: 'sv', from: 0, to: 1 },
  c3: { axis: 'Y', distanceMm: 0.25, feedMmPerMin: 600, expectedSteps: 200 },
  c4: { axes: 'X, Y and Z', searchMm: 310 },
  c4TemporaryCap: { searchMm: 40, travelMin: 0, travelMax: 300 },
  c5: { settings: 2, machineName: 'Shop router', boardId: '2U29', changes: '1sa 1.8 → 0.9', highRisk: ['1sa'] },
  c6Question: { boardId: '2U29', fromBuild: '440.21', toBuild: '450.01', sha256Short: 'ab12cd34' },
  c7: {
    file: 'part.nc',
    sha256Short: 'ab12cd34',
    state: 'NEW',
    lines: 120,
    units: 'mm',
    wcs: 'G54',
    x: { min: 0, max: 100 },
    y: { min: -5, max: 50 },
    zMin: -3,
    spindleRpm: 12000,
    estimated: '4 min',
    overrunMm: 8,
    overrunSeconds: 2,
    longestLineSeconds: 2,
    splitMoves: 1,
    wakeLock: 'ON',
  },
  c8: { file: 'part.nc' },
  c9: { line: 42, spindle: 'UNCONFIRMED' },
  c9SpindleRestart: { direction: 'M3', rpm: 12000, spinUpSeconds: 4 },
  c10: { axes: ['X', 'Y'] },
  c13: { meaning: 'Limit switch hit' },
  c14: { toolChanges: 2 },
  c15: { boardId: '2U29', dialect: 'TG' },
  c16: { wcs: 'G54', axes: 'X, Y and Z' },
  c17: { pending: 'homing travel', diff: 'tm 300 → 40' },
  c18: { factoryDefaults: '1sa 1.8' },
  c19: { profileName: 'Router', revision: 5, machineName: 'Shop router', boardId: '2U29', diff: 'none', highRisk: ['1po'] },
  c20New: { machineName: 'Shop router' },
  c20Changed: { name: 'part.nc', machineName: 'Shop router', when: 'yesterday', device: 'Laptop', diffSummary: '3 lines changed' },
  c22: { spindle: 'on, S12000', coolant: 'on' },
  c23: { machineName: 'Shop router', boardId: '2U29', revision: 6 },
  c24: { direction: 'CW', rpm: 12000 },
  c25: { axes: 'X and Y', path: 'X and Y to 0' },
  c27: { axes: 'X', system: 'G54' },
  c28: { system: 'G54' },
  c29: { system: 'G55' },
  w38: { line: 12, status: 221, meaning: 'outside the soft limits' },
  w40: { line: 40 },
  w41: { line: 40 },
  w42: { line: 40 },
  w43: { line: 40 },
  w44: { to: 0 },
  w45: { count: 3 },
  w49: { seconds: 30 },
  w50: { fb: '440.21', minimum: '450.01' },
  c37: { name: 'mine.hex', sha256Short: '3f2a…9c01', boardId: '0084-ab' },
  c38: { name: 'mine.hex', sha256Short: '3f2a…9c01', boardId: '0084-ab' },
  c39: { feed: '25', depth: '5', system: 'G54', zero: '12.68', thickness: '12.70', stop: '0.02' },
  c40: { why: 'the travel limits of Z were not read' },
  c30: { file: 'part.nc', lines: 10, workZero: 'G54', spindle: 'not used' },
  c31: { board: 'X 0', plan: 'X 1' },
  c32: { speeds: 'S12000' },
  c33: { line: 4, text: 'G1 X300' },
  c34: { line: 7, tool: 'T2' },
  c35: { direction: 'M3', rpm: 12000 },
};

type Fn = (p: Params) => unknown;
const exported = S as unknown as Record<string, unknown>;

/** Each bad value for a parameter, with the name the error must start with. */
function corruptions(key: string, value: unknown): readonly { readonly bad: unknown; readonly named: string }[] {
  if (typeof value === 'string') return [{ bad: '', named: key }];
  if (typeof value === 'number') return [{ bad: Number.NaN, named: key }];
  if (Array.isArray(value)) return [{ bad: [...value.slice(1), ''], named: `${key}[${value.length - 1}]` }];
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value).map((sub) => ({ bad: { ...value, [sub]: Number.NaN }, named: `${key}.${sub}` }));
  }
  throw new Error(`no corruption for ${key}`);
}

const CASES = Object.entries(VALID).flatMap(([fn, params]) =>
  Object.entries(params).flatMap(([key, value]) => corruptions(key, value).map((c) => ({ fn, key, ...c }))),
);

describe('strings.ts names the parameter it refuses', () => {
  it('covers every export that takes parameters, and every example renders', () => {
    const parametrised = Object.entries(exported)
      .filter(([, v]) => typeof v === 'function' && (v as Fn).length === 1 && v !== S.renderChecklist && v !== S.SafetyStringError)
      .map(([name]) => name)
      .sort();
    expect(Object.keys(VALID).sort()).toEqual(parametrised);
    for (const [fn, params] of Object.entries(VALID)) expect(() => (exported[fn] as Fn)(params), fn).not.toThrow();
  });

  it.each(CASES)('$fn: a bad $named is refused by name', ({ fn, key, bad, named }) => {
    const call = (): unknown => (exported[fn] as Fn)({ ...VALID[fn], [key]: bad });
    expect(call).toThrow(S.SafetyStringError);
    expect(call).toThrow(new RegExp(`^${named.replace(/[[\].]/g, '\\$&')} `));
  });

  it('a spindle speed of null renders "spindle OFF"; a NaN speed is refused by name', () => {
    const c7 = exported['c7'] as Fn;
    expect(JSON.stringify(c7({ ...VALID['c7'], spindleRpm: null }))).toContain('spindle OFF');
    expect(() => c7({ ...VALID['c7'], spindleRpm: Number.NaN })).toThrow(/^spindleRpm /);
  });

  it('a value of the wrong type is refused by name, not rendered', () => {
    expect(() => S.w4({ seconds: '2' as unknown as number })).toThrow(/^seconds must be a finite number, got 2$/);
    expect(() => S.c14({ toolChanges: 1.5 })).toThrow(/^toolChanges must be a whole number of 0 or more, got 1\.5$/);
    expect(() => S.c9({ line: -1, spindle: 'on' })).toThrow(/^line must be a whole number of 0 or more, got -1$/);
  });
});
