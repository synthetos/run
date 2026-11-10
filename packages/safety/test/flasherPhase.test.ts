/**
 * The flasher phase switch is pinned (owner 2026-11-03; SAFETY §4.8 as amended, T-S124): the firmware update
 * runs on the bench and staging builds only, and production stays off until the owner changes this test and the
 * switch together.
 */
import { describe, expect, it } from 'vitest';
import { CURRENT_RELEASE, FLASHER, PHASE_1_RELEASE, PHASE_2_RELEASE, allowed, flasherEnabled, withFlasher } from '../src/index.ts';

describe('the flasher phase switch', () => {
  it('is on for staging (and the localhost bench, which is staging) and off for production', () => {
    expect(FLASHER).toEqual({ staging: true, production: false });
    expect(Object.isFrozen(FLASHER)).toBe(true);
  });

  it('fails closed for no environment or anything unknown', () => {
    expect(flasherEnabled('staging')).toBe(true);
    expect(flasherEnabled('production')).toBe(false);
    for (const env of [null, undefined, 'bench', 'Staging', '', 'toString'] as unknown[]) expect(flasherEnabled(env as never)).toBe(false);
  });

  it('adds the flash kind only where enabled and only to a release that opens ports', () => {
    expect(withFlasher(PHASE_1_RELEASE, 'staging')).toMatchObject({ flash: true, name: 'Phase 1 + flasher' });
    expect(Object.isFrozen(withFlasher(PHASE_2_RELEASE, 'staging'))).toBe(true);
    expect(withFlasher(PHASE_2_RELEASE, 'production')).toBe(PHASE_2_RELEASE);
    expect(withFlasher(PHASE_2_RELEASE, null)).toBe(PHASE_2_RELEASE);
    expect(withFlasher(CURRENT_RELEASE, 'staging')).toBe(CURRENT_RELEASE);
  });

  it('without the switch the flash intent is denied in every state', () => {
    const snap = { base: 'IDLE_HOMED' as const, overlays: [], classified: true, enqCapable: true };
    expect(allowed(snap, 'flash', PHASE_2_RELEASE).allowed).toBe(false);
    expect(allowed(snap, 'flash', withFlasher(PHASE_2_RELEASE, 'staging')).allowed).toBe(true);
  });
});

describe('flasherEnabled: only the two named environments', () => {
  it('fails closed for an unknown name even when Object.prototype carries it as true (the switch is never read for it)', () => {
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto['bench'] = true;
    try {
      expect(flasherEnabled('bench' as never)).toBe(false);
    } finally {
      delete proto['bench'];
    }
  });
});
