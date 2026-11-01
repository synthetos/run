import { h, type ComponentChild } from 'preact';
import type { BuildInfo } from '../../build-info/buildInfo.ts';
import { StaticPage } from '../StaticPage.ts';

/**
 * https://run.synthetos.com/privacy/ — a placeholder until A2-08 publishes
 * the privacy notice (RUN_PLAN §9.1). It states only what is true of this
 * version.
 */
export function PrivacyPage({ build }: { readonly build: BuildInfo }): ComponentChild {
  return h(
    StaticPage,
    { build, current: '/privacy/' },
    h(
      'div',
      { class: 'page-head' },
      h('p', { class: 'label' }, 'run.synthetos.com · Privacy'),
      h('h1', null, 'Privacy'),
      h('p', { class: 'lede' }, 'The privacy notice for run.synthetos.com will be published here before sign-in and cloud storage are switched on.'),
    ),
    h(
      'section',
      { class: 'sheet', 'aria-labelledby': 'privacy-now' },
      h('div', { class: 'title-block' }, h('span', { class: 'label' }, 'Status'), h('span', { class: 'value' }, 'placeholder'), h('h2', { id: 'privacy-now' }, 'This version')),
      h(
        'div',
        { class: 'sheet-body' },
        h(
          'ul',
          null,
          h('li', null, 'There is no sign-in and no cloud storage yet.'),
          h('li', null, 'Pages load nothing from other websites: no analytics, no advertising, no third-party fonts or scripts.'),
          h('li', null, 'Your light or dark theme choice is kept in this browser only.'),
        ),
      ),
    ),
  );
}
