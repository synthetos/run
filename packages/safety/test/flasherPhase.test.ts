/** Production and staging use the same machine abilities after the port grant. */
import { describe, expect, it } from 'vitest';
import { CURRENT_RELEASE, FLASHER, PHASE_1_RELEASE, PHASE_2_RELEASE, allowed, flasherEnabled, withFlasher } from '../src/index.ts';

describe('the flasher phase switch', () => {
  it('is on for staging (and the localhost bench, which is staging) and on for production after the Connect grant', () => {
    expect(FLASHER).toEqual({ staging: true, production: true });
    expect(Object.isFrozen(FLASHER)).toBe(true);
  });

  it('fails closed for no environment or anything unknown', () => {
    expect(flasherEnabled('staging')).toBe(true);
    expect(flasherEnabled('production')).toBe(true);
    for (const env of [null, undefined, 'bench', 'Staging', '', 'toString'] as unknown[]) expect(flasherEnabled(env as never)).toBe(false);
  });

  it('adds the flash kind only where enabled and only to a release that opens ports', () => {
    expect(withFlasher(PHASE_1_RELEASE, 'staging')).toMatchObject({ flash: true, name: 'Phase 1 + flasher' });
    expect(Object.isFrozen(withFlasher(PHASE_2_RELEASE, 'staging'))).toBe(true);
    expect(withFlasher(PHASE_2_RELEASE, 'production')).toMatchObject({ flash: true });
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
