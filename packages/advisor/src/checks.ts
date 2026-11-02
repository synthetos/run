/**
 * The envelope checks of a plan (MACHINING_ASSISTANT §5.2.4). Each returns a
 * structured reason: a stable code, a plain message with the numbers, and
 * the numbers themselves, so a view can show them and a test can read them.
 *
 * - **spindle-power:** `P = ap·ae·vf·kc / 60e6` kW against the rated power.
 * - **axis-max:** the feed against the axis maximum.
 * - **frame-ap / frame-ae:** depth and stepover against the material's
 *   limits for the machine's frame class (multiples of the diameter).
 * - **deflection:** the tool as a cantilever of its effective diameter over
 *   the stickout, loaded by the mean tangential cutting force; flagged above
 *   about 0.02 mm finishing and 0.05 mm roughing.
 * - **rubbing:** a chipload below about 35 % of the target.
 * - **coolant:** a material that needs coolant, with none available.
 * - **spindle-range:** a programmed speed the spindle or tool cannot run.
 */
import type { Coolant, CoolantNeed, EngagementLimit } from '@synthetos/library';
import { THRESHOLDS } from './model.ts';

export type CheckKind = 'spindle-power' | 'axis-max' | 'frame-ap' | 'frame-ae' | 'deflection' | 'rubbing' | 'coolant' | 'spindle-range';
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export interface CheckReason {
  readonly code: string;
  readonly message: string;
  readonly values: Readonly<Record<string, number>>;
}

export interface Check {
  readonly kind: CheckKind;
  readonly status: CheckStatus;
  readonly reason: CheckReason;
}

function check(kind: CheckKind, status: CheckStatus, code: string, message: string, values: Record<string, number> = {}): Check {
  return Object.freeze({ kind, status, reason: Object.freeze({ code, message, values: Object.freeze(values) }) });
}

const n2 = (v: number): string => v.toFixed(2);
const n3 = (v: number): string => v.toFixed(3);
const int = (v: number): string => Math.round(v).toString();

/** Cutting power, kW: `ap·ae·vf·kc / 60e6` (mm, mm, mm/min, N/mm²). */
export function cuttingPowerKw(ap: number, ae: number, vf: number, kc: number): number {
  return (ap * ae * vf * kc) / 60e6;
}

/** Mean tangential cutting force, N: cutting power over cutting speed, `ap·ae·vf·kc / (π·D·n)`. */
export function cuttingForceN(ap: number, ae: number, vf: number, kc: number, diameter: number, rpm: number): number {
  return (ap * ae * vf * kc) / (Math.PI * diameter * rpm);
}

/** Cantilever tip deflection, mm: `F·L³ / (3·E·I)` with `I = π·De⁴ / 64` and E in GPa. */
export function toolDeflectionMm(forceN: number, stickout: number, effectiveDiameter: number, youngsModulusGPa: number): number {
  const inertia = (Math.PI * effectiveDiameter ** 4) / 64;
  return (forceN * stickout ** 3) / (3 * youngsModulusGPa * 1000 * inertia);
}

export function checkPower(i: { readonly ap: number; readonly ae: number; readonly vf: number; readonly kc: number | undefined; readonly powerKw: number }): Check {
  if (i.kc === undefined) return check('spindle-power', 'unknown', 'no-kc', 'The material has no specific cutting force, so the power needed is unknown.');
  const kw = cuttingPowerKw(i.ap, i.ae, i.vf, i.kc);
  const values = { kw, ratedKw: i.powerKw };
  if (kw > i.powerKw) return check('spindle-power', 'fail', 'over-power', `Needs about ${n2(kw)} kW; the spindle is rated ${n2(i.powerKw)} kW.`, values);
  if (kw > THRESHOLDS.powerWarnFraction * i.powerKw) {
    return check('spindle-power', 'warn', 'near-power', `Needs about ${n2(kw)} kW, close to the spindle's ${n2(i.powerKw)} kW.`, values);
  }
  return check('spindle-power', 'ok', 'power-ok', `Needs about ${n2(kw)} kW of ${n2(i.powerKw)} kW.`, values);
}

export function checkAxisMax(feed: number, maxFeed: number): Check {
  const values = { feed, maxFeed };
  if (feed > maxFeed) return check('axis-max', 'fail', 'over-axis-max', `${int(feed)} mm/min is above the axis maximum of ${int(maxFeed)} mm/min.`, values);
  return check('axis-max', 'ok', 'axis-ok', `${int(feed)} mm/min is within the axis maximum of ${int(maxFeed)} mm/min.`, values);
}

