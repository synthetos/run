/**
 * The Run view (Stage 1, read-only): connect, the live position, the G-code
 * preview with its timeline, the G-code, Console and Live job tabs, and the
 * job card. Jog, spindle, coolant and overrides are shown as what is coming
 * and send nothing.
 *
 * The preview is the TB-03 PreviewPanel (gcode.worker, Preview3D, LineList)
 * arranged by `runLayout`. There is no Play, Simulate or Animate control
 * (SAFETY H15, T-S41): the timeline scrubs and highlights lines, nothing
 * moves.
 */
import { h, type ComponentChild } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { c13, c16, c24, c25, w13, w34 } from '@synthetos/safety';
import { DIALECTS, type DialectId } from '@synthetos/protocol';
import { LITE_THRESHOLD_LINES, PREVIEW_DIALECTS, type PreviewMode } from '../../gcode-worker/pipeline.ts';
import type { WorkerLike } from '../../gcode-worker/client.ts';
import { Dro } from '../../machine-ui/Dro.ts';
import { TranscriptSave } from '../../machine-ui/TranscriptSave.ts';
import { PreviewPanel, markerText, type LiveMarkerView, type PreviewParts } from '../../preview/PreviewPanel.ts';
import { DIALECT_LABEL, MODE_LABEL, fileLevel, on, progressText } from '../../preview/PreviewView.ts';
import type { PreviewResult } from '../../gcode-worker/pipeline.ts';
import { routineChanges, shownCounts } from '../../preview/gcodeList.ts';
import type { SettingValue } from '@synthetos/schema';
import { ConnectPanel } from '../../live/ConnectPanel.ts';
import { connectorPins, dialectOf, plainValue, settingsOf, type PinInfo } from '../boardFacts.ts';
import { Icon } from '../icons.ts';
import { readStored, writeStored } from '../storage.ts';
import { CheckRow, TabBar, TabPane } from '../ui.ts';
import { connected, type LiveView, type WorkspaceModel } from '../model.ts';
import { JOG_FEED, JogController, MM_PER_IN, STEPS_IN, STEPS_MM, axesText, goToZeroPath, jogKey, machineZ, motionUi, workOffsets, type JogTimers, type MotionUi } from '../motion.ts';
import type { MotionAxis, MotionCommand } from '../../machine-worker/rpc.ts';
import { signalText } from '../../shell/signal.ts';
import { fileFacts, sampleFile, SAMPLES } from '../samples.ts';
import { COOLANT_TITLE, coolantText, coord, displayReadouts, num, SPINDLE_TITLE, spindleText, UNKNOWN } from '../status.ts';

export interface RunViewProps {
  readonly model: WorkspaceModel | null;
  readonly spawn: (() => WorkerLike) | null;
  readonly marker?: ReadonlySignal<LiveMarkerView | null>;
  readonly onView: (view: string) => void;
}

export function RunView({ model, spawn, marker, onView }: RunViewProps): ComponentChild {
  const live = model?.live.value ?? null;
  const reportedLine = live !== null && connected(live) ? (live.message?.snapshot.live.line ?? null) : null;
  return h(PreviewPanel, { spawn, ...(marker === undefined ? {} : { marker }), reportedLine, layout: (parts: PreviewParts) => runLayout(parts, model, onView) });
}

// ---------------------------------------------------------------- connect

/** The Connect card: the existing LIVE entry flow (live/ConnectPanel.ts), restyled. C1 opens as a dialog. */
export function ConnectNotice({ model, onView }: { readonly model: WorkspaceModel | null; readonly onView: (view: string) => void }): ComponentChild {
  const view = model?.live.value ?? null;
  const actions = model?.actions.value ?? null;
  const step = view?.entry.step ?? 'idle';
  const isConnected = view !== null && connected(view);
  const panel = h(ConnectPanel, {
    state: view?.entry ?? { step: 'idle' },
    advisoryBlocked: view?.advisoryBlocked ?? null,
    onConnect: () => actions?.connect(),
    onConfirm: (ticked) => actions?.confirm(ticked),
    onCancel: () => actions?.cancel(),
    onDisconnect: () => actions?.disconnect(),
  });
  const heading = isConnected
    ? step === 'live'
      ? 'Connected. Inspect before you operate.'
      : 'Connected'
    : step === 'refused'
      ? 'Not connected'
      : 'Connect your TinyG';
  const copy = isConnected
    ? 'Phase 1 is read-only: positions and settings are read and nothing is written to the board.'
    : 'Run checks sign-in, the safety advisory and a short checklist, then your browser asks which USB port to use.';
  return h(
    'div',
    { class: `scenario-notice connect-notice${isConnected ? ' is-connected' : ''}`, 'data-region': 'connect' },
    h('div', { class: 'notice-text' }, h('strong', null, heading), h('p', null, copy)),
    h('div', { class: 'notice-actions' }, step === 'c1' ? null : panel, isConnected ? h('button', { type: 'button', class: 'small', onClick: () => onView('board') }, 'Open the board') : null),
    step === 'c1'
      ? h(
          'div',
          { class: 'dialog-wrap', role: 'presentation' },
          h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'c1-title' }, h('div', { class: 'dialog-head' }, h('h2', { id: 'c1-title' }, 'Before you connect')), panel),
        )
      : null,
  );
}

// ---------------------------------------------------------------- position

function ageText(view: LiveView): { readonly text: string; readonly lag: string } {
  const m = view.message;
  if (m === null || m.snapshot.base === 'NOT_CONNECTED') return { text: 'Not connected', lag: 'none' };
  const base = m.dro.machineSource.ageMs;
  if (base === null) return { text: 'Waiting for position', lag: 'none' };
  const age = base + Math.max(0, view.now - view.receivedAt);
  const lag = m.snapshot.overlays.includes('STALE') || age >= m.lag.redMs ? 'red' : age >= m.lag.amberMs ? 'amber' : 'fresh';
  return { text: `${lag === 'fresh' ? 'Live' : lag === 'amber' ? 'Lagging' : 'Stale'} · ${(age / 1000).toFixed(2)} s`, lag };
}

