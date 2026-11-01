/**
 * Board definition schema and selection (ROADMAP P0-08; RUN_PLAN §5.1 rule 6):
 * `hp`/`hv` plus the classified family pick the definition; an unknown or
 * ambiguous board gets a common subset that never offers more than the board has.
 */
import { describe, expect, it } from 'vitest';
import { BOARD_SCHEMA, commonSubset, parseBoardDefinition, selectBoard, validateSchema } from '../src/index.ts';
import type { BoardDefinition } from '../src/index.ts';
import dueJson from './fixtures/boards/g2core/arduino-due-gshield@na.json' with { type: 'json' };
import tinygJson from './fixtures/boards/tinyg/tinyg-v8@8.json' with { type: 'json' };

function board(json: unknown): BoardDefinition {
  const parsed = parseBoardDefinition(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.board;
}

const TINYG_V8 = board(tinygJson);
const DUE_GSHIELD = board(dueJson);
const ALL = [TINYG_V8, DUE_GSHIELD];

/** A copy of the v8 fixture as a different revision, for ambiguity tests. */
function variant(changes: Record<string, unknown>): BoardDefinition {
  return board({ ...JSON.parse(JSON.stringify(tinygJson)), ...changes });
}

describe('fixtures', () => {
  it('TinyG v8 and Due+gShield validate against boards.schema.json', () => {
    expect(validateSchema(BOARD_SCHEMA, tinygJson)).toEqual([]);
    expect(validateSchema(BOARD_SCHEMA, dueJson)).toEqual([]);
  });

  it('every fact records its source and verification', () => {
    for (const b of ALL) {
      const facts = [b.motors.count, b.motors.microsteps, b.motors.currentSetting, b.inputs.count, b.inputs.functions, b.flasher, b.defaults];
      for (const f of facts) {
        expect(f.src.length, b.id).toBeGreaterThan(3);
        expect(['source', 'bench', 'hardware-repo', 'unverified']).toContain(f.verified);
      }
      for (const o of b.outputs) expect(o.src.length).toBeGreaterThan(3);
    }
  });

  it('the TinyG v8 fixture matches the edge-next facts it cites', () => {
    expect(TINYG_V8.match).toEqual({ hp: 1, hv: [8] });
    expect(TINYG_V8.motors.count.value).toBe(4);
    expect(TINYG_V8.inputs.count.value).toBe(8);
    expect(TINYG_V8.outputs.map((o) => o.id)).toEqual(['spindleEnable', 'spindleDirection', 'spindlePwm', 'coolant']);
    expect(TINYG_V8.usb[0]).toMatchObject({ vendorId: 0x0403, productId: 0x6015, verified: 'unverified' });
  });

  it('the gShield has no spindle direction output and refuses the Due programming port', () => {
    expect(DUE_GSHIELD.outputs.some((o) => o.id === 'spindleDirection')).toBe(false);
    expect(DUE_GSHIELD.usb).toContainEqual(expect.objectContaining({ vendorId: 0x2341, productId: 0x003d, role: 'refuse' }));
  });

  it('parsed definitions are frozen copies', () => {
    expect(Object.isFrozen(TINYG_V8.outputs[0])).toBe(true);
    expect(Object.isFrozen(tinygJson)).toBe(false);
  });
});

describe('schema rejects malformed definitions', () => {
  const bad = (change: (j: Record<string, unknown>) => void) => {
    const j = JSON.parse(JSON.stringify(tinygJson)) as Record<string, unknown>;
    change(j);
    const out = parseBoardDefinition(j);
    return out.ok ? [] : out.errors.map((e) => `${e.path}: ${e.message}`);
  };

  it('refuses unknown properties, missing facts, wrong ids and unknown outputs', () => {
    expect(bad((j) => (j['extra'] = 1))).toEqual(['/extra: property not allowed']);
    expect(bad((j) => delete j['flasher'])).toEqual([': missing required property "flasher"']);
    expect(bad((j) => (j['id'] = 'TinyG v8'))).toEqual(['/id: does not match ^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9.-]*$']);
    expect(bad((j) => ((j['outputs'] as unknown[]).push({ id: 'laser', src: 'xyz', verified: 'source' })))).toEqual([
      expect.stringMatching(/^\/outputs\/4\/id: expected one of/),
    ]);
    expect(bad((j) => ((j['motors'] as Record<string, unknown>)['count'] = { value: 4, src: 'x' }))).toEqual([
      '/motors/count: missing required property "verified"',
      '/motors/count/src: shorter than 3',
    ]);
    expect(bad((j) => ((j['match'] as Record<string, unknown>)['hv'] = [8, 8]))).toEqual(['/match/hv: items are not unique']);
    expect(bad((j) => ((j['match'] as Record<string, unknown>)['hv'] = []))).toEqual(['/match/hv: fewer than 1 items']);
    expect(bad((j) => ((j['motors'] as Record<string, Record<string, unknown>>)['microsteps']!['value'] = [3]))).toEqual([
      expect.stringMatching(/^\/motors\/microsteps\/value\/0: expected one of/),
    ]);
    expect(bad((j) => ((j['usb'] as Record<string, unknown>[])[0]!['vendorId'] = 70000))).toEqual(['/usb/0/vendorId: above maximum 65535']);
    expect(bad((j) => (j['format'] = 'synthetos-board@2'))).toEqual(['/format: expected "synthetos-board@1"']);
    expect(bad((j) => (j['name'] = 7))).toEqual(['/name: expected string']);
  });

  it('refuses a non-object', () => {
    expect(parseBoardDefinition('tinyg')).toEqual({ ok: false, errors: [{ path: '', message: 'expected object' }] });
  });
});

describe('selectBoard', () => {
  it('hp/hv plus the family select the exact definition', () => {
    expect(selectBoard({ family: 'tinyg', hp: 1, hv: 8 }, ALL)).toEqual({ kind: 'exact', board: TINYG_V8 });
    expect(selectBoard({ family: 'g2core', hp: 'ArduinoDue', hv: 'na' }, ALL)).toEqual({ kind: 'exact', board: DUE_GSHIELD });
  });

  it('the family must agree: a g2 identity never selects a TinyG board, and vice versa', () => {
    expect(selectBoard({ family: 'g2core', hp: 1, hv: 8 }, ALL).kind).toBe('commonSubset');
    expect(selectBoard({ family: 'tinyg', hp: 'ArduinoDue', hv: 'na' }, ALL).kind).toBe('commonSubset');
  });

  it('an unknown revision gets the empty subset: no motors, outputs, USB claim or flasher', () => {
    const s = selectBoard({ family: 'tinyg', hp: 1, hv: 7 }, ALL);
    expect(s).toMatchObject({ kind: 'commonSubset', reason: 'unknown', candidates: [] });
    expect(s.board.motors.count.value).toBe(0);
    expect(s.board.inputs.count.value).toBe(0);
    expect(s.board.outputs).toEqual([]);
    expect(s.board.adc).toEqual([]);
    expect(s.board.usb).toEqual([]);
    expect(s.board.flasher.value).toBe('none');
    expect(s.board.family).toBe('tinyg');
  });

  it('an unclassified board, or a missing hp/hv, is unknown', () => {
    for (const id of [{ family: null, hp: 1, hv: 8 }, { family: 'tinyg' as const, hv: 8 }, { family: 'tinyg' as const, hp: 1 }]) {
      const s = selectBoard(id, ALL);
      expect(s).toMatchObject({ kind: 'commonSubset', reason: 'unknown' });
      expect(s.board.outputs).toEqual([]);
    }
    expect(selectBoard({ family: null }, ALL).board.family).toBe('unknown');
  });

  it('an ambiguous match gets the intersection, never the richer revision', () => {
    const lean = variant({
      id: 'tinyg-v8-lean@8',
      motors: { ...tinygJson.motors, count: { value: 3, src: 'test variant', verified: 'unverified' }, microsteps: { value: [1, 2, 4], src: 'test variant', verified: 'unverified' } },
      outputs: [
        { id: 'spindleEnable', polarityToken: 'spen', src: 'test variant', verified: 'unverified' },
        { id: 'coolant', src: 'test variant', verified: 'unverified' },
      ],
      adc: [{ id: 'adc3', src: 'test variant', verified: 'unverified' }],
    });
    const s = selectBoard({ family: 'tinyg', hp: 1, hv: 8 }, [TINYG_V8, lean, DUE_GSHIELD]);
    expect(s).toMatchObject({ kind: 'commonSubset', reason: 'ambiguous', candidates: ['tinyg-v8@8', 'tinyg-v8-lean@8'] });
    expect(s.board.motors.count.value).toBe(3);
    expect(s.board.motors.microsteps.value).toEqual([1, 2, 4]);
    expect(s.board.outputs.map((o) => o.id)).toEqual(['spindleEnable', 'coolant']);
    // The polarity token is dropped where the candidates disagree.
    expect(s.board.outputs[0]?.polarityToken).toBeUndefined();
    expect(s.board.adc).toEqual([]);
    expect(s.board.flasher.value).toBe('none');
    expect(s.board.name).toContain('tinyg-v8-lean@8');
  });

  it('the subset keeps a polarity token and ADC channels all candidates share', () => {
    const twin = variant({ id: 'tinyg-v8-twin@8', adc: [{ id: 'adc0', src: 'test variant', verified: 'unverified' }] });
    const withAdc = variant({ id: 'tinyg-v8-adc@8', adc: [{ id: 'adc0', src: 'test variant', verified: 'unverified' }] });
    const s = commonSubset('tinyg', [twin, withAdc]);
    expect(s.outputs.find((o) => o.id === 'spindleEnable')?.polarityToken).toBe('spep');
    expect(s.adc.map((a) => a.id)).toEqual(['adc0']);
    expect(Object.isFrozen(s.outputs)).toBe(true);
  });

  it('property: a common subset never lists an output, ADC channel or microstep value some candidate lacks', () => {
    const variants = [
      TINYG_V8,
      variant({ id: 'a@8', outputs: [{ id: 'coolant', src: 'abc', verified: 'unverified' }] }),
      variant({ id: 'b@8', outputs: [], motors: { ...tinygJson.motors, count: { value: 1, src: 'abc', verified: 'unverified' } } }),
    ];
    for (let mask = 1; mask < 1 << variants.length; mask++) {
      const picked = variants.filter((_, i) => mask & (1 << i));
      const s = commonSubset('tinyg', picked);
      for (const o of s.outputs) for (const c of picked) expect(c.outputs.some((x) => x.id === o.id)).toBe(true);
      for (const m of s.motors.microsteps.value) for (const c of picked) expect(c.motors.microsteps.value).toContain(m);
      for (const c of picked) expect(s.motors.count.value).toBeLessThanOrEqual(c.motors.count.value);
    }
  });
});
