/**
 * The edge-next hand overlay (ROADMAP P0-09; old P0-10 subset; RUN_PLAN §7.2;
 * SAFETY §4.6).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACT_ROOTS, SETTINGS_SCHEMAS, TINYG_EN_OVERLAY, isForbiddenKey, setterClass, sourceUrl } from '../src/index.ts';
import type { OverlayEntry } from '../src/index.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const pins = (JSON.parse(readFileSync(join(REPO, 'vendor/firmware-pins.json'), 'utf8')) as { pins: Record<string, { commit: string; repo: string }> }).pins;
const EN = SETTINGS_SCHEMAS['tinyg-en'];
const BY_KEY = new Map(TINYG_EN_OVERLAY.map((o) => [o.key, o]));
const get = (key: string): OverlayEntry => {
  const o = BY_KEY.get(key);
  if (o === undefined) throw new Error(`no overlay entry for ${key}`);
  return o;
};

const MOTORS = ['1', '2', '3', '4'];
const MOTOR_KEYS = ['ma', 'sa', 'tr', 'mi', 'po', 'pm'];
/** Old P0-10's axis subset: am/vm/fr/tn/tm/jm/jh/jd/sn/sx/sv/lv/lb/zb, for every axis the table defines them on. */
const AXIS_KEYS = ['am', 'vm', 'fr', 'tn', 'tm', 'jm', 'jh', 'jd', 'sn', 'sx', 'sv', 'lv', 'lb', 'zb', 'ra'];

describe('coverage of the overlay', () => {
  it('covers the motion-relevant subset (old P0-10) on every motor and axis the table defines', () => {
    const expected = [
      ...MOTORS.flatMap((m) => MOTOR_KEYS.map((k) => `${m}${k}`)),
      ...['x', 'y', 'z', 'a', 'b', 'c'].flatMap((a) => AXIS_KEYS.map((k) => `${a}${k}`)).filter((k) => EN.table.tokens.has(k)),
      'st',
      'sl',
      'gun',
      'gdi',
      'mt',
      'spep',
      'spdp',
      'prbp',
      'os',
    ];
    expect([...BY_KEY.keys()].sort()).toEqual(expected.sort());
    expect(BY_KEY.size).toBe(TINYG_EN_OVERLAY.length);
  });

  it('every key exists in den.json, stores a value and is not a forbidden write', () => {
    for (const o of TINYG_EN_OVERLAY) {
      const def = EN.table.tokens.get(o.key);
      expect(def, o.key).toBeDefined();
      expect(setterClass(def?.setter ?? ''), o.key).toBe('value');
      expect(isForbiddenKey(EN.forbidden, o.key), o.key).toBe(false);
    }
  });

  it('scope follows the table persist flag: os is the only session key', () => {
    for (const o of TINYG_EN_OVERLAY) expect(o.scope === 'persisted', o.key).toBe(EN.table.tokens.get(o.key)?.persist);
    expect(TINYG_EN_OVERLAY.filter((o) => o.scope === 'session').map((o) => o.key)).toEqual(['os']);
  });

  it('valueType follows the table type', () => {
    for (const o of TINYG_EN_OVERLAY) {
      const type = EN.table.tokens.get(o.key)?.type;
      expect(o.valueType, `${o.key} ${String(type)}`).toBe(type === 'float' ? 'number' : 'integer');
    }
  });
});

describe('every entry is complete and cited', () => {
  it.each(TINYG_EN_OVERLAY.map((o) => [o.key, o] as const))('%s', (_key, o) => {
    expect(o.label.length).toBeGreaterThan(3);
    expect(o.description.length).toBeGreaterThan(10);
    expect(o.whatGoesWrong.length).toBeGreaterThan(20);
    expect(o.rangeSource.length).toBeGreaterThan(5);
    expect(o.rangeSource.startsWith('host:') || /^EN [a-z_]+\.[ch]:\d+/.test(o.rangeSource), o.rangeSource).toBe(true);
    expect(o.src.tag).toBe('EN');
    expect(o.src.file).toBe('config_app.c');
    expect(Number.isInteger(o.src.line) && o.src.line > 100, `cfgArray row ${o.src.line}`).toBe(true);
    expect(Number.isFinite(o.range.min) && Number.isFinite(o.range.max) && o.range.min < o.range.max).toBe(true);
    for (const v of o.values ?? []) expect(v.value >= o.range.min && v.value <= o.range.max && v.label.length > 0).toBe(true);
    for (const p of o.invalidates) {
      expect(p, o.key).toMatch(/^[a-z]+(\.(\*|[a-z0-9]+))*$/);
      expect(FACT_ROOTS as readonly string[], p).toContain(p.split('.')[0]);
    }
    expect(Object.isFrozen(o) && Object.isFrozen(o.range) && Object.isFrozen(o.invalidates) && Object.isFrozen(o.src)).toBe(true);
  });

  it('cfgArray rows are distinct and in table order (motors, then axes X..C, then system)', () => {
    const lines = TINYG_EN_OVERLAY.map((o) => o.src.line);
    expect(new Set(lines).size).toBe(lines.length);
    expect(get('1ma').src.line).toBe(211);
    expect(get('xvm').src.line).toBe(277);
    expect(get('spep').src.line).toBe(649);
    expect(get('os').src.line).toBe(667);
  });

  it('source links point at the cfgArray row at the pinned edge-next commit', () => {
    const pin = pins['EN'];
    expect(pin?.commit).toBe(EN.table.source.commit);
    expect(sourceUrl(EN.table.source.commit, get('xtn').src)).toBe(`${pin?.repo}/blob/${pin?.commit}/firmware/tinyg/config_app.c#L279`);
  });
});

