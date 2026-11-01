/**
 * Tags every page's <head> gets (ROADMAP P0-05, D38): the Web App Manifest,
 * the icons and the theme colours. Injected by the prerender plugin so no
 * page can miss them; tests check the built pages and that the colours equal
 * the tokens in src/styles/tokens.css.
 */

/** `--sheet` of the light and dark themes (the browser UI next to the safety bar). */
export const THEME_COLOR = Object.freeze({ light: '#ffffff', dark: '#131f28' });

export interface HeadTag {
  readonly tag: 'link' | 'meta';
  readonly attrs: Readonly<Record<string, string>>;
}

export const HEAD_TAGS: readonly HeadTag[] = Object.freeze([
  { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' } },
  { tag: 'link', attrs: { rel: 'icon', href: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' } },
  { tag: 'link', attrs: { rel: 'icon', href: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' } },
  { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/icons/icon-192.png' } },
  { tag: 'meta', attrs: { name: 'theme-color', content: THEME_COLOR.light, media: '(prefers-color-scheme: light)' } },
  { tag: 'meta', attrs: { name: 'theme-color', content: THEME_COLOR.dark, media: '(prefers-color-scheme: dark)' } },
  { tag: 'meta', attrs: { name: 'color-scheme', content: 'light dark' } },
]);
