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
  grid: [0.89, 0.91, 0.93, 1],
  gridMajor: [0.78, 0.82, 0.85, 1],
  plannerExec: [0.56, 0.12, 0.56, 1],
  plannerQueued: [0.08, 0.42, 0.26, 1],
  plannerStarving: [0.58, 0.31, 0, 1],
  carveCut: [0.42, 0.36, 0.59, 1],
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
  grid: '--grid',
  gridMajor: '--rule',
  // The planner view of a running job (MACHINING_ASSISTANT §7): the line executing, the queued band, amber when starving.
  plannerExec: '--live',
  plannerQueued: '--state-run',
  plannerStarving: '--state-hold',
  // The carved stock's cut surfaces (owner, 2026-11-09), apart from every stock family's colour.
  carveCut: '--carve-cut',
};

/** How far traverses (rapids) are mixed from --muted toward the background, so cutting moves stay dominant. */
export const RAPID_MUTE = 0.4;

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/** The scene solids' tones, from the design tokens: the bed in the drafting accent softened toward the sheet, as the Setup view drew it. */
export interface SceneColors {
  readonly bed: Rgba;
  readonly fixture: Rgba;
  readonly clamp: Rgba;
  /** The stock when its material has no family colour. */
  readonly stock: Rgba;
}

const SCENE_FALLBACK: SceneColors = { bed: [0.72, 0.63, 0.47, 1], fixture: [0.49, 0.58, 0.66, 1], clamp: [0.43, 0.48, 0.53, 1], stock: [0.77, 0.8, 0.83, 1] };

export function sceneColors(read: (token: string) => string): SceneColors {
  const tan = parseColor(read('--tan'));
  const sheet = parseColor(read('--sheet'));
  return {
    bed: tan === null || sheet === null ? SCENE_FALLBACK.bed : mix(tan, sheet, 0.38),
    fixture: SCENE_FALLBACK.fixture,
    clamp: SCENE_FALLBACK.clamp,
    stock: SCENE_FALLBACK.stock,
  };
}

/** A token reader on the document's root (the design tokens), or one that reads nothing where there is no document (prerender). */
export function tokenReader(): (token: string) => string {
  if (typeof document === 'undefined') return () => '';
  const style = getComputedStyle(document.documentElement);
  return (token) => style.getPropertyValue(token);
}

export function previewColors(read: (token: string) => string): PreviewColors {
  const out: Record<string, Rgba> = {};
  for (const key of Object.keys(TOKENS) as (keyof PreviewColors)[]) out[key] = parseColor(read(TOKENS[key])) ?? (FALLBACK[key] as Rgba);
  // Traverses are drawn muted (and dashed, by the renderer): --muted mixed toward the background.
  out['rapid'] = mix(out['rapid'] as Rgba, out['background'] as Rgba, RAPID_MUTE);
  return out as unknown as PreviewColors;
}
