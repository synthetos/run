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
    ROTARY,
    stepErrorMm,
    type Plane
} from './geometry.ts';

import { canonicalCode, type Word } from './lex.ts';

import type { Axis, SanitizeOptions, Wcs } from './types.ts';

import { extentAt } from './extent.ts';

import { runAction } from './analyze/actions.ts';
import { arc } from './analyze/arc.ts';
import { chargeJointResidual, jointRiskFinding, linearModeFinding, modeOf, rotaryUnknown, withJointResidual } from './analyze/axisModes.ts';
import { ModelState } from './analyze/context.ts';
import { block, type Finding, type LineAnalysis } from './analyze/contract.ts';
import { checkModalRules, checkQueued } from './analyze/dialectRules.ts';
import { initialize } from './analyze/initialize.ts';
import { linear } from './analyze/linear.ts';
import { forget, forgetLinear, modelDelta, moveBy, planeMagnitude } from './analyze/motionPosition.ts';
import { appliedTool, g92Part, g92PartUnc, offsetUnc, selectWcs, setG92, shift, totalOffset, workAfterSet } from './analyze/offsets.ts';
import { outputsOn, resetProgram } from './analyze/outputs.ts';
import { type Pos, type Unc } from './analyze/positions.ts';
import { storedMove } from './analyze/stored.ts';
import { AXIS_ACTIONS, AXIS_LETTERS, GROUP, MOTION_CODES, ROTARY_AXES } from './analyze/tables.ts';
import { setWork, settle, widen } from './analyze/uncertainty.ts';
import { mmPerUnit, motionBound, needsUnits, offsetScale, scale, unitScale } from './analyze/units.ts';
import { checkCode, checkGroups } from './analyze/words.ts';
import { AXES, AXIS_MODE_INHIBITED, AXIS_MODE_RADIUS, AXIS_MODE_STANDARD, type AxisMode } from './types.ts';
export { type Finding, type LineAnalysis } from './analyze/contract.ts';


/** One modal model per sanitizer invocation. */
export class JobModel extends ModelState {


  constructor(dialect: Dialect, job: DialectJobGcode, options: SanitizeOptions) { super(); initialize(this, dialect, job, options); }


  /** The live axis mode, or undefined when it is not known. */
  #modeOf(axis: Axis): AxisMode | undefined { return modeOf(this, axis); }


  /**
   * A block for a move word on a linear axis the firmware does not move as a
   * length: unknown mode, disabled (the word is ignored), or radius mode
   * (refused by `cm_set_am` on X/Y/Z, and ignored by `cm_set_model_target`
   * if present) (@cite EN canonical_machine.c:531-545; TG canonical_machine.c:444-454).
   */
  #linearModeFinding(axis: Axis): Finding | null { return linearModeFinding(this, axis); }


  /** The block for motion while an inhibited (or possibly inhibited) axis may hold its motor away from step 0. */
  #jointRiskFinding(): Finding | null { return jointRiskFinding(this); }


  /** A motion line's bound with the residual of inhibited axes that read 0 added (`#jointResidualMm`). */
  #withJointResidual(bound: number | null): number | null { return withJointResidual(this, bound); }


  /** Every bound of an accepted motion line, with the inhibited-axis residual. */
  #chargeJointResidual(motion: LineAnalysis['motion']): LineAnalysis['motion'] { return chargeJointResidual(this, motion); }


  /**
   * Bound on the error of the work offset in force on an axis (`totalOffset`):
   * the sum of its parts' bounds. Infinite when the offset is unknown.
   */
  #offsetUnc(axis: Axis): number { return offsetUnc(this, axis); }


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
  #settle(axis: Axis, kind: 'work' | 'machine' | 'incremental', delta: number, targetUnc = 0): void { return settle(this, axis, kind, delta, targetUnc); }


  /**
   * Work offset in force on an axis: coordinate system + G92 (if applied) +
   * the applied tool offset, or null. This is the offset the firmware adds to
   * a target, not its display convention.
   */
  totalOffset(axis: Axis): number | null { return totalOffset(this, axis); }


  /**
   * The tool offset added to a target on this axis. EN adds it to X, Y and Z
   * only: the A/B/C loop of `cm_set_model_target` uses the coordinate offset
   * alone (@cite EN canonical_machine.c:536-539 vs :556-563), although G43.1
   * stores A/B/C values (@cite EN canonical_machine.c:1609, E155), which G92
   * and G10 L20 still subtract (@cite EN canonical_machine.c:1055-1061, :1205-1206).
   */
  #appliedTool(axis: Axis): number | null { return appliedTool(this, axis); }


