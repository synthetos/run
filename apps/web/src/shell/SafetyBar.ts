import { h, type ComponentChild } from 'preact';
import { w1, w2Label, w7 } from '@synthetos/safety';
import { type BuildInfo, versionLabel } from '../build-info/buildInfo.ts';
import { DisconnectedIcon, PauseIcon, WarningIcon } from './icons.ts';
import { signalText } from './signal.ts';

/** The tooltip of the stop button while no machine is connected (ROADMAP P0-05). */
export const STOP_UNAVAILABLE = 'Available when a machine is connected';

export interface SafetyBarProps {
  readonly build: BuildInfo;
  /**
   * `workspace`: W1, the state band (W7 NOT CONNECTED in Phase 0), the
   * version chip and the stop button. `page`: W1 and the version chip, for
   * the static pages, which have no machine context.
   */
  readonly variant: 'workspace' | 'page';
}

/**
 * The safety bar (SAFETY §5 W1, RUN_PLAN §7.1). Sticky at the top of every
 * page, never collapsible, covered or rearranged, and styled with the safety
 * bar tokens only, so nothing themed resembles it. Phase 0 has no machine
 * path: the state is always NOT CONNECTED and the stop button is disabled.
 */
export function SafetyBar({ build, variant }: SafetyBarProps): ComponentChild {
  const chip = h('span', { class: 'version-chip', 'data-version': '', title: `Version ${build.version}, commit ${build.sha}` }, versionLabel(build));
  return h(
    'div',
    { class: 'safety-bar', role: 'region', 'aria-label': 'Safety', 'data-region': 'safety-bar' },
    h(
      'div',
      { class: 'safety-bar-inner' },
      h('p', { class: 'safety-w1', 'data-safety': 'W1' }, WarningIcon(), h('span', null, ...signalText(w1()))),
      variant === 'workspace'
        ? h(
            'div',
            { class: 'safety-status' },
            h(
              'p',
              { class: 'state-band', 'data-state': 'not-connected', 'data-safety': 'W7', role: 'status' },
              DisconnectedIcon(),
              h('span', null, ...signalText(w7())),
            ),
            chip,
            h(
              'span',
              { class: 'stop-wrap', title: STOP_UNAVAILABLE },
              h(
                'button',
                {
                  type: 'button',
                  class: 'stop-button',
                  disabled: true,
                  title: STOP_UNAVAILABLE,
                  'aria-describedby': 'stop-unavailable',
                  'data-safety': 'W2',
                },
                PauseIcon(),
                h('span', null, w2Label()),
              ),
              h('span', { id: 'stop-unavailable', class: 'sr-only' }, STOP_UNAVAILABLE),
            ),
          )
        : h('div', { class: 'safety-status' }, chip),
    ),
  );
}
