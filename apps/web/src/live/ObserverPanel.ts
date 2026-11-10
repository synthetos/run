/**
 * What a tab that is not LIVE shows while another tab of this browser
 * controls a machine (ROADMAP P1-06; SAFETY §4.3 "Web Lock"): "Machine is
 * controlled in another tab" with Pause-request and Stop-job-request
 * buttons, and W29 once a watched lock is released. A pure function of its
 * props; live/tabStop.ts `LockWatcher` holds the state.
 */
import { h, type ComponentChild } from 'preact';
import { STOP_TEXT, w29 } from '@synthetos/safety';
import { machineLabel } from '../shell/SafetyBar.ts';
import { signalText } from '../shell/signal.ts';
import type { TabRole } from './tabStop.ts';
import { pressHandlers } from '../workspace/pressAction.ts';

export interface ObserverPanelProps {
  readonly role: TabRole;
  /** This tab is LIVE: it controls its own machine and observes nothing. */
  readonly live: boolean;
  readonly onPauseRequest: () => void;
  readonly onStopJobRequest: () => void;
  readonly onDismiss: () => void;
}

export function ObserverPanel(props: ObserverPanelProps): ComponentChild {
  const { role } = props;
  if (props.live || (!role.observing && role.released.length === 0)) return null;
  return h(
    'div',
    { class: 'observer', 'data-region': 'observer' },
    role.released.length > 0
      ? h(
          'div',
          { class: 'overlay-banner overlay-banner-warn', 'data-safety': 'W29', role: 'alert' },
          h('p', null, ...signalText(w29())),
          h('p', { 'data-machines': '' }, role.released.map(machineLabel).join(', ')),
          h('button', { type: 'button', class: 'button', 'data-action': 'dismiss-w29', onClick: props.onDismiss }, 'OK'),
        )
      : null,
    role.observing
      ? h(
          'div',
          { class: 'observer-controls', 'data-observer': 'controlled' },
          h('p', { role: 'status' }, `${STOP_TEXT.controlledElsewhere}: ${role.held.map(machineLabel).join(', ')}`),
          h('button', { type: 'button', class: 'button', 'data-action': 'pause-request', ...pressHandlers('observer-pause-request', props.onPauseRequest) }, 'Pause request'),
          h('button', { type: 'button', class: 'button', 'data-action': 'stop-job-request', ...pressHandlers('observer-stop-job-request', props.onStopJobRequest) }, 'Stop job request'),
        )
      : null,
  );
}
