/**
 * Forbidden writes (ROADMAP P0-09; PN §12.4; SAFETY §4.6, H24).
 */
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_WRITES, forbiddenWriteReason, isForbiddenKey, isWriteForbidden } from '../src/index.ts';
import type { TinyGDialectId } from '../src/index.ts';

const IDS = Object.keys(FORBIDDEN_WRITES) as TinyGDialectId[];
const SE = Array.from({ length: 30 }, (_, i) => `se${String(i).padStart(2, '0')}`);
/** PN §12.4: forbidden outright on both TinyG dialects. */
const ALWAYS = ['hv', 'baud', 'ex', 'ej', 'defa', 'boot', 'test', 'rx', 'jog', 'jogx', 'jogy', 'jogz', 'joga', ...SE];
const EVERY_CONTEXT = [{}, { commissioning: true }, { consentedNormalisation: true }, { commissioning: true, consentedNormalisation: true }];

describe('PN §12.4 on every TinyG dialect', () => {
  it.each(IDS)('%s: the unconditional keys are forbidden in every context and for every value', (id) => {
    for (const key of ALWAYS) {
      for (const ctx of EVERY_CONTEXT) {
        for (const value of [0, 1, 8, -1, 'x', null]) expect(isWriteForbidden(id, key, value, ctx), `${key}=${String(value)}`).toBe(true);
      }
    }
  });

  it('rxm is forbidden on edge-next and stock 449, the dialects that have it', () => {
    expect(isWriteForbidden('tinyg-en', 'rxm', 1)).toBe(true);
    expect(isWriteForbidden('tinyg-449-stock', 'rxm', 0)).toBe(true);
    expect(FORBIDDEN_WRITES['tinyg-440'].tokens.has('rxm')).toBe(false);
  });

  it.each(IDS)('%s: js=0 is forbidden, js=1 is not, and a non-number js is refused (fail closed)', (id) => {
    expect(isWriteForbidden(id, 'js', 0)).toBe(true);
    expect(isWriteForbidden(id, 'js', 1)).toBe(false);
    expect(isWriteForbidden(id, 'js', '0')).toBe(true);
    expect(isWriteForbidden(id, 'js', false)).toBe(true);
  });

  it.each(IDS)('%s: me and md only in commissioning', (id) => {
    for (const key of ['me', 'md']) {
      expect(isWriteForbidden(id, key, 1)).toBe(true);
      expect(isWriteForbidden(id, key, 1, { consentedNormalisation: true })).toBe(true);
      expect(isWriteForbidden(id, key, 1, { commissioning: true })).toBe(false);
    }
  });

  it.each(IDS)('%s: fd, jv and qv only in a consented normalisation (H24)', (id) => {
    for (const key of ['fd', 'jv', 'qv']) {
      expect(isWriteForbidden(id, key, 1)).toBe(true);
      expect(isWriteForbidden(id, key, 1, { commissioning: true })).toBe(true);
      expect(isWriteForbidden(id, key, 1, { consentedNormalisation: true })).toBe(false);
    }
  });

  it('a case or whitespace variant of a forbidden key is still forbidden', () => {
    for (const key of ['HV', ' hv', 'hv ', 'Baud', 'JOGX', 'SE05', 'BOOT']) expect(isWriteForbidden('tinyg-en', key, 1), key).toBe(true);
  });

  it('ordinary settings are not forbidden', () => {
    for (const key of ['xvm', '1mi', 'st', 'spep', 'xtn', 'gun']) expect(isWriteForbidden('tinyg-en', key, 1), key).toBe(false);
    expect(forbiddenWriteReason(FORBIDDEN_WRITES['tinyg-en'], 'xvm', 1000)).toBeNull();
  });

  it('every rule carries a reason', () => {
    for (const id of IDS) {
      for (const r of [...FORBIDDEN_WRITES[id].tokens.values(), ...FORBIDDEN_WRITES[id].prefixes.values()]) expect(r.reason.length).toBeGreaterThan(10);
    }
    expect(forbiddenWriteReason(FORBIDDEN_WRITES['tinyg-en'], 'boot', 1)).toMatch(/bootloader/);
  });

  it('isForbiddenKey names a key whatever the rule condition', () => {
    for (const key of ['js', 'me', 'qv', 'hv', 'JOGZ', ' se29']) expect(isForbiddenKey(FORBIDDEN_WRITES['tinyg-en'], key), key).toBe(true);
    for (const key of ['xvm', 'sl', 'jo']) expect(isForbiddenKey(FORBIDDEN_WRITES['tinyg-en'], key), key).toBe(false);
  });

  it('the rules cannot be changed at runtime', () => {
    expect(Object.isFrozen(FORBIDDEN_WRITES)).toBe(true);
    expect(Object.isFrozen(FORBIDDEN_WRITES['tinyg-en'])).toBe(true);
    expect('delete' in FORBIDDEN_WRITES['tinyg-en'].tokens).toBe(false);
    expect(Object.isFrozen(FORBIDDEN_WRITES['tinyg-en'].tokens.get('hv'))).toBe(true);
  });
});
