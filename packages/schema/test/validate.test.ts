/**
 * validate(draft, schema) (ROADMAP P0-09; old P0-10; SAFETY §4.6).
 */
import { describe, expect, it } from 'vitest';
import { SETTINGS_SCHEMAS, SWITCH_KEYS, validate } from '../src/index.ts';
import type { Issue, IssueCode } from '../src/index.ts';

const EN = SETTINGS_SCHEMAS['tinyg-en'];
const TG = SETTINGS_SCHEMAS['tinyg-440'];
const S449 = SETTINGS_SCHEMAS['tinyg-449-stock'];

/** A board as read: homing on X/Y/Z min, limits on max, A switches off, NO switches, travel 0..300. */
const BOARD: Readonly<Record<string, number>> = Object.freeze({
  xsn: 3,
  xsx: 2,
  ysn: 3,
  ysx: 2,
  zsn: 2,
  zsx: 3,
  asn: 0,
  asx: 0,
  st: 0,
  xtn: 0,
  xtm: 300,
  ytn: 0,
  ytm: 200,
  ztn: -80,
  ztm: 0,
});

const codes = (issues: readonly Issue[]): [string, IssueCode][] => issues.map((i) => [i.key, i.code]);

describe('per-key checks', () => {
  it('a valid draft has no issues', () => {
    expect(validate({ xvm: 16000, '1mi': 8, '1sa': 1.8, '1tr': 5, xjm: 5000, spep: 0, os: 1, xam: 1, aam: 3, mt: 2 }, EN)).toEqual([]);
  });

  it('a read-only dialect writes nothing (stock 449)', () => {
    expect(codes(validate({ xvm: 1000, '1mi': 8 }, S449))).toEqual([
      ['xvm', 'readOnlyDialect'],
      ['1mi', 'readOnlyDialect'],
    ]);
  });

  it('a forbidden write is refused with its reason, whatever its value', () => {
    const issues = validate({ hv: 8, js: 0, me: 1, jv: 4, se00: 1, jogx: 10, boot: 1 }, EN);
    expect(codes(issues).every(([, c]) => c === 'forbidden')).toBe(true);
    expect(issues).toHaveLength(7);
    expect(issues[0]?.message).toMatch(/hardware version/);
    expect(validate({ js: 1 }, EN).map((i) => i.code)).toEqual(['notReviewed']);
  });

  it('an unknown or non-canonical key is refused', () => {
    expect(codes(validate({ zzz: 1, XVM: 1000, ' xvm': 1000 }, EN))).toEqual([
      ['zzz', 'unknownKey'],
      ['XVM', 'nonCanonicalKey'],
      [' xvm', 'nonCanonicalKey'],
    ]);
  });

  it('a key that is not a stored setting is refused', () => {
    expect(codes(validate({ stat: 1, home: 1, gc: 1, clear: 1 }, EN))).toEqual([
      ['stat', 'notWritable'],
      ['home', 'notWritable'],
      ['gc', 'notWritable'],
      ['clear', 'notWritable'],
    ]);
  });

  it('a stored setting without a reviewed overlay entry is refused (EN p1frq; every 440 key)', () => {
    expect(codes(validate({ p1frq: 100 }, EN))).toEqual([['p1frq', 'notReviewed']]);
    expect(codes(validate({ xvm: 1000, '1mi': 8 }, TG))).toEqual([
      ['xvm', 'notReviewed'],
      ['1mi', 'notReviewed'],
    ]);
  });

  it('type, finiteness and integers', () => {
    expect(codes(validate({ xvm: '1000', '1po': true, xtm: Number.NaN, ytm: Number.POSITIVE_INFINITY, '1mi': 2.5, xsn: 1.5 }, EN))).toEqual([
      ['xvm', 'type'],
      ['1po', 'type'],
      ['xtm', 'notFinite'],
      ['ytm', 'notFinite'],
      ['1mi', 'notInteger'],
      ['xsn', 'notInteger'],
    ]);
  });

  it('E158 minimums: zero or negative sa, tr, mi and jerk are refused before the firmware answers 108', () => {
    const issues = validate({ '1sa': 0, '2tr': -5, '3mi': 0, xjm: 0, yjh: -1 }, EN);
    expect(codes(issues)).toEqual([
      ['1sa', 'belowMinimum'],
      ['2tr', 'belowMinimum'],
      ['3mi', 'belowMinimum'],
      ['xjm', 'belowMinimum'],
      ['yjh', 'belowMinimum'],
    ]);
    expect(issues[0]?.message).toMatch(/108, E158/);
  });

  it('enumerated values', () => {
    expect(codes(validate({ xam: 3, xsn: 5, '1ma': 6, '1pm': 4, st: 2, spep: 2 }, EN))).toEqual([
      ['xam', 'enum'],
      ['xsn', 'enum'],
      ['1ma', 'enum'],
      ['1pm', 'enum'],
      ['st', 'enum'],
      ['spep', 'enum'],
    ]);
    expect(validate({ aam: 3 }, EN)).toEqual([]);
  });

  it('ranges, with exclusive minimums', () => {
    const issues = validate({ xvm: 300_000, avm: 0, mt: 0.05, xlb: -1, xjd: 0, xjm: 200_000, '1sa': 400 }, EN);
    expect(codes(issues)).toEqual([
      ['xvm', 'range'],
      ['avm', 'range'],
      ['mt', 'range'],
      ['xlb', 'range'],
      ['xjd', 'range'],
      ['xjm', 'range'],
      ['1sa', 'range'],
    ]);
    expect(issues[0]?.message).toBe('X maximum velocity must be greater than 0 and at most 200000 mm/min');
    expect(issues[2]?.message).toBe('Motor idle timeout must be at least 0.1 and at most 4294967 s');
  });

  it('hardware microsteps: 1mi=3 is refused with the TinyG message', () => {
    const issues = validate({ '1mi': 3 }, EN);
    expect(codes(issues)).toEqual([['1mi', 'hwAllowed']]);
    expect(issues[0]?.message).toBe('TinyG hardware supports 1, 2, 4, 8 for motor 1 microsteps');
    for (const mi of [1, 2, 4, 8]) expect(validate({ '1mi': mi }, EN)).toEqual([]);
  });

  it('reads own keys only', () => {
    const draft = Object.create({ hv: 8 }) as Record<string, unknown>;
    draft['xvm'] = 1000;
    expect(validate(draft, EN)).toEqual([]);
  });
});

