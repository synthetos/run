/**
 * 2D fallback (no WebGL): a top view (XY) as SVG path data. Returns plain
 * strings for `<path d>` attributes; the caller builds the elements (with
 * createElementNS or a virtual DOM), never markup.
 *
 * Y grows upwards on a machine and downwards in SVG, so Y is negated.
 */
import { drawnBounds, type Box3, type SegmentList, type Vec3 } from './segments.ts';
import { STYLE, styleOf } from './geometry.ts';
import { lineOfVertex } from './segments.ts';
import { gridLayout, gridLines } from './grid.ts';
import { offsetBox, sceneBounds, unionBox, type SceneLayers } from './scene.ts';

export interface SvgPaths {
  /** `minX minY width height`, or null for an empty list. */
  readonly viewBox: string | null;
  /** Path data per style (`STYLE` key names, lower case). */
  readonly rapid: string;
  readonly feed: string;
  readonly outOfBounds: string;
  readonly uncertain: string;
  /** The scrubbed lines' cutting moves (0..highlightLine; traverses excluded), drawn on top. */
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
  /**
   * Where the path's origin sits in the drawing (the planned work zero). The path data stays in the path's
   * own frame (the caller wraps it in a translated group); the view box is computed with the path moved.
   */
  readonly offset?: Vec3;
  /** Another box (in the drawing's frame) the view box must include: the scene solids. */
  readonly extent?: Box3 | null;
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
    // The scrubber tints cutting moves only: traverses stay muted and dashed (the caller's `.pv-rapid` style).
    if (line <= highlightLine && style !== STYLE.RAPID) parts.highlight.push(seg);
  }
  const viewBox = svgViewBox(unionBox(offsetBox(drawnBounds(list, showRapids), options.offset ?? [0, 0, 0]), options.envelope ?? null, options.extent ?? null));
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

/** The view box (`minX minY width height`, Y flipped, 5% padding) around a box, or null without one. */
export function svgViewBox(box: Box3 | null): string | null {
  if (box === null) return null;
  const [minX, minY] = box.min;
  const [maxX, maxY] = box.max;
  const pad = Math.max(1, (maxX - minX) * 0.05, (maxY - minY) * 0.05);
  return `${fmt(minX - pad)} ${fmt(-maxY - pad)} ${fmt(maxX - minX + 2 * pad)} ${fmt(maxY - minY + 2 * pad)}`;
}

export interface SvgSolid {
  /** The solid's top face as closed path data (same Y flip). */
  readonly d: string;
  readonly tag: string;
}

export interface SvgScene {
  /** Solids in the order given (the caller's painter's order: bed first). */
  readonly solids: readonly SvgSolid[];
  /** Hole marks: centre (Y flipped) and radius. */
  readonly rings: readonly { readonly cx: number; readonly cy: number; readonly r: number }[];
  /** The scene's box, for the view box. */
  readonly bounds: Box3 | null;
}

/** The scene solids as a top view: each solid's top face as path data, rings as circles. */
export function svgScene(scene: SceneLayers | null): SvgScene {
  if (scene === null) return { solids: [], rings: [], bounds: null };
  const solids: SvgSolid[] = scene.solids.map((s) => {
    if (s.kind === 'box') {
      const [x0, y0] = s.min;
      const [x1, y1] = s.max;
      return { d: `M${fmt(x0)} ${fmt(-y0)}L${fmt(x1)} ${fmt(-y0)}L${fmt(x1)} ${fmt(-y1)}L${fmt(x0)} ${fmt(-y1)}Z`, tag: s.tag ?? 'solid' };
    }
    return { d: s.outline.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(-y)}`).join('') + 'Z', tag: s.tag ?? 'solid' };
  });
  return { solids, rings: scene.rings.map((r) => ({ cx: r.center[0], cy: -r.center[1], r: r.radius })), bounds: sceneBounds(scene) };
}

/** The envelope's XY rectangle as path data (same Y flip), or '' without one. */
export function svgEnvelope(envelope: Box3 | null): string {
  if (envelope === null) return '';
  const [x0, y0] = envelope.min;
  const [x1, y1] = envelope.max;
  return `M${fmt(x0)} ${fmt(-y0)}L${fmt(x1)} ${fmt(-y0)}L${fmt(x1)} ${fmt(-y1)}L${fmt(x0)} ${fmt(-y1)}Z`;
}

/**
 * The bed/work grid under a top view (same Y flip), as minor and major path data: over the envelope
 * when given, else the padded drawn extent including the origin (grid.ts). Empty strings for an empty list.
 */
export function svgGrid(list: SegmentList, options: { readonly showRapids?: boolean; readonly envelope?: Box3 | null; readonly offset?: Vec3; readonly extent?: Box3 | null } = {}): { readonly minor: string; readonly major: string; readonly box: string | null } {
  const g = gridLayout(unionBox(offsetBox(drawnBounds(list, options.showRapids ?? true), options.offset ?? [0, 0, 0]), options.extent ?? null), options.envelope ?? null);
  if (g === null) return { minor: '', major: '', box: null };
  const minor: string[] = [];
  const major: string[] = [];
  for (const l of gridLines(g)) (l.major ? major : minor).push(`M${fmt(l.a[0])} ${fmt(-l.a[1])}L${fmt(l.b[0])} ${fmt(-l.b[1])}`);
  return { minor: minor.join(''), major: major.join(''), box: `${fmt(g.x0)} ${fmt(-g.y1)} ${fmt(g.x1 - g.x0)} ${fmt(g.y1 - g.y0)}` };
}