export function checkFrameLimits(ap: number, ae: number, diameter: number, limit: EngagementLimit): readonly [Check, Check] {
  const apMax = limit.ap * diameter;
  const aeMax = limit.ae * diameter;
  const apCheck =
    ap > apMax
      ? check('frame-ap', 'fail', 'ap-over', `${n2(ap)} mm deep is more than this frame class takes (${n2(apMax)} mm).`, { ap, apMax })
      : check('frame-ap', 'ok', 'ap-ok', `${n2(ap)} mm deep is within ${n2(apMax)} mm.`, { ap, apMax });
  const aeCheck =
    ae > aeMax
      ? check('frame-ae', 'fail', 'ae-over', `A ${n2(ae)} mm stepover is more than this frame class takes (${n2(aeMax)} mm).`, { ae, aeMax })
      : check('frame-ae', 'ok', 'ae-ok', `A ${n2(ae)} mm stepover is within ${n2(aeMax)} mm.`, { ae, aeMax });
  return [apCheck, aeCheck];
}

export function checkDeflection(deflectionMm: number | null, finishing: boolean): Check {
  if (deflectionMm === null) return check('deflection', 'unknown', 'no-deflection', 'Deflection is unknown: the stickout or the cutting force is missing.');
  const limitMm = finishing ? THRESHOLDS.deflectionFinishMm : THRESHOLDS.deflectionRoughMm;
  const values = { deflectionMm, limitMm };
  if (deflectionMm > limitMm) {
    return check('deflection', 'fail', 'over-deflection', `The tool deflects about ${n3(deflectionMm)} mm, above ${n3(limitMm)} mm for ${finishing ? 'finishing' : 'roughing'}.`, values);
  }
  return check('deflection', 'ok', 'deflection-ok', `The tool deflects about ${n3(deflectionMm)} mm.`, values);
}

export function checkRubbing(fz: number, targetFz: number): Check {
  const floor = THRESHOLDS.rubbingFloorFraction * targetFz;
  const values = { fz, targetFz, floor };
  if (fz < floor) {
    return check('rubbing', 'fail', 'rubbing', `Rubbing: ${n3(fz)} mm chipload is below the ${n3(floor)} mm floor (target ${n3(targetFz)} mm).`, values);
  }
  return check('rubbing', 'ok', 'chip-ok', `${n3(fz)} mm chipload is above the ${n3(floor)} mm floor.`, values);
}

export function checkCoolant(need: CoolantNeed, reason: string, available: Coolant): Check {
  const why = reason === '' ? '' : ` ${reason}`;
  if (need === 'required' && available === 'none') return check('coolant', 'fail', 'coolant-required', `This material needs coolant or air.${why}`);
  if (need === 'recommended' && available === 'none') return check('coolant', 'warn', 'coolant-recommended', `Coolant or air is recommended.${why}`);
  if (need === 'avoid' && (available === 'mist' || available === 'flood')) return check('coolant', 'warn', 'coolant-avoid', `Avoid ${available} with this material.${why}`);
  return check('coolant', 'ok', 'coolant-ok', 'Coolant suits the material.');
}

export function checkSpindleRange(rpm: number, minRpm: number, maxRpm: number, toolMaxRpm: number | undefined): Check {
  const values: Record<string, number> = { rpm, minRpm, maxRpm };
  if (toolMaxRpm !== undefined) values['toolMaxRpm'] = toolMaxRpm;
  if (toolMaxRpm !== undefined && rpm > toolMaxRpm) return check('spindle-range', 'fail', 'over-tool-max', `${int(rpm)} rpm is above the tool's maximum of ${int(toolMaxRpm)} rpm.`, values);
  if (rpm > maxRpm) return check('spindle-range', 'fail', 'over-spindle-max', `${int(rpm)} rpm is above the spindle's maximum of ${int(maxRpm)} rpm.`, values);
  if (rpm < minRpm) return check('spindle-range', 'warn', 'under-spindle-min', `${int(rpm)} rpm is below the spindle's minimum of ${int(minRpm)} rpm.`, values);
  return check('spindle-range', 'ok', 'spindle-ok', `${int(rpm)} rpm is within the spindle's range.`, values);
}
