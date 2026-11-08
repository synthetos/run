/**
 * Where the carve goes below the stock (docs/design/tool-sim.md, slice 3): the first line whose cut reaches below
 * the stock's bottom, how far, and the deepest such line. Pure. It is a reading of the planned setup (stock
 * thickness, where it sits), a preview finding and never a placement certainty; it gates nothing.
 *
 * A cut that ends at the bottom (a profile cut through, within `BELOW_STOCK_EPS`) is not below it.
 */

/** Deeper than this below the stock's bottom counts, mm (well under any real cut, above float noise). */
export const BELOW_STOCK_EPS = 0.01;

export interface BelowStock {
  /** The first list line (0-based) whose cut goes below the stock, and how far below its bottom, mm. */
  readonly firstLine: number;
  readonly firstDepth: number;
  /** The line that goes deepest below the stock (the first such, on a tie), and how far. */
  readonly deepestLine: number;
  readonly deepestDepth: number;
}

/** `prev` updated with one finished line whose lowest cut top was `lowest` (Infinity when it cut nothing). */
export function noteBelow(prev: BelowStock | null, line: number, lowest: number, bottom: number): BelowStock | null {
  const depth = bottom - lowest;
  if (!(depth > BELOW_STOCK_EPS)) return prev;
  if (prev === null) return { firstLine: line, firstDepth: depth, deepestLine: line, deepestDepth: depth };
  return depth > prev.deepestDepth ? { ...prev, deepestLine: line, deepestDepth: depth } : prev;
}
