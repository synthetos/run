/**
 * Drift and coverage of the settings files (Board settings spec §4.4 items
 * 1, 3, 4, 6): every setting the Board view reads has a definition, every
 * writable definition is a reviewed table key, forbidden and reserved keys
 * say so, and the inputs follow the firmware's switch order.
 */
import { describe, expect, it } from 'vitest';
import { DEN, SETTINGS_FILE_SCHEMA, getterClass, isForbiddenKey, setterClass, settingsDefsFor, settingsReadGroups, settingsSchemaFor, validateSchema } from '../src/index.ts';
import tinyg440 from '../settings/tinyg-440.json' with { type: 'json' };
import tinyg449 from '../settings/tinyg-449.json' with { type: 'json' };
import tinyg450 from '../settings/tinyg-450.json' with { type: 'json' };

const EN = 'tinyg-en';
const S449 = 'tinyg-449-stock';
const TG440 = 'tinyg-440';
const DIALECTS = [S449, TG440, EN] as const;

function members(dialect: string): string[] {
  return settingsReadGroups(dialect).flatMap((g) => g.members);
}

/** Every token whose cfgArray flags end in "c" (F_CONVERT) at the dialect's pin, read from config_app.c. */
function convertRows(d: string): string[] {
  const each = (xs: readonly string[], ys: readonly string[]): string[] => xs.flatMap((x) => ys.map((y) => `${x}${y}`));
  const linear = each(['x', 'y', 'z'], ['vm', 'fr', 'tn', 'tm', 'jm', 'jh', 'jd', 'sv', 'lv', 'lb', 'zb']);
  const works = each(['g54', 'g55', 'g56', 'g57', 'g58', 'g59'], d === TG440 ? ['x', 'y', 'z', 'a', 'b', 'c'] : ['x', 'y', 'z']);
  const stored = d === TG440 ? [] : each(['g28', 'g30'], ['x', 'y', 'z']);
  return [...each(['1', '2', '3', '4'], ['tr']), ...linear, 'ara', 'bra', 'cra', 'ja', 'ct', ...works, ...stored].sort();
}

describe('tinyg-450.json coverage', () => {
  it('every file validates against settings.schema.json', () => {
    for (const f of [tinyg449, tinyg440, tinyg450]) expect(validateSchema(SETTINGS_FILE_SCHEMA, f)).toEqual([]);
  });

  it.each(DIALECTS)('%s: every read-group member has a definition', (d) => {
    const f = settingsDefsFor(d)!;
    expect(members(d).filter((k) => !f.tokens.has(k))).toEqual([]);
  });

  it.each(DIALECTS)('%s: every access write token is in the table with a value setter and not forbidden', (d) => {
    const schema = settingsSchemaFor(d);
    for (const def of settingsDefsFor(d)!.tokens.values()) {
      if (def.access !== 'write') continue;
      const row = schema.table.tokens.get(def.key);
      expect({ key: def.key, setter: row === undefined ? 'absent' : setterClass(row.setter) }).toEqual({ key: def.key, setter: 'value' });
      expect({ key: def.key, forbidden: isForbiddenKey(schema.forbidden, def.key) }).toEqual({ key: def.key, forbidden: false });
    }
  });

  it.each(DIALECTS)('%s: a read member is forbidden in the file exactly when a forbidden rule names it, with a reason', (d) => {
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

describe('describe-only files for stock 449 and 440 (safety: nothing becomes writable)', () => {
  const words = (key: string, d: string): unknown => settingsDefsFor(d)!.tokens.get(key)?.values?.map((v) => [v.value, v.label]);

  it.each([S449, TG440])('%s: shared tokens agree on value meanings with 450 unless marked differs', (d) => {
    const own = settingsDefsFor(d)!;
    const en = settingsDefsFor(EN)!;
    for (const [key, def] of own.tokens) {
      if (!en.tokens.has(key) || def.differs !== undefined) continue;
      expect({ key, values: words(key, d) }).toEqual({ key, values: words(key, EN) });
    }
  });

  it.each([S449, TG440])('%s: the file is readOnly with no write object and no access write', (d) => {
    const f = settingsDefsFor(d)!;
    expect(f.mode).toBe('readOnly');
    expect([...f.tokens.values()].filter((t) => t.write !== undefined || t.access === 'write').map((t) => t.key)).toEqual([]);
  });

  it('449 has no prbp, no reserved hold keys, and a fixed probe contact', () => {
    const f = settingsDefsFor(S449)!;
    for (const k of ['prbp', 'coph', 'spph', 'spde', 'os']) expect({ k, has: f.tokens.has(k) }).toEqual({ k, has: false });
    expect(f.probeContact).toEqual({ fixed: 'Normally open. Fixed on this firmware.', src: 'S449 switch.c:126-128 (a probe input always reads as normally open)' });
    expect(f.probeAllowed).toEqual(['x', 'y', 'z']);
    expect(settingsDefsFor(EN)!.probeContact).toEqual({ token: 'prbp' });
  });

  it('449 inputs read the same pins and live states as 450', () => {
    expect(settingsDefsFor(S449)!.inputs).toEqual(settingsDefsFor(EN)!.inputs);
  });

  it('440 has no probe switch mode and no live input state', () => {
    const f = settingsDefsFor(TG440)!;
    expect(f.tokens.get('xsn')?.values?.map((v) => v.value)).toEqual([0, 1, 2, 3]);
    expect(f.tokens.get('xsn')?.differs).toMatch(/TG canonical_machine\.c:1976/);
    expect(f.tokens.has('in1')).toBe(false);
    expect(f.inputs.every((i) => i.state === undefined)).toBe(true);
  });

  it('440 adds no writable key to the 440 schema, and 449 none to the 449 schema', () => {
    expect([...settingsSchemaFor(TG440).settings.values()].filter((d) => d.overlay).length).toBe(0);
    expect([...settingsSchemaFor(S449).settings.values()].filter((d) => d.overlay).length).toBe(0);
  });

  it.each(DIALECTS)('%s: exactly the cfgArray F_CONVERT rows (_fipc, _fipnc) are marked as lengths', (d) => {
    const marked = members(d).filter((k) => settingsDefsFor(d)!.tokens.get(k)?.convert === true).sort();
    expect(marked).toEqual(convertRows(d));
  });

  it.each([S449, TG440])('%s: every src cites its own pin', (d) => {
    const tag = d === S449 ? 'S449 ' : 'TG ';
    for (const t of settingsDefsFor(d)!.tokens.values()) expect({ key: t.key, src: t.src.startsWith(tag) }).toEqual({ key: t.key, src: true });
  });
});
