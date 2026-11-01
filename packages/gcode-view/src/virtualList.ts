/**
 * Window of a virtualised list of fixed-height rows: only the rows in view
 * (plus overscan) are rendered, so a list of a million lines costs the same
 * as one of fifty.
 */

export interface ListWindowInput {
  readonly count: number;
  readonly rowHeight: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
  /** Rows rendered above and below the viewport (default 10). */
  readonly overscan?: number;
}

export interface ListWindow {
  /** First rendered row (inclusive). */
  readonly first: number;
  /** Last rendered row (exclusive). */
  readonly end: number;
  /** Offset of the first rendered row from the top of the list, px. */
  readonly offsetTop: number;
  /** Height of the whole list, px. */
  readonly totalHeight: number;
}

/** Browsers cap element heights (about 33.5M px in Chrome); rows past this are reached by scaling. */
export const MAX_SCROLL_HEIGHT = 15_000_000;

export function listWindow(input: ListWindowInput): ListWindow {
  const { count, rowHeight } = input;
  if (!(rowHeight > 0)) throw new RangeError('rowHeight must be positive');
  const overscan = input.overscan ?? 10;
  const natural = count * rowHeight;
  const totalHeight = Math.min(natural, MAX_SCROLL_HEIGHT);
  // When the list is taller than the cap, scroll position maps proportionally onto rows.
  const scale = natural > totalHeight && totalHeight > input.viewportHeight ? (natural - input.viewportHeight) / (totalHeight - input.viewportHeight) : 1;
  const top = Math.max(0, input.scrollTop) * scale;
  const visibleFirst = Math.min(count, Math.floor(top / rowHeight));
  const visibleEnd = Math.min(count, Math.ceil((top + Math.max(0, input.viewportHeight)) / rowHeight));
  const first = Math.max(0, visibleFirst - overscan);
  const end = Math.min(count, visibleEnd + overscan);
  return { first, end, offsetTop: Math.max(0, input.scrollTop) + first * rowHeight - top, totalHeight };
}

/** The scrollTop that brings row `index` into view at the top. */
export function scrollTopFor(index: number, input: Omit<ListWindowInput, 'scrollTop'>): number {
  const natural = input.count * input.rowHeight;
  const totalHeight = Math.min(natural, MAX_SCROLL_HEIGHT);
  const scale = natural > totalHeight && totalHeight > input.viewportHeight ? (natural - input.viewportHeight) / (totalHeight - input.viewportHeight) : 1;
  return Math.max(0, Math.min(totalHeight - input.viewportHeight, (index * input.rowHeight) / scale));
}
