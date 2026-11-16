import { c24 } from '@synthetos/safety';
import { h, type ComponentChild } from 'preact';
import type { MotionCommand, SnapshotMessage } from '../../../machine-worker/rpc.ts';
import { ContextHelp } from '../../../shell/ContextHelp.ts';
import { Icon } from '../../icons.ts';
import { connected, type WorkspaceModel } from '../../model.ts';
import { motionUi, type MotionUi } from '../../motion.ts';
import { skipSpindleConfirm, spindleConfirmSkipped } from '../../spindleConfirm.ts';
import { COOLANT_TITLE, coolantText, displayReadouts, SPINDLE_TITLE, spindleText, UNKNOWN } from '../../status.ts';
import { ConfirmCard } from '../../ui.ts';
import { isLive, LIVE_HOOKS, STATIC_HOOKS, type Hooks } from './motionHooks.ts';

/**
 * Spindle and coolant (SAFETY §4.5b, H52). The readouts are what the board reports (edge-next `spe`, `spc`,
 * `spd`, `sps`, `cof`, `com`), from its status list or the GETs Run asks about once a second, labelled
 * commanded: TinyG measures nothing. Nothing that pauses or stops reads them. In a motion session the controls
 * send M3/M4 with S, M5, M7, M8 and M9; Spindle on asks C24 first unless the user turned that off for this page.
 */
function spindleBody({ model, compact = false }: SpindleProps, hk: Hooks): ComponentChild {
  const { view, r, spindle, spindleLine, snapshot, coolant } = spindleReadouts({ model });
  const ui = motionUi(view);
  const send = model?.actions.value?.motion;
  const [rpm, setRpm] = hk.state(10000);
  const [asking, setAsking] = hk.state<'cw' | 'ccw' | null>(null);
  const [skip, setSkip] = hk.state(false);
  const [note, setNote] = hk.state<string | null>(null);
  const on = ui.enabled && send !== undefined;
  // Spindle and coolant off are stop-class: offered whenever a motion session is connected, never gated.
  const off = send !== undefined && ui.flag && ui.connected;
  const run = (command: MotionCommand): void => {
    setNote(null);
    void send?.(command).then(setNote);
  };
  const start = (direction: 'cw' | 'ccw'): void => {
    if (spindleConfirmSkipped()) run({ op: 'spindleOn', direction, rpm });
    else setAsking(direction);
  };
  const mist = r?.com === 1;
  const flood = r?.cof === 1;
  const coolantToggle = (which: 'mist' | 'flood', pressed: boolean): void => {
    if (!pressed) {
      run({ op: 'coolantOn', which });
      return;
    }
    // TinyG has one off command for both outputs (M9): turn the other one back on if it was on.
    run({ op: 'coolantOff' });
    const other = which === 'mist' ? flood : mist;
    if (other) run({ op: 'coolantOn', which: which === 'mist' ? 'flood' : 'mist' });
  };
  return h(
    'section',
    { class: `insp sec-spindle${compact ? ' compact' : ''}`, 'aria-labelledby': 'spindle-title' },
    h('header', null, h('h2', { id: 'spindle-title' }, 'Spindle and coolant'), h('span', { class: 'tag' }, 'Commanded')),
    compact ? null : spindleReadout({ spindle, spindleLine, snapshot, coolant }),
    spindleControls({ ui, off, run, on, start, rpm, setRpm, asking, setAsking, skip, setSkip, mist, coolantToggle, flood }),
    note === null ? null : h('p', { class: 'motion-note', role: 'status' }, note),
  );
}

type SpindleProps = { readonly model?: WorkspaceModel | null; readonly compact?: boolean };

function spindleReadouts({ model }: { readonly model: WorkspaceModel | null | undefined }) {
  const view = model?.live.value ?? null;
  const snapshot = view !== null && connected(view) ? view.message?.snapshot : undefined;
  const r = displayReadouts(snapshot);
  const spindle = spindleText(r);
  const spindleLine = snapshot === undefined ? 'Not connected' : spindle === UNKNOWN ? 'Unknown' : spindle;
  const coolant = coolantText(r);
  return { view, r, spindle, spindleLine, snapshot, coolant };
}

function spindleControls({ ui, off, run, on, start, rpm, setRpm, asking, setAsking, skip, setSkip, mist, coolantToggle, flood }: { readonly ui: MotionUi; readonly off: boolean; readonly run: (command: MotionCommand) => void; readonly on: boolean; readonly start: (direction: "cw" | "ccw") => void; readonly rpm: number; readonly setRpm: (v: number) => void; readonly asking: "cw" | "ccw" | null; readonly setAsking: (v: "cw" | "ccw" | null) => void; readonly skip: boolean; readonly setSkip: (v: boolean) => void; readonly mist: boolean; readonly coolantToggle: (which: "mist" | "flood", pressed: boolean) => void; readonly flood: boolean }): ComponentChild {
  return h(
    'div',
    { class: 'spindle-controls', title: ui.reason ?? undefined },
    spindleDirection({ off, run, on, start }),
    h(
      'label',
      { class: 'spindle-speed' },
      h('span', { class: 'sr-only' }, 'Speed'),
      spindleSpeed({ rpm, on, setRpm }),
      h('small', null, 'rpm')
    ),
    asking === null || !on
      ? null
      : spindleConfirmation({ asking, rpm, setAsking, skip, run, setSkip }),
    coolantControls({ mist, off, on, coolantToggle, flood })
  );
}

