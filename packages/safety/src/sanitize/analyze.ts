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
  splitArc,
  splitLinear,
  type ArcInput,
  type LinearAxis,
  type Plane,
  type Segment,
} from './geometry.ts';
import { canonicalCode, type Word } from './lex.ts';
import type { Axis, MotionModel, ReportEntry, SanitizeOptions, SanitizeRule, StartState, Wcs } from './types.ts';
import { AXES, WCS_CODES } from './types.ts';

type Pos = Record<Axis, number | null>;

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
    | { readonly kind: 'single'; readonly lengthMm: number; readonly seconds: number }
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

  constructor(dialect: Dialect, job: DialectJobGcode, options: SanitizeOptions) {
    this.#job = job;
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
    this.work = emptyPos();
    for (const a of AXES) {
      const m = this.machine[a];
      const t = this.totalOffset(a);
      this.work[a] = m !== null && t !== null ? m - t : null;
    }
  }

  /** Work offset in force on an axis: coordinate system + G92 (if applied) + tool offset, or null. */
  totalOffset(axis: Axis): number | null {
    if (this.wcs === null) return null;
    const w = this.wcsOffsets[this.wcs][axis];
    const g = this.#g92Part(axis);
    const t = this.toolOffset[axis];
    return w === null || g === null || t === null ? null : w + g + t;
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
   */
  #shift(axis: Axis, change: number | null): void {
    const m = this.machine[axis];
    const t = this.totalOffset(axis);
    const w = this.work[axis];
    if (m !== null && t !== null) this.work[axis] = m - t;
    else if (change === 0) return;
    else this.work[axis] = w !== null && change !== null ? w + change : null;
  }

  /** Selects a coordinate system (G54..G59, or the default at program end). */
  #selectWcs(next: Wcs | null): void {
    const prev = this.wcs;
    if (next === prev) return;
    this.wcs = next;
    for (const a of AXES) {
      const before = prev === null ? null : this.wcsOffsets[prev][a];
      const after = next === null ? null : this.wcsOffsets[next][a];
      this.#shift(a, before === null || after === null ? null : before - after);
    }
  }

  /** Sets whether G92 offsets apply, and to what (null keeps them). */
  #setG92(active: boolean, offsets: Pos | null): void {
    const before = AXES.map((a) => this.#g92Part(a));
    this.g92Active = active;
    if (offsets !== null) this.g92 = offsets;
    AXES.forEach((a, i) => {
      const b = before[i] as number | null;
      const after = this.#g92Part(a);
      this.#shift(a, b === null || after === null ? null : b - after);
    });
  }

  /** mm (or degrees) per program unit for an axis, or null when the units are unknown. */
  #scale(axis: Axis, units: 'G20' | 'G21' | null): number | null {
    if (ROTARY.has(axis)) return 1;
    return units === null ? null : units === 'G20' ? INCH_MM : 1;
  }

  /** Moves by known deltas: both positions follow, unknowns stay unknown. */
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
    }
  }

  /** Forgets X, Y and Z (an arc that could not be modelled may have moved any of them). */
  #forgetLinear(): void {
    for (const a of AXES) {
      if (ROTARY.has(a)) continue;
      this.work[a] = null;
      this.machine[a] = null;
    }
  }

  /** Commanded outputs at this point (SAFETY H48). */
  outputsOn(): boolean {
    return this.spindle !== 'off' || this.mist || this.flood;
  }

  /**
   * Program end resets the modal state (@cite EN canonical_machine.c:2020-2043; TG canonical_machine.c:1362-1374):
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
    this.#setG92(false, zeroPos());
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
      findings.push(block('m6-without-c14', 'a tool change needs C14: TinyG only stores the tool number, and the spindle keeps running'));
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
    if ((isArcMove || (isLinearMove && motionMode === 'G1')) && !(F !== undefined ? F.value > 0 : this.feed !== null)) {
      findings.push(block('feed-not-set', 'a feed move needs a feed rate: set F before the first G1, G2 or G3'));
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
    if (F !== undefined) this.feed = units === null ? null : F.value * (units === 'G20' ? INCH_MM : 1);
    if (F !== undefined && F.value <= 0) this.feed = null;
    if (toolSet) {
      for (const w of axisWords) {
        const a = w.letter as Axis;
        const sc = this.#scale(a, units);
        const before = this.toolOffset[a];
        const after = sc === null ? null : w.value * sc;
        this.toolOffset[a] = after;
        this.#shift(a, before === null || after === null ? null : before - after);
      }
    }
    if (toolCancel) {
      for (const a of AXES) {
        const before = this.toolOffset[a];
        this.toolOffset[a] = 0;
        this.#shift(a, before);
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
    return { findings, ok, motion: ok ? motion : null, toolChange, programStop, optionalStop, programEnd, outputsOn };
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
          const sc = this.#scale(a, units);
          const value = sc === null ? null : w.value * sc;
          if (!l20) {
            const before = this.wcsOffsets[target][a];
            this.wcsOffsets[target][a] = value;
            if (this.wcs === target) this.#shift(a, before === null || value === null ? null : before - value);
          } else {
            // L20: the offset that makes the current position read `value` in that system (@cite EN canonical_machine.c:990-997).
            const m = this.machine[a];
            const g = this.#g92Part(a);
            const t = this.toolOffset[a];
            this.wcsOffsets[target][a] = m === null || value === null || g === null || t === null ? null : m - value - g - t;
            if (this.wcs === target) this.work[a] = value;
          }
          // With the active system unknown, it may be the one that changed.
          if (this.wcs === null) this.work[a] = null;
        }
        return null;
      }
      case 'G92': {
        // Work position := value on the named axes; offsets applied on every axis (@cite EN canonical_machine.c:1120-1134).
        const offsets = { ...this.g92 };
        for (const w of axisWords) {
          const a = w.letter as Axis;
          const sc = this.#scale(a, units);
          const value = sc === null ? null : w.value * sc;
          const m = this.machine[a];
          const wo = this.wcs === null ? null : this.wcsOffsets[this.wcs][a];
          const t = this.toolOffset[a];
          offsets[a] = m === null || wo === null || t === null || value === null ? null : m - wo - t - value;
        }
        this.#setG92(true, offsets);
        for (const w of axisWords) {
          const sc = this.#scale(w.letter as Axis, units);
          this.work[w.letter as Axis] = sc === null ? null : w.value * sc;
        }
        return null;
      }
      case 'G92.1':
        this.#setG92(false, zeroPos());
        return null;
      case 'G92.2':
        this.#setG92(false, null);
        return null;
      case 'G92.3':
        this.#setG92(true, null);
        return null;
      case 'G28.1':
        this.g28 = { ...this.machine };
        return null;
      case 'G30.1':
        this.g30 = { ...this.machine };
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
   * the stored position (@cite EN canonical_machine.c:1302-1317). Two moves in
   * one block cannot be split, so the pair must fit within the ceiling.
   */
  #storedMove(
    action: 'G28' | 'G30',
    axisWords: readonly Word[],
    units: 'G20' | 'G21' | null,
    distance: 'G90' | 'G91' | null,
    findings: Finding[],
  ): LineAnalysis['motion'] {
    const stored = action === 'G28' ? this.g28 : this.g30;
    const first: Partial<Record<Axis, number>> = {};
    const unknown: string[] = [];
    for (const w of axisWords) {
      const a = w.letter as Axis;
      const d = this.#delta(a, w.value, units, distance);
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
      for (const a of AXES) this.#shift(a, null);
      findings.push(block('unknown-state', `${action} cannot be modelled: the position or stored position of ${unique(unknown).join(', ')} is not known`));
      return null;
    }
    const legs = [first, second].map((delta) => {
      const moving = AXES.filter((a) => (delta[a] ?? 0) !== 0);
      const length = Math.hypot(...moving.map((a) => delta[a] as number));
      return { length, d: moveSeconds(moving, length, null, this.#motion) };
    });
    this.#moveBy(first);
    this.#moveBy(second);
    let seconds = 0;
    for (const leg of legs) {
      if (leg.d.kind !== 'ok') {
        findings.push(block('no-velocity-limit', `no maximum velocity is known for axis ${leg.d.axis}`));
        return null;
      }
      seconds += leg.d.seconds;
    }
    const lengthMm = legs.reduce((sum, leg) => sum + leg.length, 0);
    if (seconds > this.#motion.ceilingSeconds) {
      findings.push(block('split-impossible', `${action} moves for about ${formatNumber(seconds, 1)} s, above the queued-motion ceiling, and cannot be split`));
      return null;
    }
    return { kind: 'single', lengthMm, seconds };
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
        // G53 values are machine coordinates whatever the distance mode.
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
      findings.push(block('unknown-state', unknownMessage(unknown, units, distance, g53)));
      return null;
    }
    const moving = AXES.filter((a) => (delta[a] ?? 0) !== 0);
    const lengthMm = Math.hypot(...moving.map((a) => delta[a] as number));
    const feed = mode === 'G0' ? null : (this.feed as number);
    const d = moveSeconds(moving, lengthMm, feed, this.#motion);
    const start = { ...this.work };
    const startMachine = { ...this.machine };
    this.#moveBy(delta);
    if (d.kind !== 'ok') {
      findings.push(block('no-velocity-limit', `no maximum velocity is known for axis ${d.axis}`));
      return null;
    }
    if (d.seconds <= this.#motion.ceilingSeconds) return { kind: 'single', lengthMm, seconds: d.seconds };

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
        decimals: ROTARY.has(a) ? DECIMALS.rotary : units === 'G20' ? DECIMALS.in : DECIMALS.mm,
      };
    });
    const split = splitLinear(axes, absolute, feed, d.seconds, this.#motion);
    if (split.kind !== 'ok') {
      findings.push(block('split-impossible', `this move cannot be split within the ceiling: ${split.detail}`));
      return null;
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
    const w0 = this.work[p.a0];
    const w1 = this.work[p.a1];
    const missing: string[] = [];
    if (d0 === null) missing.push(p.a0);
    if (d1 === null) missing.push(p.a1);
    if (dLin === null) missing.push(p.lin);
    if (absoluteCentre && (w0 === null || w1 === null)) missing.push(`${p.a0}${p.a1} (for the G90.1 centre)`);
    if (missing.length > 0) {
      findings.push(block('unknown-state', `this arc cannot be modelled: the start position of ${missing.join(', ')} is not known`));
      return forget();
    }
    const o = (letter: string): number => (params.get(letter)?.value ?? 0) * s;
    const input: ArcInput = {
      clockwise,
      d0: d0 as number,
      d1: d1 as number,
      dLin: dLin as number,
      centre: centreFormat
        ? { c0: absoluteCentre ? o(p.o0) - (w0 as number) : o(p.o0), c1: absoluteCentre ? o(p.o1) - (w1 as number) : o(p.o1) }
        : null,
      radius: centreFormat ? null : (params.get('R') as Word).value * s,
      noPlaneEndpoint: !params.has(p.a0) && !params.has(p.a1),
      rotations: params.get('P')?.value ?? null,
    };
    const model = modelArc(input);
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
    if (d.kind !== 'ok') {
      findings.push(block('no-velocity-limit', `no maximum velocity is known for axis ${d.axis}`));
      return null;
    }
    if (d.seconds <= this.#motion.ceilingSeconds) return { kind: 'single', lengthMm: model.arc.lengthMm, seconds: d.seconds };

    const absolute = distance === 'G90';
    const dec = units === 'G20' ? DECIMALS.in : DECIMALS.mm;
    const startOf = (axis: Axis): number => (start[axis] ?? 0) / s;
    const writtenOf = (axis: Axis, delta: number): string => {
      const w = params.get(axis);
      if (w !== undefined) return w.text;
      return absolute ? formatNumber(startOf(axis), dec) : formatNumber(delta / s, dec);
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
    const mode = clockwise ? 'G2' : 'G3';
    return { kind: 'split', bodies: bodies(codes, params, split.segments, [mode], new Set(), ['P']), segments: split.segments, seconds: d.seconds };
  }
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function unknownMessage(axes: readonly string[], units: string | null, distance: string | null, g53: boolean): string {
  const what: string[] = [];
  if (units === null && axes.some((a) => !ROTARY.has(a as Axis))) what.push('the units');
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
