/**
 * Per-line analysis for the sanitiser (SAFETY §4.7 steps 6, 6a and the
 * state that steps 7–8a need).
 *
 * A small modal model of the job, just enough to apply the dialect's block
 * rules and to model every move against the queued-motion ceiling: units,
 * distance and arc-distance mode, plane, motion mode, feed, the work
 * coordinate system and offsets, and the position in work and machine
 * coordinates. What the model does not know stays unknown (`null`); a move
 * whose length depends on an unknown is blocked, never guessed.
 *
 * Semantics follow EN, the primary target (@cite EN gcode_parser.c
 * `_parse_gcode_block`, `_validate_gcode_block`, `_execute_gcode_block`;
 * canonical_machine.c offsets and stored positions). Where TG differs, the
 * difference is dialect data (`Dialect.gcode`), never a branch on the
 * dialect id. This is not the preview interpreter (TB-02): it only decides
 * what may be sent and how long moves are split.
 */
import type { Dialect, DialectJobGcode, GcodeRule } from '@synthetos/protocol';
import {
  DECIMALS,
  PLANES,
  ROTARY,
  formatNumber,
  modelArc,
  moveSeconds,
  noVelocityMessage,
  reportedErrorMm,
  splitArc,
  stepErrorMm,
  splitLinear,
  travelBoundMm,
  type ArcInput,
  type LinearAxis,
  type Plane,
  type Segment,
} from './geometry.ts';
import { canonicalCode, type Word } from './lex.ts';
import type { Axis, MotionModel, ReportEntry, RotaryAxis, SanitizeOptions, SanitizeRule, StartState, Wcs } from './types.ts';
import { AXES, AXIS_MODE_DISABLED, AXIS_MODE_INHIBITED, AXIS_MODE_RADIUS, AXIS_MODE_STANDARD, WCS_CODES, type AxisMode } from './types.ts';

type Pos = Record<Axis, number | null>;

/**
 * Per-axis bound (mm, or degrees) on how far the firmware's float32 value
 * may be from the model's value of the matching `Pos`. Only meaningful where
 * that value is known; an unknown value has an infinite bound.
 */
type Unc = Record<Axis, number>;

function uncOf(p: Pos, bound: (axis: Axis, value: number) => number): Unc {
  const u = { X: Infinity, Y: Infinity, Z: Infinity, A: Infinity, B: Infinity, C: Infinity };
  for (const a of AXES) {
    const v = p[a];
    if (v !== null) u[a] = bound(a, v);
  }
  return u;
}

function exactUnc(): Unc {
  return { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 };
}

/** Modal groups: two codes of one group on a line is a modal conflict (EN E152). */
const GROUP: Readonly<Record<string, string>> = Object.freeze({
  G0: 'motion', G1: 'motion', G2: 'motion', G3: 'motion', G80: 'cancel',
  G4: 'action', G10: 'action', G28: 'action', 'G28.1': 'action', 'G28.2': 'action', 'G28.3': 'action',
  'G28.4': 'action', G30: 'action', 'G30.1': 'action', 'G38.2': 'action', G92: 'action', 'G92.1': 'action',
  'G92.2': 'action', 'G92.3': 'action', M105: 'action', M114: 'action', M115: 'action', M400: 'action',
  'M201.3': 'action',
  G17: 'plane', G18: 'plane', G19: 'plane',
  G90: 'distance', G91: 'distance',
  'G90.1': 'arcDistance', 'G91.1': 'arcDistance',
  G93: 'feedMode', G94: 'feedMode',
  G20: 'units', G21: 'units',
  G54: 'wcs', G55: 'wcs', G56: 'wcs', G57: 'wcs', G58: 'wcs', G59: 'wcs',
  G61: 'path', 'G61.1': 'path', G64: 'path',
  'G43.1': 'toolOffset', G49: 'toolOffset',
  M0: 'program', M1: 'program', M2: 'program', M30: 'program', M60: 'program',
  M3: 'spindle', M4: 'spindle', M5: 'spindle',
  M7: 'coolant', M8: 'coolant', M9: 'coolant',
  M48: 'override', M49: 'override', M50: 'override', M51: 'override',
});

/** Group-0 codes whose axis words are not motion (NIST 3.4; @cite EN gcode_parser.c `_validate_gcode_block`). */
const AXIS_ACTIONS: ReadonlySet<string> = new Set(['G10', 'G28', 'G30', 'G92']);

/** Codes executed after the motion of their block (program flow). They go on the last sub-segment. */
const AFTER_MOTION: ReadonlySet<string> = new Set(['M0', 'M1', 'M2', 'M30', 'M60']);

const MOTION_CODES: ReadonlySet<string> = new Set(['G0', 'G1', 'G2', 'G3']);

const AXIS_LETTERS: ReadonlySet<string> = new Set(AXES);

const ARC_LETTERS: ReadonlySet<string> = new Set(['I', 'J', 'K', 'R']);

const INCH_MM = 25.4;

const ROTARY_AXES: readonly RotaryAxis[] = ['A', 'B', 'C'];

/** A finding for the report, before its line number is attached. */
export interface Finding {
  readonly severity: ReportEntry['severity'];
  readonly rule: SanitizeRule;
  readonly message: string;
}

/** What one line does, as the sanitiser needs to know it. */
export interface LineAnalysis {
  readonly findings: readonly Finding[];
  /** False when a finding blocks the line. */
  readonly ok: boolean;
  /** The line as one move, or as sub-segment bodies replacing it. */
  readonly motion:
    | null
    | { readonly kind: 'single'; readonly plannerLength: number; readonly boundMm: number | null; readonly seconds: number }
    | { readonly kind: 'split'; readonly bodies: readonly string[]; readonly segments: readonly Segment[]; readonly seconds: number };
  readonly toolChange: boolean;
  /** M0 or M60. */
  readonly programStop: boolean;
  /** The M1 word, if any. */
  readonly optionalStop: Word | null;
  /** M2 or M30. */
  readonly programEnd: boolean;
  /** M3, M4, M7 or M8 on this line. */
  readonly outputsOn: boolean;
}

function emptyPos(): Pos {
  return { X: null, Y: null, Z: null, A: null, B: null, C: null };
}

function posFrom(values: Readonly<Partial<Record<Axis, number>>> | undefined): Pos {
  const p = emptyPos();
  if (values === undefined) return p;
  for (const a of AXES) {
    const v = values[a];
    if (v !== undefined && Number.isFinite(v)) p[a] = v;
  }
  return p;
}

function zeroPos(): Pos {
  return { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 };
}

const block = (rule: SanitizeRule, message: string): Finding => ({ severity: 'block', rule, message });

/** The job modal model. One instance per sanitiser run. */
export class JobModel {
  readonly #job: DialectJobGcode;
  readonly #rules: readonly GcodeRule[];
  readonly #lWords: readonly number[];
  readonly #options: SanitizeOptions;
  readonly #motion: MotionModel;
  /** False on a dialect with no tool length offset (TG ignores G49): the offset is then always zero. */
  readonly #hasToolOffset: boolean;
  /** False on a dialect with no arc distance mode: I/J/K are always offsets from the start. */
  readonly #hasArcDistance: boolean;
  /** The board's G-code defaults (`gun`, `gdi`, `gpl`, `gco`), restored at program end. */
  readonly #defaults: NonNullable<StartState['defaults']>;
  /**
   * Axes that are inhibited, or of unknown mode, and do not read exactly 0 at
   * the start (finding: inhibited axis). Their motor may be away from step 0,
   * and the first segment of the next move of ANY axis drives it there
   * (@cite EN kinematics.c:59, plan_exec.c:742-751; TG kinematics.c:63,
   * plan_exec.c:718-727): every motion line is blocked.
   */
  readonly #jointRisk: readonly Axis[];
  /**
   * What the same axes may still move when they read 0: the reported
   * position is rounded (3 decimals), so a motor left at the true position
   * may be up to `uMachine` from step 0. mm added to every motion line's
   * bound, or null when that includes rotary degrees with no known radius.
   */
  readonly #jointResidualMm: number | null;
  /**
   * Phase 3: run streams jobs to this dialect and stops before each M6 for a manual tool change (SAFETY §4.4a,
   * H74), so M6 is an INFO stop point instead of a block. Only edge-next streams jobs (line mode, H76).
   */
  readonly #manualToolChange: boolean;

