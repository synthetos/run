/**
 * The standalone brand files (first-run design §4): run-wordmark.svg and run-mark.svg, one per theme because a file
 * cannot read CSS, generated from the wordmark geometry and the theme tokens by `pnpm gen:brand` and committed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORDMARK_GEOMETRY } from '../../../apps/web/src/brand/wordmarkGeometry.ts';
import { BRAND_DIR, BRAND_FILES, brandColours, markSvg, wordmarkSvg } from '../src/brand/svg.ts';
import { loadThemes, REPO_ROOT } from '../src/tokens/theme.ts';

const colours = brandColours(loadThemes());

describe('brand SVG files', () => {
  it('the colours are the ink and blue of each theme', () => {
    expect(colours).toEqual({ light: { ink: '#15222c', blue: '#1d5aa6' }, dark: { ink: '#e4ebf0', blue: '#7db0f5' } });
  });

  it('lists the wordmark and the mark, light without a suffix and dark with -dark', () => {
    expect(BRAND_FILES.map((f) => `${f.file} ${f.theme}`)).toEqual([
      'run-wordmark.svg light',
      'run-wordmark-dark.svg dark',
      'run-mark.svg light',
      'run-mark-dark.svg dark',
    ]);
    expect(BRAND_DIR).toBe(join(REPO_ROOT, 'apps/web/src/brand'));
  });

  it.each(BRAND_FILES.map((f) => [f.file, f] as const))('%s matches a fresh render byte for byte (pnpm gen:brand)', (_file, f) => {
    expect(readFileSync(join(BRAND_DIR, f.file), 'utf8')).toBe(f.render(colours[f.theme]));
  });

  it('the wordmark carries the three letters with the literal colours and the dashed stem', () => {
    const svg = wordmarkSvg(WORDMARK_GEOMETRY, colours.light);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-2 2 66 46" role="img" aria-label="run">/);
    for (const d of [WORDMARK_GEOMETRY.r, WORDMARK_GEOMETRY.u, WORDMARK_GEOMETRY.nStem, WORDMARK_GEOMETRY.nArch]) expect(svg).toContain(`d="${d}"`);
    expect(svg).toContain(`stroke-dasharray="${WORDMARK_GEOMETRY.dash}"`);
    expect(svg).toContain('<circle cx="60" cy="40" r="3.4" fill="#1d5aa6"/>');
    expect(svg.match(/stroke="#15222c"/g)).toHaveLength(3);
    expect(svg.match(/stroke="#1d5aa6"/g)).toHaveLength(1);
    expect(svg).not.toMatch(/currentColor|var\(/);
  });

  it('the mark is the n alone in the spec viewBox, dark files use the dark colours', () => {
    const svg = markSvg(WORDMARK_GEOMETRY, colours.dark);
    expect(svg).toContain('viewBox="40 12 24 32"');
    expect(svg).toContain(`d="${WORDMARK_GEOMETRY.nStem}"`);
    expect(svg).toContain(`d="${WORDMARK_GEOMETRY.nArch}"`);
    expect(svg).not.toContain(WORDMARK_GEOMETRY.r);
    expect(svg).not.toContain(WORDMARK_GEOMETRY.u);
    expect(svg).toContain('stroke="#e4ebf0"');
    expect(svg).toContain('fill="#7db0f5"');
  });

  it('no URL but the SVG namespace, and every file ends with one newline', () => {
    for (const f of BRAND_FILES) {
      const svg = f.render(colours[f.theme]);
      expect(svg.match(/[a-z]+:\/\/[^"]*/g)).toEqual(['http://www.w3.org/2000/svg']);
      expect(svg.endsWith('</svg>\n')).toBe(true);
    }
  });

  it('pnpm gen:brand writes them', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['gen:brand']).toBe('node tools/gates/src/brand/gen.ts');
  });
});