export function PositionPanel({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const m = view !== null && connected(view) ? view.message : null;
  const axes = m === null ? (['x', 'y', 'z'] as const).map((axis) => ({ axis, work: null, machine: null, homed: null })) : m.dro.axes.filter((a) => a.work !== null || ['x', 'y', 'z'].includes(a.axis));
  const age = view === null ? { text: 'Not connected', lag: 'none' } : ageText(view);
  const wcs = m?.dro.wcs ?? null;
  const homed = m === null ? null : m.dro.axes.filter((a) => ['x', 'y', 'z'].includes(a.axis));
  const homingText =
    homed === null || homed.every((a) => a.homed === null) ? 'Not read' : homed.every((a) => a.homed === true) ? 'Homed (reported)' : `Not homed: ${homed.filter((a) => a.homed !== true).map((a) => a.axis.toUpperCase()).join(' ')}`;
  const tool = m?.snapshot.live.tool;
  const units = m?.dro.units ?? null;
  return h(
    'section',
    { class: 'insp sec-position', 'data-region': 'position', 'aria-labelledby': 'position-title' },
    h(
      'header',
      null,
      h('h2', { id: 'position-title' }, 'Position'),
      h('span', { class: `source lag-${age.lag}`, 'data-position': 'freshness', title: 'Machine position is read from the controller about twice a second; work position comes from its status reports.' }, age.text),
    ),
    h(
      'div',
      { class: 'dro-grid', role: 'table', 'aria-label': 'Position' },
      h('div', { class: 'dro-head', role: 'row' }, h('span', { role: 'columnheader' }, h('span', { class: 'sr-only' }, 'Axis')), h('span', { role: 'columnheader' }, units === null ? 'Work' : `Work, ${units}`), h('span', { role: 'columnheader' }, 'Machine, mm')),
      axes.map((a) =>
        h('div', { class: 'dro-row', role: 'row', key: a.axis, 'data-position-axis': a.axis }, h('span', { class: 'axis', role: 'rowheader' }, a.axis.toUpperCase()), h('strong', { role: 'cell', 'data-position': 'work' }, coord(a.work)), h('span', { role: 'cell', 'data-position': 'machine' }, coord(a.machine))),
      ),
    ),
    h(
      'dl',
      { class: 'facts' },
      h('div', null, h('dt', null, 'Work offset'), h('dd', { 'data-position': 'wcs' }, wcs?.code ?? (m === null ? UNKNOWN : 'Not read'))),
      h('div', null, h('dt', null, 'Homing'), h('dd', { 'data-position': 'homing' }, m === null ? UNKNOWN : homingText)),
      h('div', null, h('dt', null, 'Active tool'), h('dd', { 'data-position': 'tool' }, typeof tool === 'number' ? `T${tool}, reported` : m === null ? UNKNOWN : 'Not reported')),
    ),
    m === null
      ? h('p', { class: 'fine' }, 'Position appears when a board is connected. Unknown values show a dash, never zero.')
      : h('details', { class: 'more' }, h('summary', null, 'Where these numbers come from'), h(Dro, { message: m, elapsedMs: (view as LiveView).now - (view as LiveView).receivedAt })),
  );
}

// ---------------------------------------------------------------- inspector: motion (Phase 2)

/** The page's own "don't ask again" for C24, for this page load only: never stored (SAFETY §4.5b, H52). */
let spindleConfirmSkipped = false;

/** Tests only: forget the session's "don't ask again" for C24. */
export function resetSpindleConfirm(): void {
  spindleConfirmSkipped = false;
}

/**
 * The hooks a motion section uses. A section renders with real hooks only while a LIVE motion session can act
 * (the model has the motion action); otherwise it renders once, statically, with every control disabled and no
 * handler (the prerendered page, and the shell tests' tree expansion).
 */
interface Hooks {
  state<T>(initial: T): [T, (v: T) => void];
  memo<T>(make: () => T, deps: readonly unknown[]): T;
  effect(run: () => void | (() => void), deps: readonly unknown[]): void;
}
const LIVE_HOOKS: Hooks = {
  state: <T,>(initial: T) => useState<T>(initial) as [T, (v: T) => void],
  memo: (make, deps) => useMemo(make, deps as unknown[]),
  effect: (run, deps) => useEffect(run, deps as unknown[]),
};
const STATIC_HOOKS: Hooks = { state: <T,>(initial: T): [T, (v: T) => void] => [initial, () => undefined], memo: (make) => make(), effect: () => undefined };

function isLive(model: WorkspaceModel | null | undefined): boolean {
  return model?.actions.value?.motion !== undefined;
}

type Send = (command: MotionCommand) => Promise<string | null>;

/** An inline confirmation (never a modal over the stop controls, SAFETY §4.1 UI rules). Cancel has the focus; Enter does not confirm. */
function ConfirmCard(props: {
  readonly text: string;
  readonly confirm: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly safety: string;
  readonly children?: ComponentChild;
}): ComponentChild {
  return h(
    'div',
    { class: 'motion-confirm', role: 'alertdialog', 'aria-label': props.confirm, 'data-safety': props.safety },
    h('p', null, props.text),
    props.children ?? null,
    h(
      'div',
      { class: 'motion-confirm-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'motion-cancel', autoFocus: true, onClick: props.onCancel }, 'Cancel'),
      h('button', { type: 'button', class: 'small primary', 'data-action': 'motion-confirm', onClick: props.onConfirm }, props.confirm),
    ),
  );
}

function motionNote(ui: MotionUi, note: string | null): ComponentChild {
  const text = note ?? ui.reason ?? ui.notice;
  if (text === null) return null;
  return h('p', { class: ui.enabled && note === null ? 'motion-note' : 'unavailable', 'data-jog': 'note', role: 'status' }, text);
}

/** "I've checked the machine" after a reconnect, and Clear alarm with its meaning (C13). */
function MotionRecovery({ ui, send, view, hk }: { readonly ui: MotionUi; readonly send: Send | undefined; readonly view: LiveView | null; readonly hk: Hooks }): ComponentChild {
  const [asking, setAsking] = hk.state<'verify' | 'clear' | null>(null);
  if (send === undefined || (!ui.unknown && !ui.alarm)) return null;
  if (asking === 'clear') {
    const stat = view?.message?.snapshot.live.stat;
    return h(ConfirmCard, {
      text: c13({ meaning: `The controller reports an alarm (state ${stat ?? 'unknown'}) and stopped any motion` }),
      confirm: 'Clear alarm',
      safety: 'C13',
      onCancel: () => setAsking(null),
      onConfirm: () => {
        setAsking(null);
        void send({ op: 'clearAlarm' });
      },
    });
  }
  if (asking === 'verify') {
    return h(ConfirmCard, {
      text: 'The previous session ended while connected. Check that nothing is moving and that the machine is where you expect. Position is not verified by this page.',
      confirm: 'I’ve checked the machine',
      safety: 'W6',
      onCancel: () => setAsking(null),
      onConfirm: () => {
        setAsking(null);
        void send({ op: 'positionVerify' });
      },
    });
  }
  return h(
    'div',
    { class: 'motion-recovery' },
    ui.alarm ? h('button', { type: 'button', class: 'small', 'data-machine-control': 'clear-alarm', onClick: () => setAsking('clear') }, 'Clear alarm…') : null,
    ui.unknown ? h('button', { type: 'button', class: 'small', 'data-machine-control': 'verify', onClick: () => setAsking('verify') }, 'I’ve checked the machine…') : null,
  );
}

const PAD: readonly { readonly label: string; readonly text: string; readonly axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>> | null }[] = [
  { label: 'X−, Y+', text: '↖', axes: { x: -1, y: 1 } },
  { label: 'Y+', text: 'Y+', axes: { y: 1 } },
  { label: 'X+, Y+', text: '↗', axes: { x: 1, y: 1 } },
  { label: 'X−', text: 'X−', axes: { x: -1 } },
  { label: 'Go to X0 Y0', text: '⌖', axes: null },
  { label: 'X+', text: 'X+', axes: { x: 1 } },
  { label: 'X−, Y−', text: '↙', axes: { x: -1, y: -1 } },
  { label: 'Y−', text: 'Y−', axes: { y: -1 } },
  { label: 'X+, Y−', text: '↘', axes: { x: 1, y: -1 } },
];

const realTimers: JogTimers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) };

/**
 * The jog panel (SAFETY §4.5b, H50, H51): the XY pad and Z, step sizes in mm or inches or Hold, the jog speed,
 * and keyboard jog while the panel has focus. Without a LIVE motion session every control is disabled and
 * carries no handler.
 */
