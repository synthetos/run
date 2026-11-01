import { h, type ComponentChild } from 'preact';
import { MoonIcon, SunIcon } from './icons.ts';

export type Route = '/' | '/safety/' | '/privacy/' | null;

const NAV: readonly { readonly href: Exclude<Route, null>; readonly label: string }[] = [
  { href: '/', label: 'Workspace' },
  { href: '/safety/', label: 'Safety' },
  { href: '/privacy/', label: 'Privacy' },
];

/** The attribute the theme toggle is found by (theme/theme.ts). */
export const THEME_TOGGLE_ATTR = 'data-theme-toggle';

/**
 * The synthetos.com header pattern (wordmark, nav, theme toggle), with a
 * clear "Run" context so users know they are in the machine-control app
 * (RUN_PLAN §7.1).
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
        h('span', { class: 'brand-app' }, 'Run'),
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
