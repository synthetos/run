/**
 * Reading a profile value of any known version into a validated v2 profile
 * (ROADMAP TB-01: "a v1 → v2 migration"; OLD TOOLS_PLAN §5.1).
 *
 * Version dispatch is on `schemaVersion`: 1 is migrated, 2 is validated, and
 * anything else (including a newer version from a later app) is refused
 * with a typed error. The result is always checked against
 * `PROFILE_V2_SCHEMA` and `profileSemanticIssues`; nothing a migration
 * produces is trusted unchecked.
 *
 * v1 files carried `facts`, `overrides` and confirmations. They are never
 * copied: their fact keys are reported as needs re-verify (T-S22), and the
 * dropped fields are listed so the UI can say what was not imported.
 */
import { deepFreeze } from '../frozen.ts';
import { validateSchema } from '../jsonSchema.ts';
import { canonicalProfile } from './canonical.ts';
import type { SchemaError } from '../jsonSchema.ts';
import { DEFAULT_HOST_GATE_VALUES } from './fieldClasses.ts';
import { PROFILE_V1_SCHEMA, PROFILE_V2_SCHEMA } from './schema.ts';
import { familyOfDialect, profileSemanticIssues } from './semantics.ts';
import type { BoundDevice, Drive, MachineProfileV2, ProfileAxis, ProfileAxisDef, ProfileMachine, SpindleDrive } from './types.ts';
import { PROFILE_AXES } from './types.ts';
import type { DialectId } from '@synthetos/protocol';

export type ProfileErrorCode =
  /** Larger than `PROFILE_MAX_BYTES`; refused before decoding or parsing. */
  | 'ProfileTooLarge'
  /** The bytes are not valid UTF-8. */
  | 'NotUtf8'
  /** Not JSON. */
  | 'NotJson'
  /** Nested deeper than `PROFILE_MAX_DEPTH`. */
  | 'TooDeep'
  /** JSON, but not an object. */
  | 'NotAnObject'
  /** `schemaVersion` missing, or a version this app does not read. */
  | 'UnsupportedVersion'
  /** The shape or a cross-field rule is wrong; see `issues`. */
  | 'InvalidProfile';

export interface ProfileError {
  readonly code: ProfileErrorCode;
  readonly message: string;
  readonly issues: readonly SchemaError[];
}

export interface ProfileRead {
  readonly ok: true;
  readonly profile: MachineProfileV2;
  readonly fromVersion: 1 | 2;
  /** Fact keys the input carried. None is imported; each needs re-verifying on this computer (T-S22). */
  readonly reverifyFactKeys: readonly string[];
  /** Input fields that were not carried into the profile (`facts`, `overrides`, ...). */
  readonly droppedFields: readonly string[];
  /** A v1 file's embedded wiring document, for the wiring store; v2 refers to wiring by `wiringRef`. */
  readonly legacyWiring: unknown;
  /** What the migration filled in or changed, in plain words for the import summary. */
  readonly notes: readonly string[];
}

export type ProfileResult = ProfileRead | { readonly ok: false; readonly error: ProfileError };

export function profileError(code: ProfileErrorCode, message: string, issues: readonly SchemaError[] = []): ProfileResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message, issues: Object.freeze([...issues]) }) });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate a v2 value: shape first, then the cross-field rules. */
export function v2Issues(value: unknown): SchemaError[] {
  const shape = validateSchema(PROFILE_V2_SCHEMA, value);
  return shape.length > 0 ? shape : profileSemanticIssues(value as MachineProfileV2);
}

/**
 * Reads a parsed JSON value as a profile of any known version. The returned
 * profile is validated, canonical and deep-frozen; the result keeps
 * `boundDevice` (an import clears it, `io.ts`).
 */