describe('risk, confirmations and invalidations (SAFETY §4.6)', () => {
  it('spep, spdp and prbp are in the polarity class and always need typed C5', () => {
    for (const key of ['spep', 'spdp', 'prbp']) {
      expect(get(key).risk, key).toBe('polarity');
      expect(get(key).typedConfirm).toEqual({ kind: 'always' });
    }
    expect(TINYG_EN_OVERLAY.filter((o) => o.risk === 'polarity').map((o) => o.key).sort()).toEqual(['prbp', 'spdp', 'spep']);
    expect(get('spep').invalidates).toContain('outputs.spindle');
    expect(get('prbp').invalidates).toContain('probe.*');
  });

  it('typed C5 always for motor map and polarity, switch type and modes, travel, and rotary axis mode', () => {
    // Rotary `am` can select radius mode, which multiplies every move on that axis by 360 / (2π ra).
    const always = [...MOTORS.flatMap((m) => [`${m}ma`, `${m}po`]), 'st', 'aam', 'bam', 'cam', ...['x', 'y', 'z', 'a'].flatMap((a) => [`${a}sn`, `${a}sx`]), ...['x', 'y', 'z', 'a', 'b', 'c'].flatMap((a) => [`${a}tn`, `${a}tm`]), 'spep', 'spdp', 'prbp'];
    expect(TINYG_EN_OVERLAY.filter((o) => o.typedConfirm.kind === 'always').map((o) => o.key).sort()).toEqual(always.sort());
    expect(get('xam').typedConfirm).toEqual({ kind: 'never' });
    expect(get('aam').whatGoesWrong).toContain('radius mode');
  });

  it('typed C5 for sl=0 and for jerk or velocity ×2 or more', () => {
    expect(get('sl').typedConfirm).toEqual({ kind: 'whenValue', value: 0 });
    for (const a of ['x', 'y', 'z', 'a', 'b', 'c']) {
      for (const k of ['vm', 'fr', 'jm']) expect(get(`${a}${k}`).typedConfirm, `${a}${k}`).toEqual({ kind: 'increaseFactor', factor: 2 });
    }
  });

  it('W20 after motor-map, polarity, scale and travel writes only', () => {
    const w20 = [...MOTORS.flatMap((m) => ['ma', 'po', 'sa', 'tr', 'mi'].map((k) => `${m}${k}`)), ...['x', 'y', 'z', 'a', 'b', 'c'].flatMap((a) => [`${a}tn`, `${a}tm`])];
    expect(TINYG_EN_OVERLAY.filter((o) => o.afterWrite === 'W20').map((o) => o.key).sort()).toEqual(w20.sort());
  });

  it('invalidations follow the fact rules (TOOLS_PLAN §5.2)', () => {
    expect(get('1po').invalidates).toEqual(['dir.*', 'homing.*']);
    expect(get('2ma').invalidates).toEqual(['dir.*', 'homing.*']);
    // Scale and travel writes clear every softlimits fact, as the §5.2 table says ("softlimits"), not one key of it.
    for (const k of ['3tr', '3sa', '3mi']) expect(get(k).invalidates).toEqual(['scale.*', 'homing.*', 'softlimits']);
    for (const k of ['st', 'xsn', 'asx']) expect(get(k).invalidates).toEqual(['switch.*', 'homing.*']);
    for (const k of ['ytn', 'ztm']) expect(get(k).invalidates).toEqual(['softlimits', 'job.*.preflight']);
    expect(get('sl').invalidates).toEqual(['softlimits']);
    expect(get('xsv').invalidates).toEqual(['homing.x']);
  });
});

describe('ranges and units', () => {
  it('microsteps: hardware allows 1, 2, 4, 8', () => {
    for (const m of MOTORS) expect(get(`${m}mi`).hwAllowed).toEqual([1, 2, 4, 8]);
  });

  it('the E158 keys are exactly step angle, travel per revolution, microsteps and jerk', () => {
    const e158 = [...MOTORS.flatMap((m) => [`${m}sa`, `${m}tr`, `${m}mi`]), ...['x', 'y', 'z', 'a', 'b', 'c'].map((a) => `${a}jm`), ...['x', 'y', 'z', 'a'].map((a) => `${a}jh`)];
    expect(TINYG_EN_OVERLAY.filter((o) => o.e158 === true).map((o) => o.key).sort()).toEqual(e158.sort());
  });

  it('convert matches the cfgArray F_CONVERT rows (_fipc): travel per rev, linear axis lengths and speeds, radius', () => {
    const linear = ['vm', 'fr', 'tn', 'tm', 'jm', 'jh', 'jd', 'sv', 'lv', 'lb', 'zb'];
    const expected = [...MOTORS.map((m) => `${m}tr`), ...['x', 'y', 'z'].flatMap((a) => linear.map((k) => `${a}${k}`)), 'ara', 'bra', 'cra'];
    expect(TINYG_EN_OVERLAY.filter((o) => o.convert).map((o) => o.key).sort()).toEqual(expected.sort());
  });

  it('rotary axes use degrees, linear axes millimetres', () => {
    expect(get('xvm').unit).toBe('mm/min');
    expect(get('avm').unit).toBe('deg/min');
    expect(get('btn').unit).toBe('deg');
    expect(get('cjm').unit).toBe('Mdeg/min3');
    expect(get('zjm').unit).toBe('Mmm/min3');
  });

  it('axis modes: linear axes up to inhibited (2), rotary up to radius (3)', () => {
    expect(get('xam').values?.map((v) => v.value)).toEqual([0, 1, 2]);
    expect(get('aam').values?.map((v) => v.value)).toEqual([0, 1, 2, 3]);
    expect(get('zsn').values?.map((v) => v.value)).toEqual([0, 1, 2, 3, 4]);
  });
});
