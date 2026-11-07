/**
 * Probe Z's safety strings (SAFETY §5 W51, W52; §6 C39, H90), from @synthetos/safety, with the page's number format.
 */
import { c39 as safetyC39 } from '@synthetos/safety';

export { w51, w52 } from '@synthetos/safety';

/** Millimetres as the confirmations write them: at most three decimals, no trailing zeros. */
export function mm(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** C39: start a touch plate probe and set Z zero (H90), from the plan's numbers. */
export function c39(p: { readonly feed: number; readonly depthMm: number; readonly system: string; readonly thicknessMm: number; readonly stopMm: number }): string {
  return safetyC39({
    feed: mm(p.feed),
    depth: mm(p.depthMm),
    system: p.system,
    zero: mm(p.thicknessMm - p.stopMm),
    thickness: mm(p.thicknessMm),
    stop: mm(p.stopMm),
  });
}
