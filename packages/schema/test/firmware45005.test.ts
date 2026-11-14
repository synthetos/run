import { expect, it } from 'vitest';
import { settingsSchemaFor, isReadAllowed, getLineFor, readDecisionFor, restoreChanges, planSettingsWrite } from '../src/index.ts';
import { REMOVED_HOLD_KEYS, REMOVED_HOLD_REASON, OVERRIDE_SETTINGS } from '../src/firmware45005.ts';
it('450.05 removes pause keys, adds pure override reads, and permits no override writes', () => {
  expect(settingsSchemaFor('tinyg-en', 450.05).table.members('sys')).not.toContain('spph');
  expect(settingsSchemaFor('tinyg-en', 450.05).table.members('unknown')).toEqual([]);
  for (const key of REMOVED_HOLD_KEYS) {
    expect(settingsSchemaFor('tinyg-en', 450.04).settings.has(key)).toBe(true);
    expect(settingsSchemaFor('tinyg-en', 450.05).settings.has(key)).toBe(false);
    expect(isReadAllowed('tinyg-en', key, 450.04)).toBe(true);
    expect(isReadAllowed('tinyg-en', key, 450.05)).toBe(false);
    expect(() => getLineFor('tinyg-en', key, 450.05)).toThrow();
  }
  for (const def of OVERRIDE_SETTINGS) {
    expect(settingsSchemaFor('tinyg-en', 450.05).settings.get(def.token)).toEqual(def);
    expect(isReadAllowed('tinyg-en', def.token, 450.04)).toBe(false);
    expect(readDecisionFor('tinyg-en', def.token, 450.05)).toEqual({ allowed: true });
    expect(getLineFor('tinyg-en', def.token, 450.05)).toBe(`{"${def.token}":null}`);
    expect(planSettingsWrite('tinyg-en', [{ key: def.token, value: 1 }], {}).ok).toBe(false);
  }
  expect(settingsSchemaFor('tinyg-440', 450.05).settings.has('mfo')).toBe(false);
});
it('old backups explicitly explain removed hold settings without dropping valid settings', () => {
  const tokens = { spph: 1, spde: 3, coph: 1, xvm: 1000 };
  const mapped = restoreChanges('tinyg-en', tokens, { xvm: 900 }, 450.05);
  expect(mapped.changes).toEqual([{ key: 'xvm', value: 1000 }]);
  expect(mapped.skipped).toHaveLength(3);
  expect(mapped.skipped.every(s => s.reason === REMOVED_HOLD_REASON)).toBe(true);
  expect(restoreChanges('tinyg-en', tokens, {}, 450.04).skipped.some(s => s.reason === REMOVED_HOLD_REASON)).toBe(false);
  expect(restoreChanges('tinyg-440', tokens, {}, 450.05).skipped.some(s => s.reason === REMOVED_HOLD_REASON)).toBe(false);
});
