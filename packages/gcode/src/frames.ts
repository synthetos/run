/**
 * The program frame and the path frame (the preview's G92 contract).
 *
 * The preview draws its path in the interpreter's machine frame. Offline that frame starts at 0, 0, 0 with
 * zero work offsets (the worker's OFFLINE_START), so a point of the path is the program position (the
 * coordinates the G-code is written in, in mm) plus the interpreter's work offset in force on that line:
 * the active WCS offset, the G92 offset while it applies, and the tool length on X, Y and Z
 * (`Interpreter.offset`). The board reports its work position `pos` in that same program frame: machine
 * position minus the G5x, G92 and tool offsets of the block running (@cite EN canonical_machine.c:389-407
 * cm_get_work_position, plan_line.c:89; a G92 reaches the runtime in queue order, :1199-1213 and :1109).
 * So the tool in the path frame is `pos + programToPath(line)`.
 *
 * The offset changes only on the lines that set it (G92, G92.1 to G92.3, G10, G43.1, G49, G54 to G59,
 * M2/M30), so the table keeps one entry per change, never one per line: a 300k-line file with one G92 has
 * two entries.
 *
 * Pure data and pure lookups; the interpreter fills a `FrameRecorder` as it steps.
 */

export type Vec3 = readonly [number, number, number];

export interface ProgramFrames {
  /**
   * File lines (1-based), ascending: entry i applies from after line `lines[i]` until the next entry.
   * Entry 0 is line 0: the offset before the first line.
   */
  readonly lines: Uint32Array;
  /** The program-to-path offset of each entry, mm, X Y Z. */
  readonly offsets: Float64Array;
  /** File lines that set a G92 offset (a G92 with axis words), ascending. */
  readonly g92Lines: Uint32Array;
}

/** No offsets anywhere (a blocked analysis, or no lines). */
export function emptyFrames(start: Vec3 = [0, 0, 0]): ProgramFrames {
  return { lines: Uint32Array.of(0), offsets: Float64Array.from(start), g92Lines: new Uint32Array(0) };
}

/** Index of the last entry of `sorted` at or before `line`, or -1. */
function lastAtOrBefore(sorted: Uint32Array, line: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) <= line) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * The program-to-path offset in force while file line `line` runs (and after it, until the next change);
 * line 0 or less is before the first line.
 */
export function programToPath(frames: ProgramFrames, line: number): Vec3 {
  const i = Math.max(0, lastAtOrBefore(frames.lines, Math.max(0, line)));
  const o = frames.offsets;
  return [o[i * 3] ?? 0, o[i * 3 + 1] ?? 0, o[i * 3 + 2] ?? 0];
}

/** The first file line after `line` that sets a G92 offset, or null. */
export function nextG92Line(frames: ProgramFrames, line: number): number | null {
  const i = lastAtOrBefore(frames.g92Lines, Math.max(0, line)) + 1;
  return i < frames.g92Lines.length ? (frames.g92Lines[i] as number) : null;
}

/** Collects the table while the interpreter steps: an entry only where the offset changes. */
export class FrameRecorder {
  readonly #lines: number[] = [0];
  readonly #offsets: number[];
  readonly #g92: number[] = [];

  constructor(start: Vec3) {
    this.#offsets = [...start];
  }

  /** The offset in force after file line `line`. */
  note(line: number, x: number, y: number, z: number): void {
    const k = this.#offsets.length - 3;
    if (this.#offsets[k] === x && this.#offsets[k + 1] === y && this.#offsets[k + 2] === z) return;
    if (this.#lines.at(-1) === line) this.#offsets.splice(k, 3, x, y, z);
    else {
      this.#lines.push(line);
      this.#offsets.push(x, y, z);
    }
  }

  /** File line `line` set a G92 offset. */
  g92(line: number): void {
    if (this.#g92.at(-1) !== line) this.#g92.push(line);
  }

  finish(): ProgramFrames {
    return { lines: Uint32Array.from(this.#lines), offsets: Float64Array.from(this.#offsets), g92Lines: Uint32Array.from(this.#g92) };
  }
}
