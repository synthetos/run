/**
 * Types of the job sanitiser (ROADMAP P0-10, SAFETY §4.7).
 *
 * The sanitiser's output is the single source of truth: preview, analyser,
 * preflight and the streamer all use exactly `SanitizeResult.lines`
 * (SAFETY §4.7 "Single source of truth"), never the original file.
 */
import type { DialectId } from '@synthetos/protocol';

/** Axes TinyG knows. X, Y and Z are linear (mm); A, B and C are rotary (degrees). */
export type Axis = 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C';

export const AXES: readonly Axis[] = Object.freeze(['X', 'Y', 'Z', 'A', 'B', 'C']);

/** A value per axis. A missing axis is unknown. */
export type AxisValues = Readonly<Partial<Record<Axis, number>>>;

export type Wcs = 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';

export const WCS_CODES: readonly Wcs[] = Object.freeze(['G54', 'G55', 'G56', 'G57', 'G58', 'G59']);

/**
 * The machine's state when the job starts, read from the live board
 * (polled reads, SAFETY §4.2). Every field is optional: what is missing is
 * unknown, and the sanitiser never guesses it. A move whose length depends
 * on an unknown value cannot be checked against the queued-motion ceiling
 * and is blocked (SAFETY §4.7 step 6a).
 */
export interface StartState {
  /** `gun`: program units. */
  readonly units?: 'G20' | 'G21';
  /** `gdi`: distance mode. */
  readonly distance?: 'G90' | 'G91';
  /** Arc distance mode (EN `admo`). */
  readonly arcDistance?: 'G90.1' | 'G91.1';
  /** `gpl`: the active plane. */
  readonly plane?: 'G17' | 'G18' | 'G19';
  /** The modal motion mode in force. */
  readonly motion?: 'G0' | 'G1' | 'G2' | 'G3' | 'G80';
  /** The modal feed rate, in mm/min. */
  readonly feedMmPerMin?: number;
  /** `gco`: the active work coordinate system. */
  readonly wcs?: Wcs;
  /** Machine position (`mpo`), mm and degrees. */
  readonly machine?: AxisValues;
  /** G54..G59 offsets (`g54x`..), mm and degrees. */
  readonly wcsOffsets?: Readonly<Partial<Record<Wcs, AxisValues>>>;
  /** G92 origin offsets, and whether they are applied. */
  readonly g92?: { readonly offsets: AxisValues; readonly active: boolean };
  /** Tool length offset (EN G43.1), mm and degrees. */
  readonly toolOffset?: AxisValues;
  /** Stored G28 and G30 positions, machine coordinates. */
  readonly g28?: AxisValues;
  readonly g30?: AxisValues;
  /** The board's G-code defaults (`gun`, `gdi`, `gpl`, `gco`), which program end restores. */
  readonly defaults?: {
    readonly units?: 'G20' | 'G21';
    readonly distance?: 'G90' | 'G91';
    readonly plane?: 'G17' | 'G18' | 'G19';
    readonly wcs?: Wcs;
  };
  /** Commanded outputs at the start. Missing means off: the end-state rule is about what the file commands. */
  readonly spindle?: 'off' | 'cw' | 'ccw';
  readonly mist?: boolean;
  readonly flood?: boolean;
}

/**
 * The velocity model for the queued-motion ceiling (SAFETY §4.3): a move's
 * modelled duration is its length over `v_eff = min(F, vm) × k`.
 */
export interface MotionModel {
  /** The queued-motion ceiling in seconds (SAFETY §4.3: default 5, range 2–20). */
  readonly ceilingSeconds: number;
  /** The `k` factor (default 0.5, bench-tuned in B-WD-1). Range (0, 1]. */
  readonly k: number;
  /**
   * The board's maximum velocity per axis (`xvm`..`cvm`), mm/min for X, Y, Z
   * and degrees/min for A, B, C. A move on an axis with no value is blocked.
   */
  readonly maxVelocity: AxisValues;
}

export interface SanitizeOptions {
  readonly motion: MotionModel;
  /** The live start state (SAFETY §4.7 step 6a needs positions to model moves). */
  readonly start?: StartState;
  /** C14 accepted: a tool change gets `M5`, `M9`, `M0` before it, and the M0 is a barrier. */
  readonly c14?: boolean;
  /** C22 accepted: a file that ends with outputs on gets `M5` and `M9` (SAFETY H48). */
  readonly c22?: boolean;
  /** Optional stop on: M1 is a barrier (SAFETY §4.7 step 7). */
  readonly optionalStop?: boolean;
}