function jogBody({ model, onGoToZero }: JogProps, hk: Hooks): ComponentChild {
  const view = model?.live.value ?? null;
  const ui = motionUi(view);
  const send = model?.actions.value?.motion;
  const enabled = ui.enabled && send !== undefined;
  const [units, setUnits] = hk.state<'mm' | 'in'>('mm');
  const [stepIndex, setStepIndex] = hk.state<number | null>(2);
  const [feed, setFeed] = hk.state<number>(JOG_FEED.default);
  const [note, setNote] = hk.state<string | null>(null);
  const controller = hk.memo(
    () =>
      new JogController((c) => {
        void send?.(c).then((reason) => {
          if (c.op === 'jog') setNote(reason);
        });
      }, realTimers),
    [send],
  );
  hk.effect(() => {
    // Any held jog stops when the window loses focus or the page is hidden, or on any pointer-up (H50).
    const release = (): void => controller.release();
    const hidden = (): void => {
      if (document.visibilityState !== 'visible') controller.release();
    };
    addEventListener('blur', release);
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      controller.release();
      removeEventListener('blur', release);
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [controller]);
  const steps = units === 'mm' ? STEPS_MM : STEPS_IN;
  const settings = (): { stepMm: number | null; feed: number } => ({ stepMm: stepIndex === null ? null : (steps[stepIndex] as number) * (units === 'in' ? MM_PER_IN : 1), feed });
  // A held jog keeps its buttons live so the release always arrives (a disabled button gets no pointer-up).
  const live = send !== undefined && (ui.enabled || ui.holdJog);
  const press = (axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>) => (e: PointerEvent) => {
    if (!enabled) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setNote(null);
    controller.press(axes, settings());
  };
  const jogButton = (label: string, text: string, axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>, cls: string): ComponentChild =>
    h(
      'button',
      {
        type: 'button',
        class: cls,
        'aria-label': label,
        key: label,
        'data-machine-control': 'jog',
        ...(live ? { onPointerDown: press(axes), onPointerUp: () => controller.release(), onLostPointerCapture: () => controller.release() } : { disabled: true }),
      },
      text,
    );
  const onKeyDown = (e: KeyboardEvent): void => {
    const axes = jogKey(e.key);
    if (axes === null || !live || !document.hasFocus()) return;
    e.preventDefault();
    if (e.repeat || !enabled) return;
    setNote(null);
    controller.press(axes, settings());
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (jogKey(e.key) !== null) controller.release();
  };
  return h(
    'section',
    { class: 'insp sec-jog', 'aria-labelledby': 'jog-title' },
    h(
      'header',
      null,
      h('h2', { id: 'jog-title' }, 'Jog'),
      h('span', { class: `tag${ui.homed === false ? ' warn' : ''}`, 'data-jog': 'homed' }, ui.homed === null ? 'Motion control' : ui.homed ? 'Homed' : 'Not homed'),
    ),
    ui.flag && ui.connected && ui.homed === false ? h('p', { class: 'motion-warning', 'data-safety': 'W34', role: 'note' }, ...signalText(w34())) : null,
    MotionRecovery({ ui, send, view, hk }),
    h(
      'div',
      {
        class: 'jog',
        'aria-disabled': live ? 'false' : 'true',
        tabindex: live ? 0 : -1,
        'data-jog': 'panel',
        'aria-label': 'Jog pad. Arrow keys jog X and Y, Page Up and Page Down jog Z, while this panel has focus.',
        ...(live ? { onKeyDown, onKeyUp, onFocusOut: () => controller.release() } : {}),
      },
      h(
        'div',
        { class: 'jog-pads' },
        h(
          'div',
          { class: 'jog-pad', role: 'group', 'aria-label': 'X and Y' },
          PAD.map((p, i) =>
            p.axes === null
              ? h('button', { type: 'button', class: 'j', 'aria-label': p.label, key: p.label, 'data-machine-control': 'zero', ...(enabled && onGoToZero !== undefined ? { onClick: () => onGoToZero(['x', 'y']) } : { disabled: true }) }, p.text)
              : jogButton(p.label, p.text, p.axes, `j${i % 2 === 0 ? ' diag' : ''}`),
          ),
        ),
        h('div', { class: 'jog-z', role: 'group', 'aria-label': 'Z' }, jogButton('Z up', 'Z+', { z: 1 }, 'j'), jogButton('Z down', 'Z−', { z: -1 }, 'j')),
      ),
      h(
        'div',
        { class: 'seg full', role: 'group', 'aria-label': 'Step size' },
        steps.map((v, i) =>
          h('button', { type: 'button', key: `${units}${v}`, class: stepIndex === i ? 'selected' : undefined, 'aria-pressed': stepIndex === i ? 'true' : 'false', 'data-machine-control': 'jog', ...(enabled ? { onClick: () => setStepIndex(i) } : { disabled: true }) }, String(v)),
        ),
        h('button', { type: 'button', class: stepIndex === null ? 'selected' : undefined, 'aria-pressed': stepIndex === null ? 'true' : 'false', 'data-machine-control': 'jog', title: 'Jog while the button or key is held', ...(enabled ? { onClick: () => setStepIndex(null) } : { disabled: true }) }, 'Hold'),
      ),
      h(
        'div',
        { class: 'jog-settings' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Step units' }, (['mm', 'in'] as const).map((u) => h('button', { type: 'button', key: u, class: units === u ? 'selected' : undefined, 'aria-pressed': units === u ? 'true' : 'false', 'data-machine-control': 'jog', ...(enabled ? { onClick: () => setUnits(u) } : { disabled: true }) }, u))),
        h(
          'label',
          { class: 'jog-feed' },
          h('span', null, 'Jog speed'),
          h('input', {
            type: 'number',
            min: JOG_FEED.min,
            max: JOG_FEED.max,
            step: 10,
            value: feed,
            ...(enabled ? { onInput: (e: Event) => setFeed(Math.min(JOG_FEED.max, Math.max(JOG_FEED.min, Number((e.currentTarget as HTMLInputElement).value) || JOG_FEED.default))) } : { disabled: true }),
            'aria-label': 'Jog speed, mm per minute',
            'data-machine-control': 'jog',
          }),
          h('small', null, 'mm/min'),
        ),
      ),
    ),
    motionNote(ui, note),
  );
}

type JogProps = { readonly model?: WorkspaceModel | null; readonly onGoToZero?: (axes: readonly MotionAxis[]) => void };

function JogLive(props: JogProps): ComponentChild {
  return jogBody(props, LIVE_HOOKS);
}

export function JogSection(props: JogProps = {}): ComponentChild {
  return isLive(props.model) ? h(JogLive, props) : jogBody(props, STATIC_HOOKS);
}

const AXIS_ROWS: readonly MotionAxis[] = ['x', 'y', 'z'];

/**
 * Set zero and Go to zero, per axis and for all (SAFETY §4.5b, H53, C16, C25). Set zero is G10 L20 P1 (G54, saved
 * on the controller). Go to zero shows its path first; Z rises in machine coordinates before X and Y move.
 */
function zeroBody({ model, ask }: ZeroProps, hk: Hooks): ComponentChild {
  const view = model?.live.value ?? null;
  const ui = motionUi(view);
  const send = model?.actions.value?.motion;
  const settings = settingsOf(view);
  const zNow = machineZ(view);
  const ztm = typeof settings['ztm'] === 'number' ? (settings['ztm'] as number) : null;
  const [safeZ, setSafeZ] = hk.state<number | null>(null);
  const safe = safeZ ?? (ztm !== null && ui.homed === true ? Math.round((ztm - 1) * 1000) / 1000 : (zNow ?? 0));
  const [confirm, setConfirm] = hk.state<{ readonly kind: 'set' | 'go'; readonly axes: readonly MotionAxis[] } | null>(null);
  const [note, setNote] = hk.state<string | null>(null);
  hk.effect(() => {
    if (ask !== null && ask !== undefined && ui.enabled) setConfirm({ kind: 'go', axes: ask.axes });
  }, [ask?.at]);
  const offsets = workOffsets(view);
  const dro = view?.message?.dro.axes ?? [];
  const work = (a: MotionAxis): number | null => dro.find((d) => d.axis === a)?.work ?? null;
  const machine = (a: MotionAxis): number | null => dro.find((d) => d.axis === a)?.machine ?? null;
  const enabled = ui.enabled && send !== undefined;
  const run = (command: MotionCommand): void => {
    setConfirm(null);
    setNote(null);
    void send?.(command).then(setNote);
  };
  const button = (label: string, aria: string, onClick: () => void): ComponentChild =>
    h('button', { type: 'button', class: 'small', 'aria-label': aria, 'data-machine-control': 'zero', ...(enabled ? { onClick } : { disabled: true }) }, label);
  const confirmCard = (): ComponentChild => {
    if (confirm === null || !enabled) return null;
    if (confirm.kind === 'set') {
      const text = confirm.axes
        .map((a) => c16({ wcs: 'G54', axis: a.toUpperCase(), machinePositionMm: machine(a) ?? 0, newOffsetMm: machine(a) ?? 0 }))
        .join(' ');
      return h(ConfirmCard, { text, confirm: 'Set zero', safety: 'C16', onCancel: () => setConfirm(null), onConfirm: () => run({ op: 'setZero', axes: confirm.axes }) });
    }
    const path = goToZeroPath(confirm.axes, safe, zNow);
    return h(ConfirmCard, { text: c25({ axes: axesText(confirm.axes), path }), confirm: 'Go to zero', safety: 'C25', onCancel: () => setConfirm(null), onConfirm: () => run({ op: 'goToZero', axes: confirm.axes, safeZ: safe }) });
  };
  return h(
    'section',
    { class: 'insp sec-zero', 'aria-labelledby': 'zero-title' },
    h('header', null, h('h2', { id: 'zero-title' }, 'Work zero'), h('span', { class: 'tag' }, 'G54 · G10 L20')),
    h(
      'table',
      { class: 'zero-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Axis'), h('th', { scope: 'col' }, 'Work'), h('th', { scope: 'col' }, 'Offset'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))),
      h(
        'tbody',
        null,
        AXIS_ROWS.map((a) =>
          h(
            'tr',
            { key: a, 'data-zero-axis': a },
            h('th', { scope: 'row' }, a.toUpperCase()),
            h('td', { class: 'num' }, coord(work(a))),
            h('td', { class: 'num', 'data-zero-offset': a }, coord(offsets[a])),
            h('td', { class: 'zero-actions' }, button('Set 0', `Set ${a.toUpperCase()} zero here`, () => setConfirm({ kind: 'set', axes: [a] })), button('Go to 0', `Go to ${a.toUpperCase()} zero`, () => setConfirm({ kind: 'go', axes: [a] }))),
          ),
        ),
        h(
          'tr',
          { 'data-zero-axis': 'all' },
          h('th', { scope: 'row' }, 'All'),
          h('td', { colSpan: 2, class: 'fine' }, 'X, Y and Z'),
          h('td', { class: 'zero-actions' }, button('Set 0', 'Set X, Y and Z zero here', () => setConfirm({ kind: 'set', axes: ['x', 'y', 'z'] })), button('Go to 0', 'Go to X, Y and Z zero', () => setConfirm({ kind: 'go', axes: ['x', 'y', 'z'] }))),
        ),
      ),
    ),
    h(
      'label',
      { class: 'jog-feed' },
      h('span', null, 'Safe Z'),
      h('input', {
        type: 'number',
        step: 1,
        value: safe,
        ...(enabled ? { onInput: (e: Event) => setSafeZ(Number((e.currentTarget as HTMLInputElement).value)) } : { disabled: true }),
        'aria-label': 'Safe Z height in machine coordinates, mm',
        'data-machine-control': 'zero',
      }),
      h('small', null, 'mm, machine. Z never goes lower than it is.'),
    ),
    confirmCard(),
    motionNote(ui, note),
  );
}

