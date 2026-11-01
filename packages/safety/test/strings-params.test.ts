/**
 * strings.ts refuses values that cannot be shown safely (SAFETY §6: "All
 * text is generated from live values through strings.ts"). A warning that
 * read "NaN mm", "undefined" or an empty machine name, or that carried a
 * bidirectional override that reorders the rest of the line, would mislead
 * the operator, so each of these throws instead of rendering.
 */
import { describe, expect, it } from 'vitest';
import * as S from '../src/strings.ts';

const live = { machineName: 'Shop router', boardId: '2U29', firmware: 'edge-next 450.00', port: 'COM3' };

describe('strings.ts parameter checks', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('refuses the non-finite number %s', (bad) => {
    expect(() => S.w4({ seconds: bad })).toThrow(S.SafetyStringError);
    expect(() => S.w5({ distanceMm: bad, seconds: 1 })).toThrow(/distanceMm must be a finite number/);
    expect(() => S.w5({ distanceMm: 1, seconds: bad })).toThrow(/seconds must be a finite number/);
  });

  it('refuses a value that is not a number where a number is expected', () => {
    expect(() => S.w4({ seconds: undefined as unknown as number })).toThrow(S.SafetyStringError);
    expect(() => S.w4({ seconds: '3' as unknown as number })).toThrow(S.SafetyStringError);
  });

  it('renders -0 as 0, never "-0"', () => {
    expect(S.w4({ seconds: -0 })).toContain('for 0 s');
  });

  it.each(['', '   ', '\t'])('refuses an empty or blank text value %j', (bad) => {
    expect(() => S.w8({ ...live, machineName: bad })).toThrow(/machineName must not be empty/);
  });

  it.each([
    ['a line break', 'Router\nLIVE'],
    ['a carriage return', 'Router\r'],
    ['NUL', 'Router\u0000'],
    ['DEL', 'Router\u007f'],
    ['a C1 control', 'Router\u0085'],
    ['RIGHT-TO-LEFT OVERRIDE', 'Router‮'],
    ['LEFT-TO-RIGHT EMBEDDING', '‪Router'],
    ['FIRST STRONG ISOLATE', 'Router⁨'],
  ])('refuses a text value containing %s', (_label, bad) => {
    expect(() => S.w8({ ...live, port: bad })).toThrow(/control or bidirectional-override character/);
  });

  it('refuses a text value that is not a string', () => {
    expect(() => S.w9({ axis: undefined as unknown as string })).toThrow(/axis must be a string/);
  });

  it('accepts ordinary Unicode names', () => {
    expect(S.w9({ axis: 'A' })).toContain('axis A is not homed');
    expect(S.w8({ ...live, machineName: 'Fräse – Werkstatt' })).toContain('connected to Fräse – Werkstatt (');
  });

  it('refuses a value outside a fixed set', () => {
    expect(() => S.w15({ dialect: 'g2' as 'TG' })).toThrow(/dialect must be one of TG, EN/);
    expect(() => S.w24({ kind: 'project' as 'file', device: 'd', date: 'x' })).toThrow(/kind must be one of/);
    expect(() => S.c7({ ...c7, state: 'OLD' as 'NEW' })).toThrow(/state must be one of/);
  });

  it('refuses counts that are negative or fractional', () => {
    expect(() => S.c14({ toolChanges: -1 })).toThrow(/whole number/);
    expect(() => S.c14({ toolChanges: 1.5 })).toThrow(/whole number/);
    expect(() => S.w23({ machineName: 'm', fromRevision: 1, toRevision: Number.NaN, device: 'd', date: 'x' })).toThrow(/whole number/);
  });

  it('refuses an empty axis list for C10', () => {
    expect(() => S.c10({ axes: [] })).toThrow(/axes must not be empty/);
    expect(() => S.c10({ axes: ['X', ''] })).toThrow(/axes\[1\] must not be empty/);
  });

  it('renders an empty high-risk list as "none", never as a blank', () => {
    expect(S.c5({ settings: 1, machineName: 'm', boardId: 'b', changes: 'xvm', highRisk: [] })).toMatch(/High-risk changes: none\.$/);
    expect(S.c19({ profileName: 'p', revision: 2, machineName: 'm', boardId: 'b', diff: 'd', highRisk: [] })).toMatch(/High-risk changes: none\.$/);
  });

  it('C7 says "spindle OFF" when the file never turns the spindle on', () => {
    const text = S.renderChecklist(S.c7({ ...c7, spindleRpm: null }));
    expect(text).toContain(', spindle OFF, estimated');
    expect(text).not.toContain('spindle ON');
  });

  it('C3 signs a positive distance and keeps the sign of a negative one', () => {
    expect(S.c3({ axis: 'X', distanceMm: 0.25, feedMmPerMin: 100, expectedSteps: 320 })).toContain('move +0.25 mm');
    expect(S.c3({ axis: 'X', distanceMm: -0.25, feedMmPerMin: 100, expectedSteps: 320 })).toContain('move -0.25 mm');
  });

  it('C6 keeps the OLD-S boxes in order and adds the H47 mains box last', () => {
    const boxes = S.c6Boxes().boxes;
    expect(boxes.slice(0, 7).map((b) => b.slice(0, 2))).toEqual(['1.', '2.', '3.', '4.', '5.', '6.', '7.']);
    expect(boxes[7]).toMatch(/^Spindle and VFD mains are switched off/);
  });

  it('C15 adds the stalled-controller sentence on TinyG stock only', () => {
    expect(S.c15({ boardId: 'b', dialect: 'TG' })).toMatch(/press the reset button on the board\.$/);
    expect(S.c15({ boardId: 'b', dialect: 'EN' })).not.toContain('reset button');
  });

  it('every string is the same on every call (pure)', () => {
    expect(S.w1()).toBe(S.w1());
    expect(S.renderChecklist(S.c1Full())).toBe(S.renderChecklist(S.c1Full()));
  });
});

const c7: Parameters<typeof S.c7>[0] = {
  file: 'f.nc', sha256Short: 'ab…cd', state: 'SAME', lines: 1, units: 'mm', wcs: 'G54', x: { min: 0, max: 1 },
  y: { min: 0, max: 1 }, zMin: 0, spindleRpm: 1000, estimated: '1 s', overrunMm: 1, overrunSeconds: 1,
  longestLineSeconds: 1, splitMoves: 0, wakeLock: 'ON',
};
