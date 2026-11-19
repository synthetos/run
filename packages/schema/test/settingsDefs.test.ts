/**
 * Setting definitions as data (Board settings spec §4): the settings file
 * schema, the loader's cross-field rules, family expansion and the registry.
 */
import { describe, expect, it } from 'vitest';
import { expandSettingsFile, settingsDefsFor } from '../src/index.ts';
import miniJson from './fixtures/settings/mini.json' with { type: 'json' };

type Raw = Record<string, unknown>;

/** A deep copy of the fixture, so a variant never changes the shared import. */
function mini(): Raw {
  return JSON.parse(JSON.stringify(miniJson)) as Raw;
}

function withToken(key: string, changes: Raw, drop: readonly string[] = []): Raw {
  const f = mini();
  const tokens = f['tokens'] as Record<string, Raw>;
  const t = { ...tokens[key], ...changes };
  for (const d of drop) delete t[d];
  tokens[key] = t;
  return f;
}

describe('expandSettingsFile', () => {
  it('expands a family into one definition per instance with its cfgArray line', () => {
    const f = expandSettingsFile(mini());
    expect(f.tokens.get('2mi')?.label).toBe('Motor 2 microsteps');
    expect(f.tokens.get('2mi')?.src).toBe('EN config_app.c:221');
    expect(f.tokens.get('2mi')?.group).toBe('motor-2');
    expect(f.tokens.get('2mi')?.write?.whatGoesWrong).toBe('Motor 2 moves the wrong distance.');
    expect(f.tokens.get('2mi')?.values?.map((v) => v.label)).toEqual(['Full step (1)', 'Half step (2)', 'Quarter step (4)', 'Eighth step (8)']);
  });

  it('resolves an enum reference', () => {
    const f = expandSettingsFile(mini());
    expect(f.tokens.get('xsn')?.values?.[3]?.label).toBe('Homing and limit');
    expect(f.tokens.get('xsn')?.labelSrc).toBe('EN canonical_machine.c:3174 fmt_Xsn; switch.h:42-47');
  });

  it('carries the file header, groups and inputs', () => {
    const f = expandSettingsFile(mini());
    expect(f.dialect).toBe('tinyg-en');
    expect(f.mode).toBe('writable');
    expect(f.groups.map((g) => g.id)).toEqual(['system', 'motor-1', 'motor-2', 'inputs']);
    expect(f.inputs[0]).toEqual({ id: 'xmin', label: 'X min switch', pin: 'J7.3', function: 'xsn', contact: 'st', state: 'in1' });
  });

});

describe('expandSettingsFile: cross-field rules', () => {
  it('refuses access write without a write object', () => {
    expect(() => expandSettingsFile(withToken('xsn', { access: 'write' }))).toThrow(/xsn: access write needs a write object/);
  });

  it('refuses a write object on a token whose access is not write', () => {
    const f = mini();
    const fam = (f['families'] as Raw[])[0] as Raw;
    fam['access'] = 'read';
    expect(() => expandSettingsFile(f)).toThrow(/1mi: a write object needs access write/);
  });

  it('refuses a write object in a readOnly file', () => {
    expect(() => expandSettingsFile({ ...mini(), mode: 'readOnly' })).toThrow(/1mi: a readOnly file has no write objects/);
  });

  it('refuses unit enum without values, and values on a plain number unit', () => {
    expect(() => expandSettingsFile(withToken('xsn', {}, ['enum']))).toThrow(/xsn: unit enum needs values/);
    expect(() => expandSettingsFile(withToken('ex', { unit: 'mm' }))).toThrow(/ex: values need unit enum or microsteps/);
  });

  it('refuses both values and an enum reference, and an unknown enum', () => {
    expect(() => expandSettingsFile(withToken('ex', { enum: 'switchMode' }))).toThrow(/ex: both values and enum/);
    expect(() => expandSettingsFile(withToken('xsn', { enum: 'nope' }))).toThrow(/xsn: unknown enum "nope"/);
  });

  it('refuses an unresolved placeholder', () => {
    expect(() => expandSettingsFile(withToken('xsn', { label: 'Motor {m} thing' }))).toThrow(/xsn: unresolved \{m\}/);
  });

  it('refuses a family instance without a row', () => {
    const f = mini();
    ((f['families'] as Raw[])[0] as Raw)['rows'] = { '1': 214 };
    expect(() => expandSettingsFile(f)).toThrow(/2mi: no row for instance 2/);
  });

  it('refuses a token defined twice', () => {
    const f = mini();
    (f['tokens'] as Record<string, Raw>)['1mi'] = (f['tokens'] as Record<string, Raw>)['xsn'] as Raw;
    expect(() => expandSettingsFile(f)).toThrow(/1mi: defined twice/);
  });

  it('refuses a token whose group is not declared', () => {
    expect(() => expandSettingsFile(withToken('xsn', { group: 'nowhere' }))).toThrow(/xsn: unknown group "nowhere"/);
  });

});

