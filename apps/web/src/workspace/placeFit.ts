/**
 * The mismatch check under the work zero picker (owner, 2026-11-09, OD-28): when the chosen point puts the cut off
 * the stock and another point would fit, which point to offer, preferring the one the file's own bounds show
 * (fileZero.ts). It only suggests: the page offers a one-click "Use …", and never changes a pick by itself. Pure.
 */
import type { StockCorner } from '@synthetos/library';
import { withDatum, plannedZero, type Job } from './jobModel.ts';
import { placeMargins, type CutBounds, type Margins } from './placeMargins.ts';

const CORNERS: readonly StockCorner[] = ['center', 'front-left', 'front-right', 'back-left', 'back-right'];
/** Past an edge by more than this, the cut hangs off the stock. */
export const OFF_STOCK_MM = 0.05;

export const POINT_NAMES: Readonly<Record<StockCorner, string>> = {
  'front-left': 'front-left corner',
  'front-right': 'front-right corner',
  'back-left': 'back-left corner',
  'back-right': 'back-right corner',
  center: 'centre',
};

const fits = (m: Margins): boolean => m.left >= -OFF_STOCK_MM && m.right >= -OFF_STOCK_MM && m.front >= -OFF_STOCK_MM && m.back >= -OFF_STOCK_MM;

export interface FitSuggestion {
  readonly corner: StockCorner;
  /** "The toolpath hangs off the stock. Zero in this file looks like the centre." */
  readonly text: string;
  /** "Use centre" */
  readonly action: string;
}

/**
 * A point to offer when the cut hangs off the stock at the job's zero (`zero`, machine mm) and another point would
 * fit (with the job's offsets as they are), or null. `guess` is the file's own zero (fileZero.ts), tried first.
 * It checks the toolpath itself (the tool's centre line): a profile whose tool edge runs just past the stock is
 * normal, and the margins already say so. When the pick is the file's own zero, the zero is not the problem, so
 * there is nothing to offer.
 */
export function fitSuggestion(job: Job, cut: CutBounds, zero: { readonly x: number; readonly y: number }, guess: StockCorner | null): FitSuggestion | null {
  const onMachine = job.placement.zeroFrom === 'machine';
  if (fits(placeMargins(job, cut, null, zero))) return null;
  if (!onMachine && guess === job.placement.datum.corner) return null;
  const order = guess === null ? CORNERS : [guess, ...CORNERS.filter((c) => c !== guess)];
  for (const corner of order) {
    if (corner === job.placement.datum.corner && !onMachine) continue;
    const moved = withDatum(job, { ...job.placement.datum, corner });
    if (!fits(placeMargins(moved, cut, null, plannedZero(moved)))) continue;
    const why = corner === guess ? `Zero in this file looks like the ${POINT_NAMES[corner]}.` : `It fits with zero at the ${POINT_NAMES[corner]}.`;
    return { corner, text: `The toolpath hangs off the stock. ${why}`, action: `Use ${POINT_NAMES[corner]}` };
  }
  return null;
}