export function readProfileValue(value: unknown): ProfileResult {
  if (!isObject(value)) return profileError('NotAnObject', 'A machine profile is a JSON object.');
  const version = value['schemaVersion'];
  if (version === 2) {
    const issues = v2Issues(value);
    if (issues.length > 0) return profileError('InvalidProfile', 'The machine profile is not valid.', issues);
    return Object.freeze({
      ok: true,
      profile: canonicalProfile(value as unknown as MachineProfileV2),
      fromVersion: 2,
      reverifyFactKeys: Object.freeze([]),
      droppedFields: Object.freeze([]),
      legacyWiring: null,
      notes: Object.freeze([]),
    });
  }
  if (version === 1) return migrateV1(value);
  return profileError(
    'UnsupportedVersion',
    typeof version === 'number' && version > 2
      ? `This profile was made by a newer version of run (schema version ${version}). Update run to open it.`
      : 'This file has no machine profile schema version this app can read.',
  );
}

// --- v1 → v2 ------------------------------------------------------------------

/* The v1 shape, as PROFILE_V1_SCHEMA accepted it. */
interface V1Axis {
  motors: number[];
  drive?: { kind: Drive['kind']; pitch?: number; starts?: number; teeth?: number; ratio?: number };
  travelMm?: number | null;
  homeEnd?: 'min' | 'max' | 'none';
}
interface V1 {
  id: string;
  name: string;
  boundDevice?: { family: 'tinyg' | 'g2core'; id: string; fb: number } | null;
  board?: { id: string; rev?: string | null; hv?: number | null } | null;
  firmware?: { dialectId: DialectId; fv?: number; fb: number; imageSha256?: string } | null;
  machine: {
    type: ProfileMachine['type'];
    axes: Partial<Record<ProfileAxis, V1Axis>>;
    spindle: { kind: SpindleDrive; activeLow?: boolean };
    psu?: ProfileMachine['psu'];
    estop?: { kind: string; auxInput?: string | null } | null;
    hostLossPolicy?: ProfileMachine['hostLossPolicy'];
  };
  settings?: { device?: object; draft?: Record<string, number>; schemaKey?: string | null; deviceHash?: string | null };
  wiring?: unknown;
  facts?: { key: string }[];
  overrides?: unknown[];
  confirmations?: unknown[];
  createdWith?: { tool?: string; version?: string; sha?: string | null };
}

