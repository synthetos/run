import { h, type ComponentChildren, type ComponentChild } from 'preact';
import type { BuildInfo } from '../build-info/buildInfo.ts';
import { SafetyBar } from '../shell/SafetyBar.ts';
import { SiteFooter } from '../shell/SiteFooter.ts';
import { type Route, SiteHeader } from '../shell/SiteHeader.ts';

/**
 * The frame of every static page (/safety/, /privacy/, the 404 page): the
 * safety bar with W1, the header, the page and the footer. Prerendered at
 * build time; these pages need no JavaScript except the theme toggle.
 */
export function StaticPage(props: { readonly build: BuildInfo; readonly current: Route; readonly children?: ComponentChildren }): ComponentChild {
  return h(
    'div',
    { class: 'page' },
    h(SafetyBar, { build: props.build, variant: 'page' }),
    h(SiteHeader, { current: props.current }),
    h('main', { class: 'page-main', id: 'main' }, props.children),
    h(SiteFooter, { build: props.build }),
  );
}