type ZeroProps = { readonly model?: WorkspaceModel | null; readonly ask?: { readonly axes: readonly MotionAxis[]; readonly at: number } | null };

function ZeroLive(props: ZeroProps): ComponentChild {
  return zeroBody(props, LIVE_HOOKS);
}

export function ZeroSection(props: ZeroProps = {}): ComponentChild {
  return isLive(props.model) ? h(ZeroLive, props) : zeroBody(props, STATIC_HOOKS);
}

/** The J6 output pins with what the board's settings say about each (board definition labels, never generic ones). */
function OutputPins({ settings, dialect }: { readonly settings: Readonly<Record<string, SettingValue>>; readonly dialect: string | null }): ComponentChild {
  const pins = connectorPins('J6').filter((p) => p.role === 'output');
  if (pins.length === 0) return null;
  const setting = (p: PinInfo): string => {
    if (p.signal === 'out.spindleEnable') return plainValue('spep', settings['spep'], dialect) ?? 'polarity not read';
    if (p.signal === 'out.spindleDirection') return plainValue('spdp', settings['spdp'], dialect) ?? 'polarity not read';
    if (p.signal === 'out.spindlePwm') return 'speed signal';
    return 'mist and flood share it';
  };
  return h(
    'ul',
    { class: 'pin-list', 'aria-label': 'Spindle and coolant pins on J6' },
    pins.map((p) =>
      h(
        'li',
        { key: p.ref, 'data-pin-row': p.ref },
        h('span', { class: 'pin-ref' }, p.ref),
        h('span', { class: 'pin-name' }, p.label, h('small', null, p.function)),
        h('span', { class: 'pin-set' }, setting(p)),
      ),
    ),
  );
}

/**
 * Spindle and coolant (SAFETY §4.5b, H52). The readouts are what the board reports (edge-next `spe`, `spc`,
 * `spd`, `sps`, `cof`, `com`), from its status list or the GETs Run asks about once a second, labelled
 * commanded: TinyG measures nothing. Nothing that pauses or stops reads them. In a motion session the controls
 * send M3/M4 with S, M5, M7, M8 and M9; Spindle on asks C24 first unless the user turned that off for this page.
 */
