/**
 * Probe Z (SAFETY §4.5c, H90; owner 2026-11-07): the mount under the Position readout, at Simple and Advanced. A
 * closed row with the Probe Z button (and the plate reminder while it is out); opened, the step the session is in.
 *
 * The session owns the probe: its step, the touch test, the plan, the outcome and whether the plate is out. This
 * keeps only what the owner is typing and which card is open, and sends the session's narrow commands. Pause and
 * Stop job stay in the machine strip throughout; nothing here covers them.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { c13 } from '@synthetos/safety';
import type { MotionCommand } from '../../machine-worker/rpc.ts';
import { Icon } from '../icons.ts';
import { uiLevel } from '../jobWorkflow.ts';
import type { WorkspaceModel } from '../model.ts';
import { JOG_FEED, motionUi } from '../motion.ts';
import { ConfirmCard } from '../ui.ts';
import { ProbeBlocked } from './ProbeBlocked.ts';
import { ProbeCard } from './ProbeCard.ts';
import { alarmMeaning, BLOCK_COPY } from './probeCopy.ts';
import { initialForm, type ProbeForm } from './probeForm.ts';
import { lastThickness, rememberThickness } from './probeMemory.ts';
import { ProbeReady } from './ProbeReady.ts';
import { ProbeResult } from './ProbeResult.ts';
import { ProbeRunning } from './ProbeRunning.ts';
import { ProbeSetup, type ProbeSetupPlan } from './ProbeSetup.ts';
import { ProbeTouch, touchPassed } from './ProbeTouch.ts';
import { LIFT_MM, probeView } from './probeView.ts';

type Send = (command: MotionCommand) => Promise<string | null>;

/** The state hooks the body uses: Preact's live, inert when prerendered, and a recording pair in the tests. */
export interface Hooks {
  state<T>(initial: T): [T, (v: T) => void];
}
const LIVE: Hooks = { state: <T,>(initial: T) => useState<T>(initial) as [T, (v: T) => void] };
const STATIC: Hooks = { state: <T,>(initial: T): [T, (v: T) => void] => [initial, () => undefined] };

export interface ProbeZProps {
  readonly model?: WorkspaceModel | null;
}

export function probeZBody({ model }: ProbeZProps, hk: Hooks): ComponentChild {
  const view = model?.live.value ?? null;
  const send: Send | undefined = model?.actions.value?.motion;
  const pv = probeView(view);
  const probe = pv.probe;
  const step = probe?.step ?? 'closed';
  const ui = motionUi(view);
  const advanced = uiLevel.value.value === 'advanced';
  const system = probe?.system ?? 'G54';
  const [open, setOpen] = hk.state(false);
  const [form, setForm] = hk.state<ProbeForm | null>(null);
  const [continued, setContinued] = hk.state(false);
  const [plateOn, setPlateOn] = hk.state(false);
  /** The C13 meaning while Clear alarm is being asked, or null. */
  const [asking, setAsking] = hk.state<string | null>(null);
  const [note, setNote] = hk.state<string | null>(null);
  const [done, setDone] = hk.state<string | null>(null);
  const remembered = lastThickness(pv.boardId);
  const current = form ?? initialForm(remembered);

  const run = (command: MotionCommand): void => {
    setNote(null);
    if (send === undefined) setNote('Connect a machine to use these controls.');
    else void send(command).then(setNote);
  };
  const begin = (): void => {
    setDone(null);
    setNote(null);
    setForm(initialForm(remembered));
    setOpen(true);
  };
  const touch = (plan: ProbeSetupPlan): void => {
    rememberThickness(pv.boardId, plan.thicknessMm);
    setContinued(false);
    setPlateOn(false);
    run({ op: 'probeTouch', ...plan });
  };
  const cancel = (): void => run({ op: 'probeCancel' });
  const plateOff = (): void => {
    setDone(probe?.outcome?.kind === 'contactZeroSet' ? `${system} Z zero set from the touch plate.` : null);
    setOpen(false);
    setForm(null);
    run({ op: 'probePlateOff' });
  };

  let card: ComponentChild = null;
  if (probe === null || step === 'closed') {
    if (open)
      card =
        pv.block !== null
          ? h(ProbeBlocked, { block: pv.block, label: 'Close', onClose: () => setOpen(false) })
          : h(ProbeSetup, { form: current, zjh: pv.probe.zjh, system, remembered: remembered !== null && current.thickness === String(remembered), advanced, onChange: setForm, onNext: touch, onCancel: () => setOpen(false) });
  } else if ((step === 'touch' || step === 'ready') && pv.block !== null) {
    card = h(ProbeBlocked, { block: pv.block, label: 'Cancel', onClose: cancel });
  } else if (step === 'touch' && !(continued && touchPassed(probe.touch))) {
    card = h(ProbeTouch, { input: probe.input, touch: probe.touch, advanced, onContinue: () => setContinued(true), onRetest: () => run({ op: 'probeRetest' }), onCancel: cancel });
  } else if (step === 'touch' || step === 'ready') {
    card = h(ProbeReady, { plan: probe.plan, system, input: probe.input, homed: ui.homed, advanced, plateOn, onPlate: setPlateOn, onStart: () => run({ op: 'probeStart', confirm: true }), onCancel: cancel });
  } else if (step === 'result') {
    card =
      probe.outcome === null
        ? h(ProbeCard, { title: 'Probe Z', stage: null, step: 'result' }, h('p', { role: 'status' }, 'Waiting for the board.'))
        : h(ProbeResult, { outcome: probe.outcome, system, alarm: ui.alarm, liftBlocked: ui.enabled ? null : ui.reason, advanced, onLift: () => run({ op: 'jog', axes: { z: 1 }, distanceMm: LIFT_MM, feed: JOG_FEED.default }), onClear: () => setAsking(alarmMeaning(probe.outcome, view?.message?.snapshot.live.stat)), onPlateOff: plateOff });
  } else {
    card = h(ProbeRunning, { step, plan: probe.plan, input: probe.input, advanced });
  }

  const reason = pv.block === null ? null : BLOCK_COPY[pv.block].reason;
  return h(
    'div',
    { class: 'probe-z', 'data-region': 'probe-z' },
    card !== null
      ? card
      : h(
          'div',
          { class: 'probe-row' },
          h('button', { type: 'button', class: `small probe-open${reason === null ? '' : ' muted'}`, 'data-action': 'probe-open', title: reason ?? 'Set Z zero from a touch plate', onClick: begin }, Icon('probe', 16), h('span', null, 'Probe Z')),
          probe?.plateOut === true
            ? h('span', { class: 'probe-plate-out', role: 'status' }, h('span', null, 'Touch plate still out'), h('button', { type: 'button', class: 'small', 'data-action': 'probe-plate-off', onClick: plateOff }, 'The plate is off'))
            : done === null
              ? null
              : h('span', { class: 'fine', 'data-probe': 'done' }, done),
        ),
    asking !== null && ui.alarm ? h(ConfirmCard, { text: c13({ meaning: asking }), confirm: 'Clear alarm', safety: 'C13', onCancel: () => setAsking(null), onConfirm: () => {
          setAsking(null);
          run({ op: 'clearAlarm' });
        } }) : null,
    note === null ? null : h('p', { class: 'motion-note', role: 'status', 'data-probe': 'note' }, note),
  );
}

function ProbeZLive(props: ProbeZProps): ComponentChild {
  return probeZBody(props, LIVE);
}

export function ProbeZ(props: ProbeZProps = {}): ComponentChild {
  return props.model?.actions.value?.motion !== undefined ? h(ProbeZLive, props) : probeZBody(props, STATIC);
}
