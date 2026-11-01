import { h, type ComponentChild } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import type { BuildInfo } from '../build-info/buildInfo.ts';
import { SafetyBar } from './SafetyBar.ts';
import { SiteFooter } from './SiteFooter.ts';
import { SiteHeader } from './SiteHeader.ts';

/**
 * The workspace shell (ROADMAP P0-05): the safety bar (W1, W7 NOT CONNECTED,
 * version, the disabled stop button), the header, an empty rail and a centre
 * placeholder. It is prerendered into index.html at build time and hydrated
 * by the workspace entry, so the safety bar shows even before (or without)
 * JavaScript. This module has no machine, serial or network code.
 */
export function Shell({ build, previousSession }: { readonly build: BuildInfo; readonly previousSession?: ReadonlySignal<boolean> }): ComponentChild {
  return h(
    'div',
    { class: 'shell', 'data-shell': 'workspace' },
    h(SafetyBar, { build, variant: 'workspace', ...(previousSession === undefined ? {} : { previousSession }) }),
    h(SiteHeader, { current: '/' }),
    h(
      'div',
      { class: 'workspace' },
      h('nav', { class: 'rail', 'data-region': 'rail', 'aria-label': 'Modes' }),
      h(
        'main',
        { class: 'centre', 'data-region': 'centre', id: 'main' },
        h(
          'section',
          { class: 'sheet centre-placeholder', 'aria-labelledby': 'centre-title' },
          h(
            'div',
            { class: 'title-block' },
            h('span', { class: 'label' }, 'Sheet'),
            h('span', { class: 'value' }, 'Workspace'),
            h('span', { class: 'label' }, 'Machine'),
            h('span', { class: 'value' }, 'none'),
          ),
          h(
            'div',
            { class: 'sheet-body' },
            h('h1', { id: 'centre-title' }, 'No machine connected'),
            h(
              'p',
              null,
              'This version of run.synthetos.com is a foundation build. It cannot connect to a controller, and nothing on this page can move a machine.',
            ),
            h('p', null, 'Before you ever connect a machine here, read the ', h('a', { href: '/safety/' }, 'safety contract'), '.'),
          ),
        ),
      ),
    ),
    h(SiteFooter, { build }),
  );
}
