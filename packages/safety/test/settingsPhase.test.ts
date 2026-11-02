/**
 * The settings-write phase switch is pinned (SAFETY §4.6, amendment 2026-11-02):
 * production stays read-only until the owner changes this test and the switch
 * together, in a reviewed change.
 */
import { describe, expect, it } from 'vitest';
import { PHASE_1_RELEASE, PHASE_1_SETTINGS_RELEASE, PHASE_2_RELEASE, SETTINGS_WRITES, allowed, settingsWritesEnabled, withSettingsWrites } from '../src/index.ts';

describe('the settings-write phase switch', () => {
  it('is on for staging (and the localhost bench, which is staging) and off for production', () => {
    expect(SETTINGS_WRITES).toEqual({ staging: true, production: false });
    expect(Object.isFrozen(SETTINGS_WRITES)).toBe(true);
  });

  it('fails closed for no environment or anything unknown', () => {
    expect(settingsWritesEnabled('staging')).toBe(true);
    expect(settingsWritesEnabled('production')).toBe(false);
    for (const env of [null, undefined, 'bench', 'Staging', '', 'toString', '__proto__'] as unknown[]) expect(settingsWritesEnabled(env as never)).toBe(false);
  });

  it('composes with the base release: settings on only where enabled, the base unchanged otherwise', () => {
    expect(withSettingsWrites(PHASE_2_RELEASE, 'staging')).toMatchObject({ motion: true, write: false, port: true, settings: true, name: 'Phase 2 + settings writes' });
    expect(withSettingsWrites(PHASE_1_RELEASE, 'staging')).toMatchObject({ motion: false, settings: true });
    expect(Object.isFrozen(withSettingsWrites(PHASE_2_RELEASE, 'staging'))).toBe(true);
    expect(withSettingsWrites(PHASE_1_RELEASE, 'production')).toBe(PHASE_1_RELEASE);
    expect(withSettingsWrites(PHASE_2_RELEASE, null)).toBe(PHASE_2_RELEASE);
    expect(PHASE_1_SETTINGS_RELEASE).toMatchObject({ motion: false, write: false, port: true, settings: true });
    expect(PHASE_1_RELEASE.settings).toBeUndefined();
  });

  it('settingsWrite is allowed by the matrix only with the settings release, idle-class base, and no overlay but NEEDS_REVIEW', () => {
    const snap = (base: 'CONNECTED_UNKNOWN' | 'IDLE_HOMED' | 'READING', overlays: never[] | ('READ_ONLY' | 'NEEDS_REVIEW' | 'UNKNOWN' | 'ORPHANED_MOTION' | 'FAULT' | 'STALE')[] = []) => ({ base, overlays, classified: true, enqCapable: true });
    expect(allowed(snap('CONNECTED_UNKNOWN'), 'settingsWrite', PHASE_1_RELEASE).allowed).toBe(false);
    expect(allowed(snap('CONNECTED_UNKNOWN'), 'settingsWrite', { ...PHASE_1_RELEASE, write: true }).allowed).toBe(false);
    expect(allowed(snap('CONNECTED_UNKNOWN'), 'settingsWrite', PHASE_1_SETTINGS_RELEASE).allowed).toBe(true);
    expect(allowed(snap('IDLE_HOMED'), 'settingsWrite', PHASE_1_SETTINGS_RELEASE).allowed).toBe(true);
    expect(allowed(snap('READING'), 'settingsWrite', PHASE_1_SETTINGS_RELEASE).allowed).toBe(false);
    expect(allowed(snap('CONNECTED_UNKNOWN', ['NEEDS_REVIEW']), 'settingsWrite', PHASE_1_SETTINGS_RELEASE).allowed).toBe(true);
    for (const o of ['READ_ONLY', 'UNKNOWN', 'ORPHANED_MOTION', 'FAULT', 'STALE'] as const) {
      expect(allowed(snap('CONNECTED_UNKNOWN', [o]), 'settingsWrite', PHASE_1_SETTINGS_RELEASE).allowed, o).toBe(false);
    }
    // The settings release turns on nothing else.
    for (const intent of ['jog', 'home', 'setWorkZero', 'resetController', 'flash', 'applyProfile', 'optionalStop', 'start'] as const) {
      expect(allowed(snap('IDLE_HOMED'), intent, PHASE_1_SETTINGS_RELEASE).allowed, intent).toBe(false);
    }
  });
});
