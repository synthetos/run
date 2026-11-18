/**
 * Shapes for the procedural icon renderer: a shape is a predicate over canvas points. Only +, −, ×, ÷ and Math.sqrt
 * are used (all correctly rounded in IEEE 754), so every platform draws identical pixels and the committed PNGs can
 * be checked against a fresh render.
 */

/** A shape: does the canvas point (x, y) lie inside it? */
export type Shape = (x: number, y: number) => boolean;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const rect = (x0: number, y0: number, x1: number, y1: number): Shape => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;

/** A ring between radii r0 and r1 around c, optionally limited to one side of y = c.y. */
export const ring = (c: Point, r0: number, r1: number, half: 'all' | 'top' | 'bottom' = 'all'): Shape => (x, y) => {
  if (half === 'top' && y > c.y) return false;
  if (half === 'bottom' && y < c.y) return false;
  const d = Math.sqrt((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y));
  return d >= r0 && d <= r1;
};

/** A filled disc of radius r around c. */
export const disc = (c: Point, r: number): Shape => ring(c, 0, r);

/** A stroke of width w from a to b, with square ends. */
export const segment = (a: Point, b: Point, w: number): Shape => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;
  return (x, y) => {
    const px = x - a.x;
    const py = y - a.y;
    const along = px * ux + py * uy;
    const across = -px * uy + py * ux;
    return along >= -w / 2 && along <= len + w / 2 && across >= -w / 2 && across <= w / 2;
  };
};

/** A stroke of width w from a to b with round ends. */
export const roundSegment = (a: Point, b: Point, w: number): Shape => any(segment(a, b, w), disc(a, w / 2), disc(b, w / 2));

export const any = (...shapes: Shape[]): Shape => (x, y) => shapes.some((s) => s(x, y));
export const both = (a: Shape, b: Shape): Shape => (x, y) => a(x, y) && b(x, y);
