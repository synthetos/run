/**
 * Go to zero's safe Z (OD-23, owner 2026-11-08: "A: no lift unless homed"; SAFETY H53, §4.5b, C25): `ztm − 1` only
 * after a homing cycle this connection saw complete; after a position set by hand, or set before this connection, Z
 * stays where it is and C25 says the top of Z travel is not known.
 */
import { c25, c25HandSet } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { goToZeroSafeZ } from '../src/workspace/safeZ.ts';
import { goToZeroPath } from '../src/workspace/motion.ts';

describe('Go to zero safe Z', () => {
  it('homed by a homing cycle this connection saw: ztm − 1, no added sentence', () => {
    expect(goToZeroSafeZ({ homed: true, positionBy: 'homing', ztm: -2, zNow: -40 })).toEqual({ safe: -3, handSet: false });
  });

  it('set by hand (G28.3): the current machine Z, with the sentence', () => {
    const z = goToZeroSafeZ({ homed: true, positionBy: 'hand', ztm: -2, zNow: -12.5 });
    expect(z).toEqual({ safe: -12.5, handSet: true });
    const text = `${c25({ axes: 'X and Y', path: goToZeroPath(['x', 'y'], z.safe, -12.5) })} ${c25HandSet()}`;
    expect(text).toBe('Go to work zero on X and Y? The machine will move: Z stays at machine -12.5 mm, then X and Y to work 0. Keep a hand on the E-stop. The machine position was set by hand, so Run does not know the top of Z travel: raise Z first if the tool is near the work or a clamp.');
  });

  it('set before this connection (homed, no note of how): the current machine Z, with the sentence', () => {
    expect(goToZeroSafeZ({ homed: true, positionBy: undefined, ztm: -2, zNow: -7 })).toEqual({ safe: -7, handSet: true });
  });

  it('not homed: the current machine Z (or 0 unread), no sentence; ztm unread after a homing: no lift either', () => {
    expect(goToZeroSafeZ({ homed: false, positionBy: undefined, ztm: -2, zNow: -7 })).toEqual({ safe: -7, handSet: false });
    expect(goToZeroSafeZ({ homed: null, positionBy: undefined, ztm: null, zNow: null })).toEqual({ safe: 0, handSet: false });
    expect(goToZeroSafeZ({ homed: true, positionBy: 'homing', ztm: null, zNow: -7 })).toEqual({ safe: -7, handSet: true });
  });
});