describe('travel: tn < tm', () => {
  it('refuses a minimum at or above the maximum, on the keys the draft sets', () => {
    expect(codes(validate({ xtn: 10, xtm: 5 }, EN))).toEqual([
      ['xtn', 'travelOrder'],
      ['xtm', 'travelOrder'],
    ]);
    expect(codes(validate({ atn: 90 }, EN, { base: { atm: 90 } }))).toEqual([['atn', 'travelOrder']]);
  });

  it('checks a single changed end against the board value', () => {
    expect(validate({ xtn: -5 }, EN, { base: BOARD })).toEqual([]);
    expect(codes(validate({ xtm: -1 }, EN, { base: BOARD }))).toEqual([['xtm', 'travelOrder']]);
  });

  it('refuses when the other end is unknown, rather than guessing', () => {
    expect(codes(validate({ ytn: 0 }, EN))).toEqual([['ytm', 'crossFieldUnknown']]);
    expect(codes(validate({ ytm: 10 }, EN, { base: { ytn: 'x' } }))).toEqual([['ytn', 'crossFieldUnknown']]);
  });

  it('an invalid travel value is reported once, not again as a cross-key error', () => {
    expect(codes(validate({ xtn: Number.NaN }, EN, { base: BOARD }))).toEqual([['xtn', 'notFinite']]);
  });
});

describe('switch rules', () => {
  it('a valid change against a complete board passes', () => {
    expect(validate({ zsn: 3, zsx: 2 }, EN, { base: BOARD })).toEqual([]);
    expect(validate({ zsx: 4 }, EN, { base: BOARD })).toEqual([]);
  });

  it('all 8 switch modes must be known when any is changed', () => {
    const issues = validate({ xsn: 1 }, EN);
    expect(issues.map((i) => i.code)).toEqual(Array(7).fill('switchesIncomplete'));
    expect(issues.map((i) => i.key)).toEqual(SWITCH_KEYS.filter((k) => k !== 'xsn'));
    expect(codes(validate({ xsn: 1 }, EN, { base: { ...BOARD, asx: Number.NaN } }))).toEqual([['asx', 'switchesIncomplete']]);
  });

  it('one homing switch per axis (EN cycle_homing.c:261)', () => {
    expect(codes(validate({ xsx: 1 }, EN, { base: BOARD }))).toEqual([['xsn', 'multipleHomingSwitches']]);
    expect(codes(validate({ asn: 3, asx: 1 }, EN, { base: BOARD }))).toEqual([['asn', 'multipleHomingSwitches']]);
    expect(validate({ xsn: 2, xsx: 3 }, EN, { base: BOARD })).toEqual([]);
  });

  it('at most one probe input on X/Y/Z, none on A', () => {
    expect(codes(validate({ xsx: 4, ysx: 4 }, EN, { base: BOARD }))).toEqual([['ysx', 'multipleProbeInputs']]);
    expect(codes(validate({ asn: 4 }, EN, { base: BOARD }))).toEqual([['asn', 'probeOnRotary']]);
    expect(codes(validate({ asx: 4 }, EN, { base: BOARD }))).toEqual([['asx', 'probeOnRotary']]);
  });

  it('st must match the declared switch type', () => {
    expect(codes(validate({ st: 0 }, EN, { declaredSwitchType: 'NC' }))).toEqual([['st', 'switchTypeMismatch']]);
    expect(validate({ st: 1 }, EN, { declaredSwitchType: 'NC' })).toEqual([]);
    expect(codes(validate({ xvm: 1000 }, EN, { base: { st: 1 }, declaredSwitchType: 'NO' }))).toEqual([['st', 'switchTypeMismatch']]);
    expect(validate({ xvm: 1000 }, EN, { declaredSwitchType: 'NO' })).toEqual([]);
  });

  it('no cross-key rule runs on a dialect without the reviewed keys', () => {
    expect(codes(validate({ xsn: 1 }, TG, { declaredSwitchType: 'NC', base: { st: 0 } }))).toEqual([['xsn', 'notReviewed']]);
    expect(codes(validate({ xtn: 10, xtm: 5 }, S449))).toEqual([
      ['xtn', 'readOnlyDialect'],
      ['xtm', 'readOnlyDialect'],
    ]);
  });
});

it('the issue list is frozen', () => {
  const issues = validate({ hv: 1 }, EN);
  expect(Object.isFrozen(issues) && Object.isFrozen(issues[0])).toBe(true);
});