  /**
   * The work position on `axis` right after G92 or G10 L20 (on the active
   * system) set it to `value`: the firmware subtracts the stored tool offset on
   * every axis but applies it only to X, Y and Z, so a rotary axis reads
   * `value` + its stored tool offset (null when either is unknown).
   */
  #workAfterSet(axis: Axis, value: number | null): number | null { return workAfterSet(this, axis, value); }


  /** Adds `mm` to the bound on both positions of an axis (rounding the model did not follow). */
  #widen(axis: Axis, mm: number): void { return widen(this, axis, mm); }


  /**
   * Sets the work position after G92 or G10 L20 made it read `value`: the
   * firmware derived the offset from its own position, so the work position
   * is `value` up to one sum's rounding (plus the stored tool offset's bound on
   * a rotary axis, see `#workAfterSet`).
   */
  #setWork(axis: Axis, value: number | null): void { return setWork(this, axis, value); }


  /** The G92 part of the work offset on an axis, or null when it is not known whether G92 applies. */
  #g92Part(axis: Axis): number | null { return g92Part(this, axis); }


  /**
   * After the work offset on `axis` changed by `change` (old part minus new
   * part; null when unknown): the machine did not move, so the work position
   * moves by the change. Where the machine position and the new offset are
   * both known, the work position is recomputed from them instead.
   * `changeUnc` bounds the error of the change (the old and new parts' bounds).
   */
  #shift(axis: Axis, change: number | null, changeUnc: number): void { return shift(this, axis, change, changeUnc); }


  /** Selects a coordinate system (G54..G59, or the default at program end). */
  #selectWcs(next: Wcs | null): void { return selectWcs(this, next); }


  /** The bound on the G92 part of the work offset on an axis. */
  #g92PartUnc(axis: Axis): number { return g92PartUnc(this, axis); }


  /** Sets whether G92 offsets apply, and to what with which bounds (null keeps them). */
  #setG92(active: boolean, offsets: Pos | null, unc: Unc | null): void { return setG92(this, active, offsets, unc); }


  /** mm per program unit of a linear word, or null when the units are unknown. */
  static #unitScale(units: 'G20' | 'G21' | null): number | null { return unitScale(units); }


  /**
   * mm (or degrees) per program unit of a move target on an axis, or null
   * when it depends on something unknown. A rotary axis in radius mode reads
   * the word in linear units and turns it into degrees (@cite EN
   * canonical_machine.c:517-521 `_calc_ABC`; TG the same); every other
   * rotary mode reads degrees.
   */
  #scale(axis: Axis, units: 'G20' | 'G21' | null): number | null { return scale(this, axis, units); }


  /**
   * mm (or degrees) per program unit of an offset word (G10, G92, G43.1).
   * Offsets never use the radius conversion. EN stores rotary offsets as
   * written, in degrees (@cite EN canonical_machine.c:1054, :1206, :1609);
   * 440.21 applies `_to_millimeters` to every axis, so a rotary offset under
   * G20 is scaled by 25.4 (@cite TG canonical_machine.c:669, :788-789), which
   * the dialect states as `rotaryOffsetsUseUnits`.
   */
  #offsetScale(axis: Axis, units: 'G20' | 'G21' | null): number | null { return offsetScale(this, axis, units); }


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
  #mmPerUnit(axis: Axis): number | null { return mmPerUnit(this, axis); }


  /** The true travel bound of a move by these model-unit deltas, mm, or null (see `travelBoundMm`). */
  #boundMm(delta: Readonly<Partial<Record<Axis, number>>>): number | null { return motionBound(this, delta); }


  /** Whether a word on this axis needs the program units to be modelled as a move target. */
  #needsUnits(axis: Axis): boolean { return needsUnits(this, axis); }


  /**
   * A block for a move word on a rotary axis whose mode or radius is not
   * known: the word could be degrees or linear units, and a radius-mode axis
   * turns 360 / (2π × ra) degrees per mm (about 57× at ra = 1).
   */
  #rotaryUnknown(axis: Axis): Finding | null { return rotaryUnknown(this, axis); }


  /** Moves by known deltas: both positions follow, unknowns stay unknown. The caller settles the bounds (`#settle`). */
  #moveBy(delta: Readonly<Partial<Record<Axis, number>>>): void { return moveBy(this, delta); }


  /** Forgets the positions of the axes these words name. */
  #forget(axisWords: readonly Word[]): void { return forget(this, axisWords); }


  /** Forgets X, Y and Z (an arc that could not be modelled may have moved any of them). */
  #forgetLinear(): void { return forgetLinear(this); }


