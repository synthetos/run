import { expect, it } from 'vitest';
import { settingsSchemaFor, isReadAllowed, getLineFor, planSettingsWrite } from '../src/index.ts';
import { SPINDLE_OVERRIDE_SETTINGS } from '../src/firmware45006.ts';
it('shows 450.06 spindle override values as nonpersistent read-only settings in Run', () => {
  const schema = settingsSchemaFor('tinyg-en', 450.06);
  expect(schema.schemaKey).toBe('tinyg-en@701c3876');
  for (const def of SPINDLE_OVERRIDE_SETTINGS) {
    expect(schema.settings.get(def.token)).toEqual(def);
    expect(schema.table.tokens.get(def.token)).toEqual(def);
    expect(schema.settings.get(def.token)?.overlay).toBeUndefined();
    expect(def.persist).toBe(false);
    expect(isReadAllowed('tinyg-en', def.token, 450.06)).toBe(true);
    expect(getLineFor('tinyg-en', def.token, 450.06)).toBe(`{"${def.token}":null}`);
    expect(isReadAllowed('tinyg-en', def.token, 450.05)).toBe(false);
    expect(settingsSchemaFor('tinyg-en', 450.05).settings.has(def.token)).toBe(false);
    expect(isReadAllowed('tinyg-440', def.token, 450.06)).toBe(false);
    expect(planSettingsWrite('tinyg-en', [{ key: def.token, value: 1 }], {}).ok).toBe(false);
  }
});