  units: 'G20' | 'G21' | null;
  distance: 'G90' | 'G91' | null;
  arcDistance: 'G90.1' | 'G91.1' | null;
  plane: Plane | null;
  motionMode: 'G0' | 'G1' | 'G2' | 'G3' | 'G80' | null;
  feed: number | null;
  wcs: Wcs | null;
  machine: Pos;
  work: Pos;
  wcsOffsets: Record<Wcs, Pos>;
  g92: Pos;
  g92Active: boolean | null;
  toolOffset: Pos;
  g28: Pos;
  g30: Pos;
  spindle: 'off' | 'cw' | 'ccw';
  mist: boolean;
  flood: boolean;
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
  uMachine: Unc;
  uWork: Unc;
  uWcs: Record<Wcs, Unc>;
  uG92: Unc;
  uTool: Unc;
  uG28: Unc;
  uG30: Unc;

  constructor(dialect: Dialect, job: DialectJobGcode, options: SanitizeOptions) {
    this.#job = job;
    this.#manualToolChange = dialect.id === 'tinyg-en';
    this.#rules = dialect.gcode.blocked;
    this.#lWords = dialect.gcode.lWords;
    this.#options = options;
    this.#motion = options.motion;
    this.#hasToolOffset = job.codes.includes('G43.1');
    this.#hasArcDistance = job.codes.includes('G90.1');
    const s: StartState = options.start ?? {};
    this.#defaults = s.defaults ?? {};
    this.units = s.units ?? null;
    this.distance = s.distance ?? null;
    this.arcDistance = this.#hasArcDistance ? (s.arcDistance ?? null) : 'G91.1';
    this.plane = s.plane ?? null;
    this.motionMode = s.motion ?? null;
    this.feed = s.feedMmPerMin !== undefined && s.feedMmPerMin > 0 && Number.isFinite(s.feedMmPerMin) ? s.feedMmPerMin : null;
    this.wcs = s.wcs ?? null;
    this.machine = posFrom(s.machine);
    this.wcsOffsets = { G54: emptyPos(), G55: emptyPos(), G56: emptyPos(), G57: emptyPos(), G58: emptyPos(), G59: emptyPos() };
    for (const w of WCS_CODES) this.wcsOffsets[w] = posFrom(s.wcsOffsets?.[w]);
    this.g92 = posFrom(s.g92?.offsets);
    this.g92Active = s.g92 === undefined ? null : s.g92.active;
    this.toolOffset = this.#hasToolOffset ? posFrom(s.toolOffset) : zeroPos();
    this.g28 = posFrom(s.g28);
    this.g30 = posFrom(s.g30);
    this.spindle = s.spindle ?? 'off';
    this.mist = s.mist ?? false;
    this.flood = s.flood ?? false;
    // Reported values: `mpo` is always mm (@cite EN canonical_machine.c:363-371); offsets and stored
    // positions are printed in the units in force where the board converts them (F_CONVERT, @cite EN
    // config_app.c:858-871 `prep_float`), so an inch board's three decimals are 0.0127 mm apart, and
    // unknown units are taken as inches.
    const offsetUnit = (axis: Axis): number =>
      (ROTARY.has(axis) && !job.rotaryOffsetsUseUnits) || s.units === 'G21' ? 1 : INCH_MM;
    const reported = (p: Pos): Unc => uncOf(p, (a, v) => reportedErrorMm(v, offsetUnit(a)));
    this.uMachine = uncOf(this.machine, (_a, v) => reportedErrorMm(v, 1));
    this.uWcs = { G54: exactUnc(), G55: exactUnc(), G56: exactUnc(), G57: exactUnc(), G58: exactUnc(), G59: exactUnc() };
    for (const w of WCS_CODES) this.uWcs[w] = reported(this.wcsOffsets[w]);
    this.uG92 = reported(this.g92);
    this.uTool = this.#hasToolOffset ? reported(this.toolOffset) : exactUnc();
    this.uG28 = reported(this.g28);
    this.uG30 = reported(this.g30);
    this.work = emptyPos();
    this.uWork = exactUnc(); // every axis is set just below
    for (const a of AXES) {
      const m = this.machine[a];
      const t = this.totalOffset(a);
      this.work[a] = m !== null && t !== null ? m - t : null;
      this.uWork[a] = this.uMachine[a] + this.#offsetUnc(a);
    }
    // Finding: inhibited axis. For an inhibited axis the step target is 0 once any segment has run since it
    // was inhibited (or since a step resync); before that it is still the joint the axis had when it was
    // inhibited, and with no segment since, the position has not moved either. So the motor is at step 0 or
    // at the position the board reports. An axis of unknown mode may be inhibited. (An axis un-inhibited
    // while away from 0 has the mirror problem and is not visible in any read: STATUS of this finding.)
    const risk: Axis[] = [];
    let residual: number | null = 0;
    for (const a of AXES) {
      const mode = this.#modeOf(a);
      if (mode !== undefined && mode !== AXIS_MODE_INHIBITED) continue;
      const m = this.machine[a];
      if (m !== 0) {
        risk.push(a);
        continue;
      }
      if (residual === null) continue;
      residual = ROTARY.has(a) ? null : residual + this.uMachine[a];
    }
    this.#jointRisk = risk;
    this.#jointResidualMm = residual;
  }

