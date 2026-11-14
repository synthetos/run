import { h, type ComponentChild } from 'preact';
import type { BuildInfo } from '../../build-info/buildInfo.ts';
import { SafetyBar } from '../../shell/SafetyBar.ts';

/** Separate firmware page: never mounts the workspace shell. */
export function UpdatePage({ build }: { readonly build: BuildInfo }): ComponentChild {
  return h('div', { class: 'page' },
    h(SafetyBar, { build, variant: 'page' }),
    h('main', { class: 'page-main', id: 'main' },
      h('h1', null, 'Update your TinyG'),
      h('p', null, 'No account needed. Use Chrome or Edge and a USB cable.'),
      h('p', null, 'Keep the E-stop within reach. Switch off spindle mains.'),
      h('div', { id: 'firmware-update' }),
    ),
  );
}
