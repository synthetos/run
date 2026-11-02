import { h, type ComponentChild } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import { STOP_TEXT, w1, w10, w2Label, w2Tooltip, w30, w6, w7 } from '@synthetos/safety';
import { type BuildInfo, versionLabel } from '../build-info/buildInfo.ts';
import { DisconnectedIcon, PauseIcon, WarningIcon } from './icons.ts';
import { signalText } from './signal.ts';

/** The tooltip of the stop button while no machine is connected (ROADMAP P0-05). */
export const STOP_UNAVAILABLE = 'Available when a machine is connected';

/** What the stop controls show (P1-06), from live/mount.ts after hydration. */
export interface StopBarView {
  /** The stop button acts: this tab is LIVE, or another tab of this browser controls (or controlled) a machine. */
  readonly available: boolean;
  /** `held`: a report shows the held class (W30 plus W10). `pause-requested`: Pause was sent, no hold reported yet. */
  readonly band: 'held' | 'pause-requested' | null;
  /** The last stop request's result, per machine (SAFETY §4.3), and what was asked for. */
  readonly outcome: { readonly kind: 'delivered' | 'not-delivered'; readonly action: 'pause' | 'stopJob' | 'spindleOff'; readonly machines: readonly { readonly machine: string; readonly delivered: boolean }[] } | null;
}

/** A machine lock name as the user reads it (the board id). */
export function machineLabel(lockName: string): string {
  return lockName.replace(/^synthetos-machine:/, '');
}

export interface SafetyBarProps {
  readonly build: BuildInfo;
  /**
   * `workspace`: W1, the state band (W7 NOT CONNECTED in Phase 0), the
   * version chip and the stop button. `page`: W1 and the version chip, for
   * the static pages, which have no machine context.
   */
  readonly variant: 'workspace' | 'page';
  /**
   * True when the previous session ended while LIVE (P1-05, SAFETY §5 W6,
   * T-S17): W6 replaces the NOT CONNECTED band. Read after hydration from
   * the `liveSession` marker; absent in the prerendered page.
   */
  readonly previousSession?: ReadonlySignal<boolean>;
  /** P1-06: the stop controls' state; absent in the prerendered page (the button stays disabled). */
  readonly stop?: ReadonlySignal<StopBarView>;
  /** P1-06: Pause (feedhold) from the stop button, the same path as Escape. */
  readonly onPause?: () => void;
}

function band(view: StopBarView | undefined, w6Shown: boolean): ComponentChild {
  if (view?.band === 'held') {
    return h(
      'p',
      { class: 'state-band', 'data-state': 'held', 'data-safety': 'W30', role: 'alert' },
      PauseIcon(),
      h('span', null, w30()),
      h('span', { class: 'state-band-note', 'data-safety': 'W10' }, ` ${w10()}`),
    );
  }
  if (view?.band === 'pause-requested') {
    return h('p', { class: 'state-band', 'data-state': 'pause-requested', role: 'status' }, PauseIcon(), h('span', null, STOP_TEXT.pauseRequested));
  }
  return w6Shown
    ? h('p', { class: 'state-band', 'data-state': 'previous-session', 'data-safety': 'W6', role: 'alert' }, WarningIcon(), h('span', null, ...signalText(w6())))
    : h('p', { class: 'state-band', 'data-state': 'not-connected', 'data-safety': 'W7', role: 'status' }, DisconnectedIcon(), h('span', null, ...signalText(w7())));
}

function outcomeLine(view: StopBarView | undefined): ComponentChild {
  const outcome = view?.outcome;
  if (outcome === null || outcome === undefined) return null;
  if (outcome.kind === 'not-delivered') {
    const missing = outcome.machines.filter((m) => !m.delivered).map((m) => machineLabel(m.machine));
    return h('p', { class: 'stop-outcome', 'data-stop-outcome': 'not-delivered', role: 'alert' }, missing.length > 0 ? `${STOP_TEXT.notDelivered} (${missing.join(', ')})` : STOP_TEXT.notDelivered);
  }
  // Phase 1: every session answers Stop job and Spindle off with `!` only (machine reducer, SAFETY §4.4), so
  // "Delivered" alone would read as "the job is stopped, spindle off". Say what the machine actually got.
  const as = outcome.action === 'pause' ? '' : ` as ${w2Label()}`;
  return h('p', { class: 'stop-outcome', 'data-stop-outcome': 'delivered', role: 'status' }, `Delivered to ${outcome.machines.map((m) => machineLabel(m.machine)).join(', ')}${as}`);
}

function stopButton(view: StopBarView | undefined, onPause: (() => void) | undefined): ComponentChild {
  if (view?.available === true && onPause !== undefined) {
    return h(
      'span',
      { class: 'stop-wrap' },
      h('button', { type: 'button', class: 'stop-button', title: w2Tooltip(), 'data-safety': 'W2', onClick: onPause }, PauseIcon(), h('span', null, w2Label())),
    );
  }
  return h(
    'span',
    { class: 'stop-wrap', title: STOP_UNAVAILABLE },
    h(
      'button',
      { type: 'button', class: 'stop-button', disabled: true, title: STOP_UNAVAILABLE, 'aria-describedby': 'stop-unavailable', 'data-safety': 'W2' },
      PauseIcon(),
      h('span', null, w2Label()),
    ),
    h('span', { id: 'stop-unavailable', class: 'sr-only' }, STOP_UNAVAILABLE),
  );
}

/**
 * The safety bar (SAFETY §5 W1, RUN_PLAN §7.1). Sticky at the top of every
 * page, never collapsible, covered or rearranged, and styled with the safety
 * bar tokens only, so nothing themed resembles it. Prerendered (and without
 * JavaScript) the state is NOT CONNECTED and the stop button is disabled;
 * after hydration `stop` enables it while a machine is LIVE in this browser
 * (P1-06) and shows W30 for a hold, never "STOPPED".
 */
export function SafetyBar({ build, variant, previousSession, stop, onPause }: SafetyBarProps): ComponentChild {
  const w6Shown = previousSession?.value === true;
  const view = stop?.value;
  const chip = h('span', { class: 'version-chip', 'data-version': '', title: `Version ${build.version}, commit ${build.sha}` }, versionLabel(build));
  return h(
    'div',
    { class: 'safety-bar', role: 'region', 'aria-label': 'Safety', 'data-region': 'safety-bar' },
    h(
      'div',
      { class: 'safety-bar-inner' },
      h('p', { class: 'safety-w1', 'data-safety': 'W1' }, WarningIcon(), h('span', null, ...signalText(w1()))),
      variant === 'workspace'
        ? h('div', { class: 'safety-status' }, band(view, w6Shown), chip, stopButton(view, onPause), outcomeLine(view))
        : h('div', { class: 'safety-status' }, chip),
    ),
  );
}