function spindleBody({ model }: SpindleProps, hk: Hooks): ComponentChild {
  const view = model?.live.value ?? null;
  const snapshot = view !== null && connected(view) ? view.message?.snapshot : undefined;
  const r = displayReadouts(snapshot);
  const spindle = spindleText(r);
  const spindleLine = spindle.startsWith('On') ? `Spindle o${spindle.slice(1)}` : spindle;
  const coolant = coolantText(r);
  const settings = settingsOf(view);
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
    if (spindleConfirmSkipped) run({ op: 'spindleOn', direction, rpm });
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
    { class: 'insp sec-spindle', 'aria-labelledby': 'spindle-title' },
    h('header', null, h('h2', { id: 'spindle-title' }, 'Spindle and coolant'), h('span', { class: 'tag' }, 'Commanded')),
    h(
      'div',
      { class: 'spindle-state' },
      h('span', { class: `spindle-mark${spindle.startsWith('On') ? ' on' : ''}`, 'aria-hidden': 'true' }, Icon('spindle', 26)),
      h(
        'div',
        { class: 'spindle-text' },
        h('strong', { 'data-spindle': 'spindle', title: SPINDLE_TITLE }, spindleLine),
        h('small', { 'data-spindle': 'coolant', title: COOLANT_TITLE }, `Coolant: ${coolant === UNKNOWN ? UNKNOWN : coolant === 'Off' ? 'off' : coolant}`),
      ),
    ),
    h(OutputPins, { settings, dialect: dialectOf(view) }),
    h(
      'div',
      { class: 'spindle-controls' },
      h(
        'div',
        { class: 'seg full', role: 'group', 'aria-label': 'Spindle (J6.3 Spindle, J6.4 SpinDir)' },
        h('button', { type: 'button', key: 'off', 'data-machine-control': 'spindle', ...(off ? { onClick: () => run({ op: 'spindleOff' }) } : { disabled: true }) }, 'Off'),
        h('button', { type: 'button', key: 'cw', 'data-machine-control': 'spindle', ...(on ? { onClick: () => start('cw') } : { disabled: true }) }, 'On · CW'),
        h('button', { type: 'button', key: 'ccw', 'data-machine-control': 'spindle', ...(on ? { onClick: () => start('ccw') } : { disabled: true }) }, 'On · CCW'),
      ),
      h(
        'label',
        { class: 'jog-feed' },
        h('span', null, 'Speed'),
        h('input', {
          type: 'number',
          min: 1,
          max: 100000,
          step: 100,
          value: rpm,
          ...(on ? { onInput: (e: Event) => setRpm(Math.max(1, Math.round(Number((e.currentTarget as HTMLInputElement).value) || 1))) } : { disabled: true }),
          'aria-label': 'Spindle speed, rpm (commanded)',
          'data-machine-control': 'spindle',
        }),
        h('small', null, 'rpm, commanded'),
      ),
      asking === null || !on
        ? null
        : h(
            ConfirmCard,
            {
              text: c24({ direction: asking === 'cw' ? 'CW' : 'CCW', rpm }),
              confirm: 'Start spindle',
              safety: 'C24',
              onCancel: () => setAsking(null),
              onConfirm: () => {
                if (skip) spindleConfirmSkipped = true;
                const direction = asking;
                setAsking(null);
                run({ op: 'spindleOn', direction, rpm });
              },
            },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-action': 'skip-spindle-confirm', checked: skip, onChange: (e: Event) => setSkip((e.currentTarget as HTMLInputElement).checked) }), ' Don’t ask again until I reload this page'),
          ),
      h(
        'div',
        { class: 'inline-field' },
        h('span', null, 'J6.6 Coolant'),
        h(
          'span',
          { class: 'toggles' },
          h('button', { type: 'button', class: 'toggle', 'aria-pressed': mist ? 'true' : 'false', 'data-machine-control': 'coolant', ...((mist ? off : on) ? { onClick: () => coolantToggle('mist', mist) } : { disabled: true }) }, 'Mist'),
          h('button', { type: 'button', class: 'toggle', 'aria-pressed': flood ? 'true' : 'false', 'data-machine-control': 'coolant', ...((flood ? off : on) ? { onClick: () => coolantToggle('flood', flood) } : { disabled: true }) }, 'Flood'),
        ),
      ),
    ),
    note !== null
      ? h('p', { class: 'unavailable', role: 'status' }, note)
      : h('p', { class: 'fine', 'data-spindle': 'note' }, ui.enabled || off ? 'Readouts show what the controller reports driving, labelled commanded: a command queued behind a move shows once it runs, and the speed is never measured. Never rely on them for safety.' : (ui.reason ?? 'Readouts are for display only.')),
  );
}

type SpindleProps = { readonly model?: WorkspaceModel | null };

function SpindleLive(props: SpindleProps): ComponentChild {
  return spindleBody(props, LIVE_HOOKS);
}

export function SpindleSection(props: SpindleProps = {}): ComponentChild {
  return isLive(props.model) ? h(SpindleLive, props) : spindleBody(props, STATIC_HOOKS);
}

export function OverridesSection(): ComponentChild {
  const row = (label: string, id: string): ComponentChild =>
    h(
      'div',
      { class: 'ovr', key: id },
      h('div', { class: 'ovr-head' }, h('span', null, label), h('output', null, '100 %')),
      h('div', { class: 'ovr-row' }, h('button', { type: 'button', class: 'small step', disabled: true, 'aria-label': `${label} minus 10 percent`, 'data-machine-control': 'override' }, '−10'), h('input', { type: 'range', min: 10, max: 200, value: 100, disabled: true, 'aria-label': `${label} override`, 'data-machine-control': 'override' }), h('button', { type: 'button', class: 'small step', disabled: true, 'aria-label': `${label} plus 10 percent`, 'data-machine-control': 'override' }, '+10')),
    );
  return h(
    'section',
    { class: 'insp sec-overrides', 'aria-labelledby': 'ovr-title' },
    h('header', null, h('h2', { id: 'ovr-title' }, 'Overrides'), h('span', { class: 'tag mock' }, 'Needs firmware support')),
    row('Feed', 'feed'),
    row('Spindle speed', 'spindle'),
    h('p', { class: 'fine' }, 'TinyG edge-next has no feed or spindle overrides yet. These controls send nothing until the firmware supports them.'),
  );
}

type InspTab = 'jog' | 'zero' | 'spindle' | 'overrides';

/** The Run inspector: position always on top, the rest as tabs so nothing needs a long scroll. */
function RunInspector({ model, onView }: { readonly model: WorkspaceModel | null; readonly onView: (view: string) => void }): ComponentChild {
  const [tab, setTab] = useState<InspTab>('jog');
  const [ask, setAsk] = useState<{ readonly axes: readonly MotionAxis[]; readonly at: number } | null>(null);
  return h(
    'aside',
    { class: 'inspector run-inspector', 'aria-label': 'Machine' },
    h(ConnectNotice, { model, onView }),
    h(PositionPanel, { model }),
    h(
      'div',
      { class: 'insp-tabs' },
      h(TabBar<InspTab>, {
        label: 'Machine controls',
        prefix: 'insp',
        variant: 'underline',
        current: tab,
        onSelect: setTab,
        tabs: [
          { id: 'jog', label: 'Jog' },
          { id: 'zero', label: 'Zero' },
          { id: 'spindle', label: 'Spindle and coolant' },
          { id: 'overrides', label: 'Overrides' },
        ],
      }),
    ),
    h(TabPane, { prefix: 'insp', id: 'spindle', current: tab, class: 'tpane insp-pane' }, h(SpindleSection, { model })),
    h(
      TabPane,
      { prefix: 'insp', id: 'jog', current: tab, class: 'tpane insp-pane' },
      h(JogSection, {
        model,
        onGoToZero: (axes) => {
          setAsk({ axes, at: Date.now() });
          setTab('zero');
        },
      }),
    ),
    h(TabPane, { prefix: 'insp', id: 'zero', current: tab, class: 'tpane insp-pane' }, h(ZeroSection, { model, ask })),
    h(TabPane, { prefix: 'insp', id: 'overrides', current: tab, class: 'tpane insp-pane' }, h(OverridesSection, null)),
  );
}

// ---------------------------------------------------------------- job card

const fmtMm = (n: number): string => String(Math.round(n * 100) / 100);

