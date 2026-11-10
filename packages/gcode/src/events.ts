/**
 * The analytic event tape (docs/design/ANALYZE.md §1, slice 1): one ordered record per thing a sent line does,
 * emitted by the interpreter beside its drawing output. It is the one interpretation the analysis reads, so there
 * is no second modal reconstruction of the file anywhere else.
 *
 * - Geometry is Float64 and analytic: an arc's length comes from its model (radius and sweep), never from the
 *   preview's tessellation, so a coarser drawing never changes a distance or a time.
 * - Three identities stay apart: the file line (`source`), the sent line (`sent`, the sanitised stream's index,
 *   which can be a split piece or a line the sanitiser inserted) and the event itself.
 * - Distances are X, Y and Z only. A move that turns A, B or C is flagged `ROTARY` and never adds degrees to a
 *   distance in millimetres.
 *
 * Packed typed arrays, so a large file's tape is a few flat buffers, not millions of objects.
 */
import type { LineOrigin } from '@synthetos/safety';

/** What an event is. */
export const EVENT = Object.freeze({
  /** A straight move (G0 or G1, and the legs of G28/G30). */
  LINE: 0,
  /** An arc or helix (G2/G3), with its analytic length. */
  ARC: 1,
  /** G4: `seconds` holds the dwell. */
  DWELL: 2,
  /** A line that moves nothing and is not one of the others (spindle, coolant, modes). */
  COMMAND: 3,
  /** The job stops feeding here until the operator resumes (M0, or M1 with optional stop on). */
  BARRIER: 4,
  /** M6: a manual tool change. */
  TOOL_CHANGE: 5,
  /** The interpreter could not model this line (blocked, rejected arc, unknown stored position). */
  UNMODELLED: 6,
});

/** Bits per event. */
export const EVENT_FLAG = Object.freeze({
  /** A rapid (G0, G28/G30 legs). */
  RAPID: 1,
  /** The position may not be what the file intends. */
  UNCERTAIN: 2,
  /** The move turns A, B or C: not timed or measured in millimetres. */
  ROTARY: 4,
  /** The sent line was inserted by the sanitiser (C14, C22), not written in the file. */
  INSERTED: 8,
  /** The sent line is a piece of a longer move the sanitiser split. */
  SPLIT: 16,
  /**
   * A COMMAND that the firmware queues as a planner command, so motion stops at it (TinyG: S, M3/M4/M5, M6,
   * M7/M8/M9, G54..G59, G92.x, G10, G28.3, M0/M1/M2/M30; @cite TinyG 450.02 canonical_machine.c, spindle.c
   * mp_queue_command callers). A plain mode change (G21, G90, F) is not one.
   */
  SYNC: 32,
  /** A move under G61.1 exact stop: it starts and ends at rest. */
  EXACT_STOP: 64,
});

/** Codes TinyG runs as queued planner commands (EVENT_FLAG.SYNC). S on its own line counts too. */
export const SYNC_CODES: ReadonlySet<string> = new Set(['M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G92', 'G92.1', 'G92.2', 'G92.3', 'G10', 'G28.3', 'M0', 'M1', 'M2', 'M30']);
const PROGRAM_STOPS: ReadonlySet<string> = new Set(['M0', 'M1', 'M2', 'M30']);

/** No tool is known to be active (before the first M6, or an M6 with no T). */
export const NO_EVENT_TOOL = -1;

export interface EventTape {
  readonly count: number;
  /** `EVENT` per event. */
  readonly kinds: Uint8Array;
  /** `EVENT_FLAG` bits per event. */
  readonly flags: Uint8Array;
  /** Index of the sent line (the sanitised stream) the event came from. */
  readonly sent: Uint32Array;
  /** 1-based file line. */
  readonly source: Uint32Array;
  /** X, Y, Z path length in mm (0 when nothing moves). */
  readonly lengthMm: Float64Array;
  /** Machine-coordinate X, Y, Z change in mm, three per event. */
  readonly delta: Float64Array;
  /** Programmed feed in mm/min, or NaN (a rapid, or no F yet). */
  readonly feed: Float64Array;
  /** The S word in force, rpm as written, or NaN before any S. */
  readonly spindle: Float64Array;
  /** The tool made active by the last M6 (`NO_EVENT_TOOL` when unknown). */
  readonly tool: Int32Array;
  /** Dwell seconds (DWELL), else 0. */
  readonly seconds: Float64Array;
  /** Per event, the index of its arc in `arcs` (ARC events), else -1. */
  readonly arcIndex: Int32Array;
  /**
   * Five numbers per arc, as the firmware segments it: plane (0 XY, 1 XZ, 2 YZ), radius (mm), start angle (from the
   * centre, axis 1 toward axis 0), signed angular travel (clockwise positive) and the linear-axis travel (mm).
   */
  readonly arcs: Float64Array;
}

