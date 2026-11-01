/**
 * 2D fallback (no WebGL): a top view (XY) as SVG path data. Returns plain
 * strings for `<path d>` attributes; the caller builds the elements (with
 * createElementNS or a virtual DOM), never markup.
 *
 * Y grows upwards on a machine and downwards in SVG, so Y is negated.
 */
import { drawnBounds, type Box3, type SegmentList } from './segments.ts';
import { STYLE, styleOf } from './geometry.ts';
import { lineOfVertex } from './segments.ts';

export interface SvgPaths {
  /** `minX minY width height`, or null for an empty list. */
  readonly viewBox: string | null;
  /** Path data per style (`STYLE` key names, lower case). */
  readonly rapid: string;
  readonly feed: string;
  readonly outOfBounds: string;
  readonly uncertain: string;
  /** The scrubbed lines (0..highlightLine), drawn on top. */
  readonly highlight: string;
  /** True when segments were dropped to stay under `maxSegments`. */
  readonly decimated: boolean;
}

export interface SvgOptions {
  readonly showRapids?: boolean;
  /** Highlight lines 0..this (inclusive); -1 or omitted for none. */
  readonly highlightLine?: number;
  /** Upper bound on drawn segments (default 200,000); beyond it every n-th segment is kept and `decimated` is set; out-of-bounds segments are always kept. */
  readonly maxSegments?: number;
  /** The envelope is included in the view box when given. */
  readonly envelope?: Box3 | null;
}

const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();

export function svgPaths(list: SegmentList, options: SvgOptions = {}): SvgPaths {
  const showRapids = options.showRapids ?? true;
  const highlightLine = options.highlightLine ?? -1;
  const max = options.maxSegments ?? 200_000;
  const v = list.vertices;
  const count = list.kinds.length;
  const parts: Record<'rapid' | 'feed' | 'outOfBounds' | 'uncertain' | 'highlight', string[]> = { rapid: [], feed: [], outOfBounds: [], uncertain: [], highlight: [] };
  let drawable = 0;
  for (let i = 1; i < count; i++) if (((list.kinds[i] as number) & 0x7f) !== 0) drawable++;
  const stride = drawable > max ? Math.ceil(drawable / max) : 1;
  let seen = 0;
  let line = count > 1 ? lineOfVertex(list, 1) : 0;
  const ltv = list.lineToVertex;
  for (let i = 1; i < count; i++) {
    while (line + 1 < ltv.length - 1 && (ltv[line + 1] as number) <= i) line++;
    const style = styleOf(list, i, line);
    if (style < 0) continue;
    // Out-of-bounds moves are a safety finding: decimation never drops one.
    if (seen++ % stride !== 0 && style !== STYLE.OUT_OF_BOUNDS) continue;
    if (style === STYLE.RAPID && !showRapids) continue;
    const seg = `M${fmt(v[(i - 1) * 3] as number)} ${fmt(-(v[(i - 1) * 3 + 1] as number))}L${fmt(v[i * 3] as number)} ${fmt(-(v[i * 3 + 1] as number))}`;
    const key = style === STYLE.RAPID ? 'rapid' : style === STYLE.OUT_OF_BOUNDS ? 'outOfBounds' : style === STYLE.UNCERTAIN ? 'uncertain' : 'feed';
    parts[key].push(seg);
    if (line <= highlightLine) parts.highlight.push(seg);
  }
  const b = drawnBounds(list, showRapids);
  const env = options.envelope ?? null;
  let viewBox: string | null = null;
  if (b !== null || env !== null) {
    const minX = Math.min(b?.min[0] ?? Infinity, env?.min[0] ?? Infinity);
    const maxX = Math.max(b?.max[0] ?? -Infinity, env?.max[0] ?? -Infinity);
    const minY = Math.min(b?.min[1] ?? Infinity, env?.min[1] ?? Infinity);
    const maxY = Math.max(b?.max[1] ?? -Infinity, env?.max[1] ?? -Infinity);
    const pad = Math.max(1, (maxX - minX) * 0.05, (maxY - minY) * 0.05);
    viewBox = `${fmt(minX - pad)} ${fmt(-maxY - pad)} ${fmt(maxX - minX + 2 * pad)} ${fmt(maxY - minY + 2 * pad)}`;
  }
  return {
    viewBox,
    rapid: parts.rapid.join(''),
    feed: parts.feed.join(''),
    outOfBounds: parts.outOfBounds.join(''),
    uncertain: parts.uncertain.join(''),
    highlight: parts.highlight.join(''),
    decimated: stride > 1,
  };
}

/** The envelope's XY rectangle as path data (same Y flip), or '' without one. */
export function svgEnvelope(envelope: Box3 | null): string {
  if (envelope === null) return '';
  const [x0, y0] = envelope.min;
  const [x1, y1] = envelope.max;
  return `M${fmt(x0)} ${fmt(-y0)}L${fmt(x1)} ${fmt(-y0)}L${fmt(x1)} ${fmt(-y1)}L${fmt(x0)} ${fmt(-y1)}Z`;
}
