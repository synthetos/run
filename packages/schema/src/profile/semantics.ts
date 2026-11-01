/**
 * Cross-field rules a JSON Schema cannot state (ROADMAP TB-01; RUN_PLAN
 * §7.2). They run after `PROFILE_V2_SCHEMA` has accepted the shape, so the
 * value is a well-typed `MachineProfileV2` here.
 *
 * Controller-specific limits (TinyG's four motors and `drain`-only host-loss
 * policy) are keyed by the dialect or bound family, never built into the
 * shared shape.
 */
import type { SchemaError } from '../jsonSchema.ts';
import type { ControllerFamily, Drive, DriveKind, MachineProfileV2, ProfileAxis } from './types.ts';
import { PROFILE_AXES } from './types.ts';

/** Which drive numbers each kind needs; any other number is refused. */
const DRIVE_FIELDS: Readonly<Record<DriveKind, readonly (keyof Omit<Drive, 'kind'>)[]>> = Object.freeze({
  screw: ['pitchMm', 'starts'],
  belt: ['pitchMm', 'teeth'],
  rack: ['pitchMm', 'teeth'],
  rotary: ['ratio'],
  unknown: [],
});
const ALL_DRIVE_FIELDS = ['pitchMm', 'starts', 'teeth', 'ratio'] as const;

/** Motors per family (TinyG v8 has four drivers; g2core boards up to six). */
export const MOTORS_PER_FAMILY: Readonly<Record<ControllerFamily, number>> = Object.freeze({ tinyg: 4, g2core: 6 });

/** The controller family a dialect id belongs to. */
export function familyOfDialect(dialectId: string): ControllerFamily {
  return dialectId.startsWith('g2core') ? 'g2core' : 'tinyg';
}

/** Every cross-field problem of a schema-valid v2 profile (empty when consistent). */
export function profileSemanticIssues(p: MachineProfileV2): SchemaError[] {
  const issues: SchemaError[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const m = p.machine;

  // Which family the profile is for: the bound board wins, then the firmware.
  const family: ControllerFamily | null =
    p.boundDevice !== null ? p.boundDevice.family : p.firmware !== null ? familyOfDialect(p.firmware.dialectId) : null;

  if (p.boundDevice !== null && familyOfDialect(p.boundDevice.dialectId) !== p.boundDevice.family) {
    add('/boundDevice/dialectId', `dialect ${p.boundDevice.dialectId} is not a ${p.boundDevice.family} dialect`);
  }
  if (p.boundDevice !== null && p.firmware !== null && familyOfDialect(p.firmware.dialectId) !== p.boundDevice.family) {
    add('/firmware/dialectId', `firmware dialect ${p.firmware.dialectId} does not belong to the bound ${p.boundDevice.family} board`);
  }

  const motorOwner = new Map<number, ProfileAxis>();
  for (const axis of PROFILE_AXES) {
    const def = m.axes[axis];
    if (def === undefined) continue;
    const at = `/machine/axes/${axis}`;
    for (const motor of def.motors) {
      const owner = motorOwner.get(motor);
      if (owner !== undefined) add(`${at}/motors`, `motor ${motor} already drives axis ${owner}`);
      else motorOwner.set(motor, axis);
      if (family !== null && motor > MOTORS_PER_FAMILY[family]) add(`${at}/motors`, `motor ${motor} does not exist on a ${family} board`);
    }
    const needed = DRIVE_FIELDS[def.drive.kind];
    for (const field of ALL_DRIVE_FIELDS) {
      const present = def.drive[field] !== undefined;
      if (needed.includes(field) && !present) add(`${at}/drive`, `a ${def.drive.kind} drive needs ${field}`);
      if (!needed.includes(field) && present) add(`${at}/drive/${field}`, `a ${def.drive.kind} drive has no ${field}`);
    }
  }

  for (const [i, axis] of m.homingOrder.entries()) {
    const def = m.axes[axis];
    if (def === undefined) add(`/machine/homingOrder/${i}`, `axis ${axis} is not defined`);
    else if (def.homeEnd === 'none') add(`/machine/homingOrder/${i}`, `axis ${axis} has no home switch end`);
  }

  if ((m.spindle.kind === 'none') !== (m.spindle.drive === 'none')) {
    add('/machine/spindle', 'spindle kind "none" and drive "none" go together');
  }

  // TinyG pauses nothing on host loss: only `drain` is honest (ROADMAP TB-04; PN capability spindlePauseOnHold).
  if (family === 'tinyg' && m.hostLossPolicy !== 'drain') {
    add('/machine/hostLossPolicy', 'TinyG supports only the "drain" host-loss policy');
  }

  if (p.settings.schemaKey !== null && p.firmware !== null && !p.settings.schemaKey.startsWith(`${p.firmware.dialectId}@`)) {
    add('/settings/schemaKey', `the settings draft was made for ${p.settings.schemaKey}, not for ${p.firmware.dialectId}`);
  }
  return issues;
}
