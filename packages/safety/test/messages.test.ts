/**
 * Every user-visible text the safety package produces, pinned (ROADMAP P0-10;
 * SAFETY §5–§6 for the W and C strings). A change to any of them shows up as
 * a snapshot diff in review, where the wording can be checked against the
 * design, instead of reaching users unnoticed.
 *
 * - every W and C string function, rendered with fixed parameters;
 * - one sanitiser report entry per rule, from inputs that trigger it;
 * - one allow-matrix denial per row and per overlay.
 */
import { TINYG_440, TINYG_449_STOCK, TINYG_EN, type Dialect } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import * as S from '../src/strings.ts';
import { BASE_STATES, INTENTS, OVERLAYS, allowed, type Release } from '../src/index.ts';
import { MOTION, START, run } from './sanitizeHelpers.ts';

describe('W and C strings', () => {
  const range = { min: -1.5, max: 20 };
  const rendered: Record<string, unknown> = {
    w1: S.w1(),
    w2Label: S.w2Label(),
    w2Tooltip: S.w2Tooltip(),
    w3: S.w3(),
    w4: S.w4({ seconds: 2 }),
    w5: S.w5({ distanceMm: 38, seconds: 4 }),
    w5Hb: S.w5Hb({ seconds: 3 }),
    w6: S.w6(),
    w7: S.w7(),
    w8: S.w8({ machineName: 'Shapeoko', boardId: '0084-1234', firmware: '450.01', port: 'COM3' }),
    w9: S.w9({ axis: 'Y' }),
    w10: S.w10(),
    w11: S.w11(),
    w12: S.w12(),
    w13: S.w13(),
    w14Watermark: S.w14Watermark(),
    w14Footer: S.w14Footer(),
    w15tg: S.w15({ dialect: 'TG' }),
    w15en: S.w15({ dialect: 'EN' }),
    w16: S.w16(),
    w17: S.w17(),
    w18: S.w18(),
    w19: S.w19(),
    w20: S.w20(),
    w21: S.w21(),
    w22: S.w22(),
    w23: S.w23({ machineName: 'Shapeoko', fromRevision: 3, toRevision: 4, device: 'laptop', date: '2026-11-01' }),
    w24profile: S.w24({ kind: 'profile', device: 'laptop', date: '2026-11-01' }),
    w24file: S.w24({ kind: 'file', device: 'laptop', date: '2026-11-01' }),
    w25upgrade: S.w25({ fb: '449.01', reason: 'stock build', advice: 'upgrade' }),
    w25sender: S.w25({ fb: '449.01', reason: 'stock build', advice: 'usual-sender' }),
    w26: S.w26(),
    w27: S.w27(),
    w28: S.w28(),
    w29: S.w29(),
    w30: S.w30(),
    w31: S.w31({ seconds: 20 }),
    w32: S.w32(),
    w33: S.w33({ cause: 'tab frozen', seconds: 20 }),
    w34: S.w34(),
    w35: S.w35(),
    w36: S.w36({ setting: 'sv', from: 0, to: 1 }),
    c1Full: S.renderChecklist(S.c1Full()),
    c1Short: S.renderChecklist(S.c1Short()),
    c3: S.c3({ axis: 'X', distanceMm: 0.25, feedMmPerMin: 300, expectedSteps: 200 }),
    c3zero: S.c3({ axis: 'X', distanceMm: 0, feedMmPerMin: 300, expectedSteps: 0 }),
    c3negative: S.c3({ axis: 'X', distanceMm: -0.25, feedMmPerMin: 300, expectedSteps: 200 }),
    c4: S.c4({ axes: 'X, Y and Z', searchMm: 310 }),
    c4TemporaryCap: S.c4TemporaryCap({ searchMm: 40, travelMin: 0, travelMax: 300 }),
    c5: S.c5({ settings: 3, machineName: 'Shapeoko', boardId: '0084-1234', changes: 'xvm 8000 → 10000', highRisk: ['xvm', 'yvm'] }),
    c5none: S.c5({ settings: 1, machineName: 'Shapeoko', boardId: '0084-1234', changes: 'xjm', highRisk: [] }),
    c6Boxes: S.renderChecklist(S.c6Boxes()),
    c6Question: S.c6Question({ boardId: '0084-1234', fromBuild: '440.21', toBuild: '450.01', sha256Short: 'ab12cd34' }),
    c7: S.renderChecklist(
      S.c7({
        file: 'pocket.nc',
        sha256Short: 'ab12cd34',
        state: 'SAME',
        lines: 1200,
        units: 'mm',
        wcs: 'G54',
        x: range,
        y: range,
        zMin: -3,
        spindleRpm: 12000,
        estimated: '12 min',
        overrunMm: 38,
        overrunSeconds: 4,
        longestLineSeconds: 4.9,
        splitMoves: 2,
        wakeLock: 'ON',
      }),
    ),
    c7off: S.renderChecklist(
      S.c7({
        file: 'pocket.nc',
        sha256Short: 'ab12cd34',
        state: 'NEW',
        lines: 1,
        units: 'inch',
        wcs: 'G55',
        x: range,
        y: range,
        zMin: 0,
        spindleRpm: null,
        estimated: '1 s',
        overrunMm: 1,
        overrunSeconds: 1,
        longestLineSeconds: 1,
        splitMoves: 0,
        wakeLock: 'OFF',
      }),
    ),
    c8: S.c8({ file: 'pocket.nc' }),
    c9: S.c9({ line: 120, spindle: 'on, S12000' }),
    c9SpindleRestart: S.c9SpindleRestart({ direction: 'M3', rpm: 12000, spinUpSeconds: 3 }),
    c10: S.c10({ axes: ['X', 'Y'] }),
    c12: S.c12(),
    c13: S.c13({ meaning: 'limit switch hit' }),
    c13En207: S.c13En207(),
    c14: S.c14({ toolChanges: 2 }),
    c15tg: S.c15({ boardId: '0084-1234', dialect: 'TG' }),
    c15en: S.c15({ boardId: '0084-1234', dialect: 'EN' }),
    c16: S.c16({ wcs: 'G54', axes: 'X, Y and Z' }),
    c17: S.c17({ pending: 'xtn', diff: 'xtn -5 → 0' }),
    c18: S.c18({ factoryDefaults: 'spep 1' }),
    c19: S.c19({ profileName: 'Router', revision: 5, machineName: 'Shapeoko', boardId: '0084-1234', diff: 'xvm 8000 → 10000', highRisk: [] }),
    c20New: S.c20New({ machineName: 'Shapeoko' }),
    c20Changed: S.c20Changed({ name: 'pocket.nc', machineName: 'Shapeoko', when: 'yesterday', device: 'laptop', diffSummary: '3 lines changed' }),
    c21: S.c21(),
    c22: S.c22({ spindle: 'on, S12000', coolant: 'on' }),
    c23: S.c23({ machineName: 'Shapeoko', boardId: '0084-1234', revision: 6 }),
    c24: S.c24({ direction: 'CW', rpm: 12000 }),
    c25: S.c25({ axes: 'X and Y', path: 'Z up to machine -1 mm, then X and Y to 0' }),
    c26: S.c26(),
    c27: S.c27({ axes: 'X and Y', system: 'G54' }),
    c28: S.c28({ system: 'G54' }),
    c29: S.c29({ system: 'G55' }),
    w37: S.w37(),
    w38: S.w38({ line: 12, status: 221, meaning: 'outside the soft limits' }),
    w39: S.w39(),
    w40: S.w40({ line: 40 }),
    w41: S.w41({ line: 40 }),
    w42: S.w42({ line: 40 }),
    w43: S.w43({ line: 40 }),
    w44: S.w44({ to: 0 }),
    c30: S.c30({ file: 'part.nc', lines: 10, workZero: 'G54', spindle: 'not used' }),
    c31: S.c31({ board: 'X 0', plan: 'X 1' }),
    c32: S.c32({ speeds: 'S12000' }),
    c33: S.c33({ line: 4, text: 'G1 X300' }),
    c34: S.c34({ line: 7, tool: 'T2' }),
    c35: S.c35({ direction: 'M3', rpm: 12000 }),
    c36: S.c36(),
    typed: S.TYPED_WORDS,
    noBaseline: S.C19_NO_BASELINE,
    provenance: S.C19_PROVENANCE,
  };

  it('render exactly as pinned', () => {
    expect(rendered).toMatchSnapshot();
  });

  it('refuse values that cannot be shown safely, with a SafetyStringError', () => {
    const bad: (() => unknown)[] = [
      () => S.w4({ seconds: Number.NaN }),
      () => S.w4({ seconds: '2' as unknown as number }),
      () => S.w9({ axis: ' ' }),
      () => S.w9({ axis: 'X‮' }),
      () => S.c14({ toolChanges: -1 }),
      () => S.c14({ toolChanges: 1.5 }),
      () => S.w15({ dialect: 'XX' as 'TG' }),
      () => S.c10({ axes: [] }),
    ];
    for (const f of bad) {
      expect(f).toThrow(S.SafetyStringError);
      try {
        f();
      } catch (e) {
        expect((e as Error).name).toBe('SafetyStringError');
      }
    }
  });
});

