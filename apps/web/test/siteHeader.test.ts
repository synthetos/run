/**
 * The static pages' header (wiring, safety, privacy) says Run with the same wordmark as the workspace top bar, so a
 * visitor sees one Run branding (first-run design §4; logo review follow-up).
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { SiteHeader } from '../src/shell/SiteHeader.ts';
import { byAttr, one, root, text } from './tree.ts';

describe('SiteHeader', () => {
  it('the brand link is the crosshair, Synthetos and the run wordmark, named "Synthetos Run"', () => {
    const tree = root(h(SiteHeader, { current: '/safety/' }));
    const brand = one(tree, (e) => e.tag === 'a' && e.props['class'] === 'brand', 'brand link');
    const wordmark = one(brand, byAttr('role', 'img'), 'wordmark');
    expect(wordmark.tag).toBe('svg');
    expect(wordmark.props['aria-label']).toBe('Run');
    // The only text is the name; "Run" is said by the wordmark, not by a text badge.
    expect(text(brand)).toBe('Synthetos');
    expect(one(brand, (e) => e.props['class'] === 'brand-app', 'app slot').children.some((c) => typeof c === 'string')).toBe(false);
  });
});