  /** The live axis mode, or undefined when it is not known. */
  #modeOf(axis: Axis): AxisMode | undefined {
    return ROTARY.has(axis) ? this.#motion.rotary[axis as RotaryAxis]?.mode : this.#motion.linear[axis as 'X' | 'Y' | 'Z'];
  }

  /**
   * A block for a move word on a linear axis the firmware does not move as a
   * length: unknown mode, disabled (the word is ignored), or radius mode
   * (refused by `cm_set_am` on X/Y/Z, and ignored by `cm_set_model_target`
   * if present) (@cite EN canonical_machine.c:531-545; TG canonical_machine.c:444-454).
   */
  #linearModeFinding(axis: Axis): Finding | null {
    if (ROTARY.has(axis)) return null;
    const mode = this.#modeOf(axis);
    const name = `${axis.toLowerCase()}am`;
    if (mode === undefined) return block('unknown-state', `the axis mode (${name}) of ${axis} is not known, so a move on ${axis} cannot be modelled`);
    if (mode === AXIS_MODE_DISABLED) return block('axis-mode', `${axis} is disabled (${name}=0): TinyG ignores ${axis} words, so this move would not run as written`);
    if (mode === AXIS_MODE_RADIUS) return block('axis-mode', `${axis} reads radius mode (${name}=3), which TinyG refuses on a linear axis; it ignores ${axis} words in that mode`);
    return null;
  }

  /** The block for motion while an inhibited (or possibly inhibited) axis may hold its motor away from step 0. */
  #jointRiskFinding(): Finding | null {
    if (this.#jointRisk.length === 0) return null;
    const parts = this.#jointRisk.map((a) => {
      const mode = this.#modeOf(a);
      const m = this.machine[a];
      const where = m === null ? 'its position is not known' : `it reads ${formatNumber(m, 3)}`;
      return mode === undefined ? `${a} (axis mode not known, so it may be inhibited; ${where})` : `${a} (inhibited; ${where})`;
    });
    return block(
      'inhibited-axis',
      `TinyG drives an inhibited axis's motor to step 0 on the next move of any axis, by an amount no overrun bound covers: ${parts.join(', ')}. Motion stays blocked until every such axis reads 0`,
    );
  }

  /** A motion line's bound with the residual of inhibited axes that read 0 added (`#jointResidualMm`). */
  #withJointResidual(bound: number | null): number | null {
    const r = this.#jointResidualMm;
    return bound === null || r === null ? null : bound + r;
  }

  /** Every bound of an accepted motion line, with the inhibited-axis residual. */
  #chargeJointResidual(motion: LineAnalysis['motion']): LineAnalysis['motion'] {
    if (motion === null || this.#jointResidualMm === 0) return motion;
    if (motion.kind === 'single') return { ...motion, boundMm: this.#withJointResidual(motion.boundMm) };
    return { ...motion, segments: motion.segments.map((seg) => ({ ...seg, boundMm: this.#withJointResidual(seg.boundMm) })) };
  }

  /**
   * Bound on the error of the work offset in force on an axis (`totalOffset`):
   * the sum of its parts' bounds. Infinite when the offset is unknown.
   */
  #offsetUnc(axis: Axis): number {
    if (this.wcs === null || this.g92Active === null) return Infinity;
    return this.uWcs[this.wcs][axis] + (this.g92Active ? this.uG92[axis] : 0) + (ROTARY.has(axis) ? 0 : this.uTool[axis]);
  }

  /**
   * The position bounds after the firmware moved `axis` (its model positions
   * already updated):
   * - `work`: to an absolute work target. The firmware's position is the
   *   word plus its offset, so the work position is the word up to one sum's
   *   rounding; the machine position inherits the offset's uncertainty.
   * - `machine`: to a machine target known to `targetUnc` (G53, a stored
   *   position): the work position inherits the offset's uncertainty.
   * - `incremental`: by a distance added to the firmware's own position: one
   *   more rounding on top of what was already uncertain (float32
   *   accumulation over a run of G91 moves).
   */
  #settle(axis: Axis, kind: 'work' | 'machine' | 'incremental', delta: number, targetUnc = 0): void {
    const m = this.machine[axis];
    const off = this.totalOffset(axis);
    const e = stepErrorMm(m ?? 0, delta, off ?? 0);
    if (kind === 'work') {
      this.uWork[axis] = e;
      this.uMachine[axis] = this.#offsetUnc(axis) + e;
    } else if (kind === 'machine') {
      this.uMachine[axis] = targetUnc + e;
      this.uWork[axis] = this.uMachine[axis] + this.#offsetUnc(axis);
    } else {
      this.uMachine[axis] += e;
      this.uWork[axis] += e;
    }
  }

  /**
   * Work offset in force on an axis: coordinate system + G92 (if applied) +
   * the applied tool offset, or null. This is the offset the firmware adds to
   * a target, not its display convention.
   */
  totalOffset(axis: Axis): number | null {
    if (this.wcs === null) return null;
    const w = this.wcsOffsets[this.wcs][axis];
    const g = this.#g92Part(axis);
    const t = this.#appliedTool(axis);
    return w === null || g === null || t === null ? null : w + g + t;
  }

  /**
   * The tool offset added to a target on this axis. EN adds it to X, Y and Z
   * only: the A/B/C loop of `cm_set_model_target` uses the coordinate offset
   * alone (@cite EN canonical_machine.c:536-539 vs :556-563), although G43.1
   * stores A/B/C values (@cite EN canonical_machine.c:1609, E155), which G92
   * and G10 L20 still subtract (@cite EN canonical_machine.c:1055-1061, :1205-1206).
   */
  #appliedTool(axis: Axis): number | null {
    return ROTARY.has(axis) ? 0 : this.toolOffset[axis];
  }

  /**
   * The work position on `axis` right after G92 or G10 L20 (on the active
   * system) set it to `value`: the firmware subtracts the stored tool offset on
   * every axis but applies it only to X, Y and Z, so a rotary axis reads
   * `value` + its stored tool offset (null when either is unknown).
   */
  #workAfterSet(axis: Axis, value: number | null): number | null {
    if (value === null || !ROTARY.has(axis)) return value;
    const t = this.toolOffset[axis];
    return t === null ? null : value + t;
  }

  /** Adds `mm` to the bound on both positions of an axis (rounding the model did not follow). */
  #widen(axis: Axis, mm: number): void {
    this.uMachine[axis] += mm;
    this.uWork[axis] += mm;
  }

  /**
   * Sets the work position after G92 or G10 L20 made it read `value`: the
   * firmware derived the offset from its own position, so the work position
   * is `value` up to one sum's rounding (plus the stored tool offset's bound on
   * a rotary axis, see `#workAfterSet`).
   */
  #setWork(axis: Axis, value: number | null): void {
    const w = this.#workAfterSet(axis, value);
    this.work[axis] = w;
    this.uWork[axis] = w === null ? Infinity : stepErrorMm(this.machine[axis] ?? 0, w) + (ROTARY.has(axis) ? this.uTool[axis] : 0);
  }

  /** The G92 part of the work offset on an axis, or null when it is not known whether G92 applies. */
  #g92Part(axis: Axis): number | null {
    if (this.g92Active === null) return null;
    return this.g92Active ? this.g92[axis] : 0;
  }

  /**
   * After the work offset on `axis` changed by `change` (old part minus new
   * part; null when unknown): the machine did not move, so the work position
   * moves by the change. Where the machine position and the new offset are
   * both known, the work position is recomputed from them instead.
   * `changeUnc` bounds the error of the change (the old and new parts' bounds).
   */
  #shift(axis: Axis, change: number | null, changeUnc: number): void {
    const m = this.machine[axis];
    const t = this.totalOffset(axis);
    const w = this.work[axis];
    if (m !== null && t !== null) {
      this.work[axis] = m - t;
      this.uWork[axis] = this.uMachine[axis] + this.#offsetUnc(axis);
    } else if (change === 0 && changeUnc === 0) return;
    else {
      this.work[axis] = w !== null && change !== null ? w + change : null;
      this.uWork[axis] += changeUnc;
    }
  }

  /** Selects a coordinate system (G54..G59, or the default at program end). */
  #selectWcs(next: Wcs | null): void {
    const prev = this.wcs;
    if (next === prev) return;
    this.wcs = next;
    for (const a of AXES) {
      const before = prev === null ? null : this.wcsOffsets[prev][a];
      const after = next === null ? null : this.wcsOffsets[next][a];
      const unc = (prev === null ? Infinity : this.uWcs[prev][a]) + (next === null ? Infinity : this.uWcs[next][a]);
      this.#shift(a, before === null || after === null ? null : before - after, unc);
    }
  }

  /** The bound on the G92 part of the work offset on an axis. */
  #g92PartUnc(axis: Axis): number {
    if (this.g92Active === null) return Infinity;
    return this.g92Active ? this.uG92[axis] : 0;
  }

  /** Sets whether G92 offsets apply, and to what with which bounds (null keeps them). */
  #setG92(active: boolean, offsets: Pos | null, unc: Unc | null): void {
    const before = AXES.map((a) => this.#g92Part(a));
    const beforeUnc = AXES.map((a) => this.#g92PartUnc(a));
    this.g92Active = active;
    if (offsets !== null) this.g92 = offsets;
    if (unc !== null) this.uG92 = unc;
    AXES.forEach((a, i) => {
      const b = before[i] as number | null;
      const after = this.#g92Part(a);
      this.#shift(a, b === null || after === null ? null : b - after, (beforeUnc[i] as number) + this.#g92PartUnc(a));
    });
  }

  /** mm per program unit of a linear word, or null when the units are unknown. */
  static #unitScale(units: 'G20' | 'G21' | null): number | null {
    return units === null ? null : units === 'G20' ? INCH_MM : 1;
  }

  /**
   * mm (or degrees) per program unit of a move target on an axis, or null
   * when it depends on something unknown. A rotary axis in radius mode reads
   * the word in linear units and turns it into degrees (@cite EN
   * canonical_machine.c:517-521 `_calc_ABC`; TG the same); every other
   * rotary mode reads degrees.
   */
  #scale(axis: Axis, units: 'G20' | 'G21' | null): number | null {
    if (!ROTARY.has(axis)) return JobModel.#unitScale(units);
    const cfg = this.#motion.rotary[axis as RotaryAxis];
    /* c8 ignore next -- a move word on an axis of unknown mode is blocked before any target is computed (#rotaryUnknown) */
    if (cfg === undefined) return null;
    if (cfg.mode !== AXIS_MODE_RADIUS) return 1;
    const u = JobModel.#unitScale(units);
    const r = cfg.radiusMm;
    return u === null || r === undefined ? null : (u * 360) / (2 * Math.PI * r);
  }

  /**
   * mm (or degrees) per program unit of an offset word (G10, G92, G43.1).
   * Offsets never use the radius conversion. EN stores rotary offsets as
   * written, in degrees (@cite EN canonical_machine.c:1054, :1206, :1609);
   * 440.21 applies `_to_millimeters` to every axis, so a rotary offset under
   * G20 is scaled by 25.4 (@cite TG canonical_machine.c:669, :788-789), which
   * the dialect states as `rotaryOffsetsUseUnits`.
   */
  #offsetScale(axis: Axis, units: 'G20' | 'G21' | null): number | null {
    if (ROTARY.has(axis) && !this.#job.rotaryOffsetsUseUnits) return 1;
    return JobModel.#unitScale(units);
  }

  /**
   * Physical mm of travel per model unit on an axis (mm on X/Y/Z, degrees on
   * A/B/C), or null when there is no known conversion (SAFETY §4.3 H1: the
   * overrun distance is a true bound, so degrees never count as mm).
   * - Linear axes: 1.
   * - Radius mode: the firmware turns linear units into degrees at `ra`
   *   (@cite EN canonical_machine.c:515-521; TG canonical_machine.c:430-440),
   *   so one degree is π ra / 180 mm of surface travel at that radius.
   * - Disabled: the axis is skipped when the target is set, so its position
   *   does not change (@cite EN canonical_machine.c:548-549; TG
   *   canonical_machine.c:457). Its motor still follows its position: after
   *   inhibited mode it can be driven out to it (the remainder of the
   *   inhibited-axis finding, not visible in any read).
   * - Standard: degrees with no physical radius known, so unknown.
   * - Inhibited: the kinematics force the absolute joint to 0 (@cite EN
   *   kinematics.c:59; TG kinematics.c:63), so a motor away from 0 can move
   *   by an amount the model does not know: unknown.
   */
  #mmPerUnit(axis: Axis): number | null {
    if (!ROTARY.has(axis)) return 1;
    const cfg = this.#motion.rotary[axis as RotaryAxis];
    if (cfg === undefined) return null;
    if (cfg.mode === AXIS_MODE_RADIUS) return cfg.radiusMm === undefined ? null : (Math.PI * cfg.radiusMm) / 180;
    if (cfg.mode === AXIS_MODE_DISABLED) return 0;
    return null;
  }

  /** The true travel bound of a move by these model-unit deltas, mm, or null (see `travelBoundMm`). */
  #boundMm(delta: Readonly<Partial<Record<Axis, number>>>): number | null {
    return travelBoundMm(AXES.map((a) => ({ axis: a, delta: delta[a] ?? 0, mmPerUnit: this.#mmPerUnit(a) })));
  }

  /** Whether a word on this axis needs the program units to be modelled as a move target. */
  #needsUnits(axis: Axis): boolean {
    return !ROTARY.has(axis) || this.#motion.rotary[axis as RotaryAxis]?.mode === AXIS_MODE_RADIUS;
  }

  /**
   * A block for a move word on a rotary axis whose mode or radius is not
   * known: the word could be degrees or linear units, and a radius-mode axis
   * turns 360 / (2π × ra) degrees per mm (about 57× at ra = 1).
   */
  #rotaryUnknown(axis: Axis): Finding | null {
    if (!ROTARY.has(axis)) return null;
    const cfg = this.#motion.rotary[axis as RotaryAxis];
    if (cfg === undefined) {
      return block('unknown-state', `the axis mode (${axis.toLowerCase()}am) of ${axis} is not known, so a move on ${axis} cannot be modelled`);
    }
    if (cfg.mode === AXIS_MODE_RADIUS && cfg.radiusMm === undefined) {
      return block('unknown-state', `${axis} is in radius mode but its radius (${axis.toLowerCase()}ra) is not known, so a move on ${axis} cannot be modelled`);
    }
    return null;
  }

  /** Moves by known deltas: both positions follow, unknowns stay unknown. The caller settles the bounds (`#settle`). */
  #moveBy(delta: Readonly<Partial<Record<Axis, number>>>): void {
    for (const a of AXES) {
      const d = delta[a];
      if (d === undefined) continue;
      const m = this.machine[a];
      const w = this.work[a];
      this.machine[a] = m === null ? null : m + d;
      this.work[a] = w === null ? null : w + d;
    }
  }

  /** Forgets the positions of the axes these words name. */
  #forget(axisWords: readonly Word[]): void {
    for (const w of axisWords) {
      this.work[w.letter as Axis] = null;
      this.machine[w.letter as Axis] = null;
      this.uWork[w.letter as Axis] = Infinity;
      this.uMachine[w.letter as Axis] = Infinity;
    }
  }

  /** Forgets X, Y and Z (an arc that could not be modelled may have moved any of them). */
  #forgetLinear(): void {
    for (const a of AXES) {
      if (ROTARY.has(a)) continue;
      this.work[a] = null;
      this.machine[a] = null;
      this.uWork[a] = Infinity;
      this.uMachine[a] = Infinity;
    }
  }

  /**
   * The largest absolute machine coordinate, work coordinate or work offset
   * on these axes (mm), widened by how uncertain the machine coordinate is,
   * or null when a machine coordinate is unknown. It sizes the float32
   * rounding band of an arc (geometry.ts `positionErrorMm`).
   */
  #planeMagnitude(axes: readonly Axis[]): number | null {
    let max = 0;
    for (const a of axes) {
      const m = this.machine[a];
      if (m === null) return null;
      max = Math.max(max, Math.abs(m) + this.uMachine[a], Math.abs(this.work[a] ?? 0), Math.abs(this.totalOffset(a) ?? 0));
    }
    return max;
  }

  /** Commanded outputs at this point (SAFETY H48). */
  outputsOn(): boolean {
    return this.spindle !== 'off' || this.mist || this.flood;
  }

  /**
   * Program end resets the modal state (@cite EN canonical_machine.c:2191-2214; TG canonical_machine.c:1362-1374):
   * G92 cancelled, the default coordinate system and plane, G94, motion cancelled. EN also restores the
   * default units and sets G90; TG keeps the units and restores the default distance mode. Where the two
   * differ, the value is kept only if both firmwares agree on it, otherwise it becomes unknown.
   */
  #programEnd(): void {
    const d = this.#defaults;
    this.units = this.units !== null && this.units === d.units ? this.units : null;
    this.distance = d.distance === 'G90' ? 'G90' : null;
    this.plane = d.plane ?? null;
    this.motionMode = 'G80';
    this.#setG92(false, zeroPos(), exactUnc());
    this.#selectWcs(d.wcs ?? null);
    if (this.#job.programEndStopsOutputs) {
      this.spindle = 'off';
      this.mist = false;
      this.flood = false;
    }
  }

  /** Analyses one line (comments and N words already removed) and advances the model. */
  analyze(words: readonly Word[]): LineAnalysis {
    const findings: Finding[] = [];
    const codes: { word: Word; code: string }[] = [];
    const params = new Map<string, Word>();
    const job = this.#job;

    for (const w of words) {
      if (w.letter === 'G' || w.letter === 'M') {
        const code = canonicalCode(w);
        const f = this.#checkCode(w, code);
        if (f === null) codes.push({ word: w, code: code as string });
        else findings.push(f);
        continue;
      }
      if (params.has(w.letter)) {
        findings.push(block('modal-conflict', `two ${w.letter} words on one line`));
        continue;
      }
      params.set(w.letter, w);
      const rule = this.#rules.find((r): r is Extract<GcodeRule, { kind: 'word' }> => r.kind === 'word' && r.letter === w.letter);
      if (rule !== undefined) findings.push(block(rule.id, rule.reason));
      else if (!job.words.includes(w.letter)) findings.push(block('unsupported-word', `${w.letter} words are not supported by this firmware`));
    }

    const has = (code: string): boolean => codes.some((c) => c.code === code);
    this.#checkGroups(codes.map((c) => c.code), findings);

    const F = params.get('F');
    const S = params.get('S');
    const T = params.get('T');
    if (F !== undefined && F.value < 0) findings.push(block('negative-feed', 'a negative feed rate is an error (NIST 3.7, E154)'));
    if (S !== undefined && S.value < 0) findings.push(block('negative-speed', 'a negative spindle speed is an error (NIST 3.7, E154)'));
    if (T !== undefined && (!Number.isInteger(T.value) || T.value < 0 || T.value > job.maxTool)) {
      findings.push(block('bad-tool', `T must be a whole number from 0 to ${job.maxTool}; other values select another tool (E154)`));
    }
    const toolChange = has('M6');
    if (toolChange && this.#options.c14 !== true) {
      const tool = T !== undefined && Number.isInteger(T.value) && T.value >= 0 ? ` (T${String(T.value)})` : '';
      // Phase 3 (SAFETY §4.4a, H74): M6 does not pause on TinyG (it only stores the tool number), so run stops the
      // stream before the line, turns the spindle and coolant off, and walks the user through the change.
      if (this.#manualToolChange) findings.push({ severity: 'info', rule: 'tool-change-stop', message: `Tool change${tool}: Run stops here for a manual tool change.` });
      else findings.push(block('m6-without-c14', `Tool change${tool}: TinyG doesn't stop for M6, and Run streams jobs only to edge-next, which it stops before each tool change.`));
    }

    // The modal state this line runs under (modal codes apply before the block's action, EN execution order).
    const units = has('G20') ? 'G20' : has('G21') ? 'G21' : this.units;
    const distance = has('G90') ? 'G90' : has('G91') ? 'G91' : this.distance;
    const arcDistance = has('G90.1') ? 'G90.1' : has('G91.1') ? 'G91.1' : this.arcDistance;
    const plane: Plane | null = has('G17') ? 'G17' : has('G18') ? 'G18' : has('G19') ? 'G19' : this.plane;
    const explicitMotion = codes.find((c) => MOTION_CODES.has(c.code))?.code as 'G0' | 'G1' | 'G2' | 'G3' | undefined;
    const motionMode = explicitMotion ?? (has('G80') ? 'G80' : this.motionMode);
    const wcs = (codes.find((c) => GROUP[c.code] === 'wcs')?.code as Wcs | undefined) ?? this.wcs;
    const action = codes.find((c) => GROUP[c.code] === 'action')?.code;
    const g53 = has('G53');
    const toolSet = has('G43.1');
    const toolCancel = has('G49') && this.#hasToolOffset;
    const axisWords = words.filter((w) => AXIS_LETTERS.has(w.letter));
    const arcWords = ['I', 'J', 'K', 'R'].filter((l) => params.has(l));
    const isArcMove =
      action === undefined && !toolSet && (motionMode === 'G2' || motionMode === 'G3') && (axisWords.length > 0 || arcWords.length > 0);
    const isLinearMove = action === undefined && !toolSet && (motionMode === 'G0' || motionMode === 'G1') && axisWords.length > 0;

    this.#checkModalRules(codes.map((c) => c.code), units, distance, plane, isArcMove, findings);
    this.#checkQueued(codes.map((c) => c.code), params, findings);

    if (axisWords.length > 0 && action !== undefined && AXIS_ACTIONS.has(action) && explicitMotion !== undefined) {
      findings.push(block('modal-conflict', `${explicitMotion} and ${action} both use the axis words on this line (E152)`));
    }
    if (g53 && action !== undefined) findings.push(block('modal-conflict', `G53 cannot share a line with ${action} (E152)`));
    if (g53 && action === undefined && motionMode !== 'G0' && motionMode !== 'G1') {
      findings.push(block('modal-conflict', 'G53 needs G0 or G1 in effect (NIST 3.5.12)'));
    }
    // TinyG applies G53 only by dropping the work offset: under G91 the values are still distances
    // (@cite EN canonical_machine.c:535-541; TG canonical_machine.c:448-451), not machine coordinates.
    if (g53 && action === undefined && distance === 'G91') {
      findings.push(block('modal-conflict', 'G53 under G91: TinyG moves by these values as distances, not to machine coordinates; use G90'));
    }
    if (g53 && action === undefined && distance === null) {
      findings.push(block('unknown-state', 'the distance mode in force is not known, so this G53 move cannot be modelled; set G90 first'));
    }
    if (axisWords.length > 0 && action === undefined && !toolSet && motionMode === 'G80') {
      findings.push(block('modal-conflict', 'axis words with G80 in effect are an error (NIST 3.5.15)'));
    }
    if (axisWords.length > 0 && action === undefined && !toolSet && motionMode === null) {
      findings.push(block('unknown-state', 'the motion mode in force is not known, so this line cannot be modelled; set G0 or G1 first'));
    }
    if (arcWords.length > 0 && !isArcMove) findings.push(block('modal-conflict', 'I, J, K or R on a line that is not an arc'));
    if (params.has('R') && ['I', 'J', 'K'].some((l) => params.has(l))) {
      findings.push(block('modal-conflict', 'an arc with both R and I/J/K is ambiguous'));
    }
    const L = params.get('L');
    if (action === 'G10' && (L === undefined || !this.#lWords.includes(L.value))) {
      findings.push(block('l-word', `G10 needs L${this.#lWords.join(' or L')} on this firmware`));
    }
    const P = params.get('P');
    if (action === 'G10' && (P === undefined || !Number.isInteger(P.value) || P.value < 1 || P.value > 6)) {
      findings.push(block('bad-parameter', 'G10 needs P1 to P6 to name the coordinate system'));
    }
    if (action === 'G4' && P !== undefined && P.value < 0) findings.push(block('bad-parameter', 'a dwell cannot be negative'));
    if (isArcMove && P !== undefined && (!Number.isInteger(P.value) || P.value < 0)) {
      findings.push(block('bad-parameter', 'arc turns (P) must be a whole number of 0 or more'));
    }
    // F is converted with the units in force BEFORE this line's G20/G21: both firmwares set the feed
    // rate before they apply the line's units mode (@cite EN gcode_parser.c:627-633 vs :659,
    // canonical_machine.c:1447; TG gcode_parser.c:455 vs :474). `G20 G1 X4 F2` on a G21 board runs
    // at 2 mm/min, not 50.8.
    const feedScale = JobModel.#unitScale(this.units);
    const feed = F === undefined ? this.feed : F.value > 0 && feedScale !== null ? F.value * feedScale : null;
    const feedMove = isArcMove || (isLinearMove && motionMode === 'G1');
    if (feedMove && F !== undefined && F.value > 0 && feedScale === null) {
      findings.push(block('unknown-state', 'the units in force before this line are not known, and the firmware converts F with them; set G20 or G21 on an earlier line'));
    } else if (feedMove && feed === null) {
      findings.push(block('feed-not-set', 'a feed move needs a feed rate: set F before the first G1, G2 or G3'));
    }
    // A move word on a rotary axis needs its axis mode (and radius in radius mode) to be modelled.
    // (Arcs refuse rotary words outright; G28/G30 are covered below.)
    if (isLinearMove) {
      for (const w of axisWords) {
        const f = this.#rotaryUnknown(w.letter as Axis);
        if (f !== null) findings.push(f);
      }
    }
    // A move word on a linear axis needs it to be a length the firmware moves (finding: inhibited axis, am on X/Y/Z).
    if (isLinearMove || isArcMove) {
      for (const w of axisWords) {
        const f = this.#linearModeFinding(w.letter as Axis);
        if (f !== null) findings.push(f);
      }
    }
    // G28/G30 also move every axis to the stored position. 440.21 passes that stored position through
    // `_calc_ABC` again (@cite TG canonical_machine.c:907-914 via cm_set_model_target), so a radius-mode
    // rotary axis would turn by a different amount than modelled; an unknown mode could be radius.
    if (action === 'G28' || action === 'G30') {
      const risky = ROTARY_AXES.filter((a) => {
        const mode = this.#motion.rotary[a]?.mode;
        return mode === undefined || mode === AXIS_MODE_RADIUS;
      });
      if (risky.length > 0) {
        findings.push(block('rotary-radius', `${action} cannot be modelled while ${risky.join(', ')} ${risky.length === 1 ? 'is' : 'are'} in radius mode or of unknown axis mode`));
      }
      // The stored-position leg skips a disabled axis on both firmwares, but EN moves a linear axis that
      // reads radius mode while 440.21 does not (@cite EN canonical_machine.c:1293-1300; TG via cm_set_model_target).
      const linearOdd = AXES.filter((a) => !ROTARY.has(a)).filter((a) => {
        const mode = this.#modeOf(a);
        return mode !== AXIS_MODE_STANDARD && mode !== AXIS_MODE_INHIBITED;
      });
      if (linearOdd.length > 0) {
        findings.push(block('axis-mode', `${action} cannot be modelled while ${linearOdd.join(', ')} ${linearOdd.length === 1 ? 'is' : 'are'} disabled, in radius mode or of unknown axis mode`));
      }
    }
    // Finding: inhibited axis. Any executed segment can drive an inhibited axis's motor to step 0.
    if (isLinearMove || isArcMove || action === 'G28' || action === 'G30') {
      const f = this.#jointRiskFinding();
      if (f !== null) findings.push(f);
    }

    const programStop = has('M0') || has('M60');
    const programEnd = has('M2') || has('M30');
    const optionalStop = codes.find((c) => c.code === 'M1')?.word ?? null;
    const outputsOn = ['M3', 'M4', 'M7', 'M8'].some(has);
    if (findings.some((f) => f.severity === 'block')) {
      // A rejected line is never sent, so it changes nothing: the rest of the file is analysed as it would
      // run without it, and its findings are not buried under consequences of this one.
      return { findings, ok: false, motion: null, toolChange, programStop, optionalStop, programEnd, outputsOn };
    }

    // --- Modal updates (they apply before the block's action, EN execution order). ---
    this.units = units;
    this.distance = distance;
    this.arcDistance = arcDistance;
    this.plane = plane;
    this.motionMode = motionMode;
    this.feed = feed;
    if (toolSet) {
      for (const w of axisWords) {
        const a = w.letter as Axis;
        const sc = this.#offsetScale(a, units);
        const before = this.#appliedTool(a);
        const beforeUnc = ROTARY.has(a) ? 0 : this.uTool[a];
        const after = sc === null ? null : w.value * sc;
        this.toolOffset[a] = after;
        this.uTool[a] = after === null ? Infinity : stepErrorMm(after);
        const applied = this.#appliedTool(a);
        this.#shift(a, before === null || applied === null ? null : before - applied, beforeUnc + (ROTARY.has(a) ? 0 : this.uTool[a]));
      }
    }
    if (toolCancel) {
      for (const a of AXES) {
        const before = this.#appliedTool(a);
        const beforeUnc = ROTARY.has(a) ? 0 : this.uTool[a];
        this.toolOffset[a] = 0;
        this.uTool[a] = 0;
        this.#shift(a, before, beforeUnc);
      }
    }
    this.#selectWcs(wcs);

    let motion: LineAnalysis['motion'] = null;
    if (action !== undefined) {
      motion = this.#action(action, axisWords, units, distance, params, findings);
    } else if (isLinearMove) {
      motion = this.#linear(codes, params, axisWords, units, distance, motionMode as 'G0' | 'G1', g53, findings);
    } else if (isArcMove) {
      motion = this.#arc(codes, params, axisWords, units, distance, arcDistance, plane, motionMode === 'G2', findings);
    }

    // --- Outputs and program flow (after motion in the block). ---
    if (S !== undefined) this.speed = S.value;
    if (T !== undefined) this.tool = T.value;
    if (has('M3')) this.spindle = 'cw';
    if (has('M4')) this.spindle = 'ccw';
    if (has('M5')) this.spindle = 'off';
    if (has('M7')) this.mist = true;
    if (has('M8')) this.flood = true;
    if (has('M9')) {
      this.mist = false;
      this.flood = false;
    }
    if (programEnd) this.#programEnd();

    const ok = !findings.some((f) => f.severity === 'block');
    return { findings, ok, motion: ok ? this.#chargeJointResidual(motion) : null, toolChange, programStop, optionalStop, programEnd, outputsOn };
  }

  /** null when the code may be sent; otherwise the finding that blocks (or warns about) it. */
  #checkCode(word: Word, code: string | undefined): Finding | null {
    const label = `${word.letter}${word.text}`;
    if (code === undefined) return block('unsupported-code', `${label} is not a valid code`);
    if (code === 'M100') return block('m100', 'M100 runs in-stream JSON commands and is never sent');
    if (/^G38(\.|$)/.test(code)) return block('probe', 'probing (G38) is not allowed in a job in this version');
    const rule = this.#rules.find((r) => r.kind === 'code' && r.code === code);
    if (rule !== undefined) return block(rule.id, rule.reason);
    if (this.#job.ignoredCodes.includes(code)) return { severity: 'warn', rule: 'ignored-code', message: `${code} is accepted and ignored by this firmware` };
    if (this.#job.codes.includes(code)) return null;
    const dotted = code.includes('.') ? ` (a dotted code is never sent as ${code.split('.')[0]})` : '';
    return block('unsupported-code', `${code} is not supported in a job on this firmware${dotted}`);
  }

  #checkGroups(codes: readonly string[], findings: Finding[]): void {
    const seen = new Map<string, string>();
    for (const code of codes) {
      const group = GROUP[code] ?? code;
      const prior = seen.get(group);
      seen.set(group, code);
      if (prior === undefined) continue;
      // EN allows M7 with M8 (SET_COOLANT_ON), but not M9 with either, or a repeat.
      if (group === 'coolant' && prior !== code && prior !== 'M9' && code !== 'M9') continue;
      findings.push(block('modal-conflict', `${prior} and ${code} are in the same modal group (E152)`));
    }
  }

  /** The dialect's modal block rules: G18 arcs, codes under a modal state (SAFETY §4.7 step 6). */
  #checkModalRules(
    codes: readonly string[],
    units: string | null,
    distance: string | null,
    plane: Plane | null,
    isArc: boolean,
    findings: Finding[],
  ): void {
    for (const rule of this.#rules) {
      if (rule.kind === 'arcInPlane' && isArc && (plane === rule.plane || plane === null)) {
        findings.push(block(rule.id, plane === null ? `${rule.reason} The active plane is not known.` : rule.reason));
      }
      if (rule.kind === 'codeUnderModal' && codes.some((c) => rule.codes.includes(c))) {
        const modes = [units, distance];
        if (modes.some((m) => m !== null && rule.modes.includes(m)) || modes.includes(null)) {
          findings.push(block(rule.id, modes.includes(null) ? `${rule.reason} The units or distance mode are not known.` : rule.reason));
        }
      }
    }
  }

  /** TG E088: at most `max` queued commands per line besides motion. */
  #checkQueued(codes: readonly string[], params: ReadonlyMap<string, Word>, findings: Finding[]): void {
    for (const rule of this.#rules) {
      if (rule.kind !== 'queuedCommandsPerLine') continue;
      let count = codes.filter((c) => rule.counted.includes(c)).length;
      for (const letter of ['S', 'T']) if (params.has(letter) && rule.counted.includes(letter)) count++;
      if (count > rule.max) findings.push(block(rule.id, rule.reason));
    }
  }

  /** Group-0 actions: offsets, stored positions, dwell. */
  #action(
    action: string,
    axisWords: readonly Word[],
    units: 'G20' | 'G21' | null,
    distance: 'G90' | 'G91' | null,
    params: ReadonlyMap<string, Word>,
    findings: Finding[],
  ): LineAnalysis['motion'] {
    switch (action) {
      case 'G10': {
        const target = WCS_CODES[(params.get('P') as Word).value - 1] as Wcs;
        const l20 = (params.get('L') as Word).value === 20;
        for (const w of axisWords) {
          const a = w.letter as Axis;
          const sc = this.#offsetScale(a, units);
          const value = sc === null ? null : w.value * sc;
          if (!l20) {
            const before = this.wcsOffsets[target][a];
            const beforeUnc = this.uWcs[target][a];
            this.wcsOffsets[target][a] = value;
            this.uWcs[target][a] = value === null ? Infinity : stepErrorMm(value);
            if (this.wcs === target) this.#shift(a, before === null || value === null ? null : before - value, beforeUnc + this.uWcs[target][a]);
          } else {
            // L20: the offset that makes the current position read `value` in that system (@cite EN canonical_machine.c:1055-1062).
            // It inherits the machine position's uncertainty; the work position then reads `value` itself.
            const m = this.machine[a];
            const g = this.#g92Part(a);
            const t = this.toolOffset[a];
            const known = m !== null && value !== null && g !== null && t !== null;
            this.wcsOffsets[target][a] = known ? m - value - g - t : null;
            this.uWcs[target][a] = known ? this.uMachine[a] + this.#g92PartUnc(a) + this.uTool[a] + stepErrorMm(m, value, g, t) : Infinity;
            if (this.wcs === target) this.#setWork(a, value);
          }
          // With the active system unknown, it may be the one that changed.
          if (this.wcs === null) {
            this.work[a] = null;
            this.uWork[a] = Infinity;
          }
        }
        return null;
      }
      case 'G92': {
        // Work position := value on the named axes; offsets applied on every axis (@cite EN canonical_machine.c:1199-1213).
        const offsets = { ...this.g92 };
        const unc = { ...this.uG92 };
        for (const w of axisWords) {
          const a = w.letter as Axis;
          const sc = this.#offsetScale(a, units);
          const value = sc === null ? null : w.value * sc;
          const m = this.machine[a];
          const wo = this.wcs === null ? null : this.wcsOffsets[this.wcs][a];
          const t = this.toolOffset[a];
          const known = m !== null && wo !== null && t !== null && value !== null;
          offsets[a] = known ? m - wo - t - value : null;
          // The offset inherits the machine position's uncertainty; the work position then reads `value` itself.
          unc[a] = known ? this.uMachine[a] + this.uWcs[this.wcs as Wcs][a] + this.uTool[a] + stepErrorMm(m, wo, t, value) : Infinity;
        }
        this.#setG92(true, offsets, unc);
        for (const w of axisWords) {
          const a = w.letter as Axis;
          const sc = this.#offsetScale(a, units);
          this.#setWork(a, sc === null ? null : w.value * sc);
        }
        return null;
      }
      case 'G92.1':
        this.#setG92(false, zeroPos(), exactUnc());
        return null;
      case 'G92.2':
        this.#setG92(false, null, null);
        return null;
      case 'G92.3':
        this.#setG92(true, null, null);
        return null;
      case 'G28.1':
        this.g28 = { ...this.machine };
        this.uG28 = { ...this.uMachine };
        return null;
      case 'G30.1':
        this.g30 = { ...this.machine };
        this.uG30 = { ...this.uMachine };
        return null;
      case 'G28':
      case 'G30':
        return this.#storedMove(action, axisWords, units, distance, findings);
      default:
        // G4: a dwell does not move.
        return null;
    }
  }

  /**
   * G28/G30: a rapid to the intermediate point, then a rapid on every axis to
   * the stored position (@cite EN canonical_machine.c:1390-1405). Two moves in
   * one block cannot be split, so the pair must fit within the ceiling. The
   * intermediate point is in work or machine coordinates as the dialect says
   * (`storedMoveIntermediate`; 440.21 reads it as machine coordinates).
   */
  #storedMove(
    action: 'G28' | 'G30',
    axisWords: readonly Word[],
    units: 'G20' | 'G21' | null,
    distance: 'G90' | 'G91' | null,
    findings: Finding[],
  ): LineAnalysis['motion'] {
    const stored = action === 'G28' ? this.g28 : this.g30;
    const storedUnc = action === 'G28' ? this.uG28 : this.uG30;
    const first: Partial<Record<Axis, number>> = {};
    const unknown: string[] = [];
    const machineFrame = this.#job.storedMoveIntermediate === 'machine';
    for (const w of axisWords) {
      const a = w.letter as Axis;
      let d: number | null;
      if (machineFrame && distance === 'G90') {
        const sc = this.#scale(a, units);
        const m = this.machine[a];
        d = sc === null || m === null ? null : w.value * sc - m;
      } else {
        d = this.#delta(a, w.value, units, distance);
      }
      if (d === null) unknown.push(a);
      else first[a] = d;
    }
    const second: Partial<Record<Axis, number>> = {};
    for (const a of AXES) {
      const m = this.machine[a];
      const s = stored[a];
      if (m === null || s === null) {
        unknown.push(`${action} ${a}`);
        continue;
      }
      second[a] = s - (m + (first[a] ?? 0));
    }
    if (unknown.length > 0) {
      this.machine = { ...stored };
      this.uMachine = { ...storedUnc };
      for (const a of AXES) this.#shift(a, null, Infinity);
      findings.push(block('unknown-state', `${action} cannot be modelled: the position or stored position of ${unique(unknown).join(', ')} is not known`));
      return null;
    }
    const legs = [first, second].map((delta) => {
      const moving = AXES.filter((a) => (delta[a] ?? 0) !== 0);
      const length = Math.hypot(...moving.map((a) => delta[a] as number));
      return { length, bound: this.#boundMm(delta), d: moveSeconds(moving, length, null, this.#motion) };
    });
    this.#moveBy(first);
    this.#moveBy(second);
    // The second leg ends at the stored position on every axis, which is only known to its reported precision.
    for (const a of AXES) this.#settle(a, 'machine', second[a] as number, storedUnc[a]);
    let seconds = 0;
    for (const leg of legs) {
      if (leg.d.kind !== 'ok') {
        findings.push(block('no-velocity-limit', noVelocityMessage(leg.d)));
        return null;
      }
      seconds += leg.d.seconds;
    }
    const plannerLength = legs.reduce((sum, leg) => sum + leg.length, 0);
    const boundMm = legs.reduce<number | null>((sum, leg) => (sum === null || leg.bound === null ? null : sum + leg.bound), 0);
    if (seconds > this.#motion.ceilingSeconds) {
      findings.push(block('split-impossible', `${action} moves for about ${formatNumber(seconds, 1)} s, above the queued-motion ceiling, and cannot be split`));
      return null;
    }
    return { kind: 'single', plannerLength, boundMm, seconds };
  }

  /** The delta (mm or degrees) an axis word asks for, or null when it depends on something unknown. */
  #delta(axis: Axis, value: number, units: 'G20' | 'G21' | null, distance: 'G90' | 'G91' | null): number | null {
    const sc = this.#scale(axis, units);
    if (sc === null || distance === null) return null;
    if (distance === 'G91') return value * sc;
    const w = this.work[axis];
    return w === null ? null : value * sc - w;
  }

  /** G0/G1, optionally under G53. */
  #linear(
    codes: readonly { word: Word; code: string }[],
    params: ReadonlyMap<string, Word>,
    axisWords: readonly Word[],
    units: 'G20' | 'G21' | null,
    distance: 'G90' | 'G91' | null,
    mode: 'G0' | 'G1',
    g53: boolean,
    findings: Finding[],
  ): LineAnalysis['motion'] {
    const delta: Partial<Record<Axis, number>> = {};
    const unknown: string[] = [];
    for (const w of axisWords) {
      const a = w.letter as Axis;
      let d: number | null;
      if (g53) {
        // G53 values are machine coordinates (G53 under G91 or an unknown distance mode is blocked above).
        const sc = this.#scale(a, units);
        const m = this.machine[a];
        d = sc === null || m === null ? null : w.value * sc - m;
      } else {
        d = this.#delta(a, w.value, units, distance);
      }
      if (d === null) unknown.push(a);
      else delta[a] = d;
    }
    if (unknown.length > 0) {
      this.#forget(axisWords);
      findings.push(block('unknown-state', unknownMessage(unknown.filter((a) => this.#needsUnits(a as Axis)), unknown, units, distance, g53)));
      return null;
    }
    const moving = AXES.filter((a) => (delta[a] ?? 0) !== 0);
    const plannerLength = Math.hypot(...moving.map((a) => delta[a] as number));
    const boundMm = this.#boundMm(delta);
    const feed = mode === 'G0' ? null : (this.feed as number);
    const d = moveSeconds(moving, plannerLength, feed, this.#motion);
    const start = { ...this.work };
    const startMachine = { ...this.machine };
    this.#moveBy(delta);
    for (const w of axisWords) this.#settle(w.letter as Axis, g53 ? 'machine' : distance === 'G91' ? 'incremental' : 'work', delta[w.letter as Axis] as number);
    if (d.kind !== 'ok') {
      findings.push(block('no-velocity-limit', noVelocityMessage(d)));
      return null;
    }
    if (d.seconds <= this.#motion.ceilingSeconds) return { kind: 'single', plannerLength, boundMm, seconds: d.seconds };

    const absolute = g53 || distance === 'G90';
    const axes: LinearAxis[] = axisWords.map((w) => {
      const a = w.letter as Axis;
      const sc = this.#scale(a, units) as number;
      const from = (g53 ? startMachine[a] : start[a]) ?? 0;
      return {
        axis: a,
        start: absolute ? from / sc : 0,
        delta: absolute ? w.value - from / sc : w.value,
        written: w.text,
        scale: sc,
        mmPerUnit: this.#mmPerUnit(a),
        decimals: !this.#needsUnits(a) ? DECIMALS.rotary : units === 'G20' ? DECIMALS.in : DECIMALS.mm,
      };
    });
    const split = splitLinear(axes, absolute, feed, d.seconds, this.#motion);
    if (split.kind !== 'ok') {
      findings.push(block('split-impossible', `this move cannot be split within the ceiling: ${split.detail}`));
      return null;
    }
    // An incremental split is one firmware sum per sub-segment, each adding float32 rounding to the position
    // (finding: arc uncertainty, verification of c2799da). `#settle` above counted one; add the rest.
    if (!absolute) {
      for (const w of axisWords) {
        const a = w.letter as Axis;
        const reach = Math.max(Math.abs(startMachine[a] ?? 0), Math.abs(this.machine[a] ?? 0));
        this.#widen(a, (split.segments.length - 1) * stepErrorMm(reach, delta[a] as number, this.totalOffset(a) ?? 0));
      }
    }
    const motionWords = g53 ? ['G53', mode] : [mode];
    return { kind: 'split', bodies: bodies(codes, params, split.segments, motionWords, new Set(['G53']), []), segments: split.segments, seconds: d.seconds };
  }

  /** G2/G3. */
  #arc(
    codes: readonly { word: Word; code: string }[],
    params: ReadonlyMap<string, Word>,
    axisWords: readonly Word[],
    units: 'G20' | 'G21' | null,
    distance: 'G90' | 'G91' | null,
    arcDistance: 'G90.1' | 'G91.1' | null,
    plane: Plane | null,
    clockwise: boolean,
    findings: Finding[],
  ): LineAnalysis['motion'] {
    const forget = (): null => {
      this.#forgetLinear();
      return null;
    };
    if (axisWords.some((w) => ROTARY.has(w.letter as Axis))) {
      findings.push(block('unsupported-word', 'rotary axis words on an arc are not modelled; write the rotary move on its own line'));
      return forget();
    }
    const centreFormat = !params.has('R');
    const unknown: string[] = [];
    if (plane === null) unknown.push('the plane');
    if (units === null) unknown.push('the units');
    if (distance === null) unknown.push('the distance mode');
    if (centreFormat && arcDistance === null) unknown.push('the arc distance mode');
    if (unknown.length > 0) {
      findings.push(block('unknown-state', `this arc cannot be modelled; not known: ${unknown.join(', ')}`));
      return forget();
    }
    const p = PLANES[plane as Plane];
    const s = units === 'G20' ? INCH_MM : 1;
    const deltaOf = (axis: Axis): number | null => {
      const w = params.get(axis);
      return w === undefined ? 0 : this.#delta(axis, w.value, units, distance);
    };
    const d0 = deltaOf(p.a0);
    const d1 = deltaOf(p.a1);
    const dLin = deltaOf(p.lin);
    const absoluteCentre = centreFormat && arcDistance === 'G90.1';
    const absolute = distance === 'G90';
    const noPlaneEndpoint = !params.has(p.a0) && !params.has(p.a1);
    const w0 = this.work[p.a0];
    const w1 = this.work[p.a1];
    const missing: string[] = [];
    if (d0 === null) missing.push(p.a0);
    if (d1 === null) missing.push(p.a1);
    if (dLin === null) missing.push(p.lin);
    if (absoluteCentre && (w0 === null || w1 === null)) missing.push(`${p.a0}${p.a1} (for the G90.1 centre)`);
    // An absolute full circle ends where it starts: both plane starts must be known, never assumed (independent review P0-10 #2).
    if (centreFormat && noPlaneEndpoint && absolute && (w0 === null || w1 === null)) missing.push(`${p.a0}${p.a1} (for an absolute full circle)`);
    if (missing.length > 0) {
      findings.push(block('unknown-state', `this arc cannot be modelled: the start position of ${missing.join(', ')} is not known`));
      return forget();
    }
    // The firmware decides coincidence in float32 machine coordinates; their size bounds its rounding (independent review P0-10 #1).
    const magnitude = this.#planeMagnitude([p.a0, p.a1]);
    if (magnitude === null) {
      findings.push(
        block('unknown-state', `this arc cannot be modelled: the machine position of ${p.a0} and ${p.a1} is needed to bound the firmware's float32 arithmetic`),
      );
      return forget();
    }
    const o = (letter: string): number => (params.get(letter)?.value ?? 0) * s;
    // How far the firmware's start-relative end point and centre can be from the model's: an absolute end point
    // word and a G90.1 centre are measured from the work start, which is only known to `uWork`; an incremental
    // word or offset is added to the firmware's own position and inherits nothing.
    let startUncertainty = 0;
    for (const a of [p.a0, p.a1]) {
      if ((absolute && params.has(a)) || absoluteCentre) startUncertainty = Math.max(startUncertainty, this.uWork[a]);
    }
    const input: ArcInput = {
      clockwise,
      d0: d0 as number,
      d1: d1 as number,
      dLin: dLin as number,
      centre: centreFormat
        ? { c0: absoluteCentre ? o(p.o0) - (w0 as number) : o(p.o0), c1: absoluteCentre ? o(p.o1) - (w1 as number) : o(p.o1) }
        : null,
      radius: centreFormat ? null : (params.get('R') as Word).value * s,
      noPlaneEndpoint,
      rotations: params.get('P')?.value ?? null,
      coincidence: this.#job.arcCoincidence,
      magnitudeMm: magnitude,
      startUncertaintyMm: startUncertainty,
    };
    const model = modelArc(input);
    if (model.kind === 'ambiguous') {
      findings.push(block('arc-ambiguous', `the firmware's float32 arithmetic could run this arc more than one way: ${model.detail}`));
      return forget();
    }
    if (model.kind !== 'ok') {
      findings.push(block('malformed', `the firmware would refuse this arc: ${model.detail}`));
      return forget();
    }
    const moving: Axis[] = [p.a0, p.a1];
    if (input.dLin !== 0) moving.push(p.lin);
    const feed = this.feed as number;
    const d = moveSeconds(moving, model.arc.lengthMm, feed, this.#motion);
    const start = { ...this.work };
    this.#moveBy({ [p.a0]: input.d0, [p.a1]: input.d1, [p.lin]: input.dLin });
    // An omitted axis ends exactly where it was (the firmware's target starts as its position).
    for (const [a, delta] of [[p.a0, input.d0], [p.a1, input.d1], [p.lin, input.dLin]] as const) {
      if (params.has(a)) this.#settle(a, absolute ? 'work' : 'incremental', delta);
    }
    if (d.kind !== 'ok') {
      findings.push(block('no-velocity-limit', noVelocityMessage(d)));
      return null;
    }
    // Arcs carry no rotary words (blocked above), so the arc length is a physical length in mm.
    if (d.seconds <= this.#motion.ceilingSeconds) {
      return { kind: 'single', plannerLength: model.arc.lengthMm, boundMm: model.arc.lengthMm, seconds: d.seconds };
    }

    const dec = units === 'G20' ? DECIMALS.in : DECIMALS.mm;
    const startOf = (axis: Axis): number | null => {
      const v = start[axis];
      return v === null ? null : v / s;
    };
    // An absolute split writes both plane axes on every sub-arc, so each start must be known (independent review P0-10 #2).
    const unwritable = absolute ? [p.a0, p.a1].filter((a) => startOf(a) === null) : [];
    if (unwritable.length > 0) {
      findings.push(
        block('unknown-state', `this arc must be split, but the start position of ${unwritable.join(', ')} is not known, so its sub-arc end points cannot be written`),
      );
      return null;
    }
    const writtenOf = (axis: Axis, delta: number): string => {
      const w = params.get(axis);
      if (w !== undefined) return w.text;
      return absolute ? formatNumber(startOf(axis) as number, dec) : formatNumber(delta / s, dec);
    };
    const split = splitArc(
      model.arc,
      input,
      {
        plane: plane as Plane,
        absolute,
        absoluteCentre,
        start0: startOf(p.a0),
        start1: startOf(p.a1),
        startLin: startOf(p.lin),
        scale: s,
        decimals: dec,
        written: { a0: writtenOf(p.a0, input.d0), a1: writtenOf(p.a1, input.d1), lin: writtenOf(p.lin, input.dLin) },
        linearMoves: input.dLin !== 0,
      },
      feed,
      d.seconds,
      this.#motion,
    );
    if (split.kind !== 'ok') {
      findings.push(block('split-impossible', `this arc cannot be split within the ceiling: ${split.detail}`));
      return null;
    }
    // The sub-arcs are what the firmware sums (finding: arc uncertainty, verification of c2799da):
    // - absolute: the last sub-arc writes an omitted plane axis as its start rounded to `dec` decimals, so the
    //   board ends at the written value, not exactly where it was;
    // - incremental: every sub-arc writes both plane axes (and a moving linear axis) as a distance the firmware
    //   adds to its own position, one float32 rounding each.
    if (absolute) {
      for (const a of [p.a0, p.a1]) {
        if (params.has(a)) continue;
        this.#settle(a, 'work', 0);
        this.#widen(a, Math.abs(Number(writtenOf(a, 0)) * s - (start[a] as number)));
      }
    } else {
      const n = split.segments.length;
      for (const a of [p.a0, p.a1]) this.#widen(a, n * stepErrorMm(model.arc.pathMagnitudeMm));
      if (input.dLin !== 0) {
        // An unknown position or offset (Number(null) is 0 here) already has an infinite bound.
        const lin = p.lin;
        const reach = Math.abs(Number(this.machine[lin])) + Math.abs(input.dLin);
        this.#widen(lin, n * stepErrorMm(reach, input.dLin, Number(this.totalOffset(lin))));
      }
    }
    const mode = clockwise ? 'G2' : 'G3';
    return { kind: 'split', bodies: bodies(codes, params, split.segments, [mode], new Set(), ['P']), segments: split.segments, seconds: d.seconds };
  }
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function unknownMessage(
  unitAxes: readonly string[],
  axes: readonly string[],
  units: string | null,
  distance: string | null,
  g53: boolean,
): string {
  const what: string[] = [];
  if (units === null && unitAxes.length > 0) what.push('the units');
  if (!g53 && distance === null) what.push('the distance mode');
  if (what.length === 0) what.push(`the ${g53 ? 'machine' : 'work'} position of ${axes.join(', ')}`);
  return `this move cannot be checked against the queued-motion ceiling; not known: ${what.join(' and ')}`;
}

/**
 * Sub-segment bodies. The first carries every word of the original line that
 * acts before motion (modal codes, spindle and coolant codes, then F, S, T
 * and any other parameter word); every one carries the motion code (and
 * G53, which applies to its own block only); the last carries the
 * program-flow codes that act after motion (M0, M1, M2, M30, M60), so
 * barriers and holdback land on it. Axis and arc words come from the
 * segment; `dropLetters` (the arc's P turns) are already in the geometry.
 */
function bodies(
  codes: readonly { word: Word; code: string }[],
  params: ReadonlyMap<string, Word>,
  segments: readonly Segment[],
  motionWords: readonly string[],
  perSegment: ReadonlySet<string>,
  dropLetters: readonly string[],
): string[] {
  const before: string[] = [];
  const after: string[] = [];
  for (const { code } of codes) {
    if (MOTION_CODES.has(code) || code === 'G80' || perSegment.has(code)) continue;
    (AFTER_MOTION.has(code) ? after : before).push(code);
  }
  for (const [letter, w] of params) {
    if (AXIS_LETTERS.has(letter) || ARC_LETTERS.has(letter) || dropLetters.includes(letter)) continue;
    before.push(`${letter}${w.text}`);
  }
  return segments.map((seg, i) => {
    const parts: string[] = [];
    if (i === 0) parts.push(...before);
    parts.push(...motionWords, ...seg.words);
    if (i === segments.length - 1) parts.push(...after);
    return parts.join(' ');
  });
}
