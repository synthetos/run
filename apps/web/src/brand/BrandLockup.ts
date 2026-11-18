/**
 * The top bar lockup (docs/superpowers/specs/2026-11-16-first-run-design.md §4): the Synthetos crosshair, "Synthetos"
 * in the condensed face and the run wordmark at cap height, as one link home. The crosshair is decorative; the
 * wordmark carries "Run", so the link reads "Synthetos Run". The wordmark hides on phones and the name on narrow
 * phones (workspace.css), so the link also carries the name as a label.
 */
import { h, type ComponentChild } from 'preact';
import { RunWordmark } from './RunWordmark.ts';

/** The wordmark's height in the top bar: its 24-unit x-height lands on the cap height of the 20 px condensed name. */
export const LOCKUP_WORDMARK_HEIGHT = 27;

export function BrandLockup(): ComponentChild {
  return h(
    'a',
    { class: 'brand', href: '/', 'aria-label': 'Synthetos Run' },
    h(
      'svg',
      { class: 'crosshair', viewBox: '0 0 28 28', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'aria-hidden': 'true', focusable: 'false' },
      h('circle', { cx: 14, cy: 14, r: 9 }),
      h('path', { d: 'M14 0v9m0 10v9M0 14h9m10 0h9' }),
    ),
    h('strong', null, 'Synthetos'),
    h('span', { class: 'brand-run' }, h(RunWordmark, { height: LOCKUP_WORDMARK_HEIGHT, label: 'Run' })),
  );
}
