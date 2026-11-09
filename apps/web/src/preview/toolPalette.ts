/**
 * The colours of the tools in the 3D view (colour by tool; owner, 2026-11-09): a categorical palette in the
 * order the file uses its tools, never cycled, with one neutral colour for a tool that is not known. Two sets,
 * for light and dark backgrounds, each from the Okabe-Ito colour-blind-safe hues (blue, orange, bluish green,
 * reddish purple, yellow, sky blue), shaded to read on its background, then brown and slate. Red is left out:
 * it means "out of bounds" and "below the stock". Pure.
 */
import type { Rgba } from '@synthetos/gcode-view';

const hex = (h: string): Rgba => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};

/** Slot 0 (neutral) then the tools' colours, on a light background. */
export const LIGHT_PALETTE: readonly Rgba[] = ['#7d848e', '#0072b2', '#b36b00', '#00805c', '#a2477f', '#7a6e00', '#2e8bc0', '#8c5a2b', '#4d5966'].map(hex);
/** The same, on a dark background. */
export const DARK_PALETTE: readonly Rgba[] = ['#8b929b', '#5aa9e6', '#e69f00', '#2bc48f', '#e08cc0', '#f0e442', '#9bd3f5', '#d2a06b', '#aab4c0'].map(hex);

/** Tools that get their own colour; later ones share the last. */
export const TOOL_COLOURS = 8;

/** Relative luminance (WCAG) of a colour. */
function luminance(c: Rgba): number {
  const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** The palette for a background: the dark set on a dark one. */
export function toolPalette(background: Rgba | null): readonly Rgba[] {
  return background !== null && luminance(background) < 0.25 ? DARK_PALETTE : LIGHT_PALETTE;
}
