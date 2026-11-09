/**
 * Where the file's own zero is (owner, 2026-11-09, OD-28: CAM owns the toolpath and the file's zero; run owns
 * where that zero goes on the real stock and never rewrites coordinates). Read from the cutting moves' bounds,
 * with a CAM header comment as a second opinion when it names the origin:
 * - X and Y: the zero at the left or front if the cut starts at about 0 and runs positive; right or back if it
 *   ends at about 0; the centre if the cut is about symmetric around 0;
 * - Z: the top if the cuts go below 0; the bottom if they stay at about 0 and above it.
 * A point the 5-dot picker cannot show (X centred but Y at the front, say), cuts that start well away from 0, or a
 * header that disagrees with the bounds make the guess unclear, and run keeps the user's pick. Pure.
 */
import type { StockCorner } from '@synthetos/library';

export interface CutBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export type Confidence = 'clear' | 'likely' | 'unclear';

export interface FileZero {
  /** The stock point the file's zero looks like, or null when it is not clear. */
  readonly corner: StockCorner | null;
  readonly height: 'top' | 'bottom' | null;
  readonly confidence: Confidence;
  /** One short sentence for the panel. */
  readonly note: string;
}

type Side = 'low' | 'high' | 'middle' | null;

/** Where 0 sits along one axis of the cut: at its low end, its high end, its middle, or none of them (null). Loose when only roughly so. */
function sideOf(min: number, max: number): { readonly side: Side; readonly loose: boolean } {
  const span = max - min;
  const tight = Math.max(0.05, span * 0.005);
  const near = Math.max(0.5, span * 0.03);
  if (Math.abs(min) <= near && max > near) return { side: 'low', loose: Math.abs(min) > tight };
  if (Math.abs(max) <= near && min < -near) return { side: 'high', loose: Math.abs(max) > tight };
  if (min < -near && max > near) {
    const off = Math.abs(min + max) / span;
    if (off <= 0.02) return { side: 'middle', loose: false };
    if (off <= 0.1) return { side: 'middle', loose: true };
  }
  return { side: null, loose: false };
}

const CORNER_OF: Readonly<Record<string, StockCorner>> = {
  'low:low': 'front-left',
  'high:low': 'front-right',
  'low:high': 'back-left',
  'high:high': 'back-right',
  'middle:middle': 'center',
};

const WORDS: Readonly<Record<StockCorner, string>> = {
  'front-left': 'the front-left corner',
  'front-right': 'the front-right corner',
  'back-left': 'the back-left corner',
  'back-right': 'the back-right corner',
  center: 'the centre',
};

/** What a CAM header comment says about the origin, when it says anything plain (e.g. "(Zero: top of stock, centre)"). */
export function headerHints(header: string): { readonly corner: StockCorner | null; readonly height: 'top' | 'bottom' | null } {
  const lines = header.split(/\r?\n/).slice(0, 80).filter((l) => /\(|;/.test(l) && /(zero|origin|datum|wcs)/i.test(l));
  const text = lines.join(' ').toLowerCase();
  let height: 'top' | 'bottom' | null = null;
  if (/(top of (the )?(stock|material|part|model)|stock top|material (top|surface)|top surface)/.test(text)) height = 'top';
  else if (/(bottom of (the )?(stock|material|part)|stock bottom|table|spoil ?board|machine bed)/.test(text)) height = 'bottom';
  let corner: StockCorner | null = null;
  if (/(cent(er|re))/.test(text)) corner = 'center';
  else if (/(front|lower|bottom)[ -]left|left[ -](front|lower|bottom)/.test(text)) corner = 'front-left';
  else if (/(front|lower|bottom)[ -]right|right[ -](front|lower|bottom)/.test(text)) corner = 'front-right';
  else if (/(back|upper|top)[ -]left|left[ -](back|upper|top)/.test(text)) corner = 'back-left';
  else if (/(back|upper|top)[ -]right|right[ -](back|upper|top)/.test(text)) corner = 'back-right';
  return { corner, height };
}

const n = (v: number): string => `${v < 0 ? '−' : v > 0 ? '+' : ''}${String(Math.round(Math.abs(v)))}`;

/** The file's zero from its cutting bounds, and from its header comments when they name it. */
export function guessFileZero(box: CutBox, header = ''): FileZero {
  const x = sideOf(box.minX, box.maxX);
  const y = sideOf(box.minY, box.maxY);
  const corner = x.side === null || y.side === null ? null : (CORNER_OF[`${x.side}:${y.side}`] ?? null);
  const zSpan = box.maxZ - box.minZ;
  const zNear = Math.max(0.3, zSpan * 0.05);
  // A plunge from above the stock counts as cutting, so the top end of the cut can sit above 0: only the depth decides.
  const height: 'top' | 'bottom' | null = box.minZ < -zNear ? 'top' : box.maxZ > zNear ? 'bottom' : null;
  const hint = headerHints(header);
  const range = `(X ${n(box.minX)}…${n(box.maxX)}, Y ${n(box.minY)}…${n(box.maxY)})`;
  const conflict = (hint.corner !== null && corner !== null && hint.corner !== corner) || (hint.height !== null && height !== null && hint.height !== height);
  if (corner === null || conflict) {
    const why = conflict ? 'The file’s notes and its moves disagree.' : 'It is not at a corner or the centre.';
    return { corner: null, height, confidence: 'unclear', note: `Zero in this file is not clear ${range}. ${why} Keep your pick.` };
  }
  const loose = x.loose || y.loose || height === null;
  const agreed = hint.corner === corner || hint.height === height;
  const confidence: Confidence = loose && !agreed ? 'likely' : 'clear';
  const looks = confidence === 'clear' ? 'looks like' : 'may be';
  const z = height === 'top' ? ', at the stock top' : height === 'bottom' ? ', at the stock bottom' : '';
  return { corner, height, confidence, note: `Zero in this file ${looks} ${WORDS[corner]} of the part${z} ${range}.` };
}
