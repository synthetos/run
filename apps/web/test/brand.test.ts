import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { all, byAttr, one, root, text, type El } from './tree.ts';
import { RunWordmark, WORDMARK_GEOMETRY } from '../src/brand/RunWordmark.ts';
import { WORDMARK_GEOMETRY as GEOMETRY } from '../src/brand/wordmarkGeometry.ts';
import { GitHubMark } from '../src/brand/GitHubMark.ts';
import { BrandLockup } from '../src/brand/BrandLockup.ts';
import { Icon } from '../src/workspace/icons.ts';

describe('RunWordmark', () => {
  it('draws r, u and the n as an arc move: dashed ink stem, blue arch, blue tool', () => {
    const svg = root(h(RunWordmark, { height: 44 }));
    expect(svg.props['viewBox']).toBe(WORDMARK_GEOMETRY.viewBox);
    expect(svg.props['height']).toBe(44);
    expect(svg.props['role']).toBe('img');
    expect(svg.props['aria-label']).toBe('run');
    const paths = all(svg, (e) => e.tag === 'path');
    expect(paths.map((p) => p.props['d'])).toEqual([WORDMARK_GEOMETRY.r, WORDMARK_GEOMETRY.u, WORDMARK_GEOMETRY.nStem, WORDMARK_GEOMETRY.nArch]);
    expect(paths[2]?.props['stroke-dasharray']).toBe(WORDMARK_GEOMETRY.dash);
    expect(paths[2]?.props['stroke']).toBe('currentColor');
    expect(paths[3]?.props['stroke']).toBe('var(--blue)');
    const tool = all(svg, (e) => e.tag === 'circle')[0];
    expect(tool?.props).toMatchObject({ cx: 60, cy: 40, r: 3.4, fill: 'var(--blue)' });
    expect(paths.every((p) => p.props['stroke-width'] === 3.4 && p.props['stroke-linecap'] === 'round')).toBe(true);
  });
  it('takes a label for the lockup', () => {
    expect(root(h(RunWordmark, { height: 22, label: 'Synthetos run' })).props['aria-label']).toBe('Synthetos run');
  });
  it('the geometry module is the single source and imports nothing, so the Node tools can read it', () => {
    expect(GEOMETRY).toBe(WORDMARK_GEOMETRY);
    expect(readFileSync(new URL('../src/brand/wordmarkGeometry.ts', import.meta.url), 'utf8')).not.toMatch(/^import /m);
  });
});

describe('GitHubMark and the book icon', () => {
  it('GitHubMark is one filled, hidden path', () => {
    const svg = root(GitHubMark(18));
    expect(svg.props).toMatchObject({ width: 18, height: 18, viewBox: '0 0 16 16', 'aria-hidden': 'true' });
    expect(all(svg, (e) => e.tag === 'path').map((p) => p.props['fill'])).toEqual(['currentColor']);
  });
  it('book is a 24-grid stroke icon', () => {
    const svg = root(Icon('book', 15));
    expect(svg.props['viewBox']).toBe('0 0 24 24');
    expect(all(svg, (e) => e.tag === 'path')).toHaveLength(1);
  });
});

describe('BrandLockup', () => {
  it('is one link named Synthetos Run: hidden crosshair, the name, the wordmark in place of the grey text', () => {
    const a = root(h(BrandLockup, null));
    expect(a.tag).toBe('a');
    expect(a.props['href']).toBe('/');
    expect(a.props['class']).toBe('brand');
    const [crosshair, name, run] = a.children as [El, El, El];
    expect(crosshair.tag).toBe('svg');
    expect(crosshair.props).toMatchObject({ 'aria-hidden': 'true', class: 'crosshair' });
    expect(name.tag).toBe('strong');
    expect(text(name)).toBe('Synthetos');
    expect(run.props['class']).toBe('brand-run');
    const wordmark = one(run, byAttr('role', 'img'));
    expect(wordmark.props['aria-label']).toBe('Run');
    expect(wordmark.props['viewBox']).toBe(WORDMARK_GEOMETRY.viewBox);
    expect(text(run)).toBe('');
    expect(a.children).toHaveLength(3);
  });
});
