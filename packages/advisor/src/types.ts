/**
 * Advisor inputs (MACHINING_ASSISTANT §5.1).
 *
 * The machine description is the advisor's own plain shape, filled by the
 * app from the machine profile and the values read from the board: this
 * package never imports `machine`, `schema`'s profile types or `protocol`.
 *
 * Units: mm, mm/min, rpm, m/min, kW; accelerations mm/s², jerk mm/s³.
 */
import type { Coolant, FrameClass, Material, Tool } from '@synthetos/library';
import type { ModelData } from './model.ts';

export type DriveType = 'belt' | 'lead-screw' | 'ball-screw' | 'rack';

/** One dial position of a trim router and the speed it gives. */
export interface DialSetting {
  /** The label on the dial: "1" to "6", or "3.5". */
  readonly setting: string;
  readonly rpm: number;
}

export interface SpindleSpec {
  readonly kind: 'dial-router' | 'pwm' | 'vfd';
  readonly minRpm: number;
  readonly maxRpm: number;
  /** Rated power, kW. */
  readonly powerKw: number;
  /** Whether the S word sets the speed (false for a router with a dial). */
  readonly sControlled: boolean;
  /** Dial routers: the dial-to-rpm table from the machine profile. */
  readonly dial?: readonly DialSetting[];
}

/** What the planner model needs (read from the board, P1 read). */
export interface MotionCaps {
  /** Acceleration used for junctions and as the ramp cap, mm/s². */
  readonly accel: number;
  /** Jerk, mm/s³. Without it, ramps are modelled at constant acceleration. */
  readonly jerk?: number;
  /** Junction deviation, mm. */
  readonly junctionDeviation: number;
}

export interface MachineCaps {
  readonly frameClass: FrameClass;
  readonly spindle: SpindleSpec;
  /** Axis maximum feeds, mm/min: the slowest of X and Y, and Z. */
  readonly maxFeed: { readonly xy: number; readonly z: number };
  readonly motion?: MotionCaps;
  /** Descriptive (§5.1); the rules do not read them yet. */
  readonly drive?: Readonly<Partial<Record<'x' | 'y' | 'z', DriveType>>>;
  readonly gantrySpanMm?: number;
}

export const OPERATION_KINDS = Object.freeze(['slot', 'pocket', 'adaptive', 'profile', 'finish', 'drill', 'v-carve'] as const);
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** Programmed feed (F, mm/min) and spindle speed (S, rpm). */
export interface Programmed {
  readonly feed: number;
  readonly rpm: number;
}

export type Point3 = readonly [number, number, number];

export interface OperationInput {
  readonly id?: string;
  readonly kind: OperationKind;
  /** Axial depth of cut, mm (from the G-code analysis, CAM comments or the user). */
  readonly ap: number;
  /** Radial engagement (stepover), mm. Ignored for drilling. */
  readonly ae: number;
  readonly programmed?: Programmed;
  /** The operation's cutting moves as one polyline (no rapids), for the achievable-feed estimate. */
  readonly path?: readonly Point3[];
}

export interface AdvisorContext {
  readonly machine: MachineCaps;
  readonly tool: Tool;
  /** The tool's maximum rpm, when the manufacturer gives one. */
  readonly toolMaxRpm?: number;
  /** Stickout in this holder; defaults to the tool's `geometry.stickout`. */
  readonly stickout?: number;
  readonly material: Material;
  readonly coolant: Coolant;
  readonly operation: OperationInput;
  /** Model data; `DEFAULT_MODEL` (placeholders) when absent. */
  readonly model?: ModelData;
}