/** v1 homed Z first by convention; the migrated order keeps that and lists only axes with a home end. */
const V1_HOMING_ORDER: readonly ProfileAxis[] = Object.freeze(['z', 'x', 'y', 'a', 'b', 'c']);
const SCHEMA_KEY = /^[a-z0-9][a-z0-9.-]{0,31}@[0-9a-f]{7,40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{7,40}$/u;

function migrateDrive(d: V1Axis['drive']): Drive {
  if (d === undefined) return { kind: 'unknown' };
  return {
    kind: d.kind,
    ...(d.pitch === undefined ? {} : { pitchMm: d.pitch }),
    ...(d.starts === undefined ? {} : { starts: d.starts }),
    ...(d.teeth === undefined ? {} : { teeth: d.teeth }),
    ...(d.ratio === undefined ? {} : { ratio: d.ratio }),
  };
}

function migrateV1(value: Record<string, unknown>): ProfileResult {
  const shape = validateSchema(PROFILE_V1_SCHEMA, value);
  if (shape.length > 0) return profileError('InvalidProfile', 'The version 1 machine profile is not valid.', shape);
  const v1 = value as unknown as V1;
  const notes: string[] = [];
  const dropped: string[] = (['facts', 'overrides', 'confirmations'] as const).filter((k) => v1[k] !== undefined);
  if (v1.settings?.device !== undefined) dropped.push('settings.device');
  if (v1.firmware?.fv !== undefined) dropped.push('firmware.fv');

  const firmware = v1.firmware ?? null;
  const family = v1.boundDevice?.family ?? (firmware === null ? null : familyOfDialect(firmware.dialectId));

  let boundDevice: BoundDevice | null = null;
  if (v1.boundDevice != null && firmware !== null && familyOfDialect(firmware.dialectId) === v1.boundDevice.family) {
    boundDevice = { family: v1.boundDevice.family, id: v1.boundDevice.id, fb: v1.boundDevice.fb, dialectId: firmware.dialectId };
  } else if (v1.boundDevice != null) {
    notes.push('The board binding could not be carried over; the board is bound again on the next connect.');
  }

  const axes: Partial<Record<ProfileAxis, ProfileAxisDef>> = {};
  for (const axis of PROFILE_AXES) {
    const a = v1.machine.axes[axis];
    if (a === undefined) continue;
    axes[axis] = { motors: [...a.motors], drive: migrateDrive(a.drive), measuredTravelMm: a.travelMm ?? null, homeEnd: a.homeEnd ?? 'none' };
  }
  const homingOrder = V1_HOMING_ORDER.filter((axis) => axes[axis] !== undefined && axes[axis].homeEnd !== 'none');

  const drive = v1.machine.spindle.kind;
  const type = v1.machine.type;
  const spindleKind = drive === 'none' ? 'none' : type === 'laser' ? 'laser' : type === 'plasma' ? 'plasma' : 'spindle';

  let hostLossPolicy = v1.machine.hostLossPolicy ?? DEFAULT_HOST_GATE_VALUES.hostLossPolicy;
  if (family === 'tinyg' && hostLossPolicy !== 'drain') {
    hostLossPolicy = 'drain';
    notes.push('The host-loss policy was set to "drain": TinyG cannot pause the spindle when the computer is lost.');
  }
  notes.push(
    `Homing order, queued-motion ceiling (${DEFAULT_HOST_GATE_VALUES.queuedMotionCeilingS} s), jog caps and hold timeout ` +
      `(${DEFAULT_HOST_GATE_VALUES.holdTimeoutS} s) were not in version 1; they start at their safe defaults.`,
  );

  const schemaKey = v1.settings?.schemaKey ?? null;
  if (schemaKey !== null && !SCHEMA_KEY.test(schemaKey)) {
    notes.push(`The settings draft's schema "${schemaKey}" is not one this app knows; the draft is compared with the board on connect.`);
  }
  const deviceHash = v1.settings?.deviceHash ?? null;
  const sha = v1.createdWith?.sha ?? null;

  const profile: MachineProfileV2 = {
    schemaVersion: 2,
    id: v1.id,
    name: v1.name,
    boundDevice,
    board: v1.board == null ? null : { id: v1.board.id, rev: v1.board.rev ?? null, hv: v1.board.hv ?? null },
    firmware:
      firmware === null
        ? null
        : { dialectId: firmware.dialectId, fb: firmware.fb, ...(firmware.imageSha256 === undefined ? {} : { imageSha256: firmware.imageSha256 }) },
    machine: {
      type,
      axes,
      homingOrder,
      spindle: { kind: spindleKind, drive, activeLow: v1.machine.spindle.activeLow ?? false },
      psu: v1.machine.psu ?? null,
      estop: v1.machine.estop == null ? { kind: 'unknown', auxInput: null } : { kind: v1.machine.estop.kind, auxInput: v1.machine.estop.auxInput ?? null },
      hostLossPolicy,
      queuedMotionCeilingS: DEFAULT_HOST_GATE_VALUES.queuedMotionCeilingS,
      jogCaps: { ...DEFAULT_HOST_GATE_VALUES.jogCaps },
      holdTimeoutS: DEFAULT_HOST_GATE_VALUES.holdTimeoutS,
    },
    settings: {
      draft: { ...(v1.settings?.draft ?? {}) },
      schemaKey: schemaKey !== null && SCHEMA_KEY.test(schemaKey) ? schemaKey : null,
      deviceHash: deviceHash !== null && SHA256.test(deviceHash) ? deviceHash : null,
    },
    wiringRef: null,
    createdWith: {
      tool: v1.createdWith?.tool ?? 'unknown',
      version: v1.createdWith?.version ?? '0',
      sha: sha !== null && GIT_SHA.test(sha) ? sha : null,
    },
  };

  const issues = v2Issues(profile);
  if (issues.length > 0) return profileError('InvalidProfile', 'The version 1 machine profile cannot be migrated.', issues);
  return deepFreeze({
    ok: true,
    profile: canonicalProfile(profile),
    fromVersion: 1,
    reverifyFactKeys: Object.freeze([...new Set((v1.facts ?? []).map((f) => f.key))]),
    droppedFields: Object.freeze(dropped),
    legacyWiring: v1.wiring ?? null,
    notes: Object.freeze(notes),
  });
}