/** The job's checks as a compact list: icon, short label, value. Details sit behind the expander. */
function jobChecks(result: PreviewResult, facts: ReturnType<typeof fileFacts>): ComponentChild[] {
  const s = result.summary;
  const b = s.bounds;
  const routine = routineChanges(result);
  const counts = shownCounts(result);
  const changes = counts.change;
  const rows: ComponentChild[] = [
    s.blocked
      ? h(CheckRow, { key: 'v', tone: 'danger', label: `Blocked: ${num(Math.max(1, s.counts.block))} ${s.counts.block === 1 ? 'finding stops' : 'findings stop'} this file`, attr: 'verdict' })
      : h(CheckRow, { key: 'v', tone: 'ok', label: 'No blocking findings', attr: 'verdict' }),
  ];
  if (s.counts.warn > 0) rows.push(h(CheckRow, { key: 'w', tone: 'warn', label: `${num(s.counts.warn)} ${s.counts.warn === 1 ? 'warning' : 'warnings'}`, attr: 'warn' }));
  if (changes > 0) rows.push(h(CheckRow, { key: 'c', tone: 'warn', label: `${num(changes)} ${changes === 1 ? 'change' : 'changes'}`, attr: 'change' }));
  if (routine.total > 0) {
    const parts = [routine.comments > 0 ? 'comments removed' : null, routine.renumbered > 0 ? 'line numbers' : null, routine.empty > 0 ? 'empty lines' : null].filter((x): x is string => x !== null);
    rows.push(h('li', { key: 'n', class: 'check-row tone-info', 'data-check': 'routine', title: `Run's routine clean-up, not listed line by line: ${parts.join(', ')}` }, h('span', { class: 'check-icon' }, Icon('lines', 15)), h('span', { class: 'check-label' }, 'Clean-up by Run'), h('strong', { class: 'check-value' }, `${num(routine.total)} lines`)));
  }
  rows.push(h(CheckRow, { key: 'e', tone: 'info', icon: 'ruler', label: 'Extent', value: b === null ? 'nothing drawn' : `${fmtMm(b.max[0] - b.min[0])} × ${fmtMm(b.max[1] - b.min[1])} × ${fmtMm(b.max[2] - b.min[2])} mm`, attr: 'extent' }));
  rows.push(h(CheckRow, { key: 'l', tone: 'info', icon: 'lines', label: 'Lines', value: num(result.sourceLines.length), attr: 'lines' }));
  const tools = facts.tools.length === 0 ? 'none named' : facts.tools.map((t) => `T${t}`).join(', ');
  rows.push(h(CheckRow, { key: 't', tone: 'info', icon: 'tools', label: 'Tools', value: facts.spindle.length === 0 ? tools : `${tools} · ${facts.spindle.map((x) => num(x)).join(', ')} rpm`, attr: 'tools' }));
  return rows;
}

function JobDetails({ result, facts }: { readonly result: PreviewResult; readonly facts: ReturnType<typeof fileFacts> }): ComponentChild {
  const s = result.summary;
  const b = s.bounds;
  return h(
    'div',
    { class: 'job-details' },
    facts.operations.length === 0
      ? null
      : h(
          'section',
          null,
          h('h3', null, 'Operations'),
          h('ol', { class: 'job-ops' }, facts.operations.slice(0, 8).map((op, i) => h('li', { key: String(op.line) }, h('span', { class: `op-swatch op-${i < 3 ? i + 1 : 4}`, 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'name' }, op.name, h('small', null, `from line ${num(op.line)}`))))),
        ),
    h(
      'section',
      null,
      h('h3', null, 'The check'),
      h(
        'dl',
        { class: 'job-facts', 'data-preview': 'summary-detail' },
        h('dt', null, 'Findings'),
        h('dd', null, `${num(s.counts.block)} block, ${num(s.counts.warn)} warn, ${num(s.counts.change)} change, ${num(s.counts.info)} info`),
        h('dt', null, 'Lines'),
        h('dd', null, `${num(result.fileLines)} in the file, ${num(result.sourceLines.length)} to send`),
        h('dt', null, 'Extent'),
        h('dd', null, b === null ? 'nothing drawn' : `X ${fmtMm(b.min[0])} to ${fmtMm(b.max[0])}, Y ${fmtMm(b.min[1])} to ${fmtMm(b.max[1])}, Z ${fmtMm(b.min[2])} to ${fmtMm(b.max[2])} mm`),
        h('dt', null, 'Distance'),
        h('dd', null, `${fmtMm(s.stats.feedMm)} mm cutting, ${fmtMm(s.stats.rapidMm)} mm traverse, ${num(s.stats.arcs)} arcs`),
        h('dt', null, 'Envelope'),
        h('dd', null, 'From the board’s travel settings, once a board is connected.'),
        h('dt', null, 'Start'),
        h('dd', null, 'Assumed machine at 0, 0, 0 in G54 with zero offsets, G21 G90 G17.'),
        h('dt', null, 'Time'),
        h('dd', null, 'Estimated with the job engine, later.'),
      ),
      fileLevel(s.fileLevel),
    ),
  );
}

/** The job: a card at the top of the Run view with the file, its checks, and the Check → Set zero → Start steps. */
function JobCard({ parts }: { readonly parts: PreviewParts }): ComponentChild {
  const { state, actions } = parts;
  const loading = state.status === 'loading';
  const disabled = !state.ready || loading;
  const result = state.status === 'ready' ? state.result : null;
  const facts = useMemo(() => (result === null ? null : fileFacts(result.bytes)), [result]);
  const title = state.fileName === null ? 'No file open' : state.fileName.replace(/\.[^.]+$/, '');
  const checked = result !== null && !result.summary.blocked;
  return h(
    'section',
    { class: `job-card${result === null ? ' empty' : ''}`, 'data-region': 'job', 'aria-labelledby': 'run-title' },
    h(
      'div',
      { class: 'job-id' },
      h('span', { class: 'job-icon', 'aria-hidden': 'true' }, Icon('file', 22)),
      h(
        'div',
        { class: 'job-name' },
        h('h1', { id: 'run-title' }, title),
        h(
          'p',
          null,
          h('span', { class: state.fileName === null ? 'sr-only' : 'mono', 'data-preview': 'file-name' }, state.fileName ?? 'none'),
          state.fileName === null ? (loading ? 'Checking the file…' : 'Open a G-code file or a sample to check it.') : result === null ? (loading ? ' · checking…' : '') : ` · ${num(result.fileLines)} lines`,
        ),
      ),
    ),
    result === null || facts === null ? h('div', { class: 'job-checks-empty' }) : h('ul', { class: 'job-checks', 'data-preview': 'summary', 'aria-label': 'The file check' }, jobChecks(result, facts)),
    h(
      'div',
      { class: 'job-actions' },
      h('ol', { class: 'flow', 'aria-label': 'Before you start' }, h('li', { class: checked ? 'done' : undefined }, h('span', null, checked ? '✓' : '1'), 'Check'), h('li', null, h('span', null, '2'), 'Set zero'), h('li', null, h('span', null, '3'), 'Start')),
      h('button', { type: 'button', class: 'primary', disabled: true, 'data-action': 'start-job', 'data-machine-control': 'start', 'aria-describedby': 'start-later', title: 'Running jobs arrives in a later phase' }, 'Start job'),
      h(
        'label',
        { class: `file-button${disabled ? ' is-disabled' : ''}` },
        h('input', {
          type: 'file',
          accept: '.nc,.gcode,.ngc,.tap,.txt,.cnc,text/plain',
          disabled,
          'data-preview': 'file',
          ...on('onChange', actions.onFile, (f) => (e: Event) => {
            const file = (e.currentTarget as HTMLInputElement).files?.[0];
            if (file !== undefined) f(file);
          }),
        }),
        Icon('upload', 15),
        result === null ? 'Open a file' : 'Open another',
      ),
    ),
    result === null || facts === null
      ? h('p', { class: 'sr-only', id: 'start-later' }, 'Running jobs arrives in a later phase.')
      : h(
          'details',
          { class: 'job-more' },
          h('summary', null, 'Details'),
          h('div', { class: 'job-pop' }, h(JobDetails, { result, facts }), h('p', { class: 'fine', id: 'start-later' }, 'Running jobs arrives in a later phase. Today you can check the file, the setup and the tools.')),
        ),
  );
}

