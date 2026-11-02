/**
 * The machine strip (WORKSPACE_SPEC "Fixed machine strip"; SAFETY §4.4 as
 * amended by OD-6): the machine's state in plain words, the live readouts,
 * and Pause and Stop job in a fixed place.
 *
 * - Pause (W2, "Pause", with the canonical tooltip) and Stop job are always
 *   in the same place and the same size in every view. They are enabled
 *   whenever a machine is LIVE in this browser (SAFETY §4.1, D1: never gated
 *   by sign-in, a view or a mode), exactly as the safety bar's stop button
 *   was. Prerendered and without a machine they are disabled and say why.
 * - Quiet while the machine is at rest, prominent while anything may be
 *   moving, held or queued (`StopBarView.prominent`). Same size either way.
 * - The state band strings come from @synthetos/safety (T-S32): W7 NOT
 *   CONNECTED, W6 after a session that ended while LIVE, W30 with W10 for a
 *   hold, PAUSE REQUESTED, and STOP NOT DELIVERED.
 *
 * A pure function of its props.
 */
import { h, type ComponentChild } from 'preact';
import { STOP_TEXT, w10, w2Label, w2Tooltip, w30, w6, w7 } from '@synthetos/safety';
import { machineLabel, STOP_UNAVAILABLE, type StopBarView } from '../shell/SafetyBar.ts';
import { signalText } from '../shell/signal.ts';
import type { StripStatus } from './status.ts';

export interface MachineStripProps {
  readonly status: StripStatus;
  readonly stop: StopBarView | null;
  readonly previousSession: boolean;
  readonly onPause?: () => void;
  readonly onStopJob?: () => void;
  /** Phase 2: shown in the held band only while this session holds its own motion (SAFETY §4.5b). */
  readonly onResume?: () => void;
  /** Phase 2: the worker's motion flag. Stop job then runs the flush sequence instead of a feedhold. */
  readonly motion?: boolean;
}

/** What Stop job does in this release, said plainly next to the button. */
export const STOP_JOB_PHASE1 = 'In this release Stop job sends a feedhold, like Pause, and leaves the spindle as it is. Use your E-stop to remove power.';

/** What Stop job does with motion control (SAFETY §4.4, Phase 2 amendment). */
export const STOP_JOB_PHASE2 = 'Stops motion, clears the queue, and turns the spindle and coolant off. Not an emergency stop: use your E-stop to remove power.';

function band(status: StripStatus, view: StopBarView | null, previousSession: boolean, onResume?: () => void): ComponentChild {
  if (view?.band === 'held') {
    return h(
      'div',
      { class: 'state-meta state-band', 'data-state': 'held', 'data-safety': 'W30', role: 'alert' },
      h('span', { class: 'band-text' }, h('strong', null, w30()), h('span', { class: 'state-band-note', 'data-safety': 'W10' }, ` ${w10()}`)),
      onResume === undefined ? null : h('button', { type: 'button', class: 'small resume', 'data-machine-control': 'resume', onClick: onResume }, 'Resume'),
    );
  }
  if (view?.band === 'pause-requested') {
    return h('div', { class: 'state-meta state-band', 'data-state': 'pause-requested', role: 'status' }, h('span', { class: 'band-text' }, h('strong', null, STOP_TEXT.pauseRequested)));
  }
  if (!status.connected) {
    return previousSession
      ? h('div', { class: 'state-meta state-band warn', 'data-state': 'previous-session', 'data-safety': 'W6', role: 'alert' }, h('span', { class: 'band-text' }, ...signalText(w6())))
      : h('div', { class: 'state-meta state-band', 'data-state': 'not-connected', 'data-safety': 'W7', role: 'status' }, h('span', { class: 'band-text' }, ...signalText(w7())));
  }
  return h(
    'div',
    { class: 'state-meta', 'data-state': 'connected' },
    status.pill === null ? null : h('span', { class: `pill ${status.pill.tone}` }, status.pill.text),
    status.text === null ? null : h('span', { class: 'meta-text', title: status.text }, status.text),
  );
}