function spindleConfirmation({ asking, rpm, setAsking, skip, run, setSkip }: { readonly asking: "cw" | "ccw"; readonly rpm: number; readonly setAsking: (v: "cw" | "ccw" | null) => void; readonly skip: boolean; readonly run: (command: MotionCommand) => void; readonly setSkip: (v: boolean) => void }): ComponentChild {
  return h(
    ConfirmCard,
    {
      text: c24({ direction: asking === 'cw' ? 'CW' : 'CCW', rpm }),
      confirm: 'Start spindle',
      safety: 'C24',
      onCancel: () => setAsking(null),
      onConfirm: () => {
        if (skip) skipSpindleConfirm();
        const direction = asking;
        setAsking(null);
        run({ op: 'spindleOn', direction, rpm });
      },
    },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-action': 'skip-spindle-confirm', checked: skip, onChange: (e: Event) => setSkip((e.currentTarget as HTMLInputElement).checked) }), ' Don’t ask again until I reload this page')
  );
}

function coolantControls({ mist, off, on, coolantToggle, flood }: { readonly mist: boolean; readonly off: boolean; readonly on: boolean; readonly coolantToggle: (which: "mist" | "flood", pressed: boolean) => void; readonly flood: boolean }): ComponentChild {
  return h(
    'div',
    { class: 'inline-field' },
    h('span', { class: 'coolant-label' }, 'Coolant', h(ContextHelp, { id: 'spindle-help', label: 'About spindle and coolant readouts', end: true }, SPINDLE_TITLE, ' ', COOLANT_TITLE)),
    h(
      'span',
      { class: 'seg', role: 'group', 'aria-label': 'Coolant' },
      h('button', { type: 'button', class: mist ? 'selected' : undefined, 'aria-pressed': mist ? 'true' : 'false', 'data-machine-control': 'coolant', ...((mist ? off : on) ? { onClick: () => coolantToggle('mist', mist) } : { disabled: true }) }, 'Mist'),
      h('button', { type: 'button', class: flood ? 'selected' : undefined, 'aria-pressed': flood ? 'true' : 'false', 'data-machine-control': 'coolant', ...((flood ? off : on) ? { onClick: () => coolantToggle('flood', flood) } : { disabled: true }) }, 'Flood')
    )
  );
}

function spindleDirection({ off, run, on, start }: { readonly off: boolean; readonly run: (command: MotionCommand) => void; readonly on: boolean; readonly start: (direction: "cw" | "ccw") => void }): ComponentChild {
  return h(
    'div',
    { class: 'seg full', role: 'group', 'aria-label': 'Spindle direction' },
    h('button', { type: 'button', key: 'off', 'data-machine-control': 'spindle', ...(off ? { onClick: () => run({ op: 'spindleOff' }) } : { disabled: true }) }, 'Off'),
    h('button', { type: 'button', key: 'cw', 'data-machine-control': 'spindle', ...(on ? { onClick: () => start('cw') } : { disabled: true }) }, 'CW'),
    h('button', { type: 'button', key: 'ccw', 'data-machine-control': 'spindle', ...(on ? { onClick: () => start('ccw') } : { disabled: true }) }, 'CCW')
  );
}

function spindleSpeed({ rpm, on, setRpm }: { readonly rpm: number; readonly on: boolean; readonly setRpm: (v: number) => void }): ComponentChild {
  return h('input', {
    type: 'number',
    min: 1,
    max: 100000,
    step: 100,
    value: rpm,
    ...(on ? { onInput: (e: Event) => setRpm(Math.max(1, Math.round(Number((e.currentTarget as HTMLInputElement).value) || 1))) } : { disabled: true }),
    'aria-label': 'Spindle speed, rpm (commanded)',
    'data-machine-control': 'spindle',
  });
}

function spindleReadout({ spindle, spindleLine, snapshot, coolant }: { readonly spindle: string; readonly spindleLine: string; readonly snapshot: SessionSnapshot | undefined; readonly coolant: string }): ComponentChild {
  return h(
    'div',
    { class: 'spindle-state' },
    h('span', { class: `spindle-mark${spindle.startsWith('On') ? ' on' : ''}`, 'aria-hidden': 'true' }, Icon('spindle', 26)),
    h(
      'div',
      { class: 'spindle-text' },
      h('strong', { 'data-spindle': 'spindle', title: SPINDLE_TITLE }, spindleLine),
      h('small', { 'data-spindle': 'coolant', title: COOLANT_TITLE }, `Coolant: ${snapshot === undefined ? 'not connected' : coolant === UNKNOWN ? 'unknown' : coolant === 'Off' ? 'off' : coolant}`)
    )
  );
}

function SpindleLive(props: SpindleProps): ComponentChild {
  return spindleBody(props, LIVE_HOOKS);
}

export function SpindleSection(props: SpindleProps = {}): ComponentChild {
  return isLive(props.model) ? h(SpindleLive, props) : spindleBody(props, STATIC_HOOKS);
}

type SessionSnapshot = SnapshotMessage['snapshot'];