/** Traverses (G0) on or off: a toolbar toggle, remembered in this browser. */
function TraverseToggle({ parts }: { readonly parts: PreviewParts }): ComponentChild {
  const { state, actions } = parts;
  const onRapids = actions.onRapids;
  useEffect(() => {
    const stored = readStored('preview-traverses', (v: unknown): v is boolean => typeof v === 'boolean');
    if (stored !== null && stored !== state.showRapids) onRapids?.(stored);
    // Once, when the actions arrive.
  }, [onRapids === undefined]);
  return h(
    'button',
    {
      type: 'button',
      class: 'tool-toggle',
      'aria-pressed': state.showRapids ? 'true' : 'false',
      disabled: !state.ready,
      'data-preview': 'rapids',
      title: state.showRapids ? 'Hide traverses (G0 moves)' : 'Show traverses (G0 moves)',
      ...on('onClick', onRapids, (f) => () => {
        const next = !state.showRapids;
        writeStored('preview-traverses', next);
        f(next);
      }),
    },
    h('span', { class: 'toggle-dash', 'aria-hidden': 'true' }),
    'Traverses',
  );
}

// ---------------------------------------------------------------- dock

function hexText(hex: string): string {
  let s = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = Number.parseInt(hex.slice(i, i + 2), 16);
    s += c === 10 ? '' : c === 13 ? '' : c < 32 || c === 127 ? `\\x${hex.slice(i, i + 2)}` : String.fromCharCode(c);
  }
  return s;
}

interface ConsoleLine {
  readonly t: number;
  readonly dir: string;
  readonly text: string;
}

