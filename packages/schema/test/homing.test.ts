/** Which axes can be homed, from the board's settings (amendment 2026-11-02, SAFETY H65). */
import { describe, expect, it } from 'vitest';
import { HOMING_AXES, homingAxes, homingAxis } from '../src/index.ts';

const axis = (patch: Record<string, number>) => ({ xam: 1, xsn: 0, xsx: 0, xsv: 500, xtn: 0, xtm: 100, xlb: 2, ...patch });

describe('homingAxis', () => {
  it('configured with exactly one homing switch, a search velocity and an enabled axis', () => {
    expect(homingAxis(axis({ xsn: 1 }), 'x')).toEqual({ configured: true, reason: null, end: 'min', searchMm: 102 });
    expect(homingAxis(axis({ xsx: 3 }), 'x')).toEqual({ configured: true, reason: null, end: 'max', searchMm: 102 });
    const { xtm: _tm, ...noTravel } = axis({ xsn: 1 });
    expect(homingAxis(noTravel, 'x').searchMm).toBeNull();
    const { xlb: _lb, ...noBackoff } = axis({ xsn: 1 });
    expect(homingAxis(noBackoff, 'x').searchMm).toBe(100);
  });

  it('says why not', () => {
    expect(homingAxis({}, 'x').reason).toBe('its switch and homing settings were not read');
    expect(homingAxis(axis({ xam: 0, xsn: 1 }), 'x').reason).toBe('the axis is disabled');
    expect(homingAxis(axis({ xsn: 1, xsx: 3 }), 'x').reason).toBe('both of its switches are set for homing');
    expect(homingAxis(axis({ xsn: 2, xsx: 4 }), 'x').reason).toBe('no switch is set for homing');
    expect(homingAxis(axis({ xsn: 1, xsv: 0 }), 'x').reason).toBe('its homing search velocity is 0');
    expect(homingAxis({ ...axis({ xsn: 1 }), xsv: Number.NaN }, 'x').configured).toBe(false);
  });

  it('every axis at once', () => {
    expect(HOMING_AXES).toEqual(['x', 'y', 'z', 'a']);
    const all = homingAxes({ ...axis({ xsn: 1 }) });
    expect(all.x.configured).toBe(true);
    expect([all.y.configured, all.z.configured, all.a.configured]).toEqual([false, false, false]);
  });
});
