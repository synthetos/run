/**
 * Chunked line-segment geometry. A segment list of millions of vertices is cut
 * into chunks of at most `segmentsPerChunk` segments, so each chunk is filled
 * and uploaded in a short slice of main-thread time (no long task) and drawn
 * with one draw call.
 *
 * Each drawn segment becomes two vertices in a chunk. Per vertex the chunk
 * holds the position, a style and the line index, so the renderer can hide
 * rapids and highlight the scrubbed lines with uniforms, without rebuilding
 * anything.
 */
import { LINE_MARK, SEGMENT, lineOfVertex, type SegmentList } from './segments.ts';

/** Style of a drawn segment, as stored per vertex. */
export const STYLE = Object.freeze({ RAPID: 0, FEED: 1, ARC: 2, OUT_OF_BOUNDS: 3, UNCERTAIN: 4 });

/** 65,536 segments: about 1.8 MB per chunk, filled in a few milliseconds. */
export const DEFAULT_SEGMENTS_PER_CHUNK = 65_536;

export interface Chunk {
  /** X, Y, Z per vertex, two vertices per segment. */
  readonly positions: Float32Array;
  /** `STYLE` per vertex. */
  readonly styles: Uint8Array;
  /** Line index per vertex (exact in float32 up to 16,777,216 lines). */
  readonly lines: Float32Array;
  /** Number of segments in the chunk. */
  readonly segments: number;
  /** Vertices of the list consumed so far (for progress). */
  readonly vertexEnd: number;
}

/** The style of the segment ending at vertex `v`, or -1 when it is not drawn. */
export function styleOf(list: SegmentList, v: number, line: number): number {
  const raw = list.kinds[v] as number;
  const kind = raw & 0x7f;
  if (kind === SEGMENT.BREAK) return -1;
  const marks = list.lineMarks === undefined ? 0 : (list.lineMarks[line] as number);
  if (marks & LINE_MARK.OUT_OF_BOUNDS) return STYLE.OUT_OF_BOUNDS;
  if (kind === SEGMENT.RAPID) return STYLE.RAPID;
  if (raw & SEGMENT.UNCERTAIN || marks & LINE_MARK.UNCERTAIN) return STYLE.UNCERTAIN;
  return kind === SEGMENT.ARC ? STYLE.ARC : STYLE.FEED;
}

/**
 * Yields the chunks of `list` one at a time. The caller decides when to ask
 * for the next one (see `slicer.ts`), so building never blocks for long.
 */
export function* chunks(list: SegmentList, segmentsPerChunk: number = DEFAULT_SEGMENTS_PER_CHUNK): Generator<Chunk, void, undefined> {
  if (!(segmentsPerChunk >= 1)) throw new RangeError('segmentsPerChunk must be at least 1');
  const v = list.vertices;
  const count = list.kinds.length;
  const ltv = list.lineToVertex;
  let line = count > 1 ? lineOfVertex(list, 1) : 0;
  let positions = new Float32Array(segmentsPerChunk * 6);
  let styles = new Uint8Array(segmentsPerChunk * 2);
  let lines = new Float32Array(segmentsPerChunk * 2);
  let n = 0;
  for (let i = 1; i < count; i++) {
    while (line + 1 < ltv.length - 1 && (ltv[line + 1] as number) <= i) line++;
    const style = styleOf(list, i, line);
    if (style < 0) continue;
    const o = n * 6;
    positions[o] = v[(i - 1) * 3] as number;
    positions[o + 1] = v[(i - 1) * 3 + 1] as number;
    positions[o + 2] = v[(i - 1) * 3 + 2] as number;
    positions[o + 3] = v[i * 3] as number;
    positions[o + 4] = v[i * 3 + 1] as number;
    positions[o + 5] = v[i * 3 + 2] as number;
    styles[n * 2] = style;
    styles[n * 2 + 1] = style;
    lines[n * 2] = line;
    lines[n * 2 + 1] = line;
    n++;
    if (n === segmentsPerChunk) {
      yield { positions, styles, lines, segments: n, vertexEnd: i + 1 };
      positions = new Float32Array(segmentsPerChunk * 6);
      styles = new Uint8Array(segmentsPerChunk * 2);
      lines = new Float32Array(segmentsPerChunk * 2);
      n = 0;
    }
  }
  if (n > 0) yield { positions: positions.slice(0, n * 6), styles: styles.slice(0, n * 2), lines: lines.slice(0, n * 2), segments: n, vertexEnd: count };
}
