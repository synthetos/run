import { h, type ComponentChild } from 'preact';
import { type BuildInfo, versionLabel } from '../build-info/buildInfo.ts';

/**
 * The site footer: version, licence and the links every page carries. It
 * ships in the workspace bundle, so it holds no link to another origin (the
 * bundle scan allows those only in prerendered HTML anchors).
 */
export function SiteFooter({ build }: { readonly build: BuildInfo }): ComponentChild {
  return h(
    'footer',
    { class: 'site-footer' },
    h(
      'div',
      { class: 'site-footer-inner' },
      h('p', null, h('span', { class: 'label' }, 'Synthetos Run'), ' ', h('span', { class: 'mono' }, versionLabel(build))),
      h(
        'p',
        null,
        h('a', { href: '/safety/' }, 'Safety contract'),
        ' · ',
        h('a', { href: '/privacy/' }, 'Privacy'),
        ' · ',
        h('a', { href: '/licenses/IBM-Plex-OFL.txt' }, 'Font licence (OFL)'),
        ' · Apache-2.0 · A Synthetos project',
      ),
    ),
  );
}
