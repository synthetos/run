/** Why Probe Z can't run now and what to do next (SAFETY §4.5c). The flow only reads settings; it never says to change them. */
import { h, type ComponentChild } from 'preact';
import type { ProbeBlock } from '@synthetos/machine';
import { BLOCK_COPY } from './probeCopy.ts';
import { ProbeCard } from './ProbeCard.ts';

export function ProbeBlocked({ block, label, onClose }: { readonly block: ProbeBlock; readonly label: 'Close' | 'Cancel'; readonly onClose: () => void }): ComponentChild {
  const copy = BLOCK_COPY[block];
  return h(
    ProbeCard,
    { title: 'Probe Z', stage: null, step: 'blocked' },
    h('p', { class: 'probe-reason', 'data-probe-block': block }, copy.reason),
    copy.next === null ? null : h('p', { class: 'probe-next' }, copy.next),
    h('div', { class: 'probe-actions' }, h('button', { type: 'button', class: 'small', 'data-action': 'probe-close', onClick: onClose }, label)),
  );
}
