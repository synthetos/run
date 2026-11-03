/**
 * Settings-write planning (SAFETY §4.6, H57-H63, amendment 2026-11-02): order
 * (communication settings last, jv very last), high-risk classification and
 * consequence text, read-back precision, and restore by token name.
 */
import { describe, expect, it } from 'vitest';
import { COMMS_KEYS, categoryOf, changeRisk, orderWrites, planSettingsWrite, readBackMatches, restoreChanges, sameSetting } from '../src/index.ts';

const BOARD = {
  xvm: 16000, xfr: 2000, xtn: 0, xtm: 300, xjm: 5000, xsn: 3, xsx: 2, ysn: 3, ysx: 2, zsn: 0, zsx: 3, asn: 0, asx: 0,
  st: 0, sl: 0, '1po': 0, '1ma': 0, '1sa': 1.8, '1mi': 8, '1tr': 40, xam: 1, spep: 1, fb: 450.01, id: 'X', hv: 8,
};

describe('orderWrites', () => {
  it('keeps the given order but puts js ee ec ej ex rxm last, in that order, and jv very last', () => {
    const keys = ['jv', 'rxm', 'xvm', 'ex', 'js', 'yfr', 'ec', 'ee', 'ej', '1po'].map((key) => ({ key }));
    expect(orderWrites(keys).map((k) => k.key)).toEqual(['xvm', 'yfr', '1po', ...COMMS_KEYS, 'jv']);
    expect(orderWrites([{ key: 'b' }, { key: 'a' }]).map((k) => k.key)).toEqual(['b', 'a']);
  });
});

describe('changeRisk', () => {
  it('names the categories that need the high-risk confirmation', () => {
    expect(categoryOf('st')).toBe('switch');
    expect(categoryOf('xsn')).toBe('switch');
    expect(categoryOf('zsx')).toBe('switch');
    expect(categoryOf('xsv')).toBe('homing');
    expect(categoryOf('1po')).toBe('motor');
    expect(categoryOf('2pm')).toBe('motor');
    expect(categoryOf('3ma')).toBe('motorMap');
    expect(categoryOf('aam')).toBe('axisMode');
    expect(categoryOf('ytm')).toBe('travel');
    expect(categoryOf('sl')).toBe('travel');
    expect(categoryOf('ee')).toBe('comms');
    expect(categoryOf('jv')).toBe('comms');
    expect(categoryOf('spep')).toBe('polarity');
    expect(categoryOf('xvm')).toBe('motion');
    for (const key of ['st', 'xsn', 'xlb', '1po', '1pm', '1ma', 'xam', 'xtn', 'sl', 'ee', 'spep', 'prbp']) expect(changeRisk('tinyg-en', key, 0, 1).highRisk, key).toBe(true);
    expect(changeRisk('tinyg-en', 'os', 0, 1).highRisk).toBe(false);
    expect(changeRisk('tinyg-en', 'xvm', 16000, 15000).highRisk).toBe(false);
    expect(changeRisk('tinyg-en', '1sa', 1.8, 0.9)).toMatchObject({ highRisk: false, afterWrite: 'W20' });
  });

  it('the switch-type consequence says what goes wrong and to test each switch', () => {
    const r = changeRisk('tinyg-en', 'st', 0, 1);
    expect(r.consequence).toMatch(/always pressed or never pressed/);
    expect(r.consequence).toMatch(/Test each switch after applying/);
    expect(changeRisk('tinyg-en', 'xsn', 3, 0).consequence).toMatch(/X-min switch/);
    expect(changeRisk('tinyg-en', '1po', 0, 1).consequence).toMatch(/turn the other way/);
  });

  it('a doubled velocity needs the typed confirmation (overlay increaseFactor)', () => {
    expect(changeRisk('tinyg-en', 'xvm', 1000, 2500).highRisk).toBe(true);
  });
});

describe('planSettingsWrite', () => {
  it('drops values equal to the board, screens the rest, orders them and describes each change', () => {
    const plan = planSettingsWrite('tinyg-en', [{ key: 'xvm', value: 16000 }, { key: 'xfr', value: 1500 }, { key: 'st', value: 1 }], BOARD);
    if (!plan.ok) throw new Error(JSON.stringify(plan.refused));
    expect(plan.changes.map((c) => c.key)).toEqual(['xfr', 'st']);
    expect(plan.changes[0]).toMatchObject({ from: 2000, to: 1500, words: '2000 mm/min → 1500 mm/min' });
    expect(plan.changes[1]?.risk.highRisk).toBe(true);
  });

  it('refuses the whole plan for any forbidden or out-of-range value', () => {
    expect(planSettingsWrite('tinyg-en', [{ key: 'xfr', value: 1500 }, { key: 'hv', value: 9 }], BOARD).ok).toBe(false);
    expect(planSettingsWrite('tinyg-en', [{ key: '1mi', value: 3 }], BOARD).ok).toBe(false);
    expect(planSettingsWrite('tinyg-en', [{ key: 'xtn', value: 400 }], BOARD).ok).toBe(false);
    expect(planSettingsWrite('tinyg-449-stock', [{ key: 'xfr', value: 1500 }], BOARD).ok).toBe(false);
  });
});

describe('read-back and restore', () => {
  it('compares at the table precision', () => {
    expect(readBackMatches('tinyg-en', 'xvm', 1234, 1234.0)).toBe(true);
    expect(readBackMatches('tinyg-en', 'xvm', 1234, 1200)).toBe(false);
    expect(readBackMatches('tinyg-en', 'xvm', 1234, null)).toBe(false);
    expect(readBackMatches('tinyg-en', '1sa', 1.8, 1.8000001)).toBe(true);
    expect(sameSetting('tinyg-en', 'id', 'a', 'a')).toBe(true);
  });

  it('restores by token name, skipping identity, readouts, forbidden and unreviewed keys, and values already on the board', () => {
    const backup = { xvm: 12000, xfr: 2000, fb: 449.01, hv: 7, id: 'OTHER', baud: 5, spe: 1, ex: 2, jv: 1, rthb: 1, rtfi: 5, rtflk: 1, si: 250, xyz: 1, gun: 'x', zjm: 800 };
    const r = restoreChanges('tinyg-en', backup, BOARD);
    expect(r.changes).toEqual([{ key: 'xvm', value: 12000 }, { key: 'zjm', value: 800 }]);
    expect(r.same).toBe(1);
    const skipped = Object.fromEntries(r.skipped.map((s) => [s.key, s.reason]));
    expect(skipped['fb']).toMatch(/identity/);
    expect(skipped['hv']).toMatch(/identity/);
    expect(skipped['id']).toMatch(/identity/);
    expect(skipped['baud']).toMatch(/identity/);
    expect(skipped['spe']).toMatch(/read-only/);
    expect(skipped['rthb']).toMatch(/read-only/);
    expect(skipped['rtfi']).toMatch(/read-only/);
    expect(skipped['rtflk']).toMatch(/read-only/);
    expect(skipped['ex']).toMatch(/forbidden/);
    expect(skipped['jv']).toMatch(/forbidden/);
    expect(skipped['si']).toMatch(/not reviewed/);
    expect(skipped['xyz']).toMatch(/not a setting/);
    expect(skipped['gun']).toMatch(/not a number/);
  });
});
