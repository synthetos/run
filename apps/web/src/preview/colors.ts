/**
 * Preview colours from the page's design tokens (styles/tokens.css), read at
 * run time so the drawing follows the light and dark themes.
 */
import type { PreviewColors, Rgba } from '@synthetos/gcode-view';

/** Parses `#rgb`, `#rrggbb`, `rgb()` and `rgba()`; null otherwise. */
export function parseColor(value: string): Rgba | null {
  const v = value.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m !== null) {
    const [r, g, b] = (m[1] as string).split('').map((c) => parseInt(c + c, 16) / 255);
    return [r as number, g as number, b as number, 1];
  }
  m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m !== null) {
    const n = parseInt(m[1] as string, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v);
  if (m !== null) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, a];
  }
  return null;
}

const FALLBACK: PreviewColors = {
  background: [1, 1, 1, 1],
  rapid: [0.45, 0.55, 0.75, 1],
  feed: [0.1, 0.1, 0.12, 1],
  arc: [0.1, 0.25, 0.55, 1],
  outOfBounds: [0.8, 0.1, 0.1, 1],
  uncertain: [0.6, 0.6, 0.6, 1],
  highlight: [0.95, 0.6, 0.05, 1],
  envelope: [0.4, 0.4, 0.4, 1],
  axisX: [0.8, 0.15, 0.15, 1],
  axisY: [0.1, 0.55, 0.2, 1],
  axisZ: [0.15, 0.3, 0.8, 1],
};

/** Token per colour; a missing or unparsable token keeps the fallback. */
const TOKENS: Readonly<Record<keyof PreviewColors, string>> = {
  background: '--sheet',
  rapid: '--muted',
  feed: '--ink',
  arc: '--blue',
  outOfBounds: '--danger',
  uncertain: '--rule',
  highlight: '--warn',
  envelope: '--muted',
  axisX: '--danger',
  axisY: '--ok',
  axisZ: '--blue',
};

export function previewColors(read: (token: string) => string): PreviewColors {
  const out: Record<string, Rgba> = {};
  for (const key of Object.keys(TOKENS) as (keyof PreviewColors)[]) out[key] = parseColor(read(TOKENS[key])) ?? FALLBACK[key];
  return out as unknown as PreviewColors;
}
