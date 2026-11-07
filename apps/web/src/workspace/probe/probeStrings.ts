/**
 * Probe Z's safety strings, word for word from SAFETY §5 (W51, W52) and §6 (C39). Held here only until they land in
 * packages/safety/src/strings.ts; then this module re-exports them from @synthetos/safety and nothing else changes.
 */

/** W51: Pause during a probe (H90). */
export function w51(): string {
  return "Pause won't pause a probe: it ends it in an alarm. To stop, use Stop job. In an emergency, use your E-stop.";
}

/** W52: a dropped lead (H90). */
export function w52(): string {
  return "If the lead comes off now, the board can't tell. Z keeps going to the depth limit. Keep your E-stop in reach.";
}

/** Millimetres as the confirmations write them: at most three decimals, no trailing zeros. */
export function mm(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** C39: start a touch plate probe and set Z zero (H90). */
export function c39(p: { readonly feed: number; readonly depthMm: number; readonly system: string; readonly thicknessMm: number; readonly stopMm: number }): string {
  return (
    `Probe Z? Z will move down at ${mm(p.feed)} mm/min until the board reports contact, up to ${mm(p.depthMm)} mm. ` +
    `On contact Run sets ${p.system} Z so the tool reads ${mm(p.thicknessMm - p.stopMm)} mm above the work ` +
    `(plate ${mm(p.thicknessMm)} mm, less ${mm(p.stopMm)} mm calculated stop distance). This is saved on the controller.`
  );
}
