/**
 * MachineProfile v2 (ROADMAP TB-01; RUN_PLAN §7.2; SAFETY §4.10 rules 3-4).
 *
 * A profile describes ONE machine: what is bound to it, what firmware it
 * expects, the mechanics, the host gates and the settings draft. It never
 * holds commissioning facts, confirmations, overrides, acknowledgements or
 * pending restores: those live device-local in `device-safety` (the fact
 * engine in `../facts/`) and are never stored with, exported with or synced
 * with a profile (SAFETY H34, §4.10 rule 3, T-S47).
 *
 * Cloud revision metadata (`rev`, `parent_rev`, `content_sha256`) lives
 * beside the profile, never inside it (RUN_PLAN §7.2). The work envelope is
 * never a profile field: it comes only from the live board's `tn`/`tm`
 * (SAFETY §4.10 rule 4); `measuredTravelMm` is a description used to suggest
 * a draft, nothing reads it as a limit.
 *
 * The shared types are controller-neutral: TinyG-only assumptions (four
 * motors, `drain` as the only host-loss policy) are semantic checks keyed by
 * the dialect, not shapes of the type.
 */
import type { DialectId } from '@synthetos/protocol';
import type { SpindleKind } from '@synthetos/safety';

export const PROFILE_SCHEMA_VERSION = 2;

export type ControllerFamily = 'tinyg' | 'g2core';

/** Axis letters, in the order TinyG and g2core number them. */
export const PROFILE_AXES = Object.freeze(['x', 'y', 'z', 'a', 'b', 'c'] as const);
export type ProfileAxis = (typeof PROFILE_AXES)[number];

/**
 * The board this profile is bound to (RUN_PLAN §7.2). `null` until the first
 * connect binds it; an import always clears it (T-S22), so an imported or
 * cloud profile can never match a board it has not been re-bound to (SAFETY
 * H33, a non-overridable gate).
 */
export interface BoundDevice {
  readonly family: ControllerFamily;
  /** The board's `id` string as the probe read it. */
  readonly id: string;
  readonly fb: number;
  readonly fbs?: string;
  readonly dialectId: DialectId;
}

export interface ProfileFirmware {
  readonly dialectId: DialectId;
  readonly fb: number;
  readonly fbs?: string;
  /** Lower-case hex SHA-256 of the approved image, when it was flashed by run. */
  readonly imageSha256?: string;
}

export interface ProfileBoard {
  /** A board definition id (`tinyg-v8`, `arduino-due-gshield`). */
  readonly id: string;
  readonly rev: string | null;
  readonly hv: number | null;
}

export type DriveKind = 'screw' | 'belt' | 'rack' | 'rotary' | 'unknown';

/**
 * How an axis is driven. Which numbers are present depends on `kind`
 * (checked by `profileSemanticIssues`): screw `pitchMm` + `starts`; belt and
 * rack `pitchMm` + `teeth`; rotary `ratio` (motor turns per axis turn);
 * unknown none.
 */
export interface Drive {
  readonly kind: DriveKind;
  readonly pitchMm?: number;
  readonly starts?: number;
  readonly teeth?: number;
  readonly ratio?: number;
}

export interface ProfileAxisDef {
  /** Motor numbers (1-based). Two or more make a dual-motor axis, a host gate. */
  readonly motors: readonly number[];
  readonly drive: Drive;
  /** Measured travel, a description for "describe your machine". Never the envelope. */
  readonly measuredTravelMm: number | null;
  readonly homeEnd: 'min' | 'max' | 'none';
}

/** How the spindle output is switched. Descriptive; the host gate is `kind`. */
export type SpindleDrive = 'none' | 'relay' | 'ssr' | 'vfd-0-10v' | 'pwm';

export type HostLossPolicy = 'drain' | 'hold-and-spindle-pause';

export interface ProfileMachine {
  readonly type: 'router' | 'laser' | 'plasma' | 'custom';
  readonly axes: Readonly<Partial<Record<ProfileAxis, ProfileAxisDef>>>;
  /** Host gate: the order homing runs in. Every axis listed homes (`homeEnd` is not `none`). */
  readonly homingOrder: readonly ProfileAxis[];
  readonly spindle: {
    /** Host gate (W15 on TinyG for laser and plasma). */
    readonly kind: SpindleKind;
    readonly drive: SpindleDrive;
    readonly activeLow: boolean;
  };
  readonly psu: { readonly volts: number; readonly amps: number; readonly earthed: boolean } | null;
  readonly estop: { readonly kind: string; readonly auxInput: string | null };
  /** Host gate. TinyG offers only `drain` (ROADMAP TB-04). */
  readonly hostLossPolicy: HostLossPolicy;
  /** Host gate: the queued-motion ceiling in seconds (SAFETY §4.3). */
  readonly queuedMotionCeilingS: number;
  /** Host gate: unhomed jog caps (SAFETY §4.5). */
  readonly jogCaps: { readonly maxStepMm: number; readonly maxFeedMmPerMin: number };
  /** Host gate: hold timeout in seconds, 15 to 600, or null when off (expert mode; SAFETY §4.4 rule 8). */
  readonly holdTimeoutS: number | null;
}

export interface ProfileSettings {
  /** Setting key to value. A draft is only ever applied through C19 and the write pipeline. */
  readonly draft: Readonly<Record<string, number>>;
  /** `<dialect>@<commit>` of the settings schema the draft was made against, or null when unknown. */
  readonly schemaKey: string | null;
  /** The hash of the motion and switch settings last read from the bound board, or null before a read. */
  readonly deviceHash: string | null;
}

export interface WiringRef {
  readonly id: string;
  /** Lower-case hex SHA-256 of the wiring document's canonical bytes. */
  readonly sha256: string;
}

export interface MachineProfileV2 {
  readonly schemaVersion: 2;
  /** A UUID, lower case. */
  readonly id: string;
  readonly name: string;
  readonly boundDevice: BoundDevice | null;
  readonly board: ProfileBoard | null;
  readonly firmware: ProfileFirmware | null;
  readonly machine: ProfileMachine;
  readonly settings: ProfileSettings;
  readonly wiringRef: WiringRef | null;
  readonly createdWith: { readonly tool: string; readonly version: string; readonly sha: string | null };
}
