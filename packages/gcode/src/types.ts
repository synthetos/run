/** Types of the interpreter and analyser (ROADMAP TB-02; TOOLS_PLAN §6.2). */
import type { DialectId } from '@synthetos/protocol';
import type { Axis, AxisValues, Envelope, StartState, Wcs } from '@synthetos/safety';
import type { ProgramFrames } from './frames.ts';

/**
 * What the segment ending at a vertex is. Vertex 0 (the start) and a jump the
 * preview does not draw (a blocked arc) are `BREAK`. `UNCERTAIN` is or'ed in
 * where the position may not be what the file intends.
 */
export const KIND = Object.freeze({ BREAK: 0, RAPID: 1, FEED: 2, ARC: 3, UNCERTAIN: 0x80 });

/** Per sent line flags (`JobAnalysis.lineFlags`). */
export const LINE_FLAG = Object.freeze({
  /** The position after this line may not be what the file intends. */
  UNCERTAIN: 1,
  /** Part of the line's path is outside the work envelope. */
  OUT_OF_BOUNDS: 2,
  /** The analyser blocks this line: it is not drawn. */
  NOT_DRAWN: 4,
  /** A host barrier: feeding stops after this line until the board drains. */
  PAUSE: 8,
  ARC: 16,
  /** A cutting move with the spindle off. */
  SPINDLE_OFF_CUT: 32,
});

export type FindingSeverity = 'block' | 'warn' | 'info' | 'change';

export interface Finding {
  /** 1-based line of the original file (0 for file-level findings). */
  readonly line: number;
  /** Host line number of the sent line, or null when the line was not sent. */
  readonly n: number | null;
  readonly severity: FindingSeverity;
  readonly rule: string;
  readonly message: string;
  /** Who found it: the sanitiser's report, or the interpreter's own analysis. */
  readonly source: 'sanitizer' | 'analyser';
}

/** The estimate model (TOOLS_PLAN §6.2): the board's `vm`, `fr` and, optionally, `jm` per axis. */
export interface TimingModel {
  /** `xvm`.., mm/min (deg/min on A/B/C). */
  readonly maxVelocity: AxisValues;
  /** `xfr`.., same units. */
  readonly feedrateMax: AxisValues;
  /** `xjm`.., mm/min³. Without it moves are timed at constant velocity. */
  readonly jerk?: AxisValues;
}

export interface InterpretOptions {
  /** The live start state (offline: user-entered values). Missing values are assumed and flagged. */
  readonly start?: StartState;
  /** Machine-coordinate work envelope from the board's `tn`/`tm` (`workEnvelope`). */
  readonly envelope?: Envelope;
  /** EN `os`: M1 is a pause point only when optional stop is on (SAFETY §4.7 step 7). */
  readonly optionalStop?: boolean;
  /** Chord tolerance for arcs, mm (default 0.01). */
  readonly chordMm?: number;
  /** Total vertex cap before arcs are coarsened (default 20M). */
  readonly vertexCap?: number;
  readonly timing?: TimingModel;
}

export interface Box {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface JobStats {
  readonly lines: number;
  readonly rapidMm: number;
  readonly feedMm: number;
  readonly arcs: number;
  /** Trapezoid estimate in seconds, or null when the timing model is missing a value. An estimate only. */
  readonly estimatedSeconds: number | null;
  /** The chord tolerance actually used (larger than asked when the vertex cap forced coarsening). */
  readonly chordMm: number;
}

/** The interpreter's state after the last line. */
export interface EndModal {
  readonly machine: Readonly<Record<Axis, number>>;
  readonly units: 'G20' | 'G21';
  readonly distance: 'G90' | 'G91';
  readonly plane: 'G17' | 'G18' | 'G19';
  readonly wcs: Wcs;
  readonly wcsOffsets: Readonly<Record<Wcs, Readonly<Record<Axis, number>>>>;
  readonly g92: { readonly offsets: Readonly<Record<Axis, number>>; readonly active: boolean };
  readonly spindle: 'off' | 'cw' | 'ccw';
  readonly mist: boolean;
  readonly flood: boolean;
}

export interface JobAnalysis {
  readonly dialect: DialectId;
  /** True when any finding blocks. */
  readonly blocked: boolean;
  /** Machine coordinates X, Y, Z per vertex (mm). */
  readonly vertices: Float32Array;
  /** `KIND` per vertex: the segment from the previous vertex to this one. */
  readonly kinds: Uint8Array;
  /** First vertex of each sent line; one extra entry at the end holds the vertex count. */
  readonly lineToVertex: Uint32Array;
  /** `LINE_FLAG` bits per sent line. */
  readonly lineFlags: Uint8Array;
  /** Exact box of the drawn path in machine coordinates (arcs by quadrant crossings), or null. */
  readonly bounds: Box | null;
  readonly findings: readonly Finding[];
  /** Host line numbers (`SentLine.n`) after which feeding stops. */
  readonly pausePoints: readonly number[];
  /** Where the program frame meets the path frame, by file line (frames.ts): `vertices` = program position + offset. */
  readonly frameTable: ProgramFrames;
  readonly stats: JobStats;
  readonly end: EndModal;
}
