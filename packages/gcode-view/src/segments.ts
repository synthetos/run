/**
 * The input of the preview: a plain segment list. It is built by whoever
 * interprets the toolpath (for run.synthetos.com, the gcode package after the
 * safety sanitiser). This package never sees G-code text and never decides
 * whether anything is safe: it draws what it is given.
 */

/**
 * What the segment ending at a vertex is. Vertex 0 and a jump that is not
 * drawn are `BREAK`. `UNCERTAIN` may be or'ed in: the position may not be
 * what the program intends, and the segment is drawn dimmed.
 */
export const SEGMENT = Object.freeze({ BREAK: 0, RAPID: 1, FEED: 2, ARC: 3, UNCERTAIN: 0x80 });

/** Per-line marks (`SegmentList.lineMarks`). */
export const LINE_MARK = Object.freeze({
  /** Part of the line's path is outside the work envelope: drawn in red. */
  OUT_OF_BOUNDS: 1,
  /** The position after this line may not be what the program intends: drawn dimmed. */
  UNCERTAIN: 2,
});

export type Vec3 = readonly [number, number, number];

export interface Box3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface SegmentList {
  /** X, Y, Z per vertex. */
  readonly vertices: Float32Array;
  /** `SEGMENT` per vertex: the segment from the previous vertex to this one. */
  readonly kinds: Uint8Array;
  /** First vertex of each line; one extra entry at the end holds the vertex count. */
  readonly lineToVertex: Uint32Array;
  /** `LINE_MARK` bits per line, or omitted. */
  readonly lineMarks?: Uint8Array;
}

export class SegmentListError extends Error {
  override readonly name = 'SegmentListError';
}

/** Throws unless the arrays agree with each other. Every entry point calls it. */
export function checkSegmentList(list: SegmentList): void {
  const count = list.kinds.length;
  if (list.vertices.length !== count * 3) throw new SegmentListError(`vertices holds ${String(list.vertices.length)} numbers for ${String(count)} kinds`);
  const lines = list.lineToVertex.length - 1;
  if (lines < 0) throw new SegmentListError('lineToVertex needs at least the closing entry');
  if (list.lineToVertex[lines] !== count) throw new SegmentListError('the last lineToVertex entry must equal the vertex count');
  for (let i = 1; i <= lines; i++) {
    if ((list.lineToVertex[i] as number) < (list.lineToVertex[i - 1] as number)) throw new SegmentListError(`lineToVertex decreases at line ${String(i)}`);
  }
  if (list.lineMarks !== undefined && list.lineMarks.length !== lines) throw new SegmentListError('lineMarks needs one entry per line');
}

/** Number of lines in the list. */
export function lineCount(list: SegmentList): number {
  return list.lineToVertex.length - 1;
}

/** The line whose segments include the segment ending at vertex `v` (binary search). */
export function lineOfVertex(list: SegmentList, v: number): number {
  const ltv = list.lineToVertex;
  let lo = 0;
  let hi = ltv.length - 2;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if ((ltv[mid] as number) <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The vertices a scrubber position highlights: every segment of lines
 * 0..`line` inclusive, as the half-open vertex range [0, end). The scrubber
 * highlights; it never animates anything and never reports a position.
 */
export function scrubVertexEnd(list: SegmentList, line: number): number {
  const lines = lineCount(list);
  if (lines === 0 || line < 0) return 0;
  const l = Math.min(line, lines - 1);
  return list.lineToVertex[l + 1] as number;
}

/** Box of every vertex that ends a drawn segment (and the vertex it starts from), or null. */
export function drawnBounds(list: SegmentList, includeRapids = true): Box3 | null {
  const v = list.vertices;
  const k = list.kinds;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const take = (i: number): void => {
    const x = v[i * 3] as number, y = v[i * 3 + 1] as number, z = v[i * 3 + 2] as number;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  };
  for (let i = 1; i < k.length; i++) {
    const kind = (k[i] as number) & 0x7f;
    if (kind === SEGMENT.BREAK || (!includeRapids && kind === SEGMENT.RAPID)) continue;
    take(i - 1);
    take(i);
  }
  if (minX === Infinity) return null;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