/** Where a sent line came from. */
export type LineOrigin =
  /** A line of the file, as written apart from the changes the report lists. */
  | 'file'
  /** A sub-segment of a long move (step 6a). */
  | 'split'
  /** `M5`, `M9`, `M0` before a tool change (C14). */
  | 'c14'
  /** `M5`, `M9` for the end state (C22). */
  | 'c22';

/** The modelled motion of one sent line. */
export interface LineMotion {
  /** Path length, mm (degrees count as mm for rotary-only moves, as TinyG does). */
  readonly lengthMm: number;
  /** Modelled duration at `v_eff` (SAFETY §4.3). Never above the ceiling. */
  readonly seconds: number;
}

/** One line the host will send. The streamer writes `text` followed by exactly one LF. */
export interface SentLine {
  /** Host line number: 1, 2, 3, ... with no gaps (step 9). */
  readonly n: number;
  /** The bytes to send, without the terminator: `N<n> <body>`. Printable ASCII only, never CR or LF. */
  readonly text: string;
  /** `text` without the N prefix. */
  readonly body: string;
  /** The 1-based line of the file this came from; for inserted lines, the line they were inserted for. */
  readonly sourceLine: number;
  readonly origin: LineOrigin;
  /** A host barrier: feeding stops after this line until the board has drained (SAFETY §4.7 step 7, PN §9.2). */
  readonly barrier: boolean;
  /** The final M2/M30: sent only when every earlier line is acknowledged and no alarm (SAFETY H35). */
  readonly holdback: boolean;
  /** Modelled motion, or null for a line that does not move. */
  readonly motion: LineMotion | null;
}

/** The terminator the streamer appends to every `SentLine.text`. LF only (SAFETY §4.7 step 1). */
export const LINE_TERMINATOR = '\n';

export type Severity =
  /** The job cannot run (a rejected line, or a file-level block). */
  | 'block'
  /** Kept, but the user should know. */
  | 'warn'
  /** A change the sanitiser made. */
  | 'change';

/** Stable ids for every rule the sanitiser applies. Dialect rules use their own `GcodeRule.id`. */
export type SanitizeRule =
  | 'read-only-dialect'
  | 'control-byte'
  | 'unclosed-comment'
  | 'comment-stripped'
  | 'dropped-empty'
  | 'dropped-tape-marker'
  | 'first-character'
  | 'n-word-stripped'
  | 'realtime-character'
  | 'non-ascii'
  | 'invalid-character'
  | 'malformed'
  | 'm100'
  | 'probe'
  | 'unsupported-code'
  | 'unsupported-word'
  | 'ignored-code'
  | 'modal-conflict'
  | 'negative-feed'
  | 'negative-speed'
  | 'bad-tool'
  | 'bad-parameter'
  | 'l-word'
  | 'm6-without-c14'
  | 'c14-inserted'
  | 'feed-not-set'
  | 'unknown-state'
  | 'no-velocity-limit'
  | 'split'
  | 'split-impossible'
  | 'too-long'
  | 'm1-dropped'
  | 'mid-file-program-end'
  | 'end-state'
  | 'c22-inserted'
  | (string & { readonly __dialectRule?: never });

/** One entry of the report. `line` is 1-based in the original file (0 for file-level entries). */
export interface ReportEntry {
  readonly line: number;
  readonly severity: Severity;
  readonly rule: SanitizeRule;
  readonly message: string;
}

/** One long move replaced by sub-segments (step 6a). */
export interface SplitRecord {
  readonly line: number;
  readonly segments: number;
  /** Modelled duration of the original move. */
  readonly seconds: number;
}

/** Commanded outputs at the end of the sanitised lines (SAFETY H48, T-S76; DONE shows this). */
export interface EndState {
  readonly spindle: 'off' | 'cw' | 'ccw';
  readonly mist: boolean;
  readonly flood: boolean;
}

export interface SanitizeReport {
  readonly dialect: DialectId;
  /** True when anything blocks the job. The streamer and Arm refuse a blocked result. */
  readonly blocked: boolean;
  readonly entries: readonly ReportEntry[];
  readonly splits: readonly SplitRecord[];
  /** The longest single modelled move in seconds, for C7. */
  readonly longestMoveSeconds: number;
  readonly endState: EndState;
}

export interface SanitizeResult {
  readonly lines: readonly SentLine[];
  readonly report: SanitizeReport;
}
