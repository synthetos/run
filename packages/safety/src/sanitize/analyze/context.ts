import type { DialectJobGcode, GcodeRule } from '@synthetos/protocol';
import { extentAt, type MoveExtent } from '../extent.ts';
import {
  type Plane
} from '../geometry.ts';
import type { Axis, MotionModel, SanitizeOptions, StartState, Wcs } from '../types.ts';
import { emptyPos, type Pos, type Unc } from './positions.ts';

export class ModelState {

  readonly _job!: DialectJobGcode;

  readonly _rules!: readonly GcodeRule[];

  readonly _lWords!: readonly number[];

  readonly _options!: SanitizeOptions;

  readonly _motion!: MotionModel;

  /** False on a dialect with no tool length offset (TG ignores G49): the offset is then always zero. */
  readonly _hasToolOffset!: boolean;

  /** False on a dialect with no arc distance mode: I/J/K are always offsets from the start. */
  readonly _hasArcDistance!: boolean;

  /** The board's G-code defaults (`gun`, `gdi`, `gpl`, `gco`), restored at program end. */
  readonly _defaults!: NonNullable<StartState['defaults']>;

  /**
   * Axes that are inhibited, or of unknown mode, and do not read exactly 0 at
   * the start (finding: inhibited axis). Their motor may be away from step 0,
   * and the first segment of the next move of ANY axis drives it there
   * (@cite EN kinematics.c:59, plan_exec.c:742-751; TG kinematics.c:63,
   * plan_exec.c:718-727): every motion line is blocked.
   */
  readonly _jointRisk!: readonly Axis[];

  /**
   * What the same axes may still move when they read 0: the reported
   * position is rounded (3 decimals), so a motor left at the true position
   * may be up to `uMachine` from step 0. mm added to every motion line's
   * bound, or null when that includes rotary degrees with no known radius.
   */
  readonly _jointResidualMm!: number | null;

  /**
   * Phase 3: run streams jobs to this dialect and stops before each M6 for a manual tool change (SAFETY §4.4a,
   * H74), so M6 is an INFO stop point instead of a block. Only edge-next streams jobs (line mode, H76).
   */
  readonly _manualToolChange!: boolean;


  units!: 'G20' | 'G21' | null;

  distance!: 'G90' | 'G91' | null;

  arcDistance!: 'G90.1' | 'G91.1' | null;

  plane!: Plane | null;

  motionMode!: 'G0' | 'G1' | 'G2' | 'G3' | 'G80' | null;

  feed!: number | null;

  wcs!: Wcs | null;

  machine!: Pos;

  /** OD-24: the box of the line being analysed, in machine coordinates (extent.ts). */
  _extent: MoveExtent = extentAt(emptyPos());

  work!: Pos;

  wcsOffsets!: Record<Wcs, Pos>;

  g92!: Pos;

  g92Active!: boolean | null;

  toolOffset!: Pos;

  g28!: Pos;

  g30!: Pos;

  spindle!: 'off' | 'cw' | 'ccw';

  mist!: boolean;

  flood!: boolean;

  /** The last S word (commanded speed), or null. For the tool-change spindle restart (H74). */
  speed: number | null = null;

  /** The last T word (selected tool), or null. */
  tool: number | null = null;

  /**
   * How well the model knows the firmware's positions, offsets and stored
   * positions (finding: arc uncertainty, after P0-10#1). The board reports
   * them to three decimals, and every incremental move adds float32 rounding
   * the double-precision model does not see. `uWork` bounds the error of the
   * work position as the firmware's arithmetic sees it (its machine position
   * minus its offset); it is what an absolute arc's end point and a G90.1
   * centre inherit, and it widens the arc's float32 decision band.
   */
  uMachine!: Unc;

  uWork!: Unc;

  uWcs!: Record<Wcs, Unc>;

  uG92!: Unc;

  uTool!: Unc;

  uG28!: Unc;

  uG30!: Unc;
}

export type ModelContext = { -readonly [K in keyof ModelState]: ModelState[K] } & { totalOffset(axis: Axis): number | null };
