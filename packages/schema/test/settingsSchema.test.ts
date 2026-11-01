/**
 * Per-dialect settings schemas generated from the vendored tables plus the
 * overlay (ROADMAP P0-09; RUN_PLAN §7.2).
 */
import { describe, expect, it } from 'vitest';
import { D440, DEN, SETTINGS_SCHEMAS, TINYG_EN_OVERLAY, buildSettingsSchema, settingsSchemaFor } from '../src/index.ts';
import type { OverlayEntry } from '../src/index.ts';

describe('SETTINGS_SCHEMAS', () => {
  it('has every token of each vendored table, with group, type, persist flag and accessors', () => {
    for (const schema of Object.values(SETTINGS_SCHEMAS)) {
      expect(schema.settings.size).toBe(schema.table.tokens.size);
      for (const [token, def] of schema.table.tokens) expect(schema.settings.get(token)).toMatchObject(def);
    }
    expect(SETTINGS_SCHEMAS['tinyg-en'].settings.get('xtn')).toMatchObject({ group: 'x', type: 'float', persist: true, setter: 'set_flu' });
    expect(SETTINGS_SCHEMAS['tinyg-en'].settings.get('os')).toMatchObject({ group: 'sys', persist: false });
  });

  it('only edge-next carries the overlay; 440 keys are unreviewed; stock 449 is read-only', () => {
    const en = SETTINGS_SCHEMAS['tinyg-en'];
    expect([...en.settings.values()].filter((d) => d.overlay !== undefined).length).toBe(TINYG_EN_OVERLAY.length);
    expect(en.settings.get('xvm')?.overlay?.label).toBe('X maximum velocity');
    expect(en.settings.get('stat')?.overlay).toBeUndefined();
    expect([...SETTINGS_SCHEMAS['tinyg-440'].settings.values()].some((d) => d.overlay !== undefined)).toBe(false);
    expect(en.mode).toBe('writable');
    expect(SETTINGS_SCHEMAS['tinyg-440'].mode).toBe('writable');
    expect(SETTINGS_SCHEMAS['tinyg-449-stock'].mode).toBe('readOnly');
  });

  it('the schema key names the dialect and the firmware commit (MachineProfile settings.schemaKey)', () => {
    expect(SETTINGS_SCHEMAS['tinyg-en'].schemaKey).toBe('tinyg-en@ead63997');
    expect(SETTINGS_SCHEMAS['tinyg-440'].schemaKey).toBe('tinyg-440@d0418390');
    expect(SETTINGS_SCHEMAS['tinyg-449-stock'].schemaKey).toBe('tinyg-449-stock@c5024186');
  });

  it('settingsSchemaFor returns a schema, and throws for a dialect without a table', () => {
    expect(settingsSchemaFor('tinyg-en')).toBe(SETTINGS_SCHEMAS['tinyg-en']);
    expect(() => settingsSchemaFor('g2core-edge')).toThrow(/no settings schema/);
    expect(() => settingsSchemaFor('hasOwnProperty')).toThrow(/no settings schema/);
  });

  it('is frozen', () => {
    const en = SETTINGS_SCHEMAS['tinyg-en'];
    expect(Object.isFrozen(SETTINGS_SCHEMAS) && Object.isFrozen(en) && Object.isFrozen(en.settings.get('xvm'))).toBe(true);
    expect('set' in en.settings).toBe(false);
  });
});

describe('buildSettingsSchema refuses an overlay that could reach an unreviewed write', () => {
  const xvm = TINYG_EN_OVERLAY.find((o) => o.key === 'xvm') as OverlayEntry;

  it('an entry listed twice', () => {
    expect(() => buildSettingsSchema(DEN, 'writable', [xvm, xvm])).toThrow(/xvm: listed twice/);
  });

  it('a key the table does not have', () => {
    expect(() => buildSettingsSchema(DEN, 'writable', [{ ...xvm, key: 'xyzzy' }])).toThrow(/xyzzy: not in the den table/);
    expect(() => buildSettingsSchema(D440, 'writable', [{ ...xvm, key: 'spep' }])).toThrow(/spep: not in the d440 table/);
  });

  it('a key whose setter does not store a value', () => {
    expect(() => buildSettingsSchema(DEN, 'writable', [{ ...xvm, key: 'stat' }])).toThrow(/stat: setter set_nul does not store a value/);
    expect(() => buildSettingsSchema(DEN, 'writable', [{ ...xvm, key: 'home' }])).toThrow(/home: setter cm_run_home does not store a value/);
  });

  it('a forbidden write', () => {
    expect(() => buildSettingsSchema(DEN, 'writable', [{ ...xvm, key: 'hv' }])).toThrow(/hv: the key is a forbidden write/);
    expect(() => buildSettingsSchema(DEN, 'writable', [{ ...xvm, key: 'js' }])).toThrow(/js: the key is a forbidden write/);
  });
});