type Xyz = { readonly X: number; readonly Y: number; readonly Z: number; readonly A: number; readonly B: number; readonly C: number };

/** An empty tape (a file the interpreter does not run). */
export function emptyTape(): EventTape {
  return { count: 0, kinds: new Uint8Array(0), flags: new Uint8Array(0), sent: new Uint32Array(0), source: new Uint32Array(0), lengthMm: new Float64Array(0), delta: new Float64Array(0), feed: new Float64Array(0), spindle: new Float64Array(0), tool: new Int32Array(0), seconds: new Float64Array(0), arcIndex: new Int32Array(0), arcs: new Float64Array(0) };
}

/** The interpreter's side of the tape: it reports what each line did, in order. */
export class EventRecorder {
  #count = 0;
  #cap = 0;
  #kinds = new Uint8Array(0);
  #flags = new Uint8Array(0);
  #sent = new Uint32Array(0);
  #source = new Uint32Array(0);
  #length = new Float64Array(0);
  #delta = new Float64Array(0);
  #feed = new Float64Array(0);
  #spindle = new Float64Array(0);
  #tool = new Int32Array(0);
  #seconds = new Float64Array(0);
  #arcIndex = new Int32Array(0);
  readonly #arcs: number[] = [];
  #exactStop = false;
  #endAfterMove = false;
  #line = 0;
  #lineFlags = 0;
  #lineSource = 0;
  #lineEvents = 0;
  #rpm = Number.NaN;
  #selected = NO_EVENT_TOOL;
  #active = NO_EVENT_TOOL;
  readonly #origins: readonly { readonly sourceLine: number; readonly origin: LineOrigin }[];

  constructor(lines: readonly { readonly sourceLine: number; readonly origin: LineOrigin }[]) {
    this.#origins = lines;
    this.#grow(Math.max(16, lines.length));
  }

