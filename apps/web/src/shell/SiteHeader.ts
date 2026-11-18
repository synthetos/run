import { h, type ComponentChild } from 'preact';
import { RunWordmark } from '../brand/RunWordmark.ts';
import { MoonIcon, SunIcon } from './icons.ts';

/** The wordmark's height beside the 1.3rem condensed name: its 24-unit x-height lands near the name's cap height. */
export const HEADER_WORDMARK_HEIGHT = 26;

export type Route = '/' | '/wiring/' | '/safety/' | '/privacy/' | null;

const NAV: readonly { readonly href: Exclude<Route, null>; readonly label: string }[] = [
  { href: '/', label: 'Workspace' },
  { href: '/wiring/', label: 'Wiring' },
  { href: '/safety/', label: 'Safety' },
  { href: '/privacy/', label: 'Privacy' },
];

/** The attribute the theme toggle is found by (theme/theme.ts). */
export const THEME_TOGGLE_ATTR = 'data-theme-toggle';

/**
 * The synthetos.com header pattern (crosshair, name, nav, theme toggle), with
 * the run wordmark beside the name so users know they are in the
 * machine-control app (RUN_PLAN §7.1; the same wordmark as the workspace top
 * bar, first-run design §4).
 */
export function SiteHeader({ current }: { readonly current: Route }): ComponentChild {
  return h(
    'header',
    { class: 'site-header' },
    h(
      'div',
      { class: 'site-header-inner' },
      h(
        'a',
        { class: 'brand', href: '/' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
        h('span', { class: 'brand-name' }, 'Synthetos'),
        h('span', { class: 'brand-app' }, h(RunWordmark, { height: HEADER_WORDMARK_HEIGHT, label: 'Run' })),
      ),
      h('span', { class: 'brand-context' }, 'run.synthetos.com · machine control'),
      h(
        'nav',
        { class: 'site-nav', 'aria-label': 'Main' },
        ...NAV.map((item) => h('a', { href: item.href, 'aria-current': item.href === current ? 'page' : undefined }, item.label)),
        h(
          'button',
          { type: 'button', class: 'theme-toggle', [THEME_TOGGLE_ATTR]: '', 'aria-label': 'Toggle day/night mode', title: 'Toggle day/night mode' },
          SunIcon(),
          MoonIcon(),
        ),
      ),
    ),
  );
}
