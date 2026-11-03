/**
 * Which axes can be homed, from the board's settings (amendment 2026-11-02, SAFETY H65).
 *
 * An axis is configured for homing (G28.2) when exactly one of its switches (`<a>sn` min, `<a>sx` max) has the
 * homing bit (mode 1 homing, or 3 limit and homing; EN switch.h:40-45), its search velocity `<a>sv` is above 0,
 * and its axis mode `<a>am` is not 0 (disabled). Homing a switch on both ends is refused by the firmware (EN
 * cycle_homing.c:265, status 246). The switch end decides the direction: min homes towards `tn`, max towards
 * `tm`. The search distance is `|tm − tn| + lb` (C4).
 *
 * Pure. It sees settings, never the wiring: a switch configured but wired wrong still fails at the machine
 * (H65), which is why homing needs its confirmation and a hand on the E-stop.
 */
export type HomingAxis = 'x' | 'y' | 'z' | 'a';

export interface HomingAxisConfig {
  readonly configured: boolean;
  /** Plain words why not, when not configured. */
  readonly reason: string | null;
  /** `min` or `max`: the switch homing moves towards. */
  readonly end: 'min' | 'max' | null;
  /** `|tm − tn| + lb`, mm, when known. */
  readonly searchMm: number | null;
}

export const HOMING_AXES: readonly HomingAxis[] = Object.freeze(['x', 'y', 'z', 'a']);

function n(settings: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const v = settings[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const homing = (mode: number | undefined): boolean => mode !== undefined && (mode & 1) === 1 && mode !== 4 && mode >= 0 && mode <= 3;

export function homingAxis(settings: Readonly<Record<string, unknown>>, a: HomingAxis): HomingAxisConfig {
  const sn = n(settings, `${a}sn`);
  const sx = n(settings, `${a}sx`);
  const sv = n(settings, `${a}sv`);
  const am = n(settings, `${a}am`);
  const no = (reason: string): HomingAxisConfig => ({ configured: false, reason, end: null, searchMm: null });
  if (sn === undefined || sx === undefined || sv === undefined || am === undefined) return no('its switch and homing settings were not read');
  if (am === 0) return no('the axis is disabled');
  if (homing(sn) && homing(sx)) return no('both of its switches are set for homing');
  if (!homing(sn) && !homing(sx)) return no('no switch is set for homing');
  if (!(sv > 0)) return no('its homing search velocity is 0');
  const tn = n(settings, `${a}tn`);
  const tm = n(settings, `${a}tm`);
  const lb = n(settings, `${a}lb`);
  const searchMm = tn !== undefined && tm !== undefined ? Math.abs(tm - tn) + (lb ?? 0) : null;
  return { configured: true, reason: null, end: homing(sn) ? 'min' : 'max', searchMm };
}

/** Every axis's homing configuration. */
export function homingAxes(settings: Readonly<Record<string, unknown>>): Readonly<Record<HomingAxis, HomingAxisConfig>> {
  return { x: homingAxis(settings, 'x'), y: homingAxis(settings, 'y'), z: homingAxis(settings, 'z'), a: homingAxis(settings, 'a') };
}
