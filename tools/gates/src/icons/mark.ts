/**
 * The n mark for the icons (docs/superpowers/specs/2026-11-16-first-run-design.md §4): the icon renderer has no SVG
 * rasterizer, so the n is drawn in code, from the numbers of WORDMARK_GEOMETRY. The two n paths are parsed, never
 * copied: the dashed stem becomes ink dots, the arch and right stem a blue ring and round stroke, the tool a disc.
 */
import type { WordmarkGeometry } from '../../../../apps/web/src/brand/wordmarkGeometry.ts';
import { any, disc, ring, roundSegment, type Point, type Shape } from './shapes.ts';

export interface Stem {
  readonly x: number;
  readonly y0: number;
  readonly y1: number;
}

export interface Circle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export interface MarkPrimitives {
  /** The left stem, start to end, as the path draws it. */
  readonly stem: Stem;
  /** The arch: a half circle above its centre. */
  readonly arch: Circle;
  readonly rightStem: Stem;
  readonly tool: Circle;
  readonly stroke: number;
  /** Dot centres of the dashed stem: one every dash period from the path start. */
  readonly dots: readonly Point[];
}

/** The spec's viewBox around the n: 40..64 × 12..44. */
export const MARK_BOX = Object.freeze({ x: 40, y: 12, w: 24, h: 32 });

const NUM = '(-?\\d+(?:\\.\\d+)?)';
/** `M x y V y`: a vertical stem. */
const STEM = new RegExp(`^M${NUM} ${NUM}V${NUM}$`);
/** `M x y a r r 0 0 1 2r 0 v dy`: a clockwise half circle of radius r, then a stem down. */
const ARCH = new RegExp(`^M${NUM} ${NUM}a${NUM} ${NUM} 0 0 1 ${NUM} 0v${NUM}$`);
/** `on off`: a dash pattern of two lengths. */
const DASH = new RegExp(`^${NUM} ${NUM}$`);

function parse(re: RegExp, text: string, name: string): number[] {
  const m = re.exec(text);
  if (m === null) throw new Error(`${name}: the icon renderer cannot draw "${text}"`);
  return m.slice(1).map(Number);
}

function stemDots(stem: Stem, dash: string): Point[] {
  const [on, off] = parse(DASH, dash, 'dash') as [number, number];
  const period = on + off;
  const length = Math.abs(stem.y1 - stem.y0);
  const sign = stem.y1 < stem.y0 ? -1 : 1;
  const dots: Point[] = [];
  for (let k = 0; k * period <= length; k += 1) dots.push({ x: stem.x, y: stem.y0 + sign * k * period });
  return dots;
}

/** The n's drawing primitives, derived from the geometry. Throws when a path is not the shape the spec draws. */
export function markPrimitives(g: WordmarkGeometry): MarkPrimitives {
  const [sx, sy0, sy1] = parse(STEM, g.nStem, 'nStem') as [number, number, number];
  const [ax, ay, rx, ry, dx, dy] = parse(ARCH, g.nArch, 'nArch') as [number, number, number, number, number, number];
  if (rx !== ry || dx !== 2 * rx) throw new Error(`nArch: "${g.nArch}" is not a half circle`);
  const stem = { x: sx, y0: sy0, y1: sy1 };
  return {
    stem,
    arch: { cx: ax + rx, cy: ay, r: rx },
    rightStem: { x: ax + dx, y0: ay, y1: ay + dy },
    tool: g.tool,
    stroke: g.stroke,
    dots: stemDots(stem, g.dash),
  };
}

/** Where the mark lands on the canvas: MARK_BOX's corner maps to (x, y), one geometry unit to `scale` canvas units. */
export interface MarkFit {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** The ink shape (the dotted rapid) and the blue shape (arch, right stem, tool) of the n, in canvas units. */
export function markShapes(p: MarkPrimitives, fit: MarkFit): { readonly ink: Shape; readonly blue: Shape } {
  const at = (u: Point): Point => ({ x: fit.x + (u.x - MARK_BOX.x) * fit.scale, y: fit.y + (u.y - MARK_BOX.y) * fit.scale });
  const half = (p.stroke / 2) * fit.scale;
  const archCentre = at({ x: p.arch.cx, y: p.arch.cy });
  const archR = p.arch.r * fit.scale;
  return {
    ink: any(...p.dots.map((d) => disc(at(d), half))),
    blue: any(
      ring(archCentre, archR - half, archR + half, 'top'),
      roundSegment(at({ x: p.rightStem.x, y: p.rightStem.y0 }), at({ x: p.rightStem.x, y: p.rightStem.y1 }), p.stroke * fit.scale),
      disc(at({ x: p.tool.cx, y: p.tool.cy }), p.tool.r * fit.scale),
    ),
  };
}
