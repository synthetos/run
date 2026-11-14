import { h, type ComponentChild } from 'preact';
import type { BuildInfo } from '../../build-info/buildInfo.ts';
import { OUTBOUND } from '../outbound.ts';

/** Separate firmware page: never mounts the workspace shell. */
export function UpdatePage(_props: { readonly build: BuildInfo }): ComponentChild {
  return h('div', { class: 'page' },
    h('main', { class: 'page-main update-page', id: 'main' },
      h('div', { class: 'update-heading' }, h('h1', null, 'Update your TinyG'), h('button', { type: 'button', 'data-theme-toggle': '', 'aria-label': 'Switch light or dark theme' }, 'Light / dark')),
      h('p', null, 'No account needed. Use Chrome or Edge and a USB cable.'),
      h('p', null, 'Switch off spindle mains.'),
      h('div', { id: 'firmware-update' }, h('p', null, 'Loading the updater…')),
      h('template', { id: 'update-blog-link' }, h('a', { href: OUTBOUND.synthetosBlog }, 'Read the Synthetos blog')),
    ),
  );
}