describe('sanitiser report messages', () => {
  const cases: [string, Dialect, string, Parameters<typeof run>[2]?][] = [
    ['read-only', TINYG_449_STOCK, 'G0 X1'],
    ['control', TINYG_EN, 'G0\x05'],
    ['unclosed', TINYG_EN, 'G0 (x'],
    ['text-after', TINYG_EN, '(x) G0'],
    ['stripped, empty, tape, N', TINYG_EN, 'G0 X1 (c)\n\n%\nN5\nN6 G0 X2'],
    ['first char', TINYG_EN, '$H'],
    ['realtime', TINYG_EN, 'G0 X1!'],
    ['non-ascii', TINYG_EN, 'G0 Xé'],
    ['invalid', TINYG_EN, 'G0 X1#'],
    ['malformed', TINYG_EN, 'G0 X'],
    ['m100, probe', TINYG_EN, 'M100\nG38.2 Z1'],
    ['codes', TINYG_440, 'G59.1\nG43\nM48\nG0 X1 Q1\nG0 X1 E1\nM201.3'],
    ['conflicts', TINYG_EN, 'G0 G1 X1\nG1 G92 X0\nG53 G4\nG2\nG53 X1\nG80\nX1\nG1 X1 I1 F1\nG2 X1 R1 I1 F1\nX1 X2'],
    ['values', TINYG_EN, 'G1 X1 F-1\nM3 S-1\nT99\nG10 P1 X0\nG10 L2 X0\nG4 P-1\nG2 X10 I5 P-1 F100\nG1 X1'],
    ['dialect rules', TINYG_440, 'G18 G2 X2 Z0 I1 K0.75 F120\nG91 G28 Z0\nG28.4\nG93\nS1 M3 M8 G4 P1'],
    ['m6', TINYG_EN, 'T1 M6'],
    ['c14', TINYG_EN, 'T1 M6\nM5', { c14: true }],
    ['unknown', TINYG_EN, 'G0 X1\nG53 G0 X1\nG2 X1 Y0 I1 F100', { start: {} }],
    ['unknown units', TINYG_EN, 'G21\nG90\nG0 X1', { start: { units: undefined as never } }],
    ['velocity', TINYG_EN, 'G0 B1'],
    ['feed rate max', TINYG_EN, 'G1 X1 F100', { motion: { ...MOTION, feedrateMax: { Y: 1 } } }],
    ['rotary mode', TINYG_EN, 'G0 A1\nG0 B1\nG28', { motion: { ...MOTION, rotary: { B: { mode: 3 } } } }],
    ['linear axis mode', TINYG_EN, 'G0 Y1\nG0 Z1\nG0 X1\nG28', { motion: { ...MOTION, linear: { Y: 0, Z: 3 } } }],
    ['inhibited axis', TINYG_EN, 'G0 X1', { motion: { ...MOTION, rotary: { A: { mode: 2 }, C: { mode: 1 } } }, start: { ...START, machine: { X: 0, Y: 0, Z: 0, A: 30, B: 45.25 } } }],
    ['feed units', TINYG_EN, 'G20 G1 X1 F1', { start: { ...START, units: undefined as never } }],
    ['split', TINYG_EN, 'G1 X100 F60', { motion: { ...MOTION, maxVelocity: { X: 600 }, feedrateMax: { X: 600 } } }],
    ['split impossible', TINYG_EN, 'G1 X1 F0.1\nG28', { start: { ...START, g28: { X: 9000, Y: 0, Z: 0, A: 0, B: 0, C: 0 } } }],
    ['arc', TINYG_EN, 'G2 X10 Y0 I4 F100\nG2 X10 Y0 I5 A1 F100\nG2 X1 Y0 I0.5 F0.1'],
    ['too long', TINYG_EN, `G4 P${'1'.repeat(120)}`],
    ['m1', TINYG_440, 'M1'],
    ['mid-file', TINYG_EN, 'M30\nG0 X1\nM30'],
    ['mid-file warn', TINYG_440, 'M30\nG0 X1\nM30'],
    ['end state', TINYG_EN, 'M4\nM7\nM8'],
    ['c22', TINYG_EN, 'M3', { c22: true }],
    ['c22 last line', TINYG_440, 'M8 M30', { c22: true }],
  ];

  it('are pinned for every rule', () => {
    const out = Object.fromEntries(cases.map(([name, d, file, opts]) => [`${d.id} ${name}`, run(file, d, opts).report.entries]));
    expect(out).toMatchSnapshot();
  });
});

describe('allow-matrix denials', () => {
  it('are pinned for every intent and overlay', () => {
    const open: Release = { name: 'all gates open', motion: true, write: true, port: true, settings: true };
    const out: Record<string, unknown> = {};
    for (const intent of INTENTS) {
      out[`${intent} NOT_CONNECTED`] = allowed({ base: 'NOT_CONNECTED', overlays: [], classified: false, enqCapable: false }, intent, open);
      out[`${intent} BOOTLOADER_MODE`] = allowed({ base: 'BOOTLOADER_MODE', overlays: [], classified: true, enqCapable: false }, intent, open);
      out[`${intent} phase 0`] = allowed({ base: 'IDLE_HOMED', overlays: [], classified: true, enqCapable: true }, intent);
    }
    for (const overlay of OVERLAYS) out[`overlay ${overlay}`] = allowed({ base: 'IDLE_HOMED', overlays: [overlay], classified: true, enqCapable: true }, 'jog', open);
    out['unknown state'] = allowed({ base: 'NOWHERE' as (typeof BASE_STATES)[number], overlays: [], classified: true, enqCapable: true }, 'read');
    expect(out).toMatchSnapshot();
  });
});
