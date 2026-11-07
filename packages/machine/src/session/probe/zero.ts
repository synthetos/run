/**
 * Probe Z: setting Z from a contact (SAFETY §4.5c "Setting Z", H90 mitigation 3; T-S130). Pure. The zero is
 * `G10 L20 P<n> Z<thickness − L>` in G21, which does not depend on the report's frame; never the reported position
 * and never G92. Its read-back must agree before the result calls the zero set.
 */
import type { JsonValue } from '@synthetos/protocol';
import { probeZeroLine } from '../motionLines.ts';
import type { ProbeRun } from './state.ts';
import type { ProbePlan } from './types.ts';

/** The read-back must agree with the zero within this, mm (§4.5c). */
export const ZERO_TOLERANCE_MM = 0.002;

/** What is read back after the EEPROM wait: work position, work offset, active system. */
export const READBACK_TOKENS: readonly string[] = Object.freeze(['pos', 'ofs', 'coor']);

export function zeroLine(system: number, plan: ProbePlan): string {
  return probeZeroLine(system, plan.zeroZ);
}

function zOf(value: JsonValue | undefined): number | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const z = (value as Readonly<Record<string, JsonValue>>)['z'];
  return typeof z === 'number' && Number.isFinite(z) ? z : undefined;
}

/** One answered read-back (status 0), added to what the run holds. */
export function takeReadback(readback: ProbeRun['readback'], token: string, value: JsonValue | undefined): ProbeRun['readback'] {
  if (token === 'pos') {
    const z = zOf(value);
    return z === undefined ? readback : { ...readback, posZ: z };
  }
  if (token === 'ofs') {
    const z = zOf(value);
    return z === undefined ? readback : { ...readback, ofsZ: z };
  }
  return typeof value === 'number' ? { ...readback, coor: value } : readback;
}

/** The zero is confirmed: the system is the one written, Z reads the zero within the tolerance, and an offset came back. */
export function zeroConfirmed(readback: ProbeRun['readback'], system: number, plan: ProbePlan): boolean {
  return readback.coor === system && readback.ofsZ !== undefined && readback.posZ !== undefined && Math.abs(readback.posZ - plan.zeroZ) <= ZERO_TOLERANCE_MM;
}