/** The last stop request's result, in plain words (SAFETY §4.3; OD-6). */
export function outcomeText(view: StopBarView | null, motion = false): { readonly kind: 'delivered' | 'not-delivered'; readonly text: string } | null {
  const outcome = view?.outcome;
  if (outcome === null || outcome === undefined) return null;
  if (outcome.kind === 'not-delivered') {
    const missing = outcome.machines.filter((m) => !m.delivered).map((m) => machineLabel(m.machine));
    return { kind: 'not-delivered', text: missing.length > 0 ? `${STOP_TEXT.notDelivered} (${missing.join(', ')})` : STOP_TEXT.notDelivered };
  }
  const machines = outcome.machines.map((m) => machineLabel(m.machine)).join(', ');
  if (outcome.action === 'pause') return { kind: 'delivered', text: outcome.idle === true ? STOP_TEXT.pausedIdle : `Pause delivered to ${machines}` };
  // Phase 2: the session runs the flush sequence and reports "Stopped: …" in the strip from polled state.
  if (motion) return { kind: 'delivered', text: `${outcome.action === 'stopJob' ? STOP_TEXT.stopJob : 'Spindle off'} delivered to ${machines}.` };
  // Phase 1: every session answers Stop job and Spindle off with `!` only (machine reducer, SAFETY §4.4), so
  // "delivered" alone would read as "the job is stopped, spindle off". Say what the machine actually got.
  return { kind: 'delivered', text: `${outcome.action === 'stopJob' ? STOP_TEXT.stopJob : 'Spindle off'} delivered to ${machines} as ${w2Label()}. Use your E-stop to remove power.` };
}

function stopButtons(view: StopBarView | null, onPause: (() => void) | undefined, onStopJob: (() => void) | undefined, motion: boolean): ComponentChild {
  const available = view?.available === true;
  const prominent = available && view?.prominent === true ? 'true' : 'false';
  const pause = available && onPause !== undefined;
  const stop = available && onStopJob !== undefined;
  return h(
    'div',
    { class: 'stop-group', 'data-region': 'stop-controls', 'data-prominent': prominent },
    h(
      'button',
      {
        type: 'button',
        class: 'stop-button pause',
        'data-safety': 'W2',
        'data-machine-control': 'stop',
        'data-prominent': prominent,
        title: pause ? w2Tooltip() : STOP_UNAVAILABLE,
        ...(pause ? { onClick: onPause } : { disabled: true, 'aria-describedby': 'stop-unavailable' }),
      },
      h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', class: 'pause-icon' }, h('rect', { x: '3.5', y: '2.5', width: '3', height: '11', rx: '.5' }), h('rect', { x: '9.5', y: '2.5', width: '3', height: '11', rx: '.5' })),
      h('span', null, w2Label()),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'stop stop-job',
        'data-action': 'stop-job',
        'data-machine-control': 'stop',
        'data-prominent': prominent,
        title: stop ? (motion ? STOP_JOB_PHASE2 : STOP_JOB_PHASE1) : STOP_UNAVAILABLE,
        ...(stop ? { onClick: onStopJob } : { disabled: true, 'aria-describedby': 'stop-unavailable' }),
      },
      h('span', { class: 'stop-mark', 'aria-hidden': 'true' }),
      h('span', null, STOP_TEXT.stopJob),
    ),
    available ? null : h('span', { id: 'stop-unavailable', class: 'sr-only' }, STOP_UNAVAILABLE),
  );
}

export function MachineStrip({ status, stop, previousSession, onPause, onStopJob, onResume, motion = false }: MachineStripProps): ComponentChild {
  const held = stop?.band === 'held';
  // "spindle still on" only when the board reports spe=1 while held; wording only, nothing decides on it.
  const title = held ? (status.spindleOn ? STOP_TEXT.pausedSpindleOn : STOP_TEXT.paused) : status.title;
  const tone = held ? 'hold' : status.tone;
  const outcome = outcomeText(stop, motion);
  const showReadouts = status.connected && !held && stop?.band !== 'pause-requested' && status.readouts.length > 0;
  return h(
    'section',
    { class: 'statebar', 'data-region': 'machine-strip', 'data-tone': tone, 'aria-label': 'Machine state and stop controls' },
    h(
      'div',
      { class: 'state-title' },
      h('span', { class: 'state-dot', 'aria-hidden': 'true' }),
      h('div', null, h('strong', { 'data-strip': 'state' }, title), h('small', { 'data-strip': 'name' }, status.name)),
    ),
    band(status, stop, previousSession, onResume),
    showReadouts
      ? h(
          'div',
          { class: 'readouts', 'aria-label': 'Live readouts' },
          status.readouts.map((r) =>
            h('div', { class: 'readout', title: r.title, key: r.label }, h('span', null, r.label), h('strong', { 'data-readout': r.label }, r.value, r.unit === undefined || r.unit === '' ? null : h('small', null, ` ${r.unit}`))),
          ),
        )
      : null,
    stopButtons(stop, onPause, onStopJob, motion),
    outcome === null
      ? null
      : h('p', { class: `stop-outcome ${outcome.kind}`, 'data-stop-outcome': outcome.kind, role: outcome.kind === 'not-delivered' ? 'alert' : 'status' }, outcome.text),
  );
}
