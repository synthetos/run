/**
 * A new, empty machine profile (RUN_PLAN §7.2 connect flow step 3: "New
 * machine from this board"). It starts unbound, with no axes, no settings
 * draft and every host gate at its tight default; binding happens on a
 * connect, and loosening a host gate later needs C19.
 */
import { DEFAULT_HOST_GATE_VALUES } from './fieldClasses.ts';
import { toStoredProfile } from './io.ts';
import type { MachineProfileV2 } from './types.ts';

export interface NewProfileInput {
  /** A lower-case UUID (`crypto.randomUUID()` in the app). */
  readonly id: string;
  readonly name: string;
  readonly createdWith: MachineProfileV2['createdWith'];
}

/** Throws `ProfileInvalidError` for a malformed id or name. */
export function newMachineProfile(input: NewProfileInput): MachineProfileV2 {
  return toStoredProfile({
    schemaVersion: 2,
    id: input.id,
    name: input.name,
    boundDevice: null,
    board: null,
    firmware: null,
    machine: {
      type: 'router',
      axes: {},
      homingOrder: [],
      spindle: { kind: 'none', drive: 'none', activeLow: false },
      psu: null,
      estop: { kind: 'unknown', auxInput: null },
      hostLossPolicy: DEFAULT_HOST_GATE_VALUES.hostLossPolicy,
      queuedMotionCeilingS: DEFAULT_HOST_GATE_VALUES.queuedMotionCeilingS,
      jogCaps: { ...DEFAULT_HOST_GATE_VALUES.jogCaps },
      holdTimeoutS: DEFAULT_HOST_GATE_VALUES.holdTimeoutS,
    },
    settings: { draft: {}, schemaKey: null, deviceHash: null },
    wiringRef: null,
    createdWith: input.createdWith,
  });
}