  /**
   * The largest absolute machine coordinate, work coordinate or work offset
   * on these axes (mm), widened by how uncertain the machine coordinate is,
   * or null when a machine coordinate is unknown. It sizes the float32
   * rounding band of an arc (geometry.ts `positionErrorMm`).
   */
  #planeMagnitude(axes: readonly Axis[]): number | null { return planeMagnitude(this, axes); }


  /** Commanded outputs at this point (SAFETY H48). */
  outputsOn(): boolean { return outputsOn(this); }


  /**
   * Program end resets the modal state (@cite EN canonical_machine.c:2191-2214; TG canonical_machine.c:1362-1374):
   * G92 cancelled, the default coordinate system and plane, G94, motion cancelled. EN also restores the
   * default units and sets G90; TG keeps the units and restores the default distance mode. Where the two
   * differ, the value is kept only if both firmwares agree on it, otherwise it becomes unknown.
   */
  #programEnd(): void { return resetProgram(this); }


  /** Analyses one line (comments and N words already removed) and advances the model. */
  analyze(words: readonly Word[]): LineAnalysis {
    const findings: Finding[] = [];
    this._extent = extentAt(this.machine);
    const codes: { word: Word; code: string }[] = [];
    const params = new Map<string, Word>();
    const job = this._job;

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
      const rule = this._rules.find((r): r is Extract<GcodeRule, { kind: 'word' }> => r.kind === 'word' && r.letter === w.letter);
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
    if (toolChange && this._options.c14 !== true) {
      const tool = T !== undefined && Number.isInteger(T.value) && T.value >= 0 ? ` (T${String(T.value)})` : '';
      // Phase 3 (SAFETY §4.4a, H74): M6 does not pause on TinyG (it only stores the tool number), so run stops the
      // stream before the line, turns the spindle and coolant off, and walks the user through the change.
      if (this._manualToolChange) findings.push({ severity: 'info', rule: 'tool-change-stop', message: `Tool change${tool}: Run stops here for a manual tool change.` });
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
    const toolCancel = has('G49') && this._hasToolOffset;
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
    if (action === 'G10' && (L === undefined || !this._lWords.includes(L.value))) {
      findings.push(block('l-word', `G10 needs L${this._lWords.join(' or L')} on this firmware`));
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
        const mode = this._motion.rotary[a]?.mode;
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
      return { findings, ok: false, motion: null, toolChange, programStop, optionalStop, programEnd, outputsOn, extent: null };
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
    return { findings, ok, motion: ok ? this.#chargeJointResidual(motion) : null, toolChange, programStop, optionalStop, programEnd, outputsOn, extent: ok && motion !== null ? this._extent : null };
  }


  /** null when the code may be sent; otherwise the finding that blocks (or warns about) it. */
  #checkCode(word: Word, code: string | undefined): Finding | null { return checkCode(this, word, code); }


  #checkGroups(codes: readonly string[], findings: Finding[]): void { return checkGroups(codes, findings); }


  /** The dialect's modal block rules: G18 arcs, codes under a modal state (SAFETY §4.7 step 6). */
  #checkModalRules(
    codes: readonly string[],
    units: string | null,
    distance: string | null,
    plane: Plane | null,
    isArc: boolean,
    findings: Finding[],
  ): void { return checkModalRules(this, codes, units, distance, plane, isArc, findings); }


  /** TG E088: at most `max` queued commands per line besides motion. */
  #checkQueued(codes: readonly string[], params: ReadonlyMap<string, Word>, findings: Finding[]): void { return checkQueued(this, codes, params, findings); }


  /** Group-0 actions: offsets, stored positions, dwell. */
  #action(
    action: string,
    axisWords: readonly Word[],
    units: 'G20' | 'G21' | null,
    distance: 'G90' | 'G91' | null,
    params: ReadonlyMap<string, Word>,
    findings: Finding[],
  ): LineAnalysis['motion'] { return runAction(this, action, axisWords, units, distance, params, findings); }


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
  ): LineAnalysis['motion'] { return storedMove(this, action, axisWords, units, distance, findings); }


  /** The delta (mm or degrees) an axis word asks for, or null when it depends on something unknown. */
  #delta(axis: Axis, value: number, units: 'G20' | 'G21' | null, distance: 'G90' | 'G91' | null): number | null { return modelDelta(this, axis, value, units, distance); }


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
  ): LineAnalysis['motion'] { return linear(this, codes, params, axisWords, units, distance, mode, g53, findings); }


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
  ): LineAnalysis['motion'] { return arc(this, codes, params, axisWords, units, distance, arcDistance, plane, clockwise, findings); }
}
