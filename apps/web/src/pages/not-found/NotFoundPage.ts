import { h, type ComponentChild } from 'preact';
import type { BuildInfo } from '../../build-info/buildInfo.ts';
import { StaticPage } from '../StaticPage.ts';

/** The asset layer's not-found page (wrangler.jsonc `not_found_handling: 404-page`). */
export function NotFoundPage({ build }: { readonly build: BuildInfo }): ComponentChild {
  return h(
    StaticPage,
    { build, current: null },
    h(
      'div',
      { class: 'page-head', 'data-page': 'not-found' },
      h('p', { class: 'label' }, 'Error 404'),
      h('h1', null, 'Not found'),
      h('p', { class: 'lede' }, 'There is no page at this address. ', h('a', { href: '/' }, 'Open the workspace'), ' or read the ', h('a', { href: '/safety/' }, 'safety contract'), '.'),
    ),
  );
}
