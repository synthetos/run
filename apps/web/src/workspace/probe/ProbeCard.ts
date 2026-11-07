/**
 * The frame every Probe Z step shares: its heading and, for the steps before the probe, where the owner is
 * (Setup · Touch test · Ready). In the page's flow, never over the machine strip, W1 or the stop controls.
 */
import { h, type ComponentChild } from 'preact';
import { focusOnMount } from '../ui.ts';

export type ProbeStage = 'setup' | 'touch' | 'ready';

const STAGES: readonly (readonly [ProbeStage, string])[] = [
  ['setup', 'Setup'],
  ['touch', 'Touch test'],
  ['ready', 'Ready'],
];

export function ProbeCard(props: {
  readonly title: string;
  /** Which step before the probe this is, or null for the probe and its result. */
  readonly stage: ProbeStage | null;
  /** The heading takes the focus when the card appears (the probe and its result, whose buttons come and go). */
  readonly focusHeading?: boolean;
  readonly step: string;
  readonly children?: ComponentChild;
}): ComponentChild {
  return h(
    'section',
    { class: 'probe-card', 'data-probe-step': props.step, 'aria-labelledby': 'probe-title' },
    h(
      'header',
      { class: 'probe-head' },
      h('h3', { id: 'probe-title', tabindex: -1, ...(props.focusHeading === true ? { ref: focusOnMount } : {}) }, props.title),
      props.stage === null
        ? null
        : h(
            'ol',
            { class: 'probe-stages', 'aria-label': 'Probe Z steps' },
            STAGES.map(([id, label]) => h('li', { key: id, ...(id === props.stage ? { 'aria-current': 'step', class: 'current' } : {}) }, label)),
          ),
    ),
    props.children,
  );
}
