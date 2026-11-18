/**
 * The standalone brand files (docs/superpowers/specs/2026-11-16-first-run-design.md §4): the run wordmark and the n
 * mark as plain SVG for places that cannot read CSS (the README, synthetos.com, a blog byline). Ink and blue are the
 * literal token values, so there is one file per theme. Rendered from WORDMARK_GEOMETRY, the same numbers the Preact
 * component and the icons use; `pnpm gen:brand` writes the files and brand-svg.test.ts checks them.
 */
import { join } from 'node:path';
import { WORDMARK_GEOMETRY, type WordmarkGeometry } from '../../../../apps/web/src/brand/wordmarkGeometry.ts';
import { MARK_BOX } from '../icons/mark.ts';
import { REPO_ROOT, type ThemeName, type Themes } from '../tokens/theme.ts';

export interface BrandColours {
  readonly ink: string;
  readonly blue: string;
}

export const BRAND_DIR = join(REPO_ROOT, 'apps/web/src/brand');

/** `--ink` and `--blue` of each theme. */
export function brandColours(themes: Themes): Record<ThemeName, BrandColours> {
  const of = (name: ThemeName): BrandColours => {
    const ink = themes[name].get('--ink');
    const blue = themes[name].get('--blue');
    if (ink === undefined || blue === undefined) throw new Error(`tokens.css: the ${name} theme lacks --ink or --blue`);
    return { ink, blue };
  };
  return { light: of('light'), dark: of('dark') };
}

const open = (viewBox: string, stroke: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="run">\n` +
  `  <g fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">\n`;

const path = (d: string, stroke: string, extra = ''): string => `    <path d="${d}" stroke="${stroke}"${extra}/>\n`;

/** The n: dotted ink rapid, blue arch and stem, blue tool. */
function nParts(g: WordmarkGeometry, c: BrandColours): string {
  return (
    path(g.nStem, c.ink, ` stroke-dasharray="${g.dash}"`) +
    path(g.nArch, c.blue) +
    `  </g>\n` +
    `  <circle cx="${g.tool.cx}" cy="${g.tool.cy}" r="${g.tool.r}" fill="${c.blue}"/>\n` +
    `</svg>\n`
  );
}

/** The three letters. */
export function wordmarkSvg(g: WordmarkGeometry, c: BrandColours): string {
  return open(g.viewBox, g.stroke) + path(g.r, c.ink) + path(g.u, c.ink) + nParts(g, c);
}

/** The n alone, in the spec's box around it. */
export function markSvg(g: WordmarkGeometry, c: BrandColours): string {
  return open(`${MARK_BOX.x} ${MARK_BOX.y} ${MARK_BOX.w} ${MARK_BOX.h}`, g.stroke) + nParts(g, c);
}

export interface BrandFile {
  readonly file: string;
  readonly theme: ThemeName;
  readonly render: (c: BrandColours) => string;
}

const wordmark = (c: BrandColours): string => wordmarkSvg(WORDMARK_GEOMETRY, c);
const mark = (c: BrandColours): string => markSvg(WORDMARK_GEOMETRY, c);

/** Every committed brand file under apps/web/src/brand/: the light theme without a suffix, the dark theme with -dark. */
export const BRAND_FILES: readonly BrandFile[] = Object.freeze([
  { file: 'run-wordmark.svg', theme: 'light', render: wordmark },
  { file: 'run-wordmark-dark.svg', theme: 'dark', render: wordmark },
  { file: 'run-mark.svg', theme: 'light', render: mark },
  { file: 'run-mark-dark.svg', theme: 'dark', render: mark },
]);