  #grow(min: number): void {
    const cap = Math.max(min, this.#cap * 2);
    // `per` values per event: the deltas are three, so their copy must keep three per event.
    const copy = <T extends Uint8Array | Uint32Array | Int32Array | Float64Array>(from: T, make: (n: number) => T, n: number, per = 1): T => {
      const to = make(n);
      to.set(from.subarray(0, this.#count * per) as never);
      return to;
    };
    this.#kinds = copy(this.#kinds, (n) => new Uint8Array(n), cap);
    this.#flags = copy(this.#flags, (n) => new Uint8Array(n), cap);
    this.#sent = copy(this.#sent, (n) => new Uint32Array(n), cap);
    this.#source = copy(this.#source, (n) => new Uint32Array(n), cap);
    this.#length = copy(this.#length, (n) => new Float64Array(n), cap);
    this.#delta = copy(this.#delta, (n) => new Float64Array(n), cap * 3, 3);
    this.#feed = copy(this.#feed, (n) => new Float64Array(n), cap);
    this.#spindle = copy(this.#spindle, (n) => new Float64Array(n), cap);
    this.#tool = copy(this.#tool, (n) => new Int32Array(n), cap);
    this.#seconds = copy(this.#seconds, (n) => new Float64Array(n), cap);
    this.#arcIndex = copy(this.#arcIndex, (n) => new Int32Array(n), cap);
    this.#cap = cap;
  }

  /** A sent line starts (`i` is its index in the sanitised stream). */
  begin(i: number): void {
    const line = this.#origins[i];
    this.#line = i;
    this.#lineSource = line?.sourceLine ?? 0;
    this.#lineFlags = line?.origin === 'c14' || line?.origin === 'c22' ? EVENT_FLAG.INSERTED : line?.origin === 'split' ? EVENT_FLAG.SPLIT : 0;
    this.#lineEvents = 0;
  }

  /**
   * The line's codes and S and T words, before its move: a tool change (T is read before M6 in one block: `T1 M6`
   * changes to T1), a queued planner command (SYNC) and the path control mode (G61.1 exact stop; G61, G64 off).
   */
  words(codes: readonly string[], s: number | undefined, t: number | undefined): void {
    if (s !== undefined && Number.isFinite(s)) this.#rpm = s;
    if (t !== undefined && Number.isInteger(t) && t >= 0) this.#selected = t;
    // TinyG plans exact stop for G61.1 only; G61 (exact path) and G64 keep continuous planning (plan_line.c mp_aline).
    if (codes.includes('G61.1')) this.#exactStop = true;
    if (codes.includes('G61') || codes.includes('G64')) this.#exactStop = false;
    if (codes.includes('M6')) {
      this.#active = this.#selected;
      this.#push(EVENT.TOOL_CHANGE, EVENT_FLAG.SYNC);
    }
    // Commands queue before the line's move; M0/M1/M2/M30 run after it.
    this.#endAfterMove = codes.some((c) => PROGRAM_STOPS.has(c));
    if (s !== undefined || codes.some((c) => SYNC_CODES.has(c) && !PROGRAM_STOPS.has(c) && c !== 'M6')) this.#push(EVENT.COMMAND, EVENT_FLAG.SYNC);
  }

  #push(kind: number, flags: number): number {
    if (this.#count === this.#cap) this.#grow(this.#count + 1);
    const e = this.#count++;
    this.#kinds[e] = kind;
    this.#flags[e] = flags | this.#lineFlags;
    this.#sent[e] = this.#line;
    this.#source[e] = this.#lineSource;
    this.#feed[e] = Number.NaN;
    this.#arcIndex[e] = -1;
    this.#spindle[e] = this.#rpm;
    this.#tool[e] = this.#active;
    this.#lineEvents++;
    return e;
  }

  #move(kind: number, from: Xyz, to: Xyz, lengthMm: number, flags: number, feed: number | undefined): void {
    const rotary = to.A !== from.A || to.B !== from.B || to.C !== from.C;
    const exact = (kind === EVENT.LINE || kind === EVENT.ARC) && this.#exactStop ? EVENT_FLAG.EXACT_STOP : 0;
    const e = this.#push(kind, flags | exact | (rotary ? EVENT_FLAG.ROTARY : 0));
    this.#length[e] = lengthMm;
    this.#delta[e * 3] = to.X - from.X;
    this.#delta[e * 3 + 1] = to.Y - from.Y;
    this.#delta[e * 3 + 2] = to.Z - from.Z;
    this.#feed[e] = (flags & EVENT_FLAG.RAPID) !== 0 || feed === undefined ? Number.NaN : feed;
  }

  /** A straight move from `from` to `to` (machine mm; rotary in degrees). */
  line(from: Xyz, to: Xyz, rapid: boolean, uncertain: boolean, feed: number | undefined): void {
    const length = Math.hypot(to.X - from.X, to.Y - from.Y, to.Z - from.Z);
    this.#move(EVENT.LINE, from, to, length, (rapid ? EVENT_FLAG.RAPID : 0) | (uncertain ? EVENT_FLAG.UNCERTAIN : 0), feed);
  }

  /**
   * An arc with its analytic length (the arc model's, including a helix's linear travel) and what the firmware
   * needs to segment it: plane (0 XY, 1 XZ, 2 YZ), radius, start angle, signed angular travel, linear travel.
   */
  arc(from: Xyz, to: Xyz, lengthMm: number, uncertain: boolean, feed: number | undefined, shape: readonly [number, number, number, number, number]): void {
    this.#move(EVENT.ARC, from, to, lengthMm, uncertain ? EVENT_FLAG.UNCERTAIN : 0, feed);
    this.#arcIndex[this.#count - 1] = this.#arcs.length / 5;
    this.#arcs.push(...shape);
  }

  /** A line the interpreter could not model; `from`/`to` are where it left the position. */
  unmodelled(from: Xyz, to: Xyz): void {
    this.#move(EVENT.UNMODELLED, from, to, 0, EVENT_FLAG.UNCERTAIN, undefined);
  }

  dwell(seconds: number): void {
    const e = this.#push(EVENT.DWELL, 0);
    this.#seconds[e] = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }

  barrier(): void {
    this.#push(EVENT.BARRIER, 0);
  }

  /**
   * The sent line ends. One that recorded nothing else is a command event, or an unmodelled one when the interpreter
   * did not run it (`notRun`: blocked, not drawn), so every sent line has at least one event.
   */
  end(notRun: boolean): void {
    if (this.#endAfterMove) this.#push(EVENT.COMMAND, EVENT_FLAG.SYNC);
    this.#endAfterMove = false;
    if (this.#lineEvents === 0) this.#push(notRun ? EVENT.UNMODELLED : EVENT.COMMAND, notRun ? EVENT_FLAG.UNCERTAIN : 0);
  }

  finish(): EventTape {
    const n = this.#count;
    return {
      count: n,
      kinds: this.#kinds.slice(0, n),
      flags: this.#flags.slice(0, n),
      sent: this.#sent.slice(0, n),
      source: this.#source.slice(0, n),
      lengthMm: this.#length.slice(0, n),
      delta: this.#delta.slice(0, n * 3),
      feed: this.#feed.slice(0, n),
      spindle: this.#spindle.slice(0, n),
      tool: this.#tool.slice(0, n),
      seconds: this.#seconds.slice(0, n),
      arcIndex: this.#arcIndex.slice(0, n),
      arcs: Float64Array.from(this.#arcs),
    };
  }
}

/** The tape's buffers, for moving it to another thread without a copy. */
export function tapeBuffers(tape: EventTape): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const v of [tape.kinds, tape.flags, tape.sent, tape.source, tape.lengthMm, tape.delta, tape.feed, tape.spindle, tape.tool, tape.seconds, tape.arcIndex, tape.arcs]) if (v.buffer instanceof ArrayBuffer) out.add(v.buffer);
  return [...out];
}
