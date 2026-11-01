/**
 * Profile field classes and the host gates a profile carries (ROADMAP TB-01;
 * RUN_PLAN §7.2 "Profile field classes"; SAFETY §4.10 rule 4, T-S69).
 *
 * Every MachineProfile v2 field is a firmware setting, a host gate or
 * descriptive. `boundDevice` is the one field that is none of these: it is
 * the input to the non-overridable "bound device matches" gate, written only
 * by a connect and cleared by every import (SAFETY H33, T-S22), so it is its
 * own class, `binding`.
 *
 * Host gates are what the host's own safety checks read. A loosening is not
 * used by this browser until C19 (`@synthetos/safety` `effectiveHostGates`);
 * `hostGatesOf` hands those checks the profile's values in their shape.
 */
import type { HostGateField, HostGates } from '@synthetos/safety';
import { CEILING_SECONDS } from '@synthetos/safety';
import { HOLD_TIMEOUT_S } from './schema.ts';
import type { MachineProfileV2, ProfileMachine } from './types.ts';
import { PROFILE_AXES } from './types.ts';

export type ProfileFieldClass = 'firmwareSetting' | 'hostGate' | 'descriptive' | 'binding';

/**
 * The class of each field, by dotted path; `*` stands for any axis letter.
 * The schema test proves every leaf of `PROFILE_V2_SCHEMA` has a class,
 * every entry is used, and no entry is a prefix of another.
 */
export const PROFILE_FIELD_CLASSES: readonly (readonly [string, ProfileFieldClass])[] = Object.freeze(
  (
    [
      ['schemaVersion', 'descriptive'],
      ['id', 'descriptive'],
      ['name', 'descriptive'],
      ['boundDevice', 'binding'],
      ['board', 'descriptive'],
      ['firmware', 'descriptive'],
      ['machine.type', 'descriptive'],
      ['machine.axes.*.motors', 'hostGate'],
      ['machine.axes.*.drive', 'descriptive'],
      ['machine.axes.*.measuredTravelMm', 'descriptive'],
      ['machine.axes.*.homeEnd', 'descriptive'],
      ['machine.homingOrder', 'hostGate'],
      ['machine.spindle.kind', 'hostGate'],
      ['machine.spindle.drive', 'descriptive'],
      ['machine.spindle.activeLow', 'descriptive'],
      ['machine.psu', 'descriptive'],
      ['machine.estop', 'descriptive'],
      ['machine.hostLossPolicy', 'hostGate'],
      ['machine.queuedMotionCeilingS', 'hostGate'],
      ['machine.jogCaps', 'hostGate'],
      ['machine.holdTimeoutS', 'hostGate'],
      ['settings.draft', 'firmwareSetting'],
      ['settings.schemaKey', 'descriptive'],
      ['settings.deviceHash', 'descriptive'],
      ['wiringRef', 'descriptive'],
      ['createdWith', 'descriptive'],
    ] as const
  ).map((e) => Object.freeze(e)),
);

/** Where each host gate of `@synthetos/safety` lives in the profile. */
export const HOST_GATE_PATHS: Readonly<Record<HostGateField, string>> = Object.freeze({
  spindleKind: 'machine.spindle.kind',
  dualMotorAxes: 'machine.axes.*.motors',
  queuedMotionCeilingS: 'machine.queuedMotionCeilingS',
  jogCaps: 'machine.jogCaps',
  homingOrder: 'machine.homingOrder',
  holdTimeoutS: 'machine.holdTimeoutS',
  hostLossPolicy: 'machine.hostLossPolicy',
});

function entryMatches(entry: string, path: string): boolean {
  const e = entry.split('.');
  const p = path.split('.');
  return e.length <= p.length && e.every((seg, i) => seg === p[i] || (seg === '*' && (PROFILE_AXES as readonly string[]).includes(p[i] as string)));
}

/**
 * The class of a dotted field path (`machine.axes.x.motors`); throws for a
 * path no entry covers. No entry is a prefix of another (the schema test
 * checks it), so at most one entry matches and the order of the list does
 * not matter.
 */
export function profileFieldClass(path: string): ProfileFieldClass {
  const entry = PROFILE_FIELD_CLASSES.find(([e]) => entryMatches(e, path));
  if (entry === undefined) throw new Error(`profile field ${JSON.stringify(path)} has no class`);
  return entry[1];
}

/**
 * The host gates a new or migrated profile starts with: the tight end of
 * each (SAFETY §4.3 default ceiling, §4.4 rule 8 hold timeout on at 60 s,
 * §4.5 jog increments up to 10 mm). Loosening any of them later needs C19.
 */
export const DEFAULT_HOST_GATE_VALUES = Object.freeze({
  queuedMotionCeilingS: CEILING_SECONDS.default,
  jogCaps: Object.freeze({ maxStepMm: 10, maxFeedMmPerMin: 1000 }),
  holdTimeoutS: HOLD_TIMEOUT_S.default,
  hostLossPolicy: 'drain',
} as const satisfies Partial<ProfileMachine>);

/** The profile's host gates in the shape `@synthetos/safety` checks them. */
export function hostGatesOf(p: MachineProfileV2): HostGates {
  const m = p.machine;
  const dualMotorAxes = PROFILE_AXES.flatMap((axis) => {
    const def = m.axes[axis];
    return def !== undefined && def.motors.length > 1 ? [Object.freeze({ axis, motors: Object.freeze([...def.motors]) })] : [];
  });
  return Object.freeze({
    spindleKind: m.spindle.kind,
    dualMotorAxes: Object.freeze(dualMotorAxes),
    queuedMotionCeilingS: m.queuedMotionCeilingS,
    jogCaps: Object.freeze({ ...m.jogCaps }),
    homingOrder: Object.freeze([...m.homingOrder]),
    holdTimeoutS: m.holdTimeoutS,
    hostLossPolicy: m.hostLossPolicy,
  });
}
