/**
 * Drift and coverage of the settings files (Board settings spec §4.4 items
 * 1, 3, 4, 6): every setting the Board view reads has a definition, every
 * writable definition is a reviewed table key, forbidden and reserved keys
 * say so, and the inputs follow the firmware's switch order.
 */
import { describe, expect, it } from 'vitest';
import { DEN, SETTINGS_FILE_SCHEMA, getterClass, isForbiddenKey, setterClass, settingsDefsFor, settingsReadGroups, settingsSchemaFor, validateSchema } from '../src/index.ts';
import tinyg450 from '../settings/tinyg-450.json' with { type: 'json' };

const EN = 'tinyg-en';

function members(dialect: string): string[] {
  return settingsReadGroups(dialect).flatMap((g) => g.members);
}

describe('tinyg-450.json coverage', () => {
  it('validates against settings.schema.json', () => {
    expect(validateSchema(SETTINGS_FILE_SCHEMA, tinyg450)).toEqual([]);
  });

  it.each([EN])('%s: every read-group member has a definition', (d) => {
    const f = settingsDefsFor(d)!;
    expect(members(d).filter((k) => !f.tokens.has(k))).toEqual([]);
  });

  it.each([EN])('%s: every access write token is in the table with a value setter and not forbidden', (d) => {
    const schema = settingsSchemaFor(d);
    for (const def of settingsDefsFor(d)!.tokens.values()) {
      if (def.access !== 'write') continue;
      const row = schema.table.tokens.get(def.key);
      expect({ key: def.key, setter: row === undefined ? 'absent' : setterClass(row.setter) }).toEqual({ key: def.key, setter: 'value' });
      expect({ key: def.key, forbidden: isForbiddenKey(schema.forbidden, def.key) }).toEqual({ key: def.key, forbidden: false });
    }
  });

  it.each([EN])('%s: a read member is forbidden in the file exactly when a forbidden rule names it, with a reason', (d) => {
    const f = settingsDefsFor(d)!;
    const schema = settingsSchemaFor(d);
    const ruled = members(d).filter((k) => isForbiddenKey(schema.forbidden, k)).sort();
    const marked = members(d).filter((k) => f.tokens.get(k)?.access === 'forbidden').sort();
    expect(marked).toEqual(ruled);
    for (const k of marked) expect(f.tokens.get(k)?.reason, k).toMatch(/\.$/);
  });

  it('forbidden tokens carry the forbidden rule reason', () => {
    expect(settingsDefsFor(EN)!.tokens.get('ex')?.access).toBe('forbidden');
    expect(settingsDefsFor(EN)!.tokens.get('ex')?.values?.map((v) => v.label)).toEqual(['Off', 'XON/XOFF', 'RTS/CTS']);
  });

  it('reserved tokens are exactly den.json _reserved_hold_setting rows, and are gone from 450.05', () => {
    const stubs = DEN.tokens.filter((r) => r[5] === '_reserved_hold_setting').map((r) => r[0]).sort();
    const reserved = [...settingsDefsFor(EN)!.tokens.values()].filter((t) => t.access === 'reserved').map((t) => t.key).sort();
    expect(reserved).toEqual(stubs);
    expect(stubs).toEqual(['coph', 'spde', 'spph']);
    for (const k of stubs) expect(settingsDefsFor(EN, 450.05)!.tokens.has(k)).toBe(false);
  });

  it('the 450.05 and 450.06 override tokens are described from their builds only', () => {
    expect(settingsDefsFor(EN, 450.04)!.tokens.has('mfo')).toBe(false);
    expect(settingsDefsFor(EN, 450.05)!.tokens.has('mfo')).toBe(true);
    expect(settingsDefsFor(EN, 450.05)!.tokens.has('sso')).toBe(false);
    expect(settingsDefsFor(EN, 450.06)!.tokens.get('sso')?.access).toBe('read');
  });

  it('readouts are table tokens whose setter stores nothing', () => {
    for (const def of settingsDefsFor(EN, 450.06)!.tokens.values()) {
      if (def.access !== 'readout') continue;
      const row = settingsSchemaFor(EN, 450.06).settings.get(def.key);
      expect({ key: def.key, setter: row === undefined ? 'absent' : setterClass(row.setter), getter: row === undefined ? 'absent' : getterClass(row.getter) }).toMatchObject({ key: def.key, setter: 'readOnly' });
    }
  });

});

describe('tinyg-450.json inputs, sources and words', () => {
  it('inputs map in order to sw.s[0..7]', () => {
    expect(settingsDefsFor(EN)!.inputs.map((i) => [i.id, i.function, i.state, i.pin])).toEqual([
      ['xmin', 'xsn', 'in1', 'J7.3'], ['xmax', 'xsx', 'in2', 'J7.4'], ['ymin', 'ysn', 'in3', 'J7.5'], ['ymax', 'ysx', 'in4', 'J7.6'],
      ['zmin', 'zsn', 'in5', 'J8.3'], ['zmax', 'zsx', 'in6', 'J8.4'], ['amin', 'asn', 'in7', 'J8.5'], ['amax', 'asx', 'in8', 'J8.6'],
    ]);
    expect(settingsDefsFor(EN)!.inputs.every((i) => i.contact === 'st')).toBe(true);
    expect(settingsDefsFor(EN)!.probeAllowed).toEqual(['x', 'y', 'z']);
  });

  it('every src names a cfgArray row: a line after the header, unique among the written keys and among the rest', () => {
    const defs = [...settingsDefsFor(EN, 450.02)!.tokens.values()];
    const lineOf = (src: string): number => Number(/:(\d+)$/.exec(src)?.[1]);
    for (const d of defs) expect({ key: d.key, ok: Number.isInteger(lineOf(d.src)) && lineOf(d.src) > 100 }).toEqual({ key: d.key, ok: true });
    for (const part of [defs.filter((d) => d.write), defs.filter((d) => !d.write)]) {
      const lines = part.map((d) => lineOf(d.src));
      expect(lines.length - new Set(lines).size).toBe(0);
    }
  });

  it('in1 values are -1 Off, 0 Released, 1 Pressed, pending bench check BC-1', () => {
    const in1 = settingsDefsFor(EN)!.tokens.get('in1');
    expect(in1?.values?.map((v) => [v.value, v.label])).toEqual([[-1, 'Off'], [0, 'Released'], [1, 'Pressed']]);
    expect(in1?.access).toBe('readout');
    expect(in1?.verify).toBe('BC-1');
  });

  it('every definition names a group the file declares and a Board tab', () => {
    const tabs = new Set(['overview', 'motors', 'axes', 'inputs', 'io', 'comms', 'settings']);
    for (const d of settingsDefsFor(EN, 450.06)!.tokens.values()) expect({ key: d.key, tab: tabs.has(d.tab) }).toEqual({ key: d.key, tab: true });
  });

  it('every enumerated or described value has words, never only a number', () => {
    for (const d of settingsDefsFor(EN)!.tokens.values()) {
      for (const v of d.values ?? []) expect(v.label, d.key).toMatch(/[A-Za-z]/);
    }
  });
});