/** The Console tab: the worker's wire transcript of this link, read-only, refreshed while the tab is open. */
function ConsolePane({ model, active }: { readonly model: WorkspaceModel | null; readonly active: boolean }): ComponentChild {
  const view = model?.live.value ?? null;
  const epoch = view?.message?.snapshot.epoch ?? 0;
  const [lines, setLines] = useState<readonly ConsoleLine[] | null>(null);
  useEffect(() => {
    if (!active || model === null || epoch === 0) return;
    let stop = false;
    const pull = async (): Promise<void> => {
      const jsonl = await model.actions.value?.transcriptText();
      if (stop || jsonl === null || jsonl === undefined) return;
      const rows = jsonl.trim() === '' ? [] : jsonl.trim().split('\n');
      const parsed: ConsoleLine[] = [];
      for (const row of rows.slice(-400)) {
        try {
          const e = JSON.parse(row) as { t?: unknown; dir?: unknown; hex?: unknown };
          if (typeof e.t === 'number' && typeof e.dir === 'string' && typeof e.hex === 'string') parsed.push({ t: e.t, dir: e.dir, text: hexText(e.hex) });
        } catch {
          // A damaged row is skipped.
        }
      }
      setLines(parsed);
    };
    void pull();
    const timer = setInterval(() => void pull(), 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [active, model, epoch]);
  const t0 = lines?.[0]?.t ?? 0;
  return h(
    'div',
    { class: 'console-pane' },
    epoch === 0 || lines === null
      ? h('p', { class: 'live-empty' }, h('strong', null, 'The console shows the conversation with the board.'), 'Every line Run sends and every answer, once a board is connected in this tab. It only reads.')
      : h('ol', { class: 'console', 'data-console': 'lines', 'aria-label': 'Wire transcript' }, lines.map((l, i) => h('li', { key: String(i), class: l.dir === 'tx' ? 'tx' : 'rx' }, h('time', null, `${((l.t - t0) / 1000).toFixed(2)}`), h('span', { class: 'dir' }, l.dir === 'tx' ? '→' : '←'), h('span', null, l.text)))),
    view === null || view.message === null || view.message.snapshot.epoch === 0 ? null : h(TranscriptSave, { status: view.transcript, onSave: () => model?.actions.value?.saveTranscript() }),
  );
}

const STAT_TEXT: Readonly<Record<string, string>> = {
  initializing: 'Starting up',
  idle: 'Idle',
  programStop: 'Program stopped',
  end: 'Program ended',
  running: 'Running',
  held: 'Held',
  probing: 'Probing',
  homing: 'Homing',
  jogging: 'Jogging',
  softAlarm: 'Soft alarm',
  alarm: 'Alarm',
  shutdown: 'Shutdown',
  panic: 'Panic',
  interlock: 'Interlock',
  unknown: 'Unknown',
};

/** The Live job tab: what the status reports say now, and the feed of the last 60 s. Honest when nothing runs. */
function LivePane({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  if (view === null || !connected(view) || view.message === null) {
    return h('div', { class: 'live-empty', 'data-live': 'empty' }, h('strong', null, 'Live job data appears here while a board is connected.'), h('p', null, 'The machine state, the current line, actual against programmed feed and the planner buffers, all from the controller’s status reports. Running jobs arrives in a later phase.'));
  }
  const s = view.message.snapshot;
  const live = s.live;
  const dialect = DIALECTS.find((d) => d.id === s.classification?.dialectId);
  const blocks = dialect?.limits.plannerBlocks ?? null;
  const samples = view.samples;
  const maxFeed = Math.max(1, ...samples.map((x) => Math.max(x.feed ?? 0, x.vel ?? 0)));
  const tEnd = view.now;
  const pts = samples.filter((x) => x.vel !== null).map((x) => `${(300 - ((tEnd - x.t) / 60_000) * 300).toFixed(1)},${(68 - ((x.vel as number) / maxFeed) * 64).toFixed(1)}`);
  const feedPts = samples.filter((x) => x.feed !== null).map((x) => `${(300 - ((tEnd - x.t) / 60_000) * 300).toFixed(1)},${(68 - ((x.feed as number) / maxFeed) * 64).toFixed(1)}`);
  const qr = typeof live.qr === 'number' ? live.qr : null;
  return h(
    'div',
    { class: 'live-grid', 'data-live': 'connected' },
    h(
      'div',
      { class: 'live-progress' },
      h('span', { class: 'live-big', 'data-live': 'stat' }, live.machineClass === undefined ? UNKNOWN : (STAT_TEXT[live.machineClass] ?? live.machineClass)),
      h('span', { class: 'live-sub', 'data-live': 'line' }, typeof live.line === 'number' ? `Line ${num(live.line)} reported` : 'No line reported'),
      h('p', { class: 'fine' }, 'No job is running from this page. Progress, elapsed and remaining time appear with jobs in a later phase.'),
    ),
    h(
      'div',
      { class: 'live-feed' },
      h('div', { class: 'live-head' }, h('span', null, 'Feed: actual and programmed'), h('strong', { 'data-live': 'feed' }, `${live.vel === undefined ? UNKNOWN : num(live.vel)} / ${live.feed === undefined ? UNKNOWN : num(live.feed)}`)),
      h(
        'svg',
        { class: 'feed-chart', viewBox: '0 0 300 70', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Actual velocity over the last 60 seconds against programmed feed' },
        feedPts.length > 1 ? h('polyline', { class: 'prog', points: feedPts.join(' ') }) : null,
        pts.length > 1 ? h('polyline', { class: 'act', points: pts.join(' ') }) : null,
      ),
      h('div', { class: 'live-head' }, h('span', null, 'Planner buffers free'), h('strong', { 'data-live': 'qr' }, qr === null ? UNKNOWN : blocks === null ? String(qr) : `${qr} of ${blocks}`)),
      blocks === null || qr === null ? null : h('div', { class: 'qr-meter', 'aria-hidden': 'true' }, Array.from({ length: blocks }, (_, i) => h('i', { key: String(i), class: i < blocks - qr ? 'used' : undefined }))),
    ),
    h(
      'ol',
      { class: 'live-stream', 'aria-live': 'polite' },
      h('li', null, h('time', null, 'now'), h('span', null, s.overlays.includes('READ_ONLY') ? 'Read only: Run watches the status reports and writes nothing.' : 'Watching the status reports.')),
      typeof live.qr === 'number' && blocks !== null && live.qr === blocks ? h('li', null, h('time', null, 'now'), h('span', null, 'The planner queue is empty.')) : null,
    ),
  );
}

function Dock({ parts, model }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null }): ComponentChild {
  const [tab, setTab] = useState<'gcode' | 'console' | 'live'>('gcode');
  const result = parts.state.status === 'ready' ? parts.state.result : null;
  const live = model?.live.value ?? null;
  const tabs: readonly ['gcode' | 'console' | 'live', string][] = [
    ['gcode', 'G-code'],
    ['console', 'Console'],
    ['live', 'Live job'],
  ];
  return h(
    'div',
    { class: 'dock' },
    h(
      'div',
      { class: 'dock-tabs', role: 'tablist', 'aria-label': 'File and machine' },
      tabs.map(([id, label]) =>
        h(
          'button',
          { type: 'button', role: 'tab', id: `dock-tab-${id}`, 'aria-selected': tab === id ? 'true' : 'false', 'aria-controls': `dock-pane-${id}`, 'data-tab': id, key: id, onClick: () => setTab(id) },
          label,
          id === 'live' ? h('span', { class: `live-dot${live !== null && connected(live) ? ' on' : ''}`, 'aria-hidden': 'true' }) : null,
        ),
      ),
      h('span', { class: 'dock-summary' }, result === null ? 'No file open' : `${num(result.fileLines)} lines · ${num(result.sourceLines.length)} to send`),
    ),
    h(
      'div',
      { tabindex: 0, class: 'dock-panel' },
      h('div', { tabindex: 0, class: 'dock-pane', role: 'tabpanel', id: 'dock-pane-gcode', 'aria-labelledby': 'dock-tab-gcode', hidden: tab !== 'gcode' }, parts.slots.list ?? h('p', { class: 'live-empty' }, 'Open a file to see its lines here, each with its safety verdict.')),
      h('div', { tabindex: 0, class: 'dock-pane', role: 'tabpanel', id: 'dock-pane-console', 'aria-labelledby': 'dock-tab-console', hidden: tab !== 'console' }, h(ConsolePane, { model, active: tab === 'console' })),
      h('div', { tabindex: 0, class: 'dock-pane live', role: 'tabpanel', id: 'dock-pane-live', 'aria-labelledby': 'dock-tab-live', hidden: tab !== 'live' }, h(LivePane, { model })),
    ),
  );
}

// ---------------------------------------------------------------- layout

function runLayout(parts: PreviewParts, model: WorkspaceModel | null, onView: (view: string) => void): ComponentChild {
  const { state, actions, slots, live } = parts;
  const loading = state.status === 'loading';
  const disabled = !state.ready || loading;
  const result = state.status === 'ready' ? state.result : null;
  const sent = result?.sourceLines.length ?? 0;
  const scrubLine = state.scrub > 0 && result !== null ? (result.sourceLines[state.scrub - 1] ?? 0) : 0;
  return h(
    'div',
    { class: 'run-view', 'data-region': 'preview' },
    h(JobCard, { parts }),
    h(
      'div',
      { class: 'workspace-grid run-grid' },
      h(
        'div',
        { class: 'canvas-column' },
        h(
          'div',
          { class: 'viewer', ...(result === null ? {} : { 'data-lite': result.lite ? 'true' : 'false' }) },
          result !== null && !result.lite ? h('div', { class: 'preview-drawing', 'data-preview': 'drawing', 'data-drawing': state.drawing }, slots.drawing ?? null) : null,
          h(
            'div',
            { class: 'viewer-top' },
            h(
              'div',
              { class: 'seg viewer-options', role: 'group', 'aria-label': 'Preview options' },
              h(
                'span',
                { class: 'select-wrap compact' },
                h(
                  'select',
                  { 'aria-label': 'Dialect', value: state.dialect, disabled, ...on('onChange', actions.onDialect, (f) => (e: Event) => { f((e.currentTarget as HTMLSelectElement).value as DialectId); }) },
                  PREVIEW_DIALECTS.map((d) => h('option', { value: d, key: d }, DIALECT_LABEL[d] ?? d)),
                ),
              ),
              h(
                'span',
                { class: 'select-wrap compact' },
                h(
                  'select',
                  { 'aria-label': 'Preview mode', value: state.mode, disabled, 'data-preview': 'mode', ...on('onChange', actions.onMode, (f) => (e: Event) => { f((e.currentTarget as HTMLSelectElement).value as PreviewMode); }) },
                  (['auto', 'lite', 'full'] as const).map((m) => h('option', { value: m, key: m }, MODE_LABEL[m])),
                ),
              ),
            ),
            h(
              'div',
              { class: 'viewer-tools', role: 'group', 'aria-label': 'View' },
              h(TraverseToggle, { parts }),
              result !== null && !result.lite && state.drawing === 'webgl' ? h('button', { type: 'button', class: 'tool-toggle', 'data-preview': 'fit', ...on('onClick', actions.onFit, (f) => () => { f(); }) }, 'Fit') : null,
            ),
          ),
          result === null && !loading
            ? h(
                'div',
                { class: 'empty-prompt' },
                h('h2', null, state.status === 'error' ? 'The file could not be checked' : 'Open a file to check and preview it'),
                state.status === 'error'
                  ? h('p', { class: 'preview-error', role: 'alert', 'data-preview': 'error' }, state.error ?? 'The preview failed.')
                  : h('p', null, 'Every line is checked by the safety sanitiser and drawn in 3D. The file stays in this browser.'),
                h('div', { class: 'sample-row' }, SAMPLES.map((s) => h('button', { type: 'button', class: 'small', key: s.id, disabled, 'data-sample': s.id, ...on('onClick', actions.onFile, (f) => () => { f(sampleFile(s)); }) }, `Open the ${s.title.toLowerCase()} sample`))),
              )
            : null,
          loading
            ? h(
                'div',
                { class: 'empty-prompt preview-progress', role: 'status', 'data-preview': 'progress' },
                h('h2', null, progressText(state.progress)),
                h('button', { type: 'button', class: 'small', 'data-preview': 'cancel', ...on('onClick', actions.onCancel, (f) => () => { f(); }) }, 'Cancel'),
              )
            : null,
          result !== null && result.lite
            ? h(
                'p',
                { class: 'empty-prompt preview-lite', 'data-preview': 'lite' },
                result.liteBySize
                  ? `Lite mode: this file has more than ${LITE_THRESHOLD_LINES.toLocaleString('en-US')} lines, so it is not drawn. Choose Full to draw it anyway.`
                  : 'Lite mode: the list and summary only, no drawing.',
              )
            : null,
          live === null ? null : h('p', { class: `viewer-key pv-marker-readout lag-${live.lag}`, 'data-preview': 'marker-readout', role: 'status' }, markerText(live)),
          h('p', { class: 'viewer-notice', role: 'note', 'data-safety': 'W13' }, w13()),
        ),
        h(
          'div',
          { class: 'timeline', 'aria-label': 'Line scrubber' },
          h(
            'div',
            { class: 'track-wrap' },
            h('label', { class: 'sr-only', for: 'preview-scrub' }, 'Highlight lines up to'),
            h('input', {
              id: 'preview-scrub',
              type: 'range',
              min: 0,
              max: sent,
              step: 1,
              value: state.scrub,
              disabled: result === null,
              'data-preview': 'scrubber',
              'aria-valuetext': state.scrub === 0 ? 'no lines highlighted' : `highlighting up to file line ${String(scrubLine)}`,
              ...on('onInput', actions.onScrub, (f) => (e: Event) => { f(Number((e.currentTarget as HTMLInputElement).value)); }),
            }),
          ),
          h('output', { class: 'time', for: 'preview-scrub', 'data-preview': 'scrub-line' }, state.scrub === 0 ? 'none' : `file line ${String(scrubLine)}`),
        ),
        h(Dock, { parts, model }),
      ),
      h(RunInspector, { model, onView }),
    ),
  );
}
