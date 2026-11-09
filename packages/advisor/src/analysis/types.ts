/**
 * The job analysis report's shapes (docs/design/ANALYZE.md §1, slice 1).
 *
 * The input is the interpreter's event tape, described here structurally (`ProgramTape`): advisor never imports the
 * interpreter (.dependency-cruiser.cjs `layer-advisor`), and the app passes `@synthetos/gcode`'s `EventTape`
 * straight in. A test in the app keeps the codes below equal to the interpreter's.
 *
 * Every value the page shows carries its evidence: where it came from (the file, the board, a saved reading, the
 * machine profile, the user, or an assumption) and in what units. Unknown stays unknown (`value: null`), never 0.
 */

/** Where a value came from. */
export type EvidenceSource = 'file' | 'board' | 'saved-board' | 'profile' | 'user' | 'assumption';

export interface Evidence<T> {
  /** The value, or null when it is not known. */
  readonly value: T | null;
  readonly source: EvidenceSource;
  /** How the page names the source ("Board settings", "Last read 14:02", "From the file"). */
  readonly label: string;
  readonly units: string;
  /** When the reading was taken (epoch milliseconds), for board and saved values. */
  readonly observedAt?: number;
}

/** Event kinds, equal to `@synthetos/gcode` `EVENT`. */
export const TAPE_KIND = Object.freeze({ LINE: 0, ARC: 1, DWELL: 2, COMMAND: 3, BARRIER: 4, TOOL_CHANGE: 5, UNMODELLED: 6 });

/** Event flags, equal to `@synthetos/gcode` `EVENT_FLAG`. */
export const TAPE_FLAG = Object.freeze({ RAPID: 1, UNCERTAIN: 2, ROTARY: 4, INSERTED: 8, SPLIT: 16 });

/** The interpreter's event tape, as far as the analysis reads it (`@synthetos/gcode` `EventTape`). */
export interface ProgramTape {
  readonly count: number;
  readonly kinds: Uint8Array;
  readonly flags: Uint8Array;
  readonly sent: Uint32Array;
  readonly source: Uint32Array;
  readonly lengthMm: Float64Array;
  readonly delta: Float64Array;
  readonly feed: Float64Array;
  readonly spindle: Float64Array;
  readonly tool: Int32Array;
  readonly seconds: Float64Array;
}

/** A CAM operation heading from the file's comments (descriptive only: it never makes a stop or a boundary in time). */
export interface OperationHeading {
  readonly line: number;
  readonly name: string;
}

export interface ReportOptions {
  readonly headings?: readonly OperationHeading[];
  /** Lines per second above which a section counts as dense (an assumption until delivery is measured). */
  readonly denseLinesPerSecond?: number;
}

/** One feed regime inside an operation: a plunge, a ramp or a cut at one programmed feed. */
export interface FeedRegime {
  readonly kind: 'plunge' | 'ramp' | 'cut';
  /** mm/min, or null when the file set no feed. */
  readonly feed: number | null;
  /** The S word in force at its first move, or null. */
  readonly spindle: number | null;
  readonly moves: number;
  readonly mm: number;
  /** At the programmed feed, or null when the feed is unknown. */
  readonly seconds: number | null;
  readonly firstLine: number;
  /** The sent-line index of its first move (the preview scrubs by these). */
  readonly firstSent: number;
}

/** One CAM operation: one card, with its feed regimes under it. */
export interface OperationSummary {
  readonly id: string;
  readonly name: string;
  readonly tool: number | null;
  readonly fromLine: number;
  readonly toLine: number;
  /** The stretches of the file it runs in, in order (more than one when another operation runs in between). */
  readonly spans: readonly { readonly fromLine: number; readonly toLine: number }[];
  readonly feedMm: number;
  readonly seconds: number | null;
  readonly regimes: readonly FeedRegime[];
}

/** A section of the file worth a look: many short lines, or a long stretch at a low feed. */
export interface Region {
  readonly id: string;
  readonly kind: 'dense' | 'slow';
  readonly fromLine: number;
  readonly toLine: number;
  /** Sent-line indexes (the preview scrubs by these). */
  readonly fromSent: number;
  readonly toSent: number;
  readonly lines: number;
  /** At the programmed feeds. */
  readonly seconds: number;
  /** Lines per second the section needs at its programmed feed. */
  readonly linesPerSecond: number;
  readonly meanMoveMm: number;
  /** The lowest programmed feed in the section, mm/min. */
  readonly feed: number;
}

export interface DensityBucket {
  readonly label: string;
  /** Lines per second, [min, max). */
  readonly min: number;
  readonly max: number;
  /** Feed lines in this bucket. */
  readonly lines: number;
}

export interface ProgramReport {
  /** Sent lines analysed. */
  readonly lines: number;
  readonly coverage: { readonly events: number; readonly supported: number; readonly reasons: readonly string[] };
  readonly feedMm: Evidence<number>;
  readonly rapidMm: Evidence<number>;
  readonly arcs: number;
  /** Feed moves at their programmed feeds. Null when any feed move has no known feed or turns a rotary axis. */
  readonly feedSeconds: Evidence<number>;
  /** The part of the feed time that is known, and how many feed moves are not timed. */
  readonly knownFeedSeconds: number;
  readonly untimedMoves: number;
  /** |dx|, |dy|, |dz| per rapid, mm, three per rapid: timed when the rapid speeds are known. */
  readonly rapidDeltas: Float64Array;
  /** Rapids that turn a rotary axis: the rapid time stays unknown while there are any. */
  readonly untimedRapids: number;
  readonly dwellSeconds: Evidence<number>;
  readonly dwells: number;
  /** Where the job stops for the operator: M0 (or M1 with optional stop) and tool changes, by file line. */
  readonly stopLines: readonly number[];
  readonly toolChangeLines: readonly number[];
  readonly density: { readonly threshold: Evidence<number>; readonly buckets: readonly DensityBucket[]; readonly regions: readonly Region[] };
  readonly slow: readonly Region[];
  readonly operations: readonly OperationSummary[];
  /** The lengths of the feed moves that move X, Y or Z (rotary moves left out), for "half the moves are under …". */
  readonly moveLengths: MoveLengths;
}

export interface MoveLengths {
  readonly moves: number;
  /** Moves shorter than 0.1 mm. */
  readonly under01: number;
  /** The median and the first quartile, mm, or null with no moves. */
  readonly median: number | null;
  readonly quarter: number | null;
}

export type XyzAxis = 'X' | 'Y' | 'Z';

/** The motion settings the time needs, each with its evidence (analysisInputs.ts in the app maps them). */
export interface MotionInputs {
  /** Rapid speed per axis (`vm`), mm/min. */
  readonly rapid: Readonly<Record<XyzAxis, Evidence<number>>>;
}

export interface MotionTime {
  readonly feedSeconds: Evidence<number>;
  readonly rapidSeconds: Evidence<number>;
  readonly dwellSeconds: Evidence<number>;
  /** Feed, rapid and dwell together, or null when any part is unknown. Never includes manual stops. */
  readonly totalSeconds: number | null;
  /** The known parts summed: shown only beside what is missing, never as a total or a minimum. */
  readonly knownSeconds: number;
  readonly manualStops: number;
  /** Why the total is not known, in short sentences. */
  readonly missing: readonly string[];
}
