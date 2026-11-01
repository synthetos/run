/**
 * Build-time prerendering (ROADMAP P0-05).
 *
 * Every HTML page holds the marker `<!--run:body-->`. This plugin replaces it
 * with the page's markup, rendered from the same Preact components the
 * client uses (src/pages/registry.ts), and injects the shared head tags
 * (build/head.ts). So:
 * - the safety bar with W1 is in the HTML of every page, before and without
 *   JavaScript;
 * - every warning on a page comes from @synthetos/safety's strings.ts (T-S32),
 *   never from text typed into an HTML file;
 * - a page without the marker, or a marker without a registered page, fails
 *   the build.
 */
import type { Plugin } from 'vite';
import { Fragment, h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { BuildInfo } from '../src/build-info/buildInfo.ts';
import { PAGES } from '../src/pages/registry.ts';
import { HEAD_TAGS } from './head.ts';

export const BODY_MARKER = '<!--run:body-->';

/** Renders one page's HTML. Exported for the tests. */
export function prerenderPage(path: string, html: string, build: BuildInfo): string {
  const page = PAGES[path];
  if (page === undefined) throw new Error(`prerender: no page registered for ${path} (src/pages/registry.ts)`);
  const at = html.indexOf(BODY_MARKER);
  if (at === -1 || html.indexOf(BODY_MARKER, at + 1) !== -1) {
    throw new Error(`prerender: ${path} must contain ${BODY_MARKER} exactly once`);
  }
  return html.slice(0, at) + renderToString(h(Fragment, null, page(build))) + html.slice(at + BODY_MARKER.length);
}

export function prerender(build: BuildInfo): Plugin {
  return {
    name: 'run-prerender',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return {
          html: prerenderPage(ctx.path, html, build),
          tags: HEAD_TAGS.map((t) => ({ tag: t.tag, attrs: { ...t.attrs }, injectTo: 'head' as const })),
        };
      },
    },
  };
}