describe('expandSettingsFile: builds, families and the schema', () => {
  it('drops a token outside since/until for the given fb', () => {
    expect(expandSettingsFile(mini(), 450.04).tokens.has('sso')).toBe(false);
    expect(expandSettingsFile(mini(), 450.06).tokens.has('sso')).toBe(true);
    expect(expandSettingsFile(withToken('ex', { until: 450.05 }), 450.05).tokens.has('ex')).toBe(false);
    expect(expandSettingsFile(withToken('ex', { until: 450.05 }), 450.04).tokens.has('ex')).toBe(true);
  });

  it('without an fb, uses the lowest build the file serves', () => {
    expect(expandSettingsFile(mini()).tokens.has('sso')).toBe(false);
  });

  it('validates against settings.schema.json (unknown property refused)', () => {
    expect(() => expandSettingsFile(withToken('xsn', { colour: 'red' }))).toThrow(/additional property/);
    expect(() => expandSettingsFile({ ...mini(), format: 'other@1' })).toThrow(/\/format/);
  });

  it('expands an axis family with {a}, {A} and two placeholders', () => {
    const f = mini();
    (f['families'] as Raw[]).push({
      pattern: 'g{w}{a}',
      for: { w: ['54', '55'], a: ['x', 'y'] },
      rows: { '54x': 101, '54y': 102, '55x': 103, '55y': 104 },
      src: 'EN config_app.c:{row}',
      label: 'G{w} {A} offset',
      short: '{A}',
      description: 'Work offset {w} on {A}.',
      unit: 'mm',
      group: 'system',
      tab: 'settings',
      access: 'read',
    });
    const t = expandSettingsFile(f).tokens;
    expect([...t.keys()].filter((k) => k.startsWith('g'))).toEqual(['g54x', 'g54y', 'g55x', 'g55y']);
    expect(t.get('g55y')).toMatchObject({ label: 'G55 Y offset', short: 'Y', src: 'EN config_app.c:104' });
  });

  it('keeps a placeholder the family does not define, and then refuses it', () => {
    const f = mini();
    ((f['families'] as Raw[])[0] as Raw)['short'] = 'Microsteps on {a}';
    expect(() => expandSettingsFile(f)).toThrow(/1mi: unresolved \{a\}/);
  });

  it('a token labelSrc wins over the enum labelSrc; an enum without one leaves none', () => {
    expect(expandSettingsFile(withToken('xsn', { labelSrc: 'own' })).tokens.get('xsn')?.labelSrc).toBe('own');
    const f = withToken('xsn', {});
    delete ((f['enums'] as Record<string, Raw>)['switchMode'] as Raw)['labelSrc'];
    expect(expandSettingsFile(f).tokens.get('xsn')?.labelSrc).toBeUndefined();
  });

  it('typed confirmation needs its value or factor', () => {
    const f = (typed: Raw): Raw => {
      const g = mini();
      (((g['families'] as Raw[])[0] as Raw)['write'] as Raw)['typedConfirm'] = typed;
      return g;
    };
    expect(() => expandSettingsFile(f({ kind: 'whenValue' }))).toThrow(/1mi: typedConfirm whenValue needs a value/);
    expect(() => expandSettingsFile(f({ kind: 'increaseFactor' }))).toThrow(/1mi: typedConfirm increaseFactor needs a factor/);
    expect(expandSettingsFile(f({ kind: 'whenValue', value: 0 })).tokens.get('1mi')?.write?.typedConfirm).toEqual({ kind: 'whenValue', value: 0 });
  });

  it('a file without a lowest build and no fb keeps every token', () => {
    expect(expandSettingsFile({ ...mini(), firmware: { family: 'x', fb: {}, source: 'EN@a7489b79' } }).tokens.has('sso')).toBe(true);
  });

  it('a file without families or enums loads its tokens', () => {
    const f = withToken('xsn', { values: [{ value: 0, label: 'Off' }] }, ['enum']);
    delete f['families'];
    delete f['enums'];
    expect([...expandSettingsFile(f).tokens.keys()]).toEqual(['xsn', 'ex']);
  });

});

describe('expandSettingsFile: file-level rules', () => {
  it('probeContact names a defined token, or a fixed sentence, never both or neither', () => {
    expect(expandSettingsFile({ ...mini(), probeContact: { token: 'xsn' } }).probeContact).toEqual({ token: 'xsn' });
    expect(expandSettingsFile({ ...mini(), probeContact: { fixed: 'Normally open.', src: 'x' } }).probeContact?.fixed).toBe('Normally open.');
    expect(() => expandSettingsFile({ ...mini(), probeContact: { token: 'prbp' } })).toThrow(/probeContact: token "prbp" is not defined/);
    expect(() => expandSettingsFile({ ...mini(), probeContact: {} })).toThrow(/probeContact: exactly one of token or fixed/);
    expect(() => expandSettingsFile({ ...mini(), probeContact: { token: 'xsn', fixed: 'x' } })).toThrow(/exactly one/);
  });

  it('a root-level schema error names the root', () => {
    const f = mini();
    delete f['groups'];
    expect(() => expandSettingsFile(f)).toThrow(/settings file: \/ missing required property "groups"/);
  });

  it('returns frozen definitions', () => {
    const f = expandSettingsFile(mini());
    expect(Object.isFrozen(f)).toBe(true);
    expect(Object.isFrozen(f.tokens.get('1mi'))).toBe(true);
    expect(Object.isFrozen(f.tokens.get('1mi')?.write?.range)).toBe(true);
  });
});

describe('settingsDefsFor', () => {
  it('returns null for g2core-edge and an unknown dialect', () => {
    expect(settingsDefsFor('g2core-edge')).toBeNull();
    expect(settingsDefsFor('nope')).toBeNull();
  });
});
