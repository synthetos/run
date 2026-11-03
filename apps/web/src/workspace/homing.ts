/**
 * Homing, set machine position, and the ways out of "state unknown" (owner 2026-11-02; SAFETY §3 and §4.5b as
 * amended, H65-H67, C4, C26).
 *
 * - `HomeSection` (the Run inspector's Home tab): Home all and Home per axis with G28.2, only for the axes whose
 *   switch and homing settings are configured; C4 first, naming the axes and that the machine moves to its
 *   switches. When homing is not configured it says why per axis and offers "Set machine position here (G28.3)"
 *   behind C26, for machines without switches.
 * - `UnknownExits` (the banner above every view): "Connected · state unknown" with its primary actions, "I've
 *   checked the machine" (with a short explanation) and "Home machine" (or, without homing, set the position
 *   here). UNKNOWN never traps the user.
 *
 * The session decides every request again; this only shows what will be allowed. Confirmations are inline, never a
 * modal over the stop controls (SAFETY §4.1 UI rules); Cancel has the focus.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { c4, c26 } from '@synthetos/safety';
import type { MotionAxis, MotionCommand } from '../machine-worker/rpc.ts';
import { settingsOf } from './boardFacts.ts';
import { connected, type LiveView, type WorkspaceModel } from './model.ts';
import { HOME_AXES, axesText, homingView, type HomingView } from './motion.ts';
import { ConfirmCard } from './ui.ts';

type Send = (command: MotionCommand) => Promise<string | null>;

interface Hooks {
  state<T>(initial: T): [T, (v: T) => void];
}
const LIVE: Hooks = { state: <T,>(initial: T) => useState<T>(initial) as [T, (v: T) => void] };
const STATIC: Hooks = { state: <T,>(initial: T): [T, (v: T) => void] => [initial, () => undefined] };

function isLive(model: WorkspaceModel | null | undefined): boolean {
  return model?.actions.value?.motion !== undefined;
}

type Asking = { readonly kind: 'home' | 'position'; readonly axes: readonly MotionAxis[] } | { readonly kind: 'verify' } | null;

/** The C4 text for the axes asked (the search distance from the controller's settings). */
function homeText(hv: HomingView, axes: readonly MotionAxis[]): string {
  const searches = axes.map((a) => hv.axes[a].searchMm).filter((v): v is number => v !== null);
  return c4({ axes: axesText(axes.map((a) => a)), searchMm: searches.length === 0 ? 0 : Math.max(...searches) });
}

/** The confirmation in progress, or null. */
function confirmFor(asking: Asking, hv: HomingView, run: (c: MotionCommand) => void, cancel: () => void): ComponentChild {
  if (asking === null) return null;
  if (asking.kind === 'verify') {
    return h(ConfirmCard, {
      text: 'Check that nothing is moving and that the machine is where you expect it. Run then trusts the position the board reports; it does not verify it. Home the machine before relying on soft limits.',
      confirm: 'I’ve checked the machine',
      safety: 'W6',
      onCancel: cancel,
      onConfirm: () => run({ op: 'positionVerify' }),
    });
  }
  if (asking.kind === 'home') return h(ConfirmCard, { text: homeText(hv, asking.axes), confirm: 'Home', safety: 'C4', onCancel: cancel, onConfirm: () => run({ op: 'home', axes: asking.axes }) });
  return h(ConfirmCard, { text: c26({ axes: axesText(asking.axes) }), confirm: 'Set machine position', safety: 'C26', onCancel: cancel, onConfirm: () => run({ op: 'setPosition', axes: asking.axes }) });
}

const POSITION_AXES: readonly MotionAxis[] = ['x', 'y', 'z'];

function homeBody({ model }: HomeProps, hk: Hooks): ComponentChild {
  const view = model?.live.value ?? null;
  const send: Send | undefined = model?.actions.value?.motion;
  const hv = homingView(view, settingsOf(view));
  const [asking, setAsking] = hk.state<Asking>(null);
  const [note, setNote] = hk.state<string | null>(null);
  const enabled = hv.enabled && send !== undefined;
  const run = (command: MotionCommand): void => {
    setAsking(null);
    setNote(null);
    void send?.(command).then(setNote);
  };
  const homed = view?.message?.dro.axes ?? [];
  const homedText = (a: MotionAxis): string => {
    const v = homed.find((d) => d.axis === a)?.homed ?? null;
    return v === null ? 'not read' : v ? 'homed' : 'not homed';
  };
  const button = (label: string, aria: string, onClick: () => void, ok: boolean, cls = 'small'): ComponentChild =>
    h('button', { type: 'button', class: cls, 'aria-label': aria, 'data-machine-control': 'home', ...(enabled && ok ? { onClick } : { disabled: true }) }, label);
  const none = hv.read && hv.configured.length === 0;
  return h(
    'section',
    { class: 'insp sec-home', 'aria-labelledby': 'home-title' },
    h('header', null, h('h2', { id: 'home-title' }, 'Home'), h('span', { class: 'tag' }, 'G28.2')),
    h('p', { class: 'fine' }, 'Homing moves each axis toward its homing switch until it triggers, then sets machine position from it. Keep a hand on the E-stop.'),
    h(
      'table',
      { class: 'zero-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Axis'), h('th', { scope: 'col' }, 'Homing'), h('th', { scope: 'col' }, 'Now'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))),
      h(
        'tbody',
        null,
        HOME_AXES.filter((a) => a !== 'a' || hv.axes.a.configured).map((a) =>
          h(
            'tr',
            { key: a, 'data-home-axis': a },
            h('th', { scope: 'row' }, a.toUpperCase()),
            h('td', { class: 'fine', 'data-home-config': a }, hv.axes[a].configured ? `to the ${hv.axes[a].end === 'min' ? 'minimum' : 'maximum'} switch` : (hv.axes[a].reason ?? '')),
            h('td', { 'data-home-state': a }, homedText(a)),
            h('td', { class: 'zero-actions' }, button('Home', `Home ${a.toUpperCase()}`, () => setAsking({ kind: 'home', axes: [a] }), hv.axes[a].configured)),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'motion-recovery' },
      button(hv.configured.length > 0 ? `Home all (${axesText(hv.configured)})` : 'Home all', 'Home all configured axes', () => setAsking({ kind: 'home', axes: hv.configured }), hv.configured.length > 0, 'small primary'),
    ),
    none
      ? h(
          'div',
          { class: 'motion-note', 'data-home': 'not-configured' },
          h('p', null, 'Homing is not configured on this board: no axis has a homing switch with a search speed. Configure the switches in the Board view, or, on a machine without switches, set the machine position here.'),
          h('button', { type: 'button', class: 'small', 'data-machine-control': 'home', ...(enabled ? { onClick: () => setAsking({ kind: 'position', axes: POSITION_AXES }) } : { disabled: true }) }, 'Set machine position here (G28.3)…'),
        )
      : null,
    enabled ? confirmFor(asking, hv, run, () => setAsking(null)) : null,
    h('p', { class: hv.enabled && note === null ? 'motion-note' : 'unavailable', role: 'status', 'data-home': 'note' }, note ?? hv.reason ?? view?.message?.snapshot.notices.change?.text ?? (hv.read ? null : 'The homing settings are read when a board connects.')),
  );
}

type HomeProps = { readonly model?: WorkspaceModel | null };

function HomeLive(props: HomeProps): ComponentChild {
  return homeBody(props, LIVE);
}

export function HomeSection(props: HomeProps = {}): ComponentChild {
  return isLive(props.model) ? h(HomeLive, props) : homeBody(props, STATIC);
}

/** True when the UNKNOWN banner applies: connected, classified, UNKNOWN the highest overlay, nothing moving. */
export function unknownApplies(view: LiveView | null): boolean {
  const s = view !== null && connected(view) ? (view.message?.snapshot ?? null) : null;
  return s !== null && s.primaryOverlay === 'UNKNOWN' && s.base === 'CONNECTED_UNKNOWN' && s.classification !== null;
}

/**
 * The UNKNOWN banner with its primary actions (SAFETY §3 as amended). "I've checked the machine" is always offered
 * (it moves nothing); "Home machine" when homing is configured and motion is on, otherwise "Set machine position
 * here (G28.3)" where motion is on.
 */
export function UnknownExits({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const [asking, setAsking] = useState<Asking>(null);
  const [note, setNote] = useState<string | null>(null);
  const view = model?.live.value ?? null;
  if (!unknownApplies(view)) return null;
  const send = model?.actions.value?.motion;
  const hv = homingView(view, settingsOf(view));
  const run = (command: MotionCommand): void => {
    setAsking(null);
    setNote(null);
    void send?.(command).then(setNote);
  };
  const canHome = hv.enabled && hv.configured.length > 0;
  const canPosition = hv.enabled && hv.read && hv.configured.length === 0;
  return h(
    'div',
    { class: 'overlay-banner overlay-banner-warn unknown-exits', 'data-region': 'unknown-exits', role: 'alert' },
    h('p', null, h('strong', null, 'Connected · state unknown. '), 'The previous session ended while connected, so the machine may have moved. Check the machine, then choose one:'),
    h(
      'div',
      { class: 'notice-actions' },
      h('button', { type: 'button', class: 'small primary', 'data-action': 'unknown-verify', onClick: () => setAsking({ kind: 'verify' }) }, 'I’ve checked the machine'),
      canHome ? h('button', { type: 'button', class: 'small primary', 'data-action': 'unknown-home', onClick: () => setAsking({ kind: 'home', axes: hv.configured }) }, 'Home machine') : null,
      canPosition ? h('button', { type: 'button', class: 'small', 'data-action': 'unknown-position', onClick: () => setAsking({ kind: 'position', axes: POSITION_AXES }) }, 'Set machine position here (G28.3)') : null,
    ),
    h(
      'p',
      { class: 'fine' },
      canHome
        ? `Home machine moves ${axesText(hv.configured)} to their switches and sets the position from them.`
        : canPosition
          ? 'Homing is not configured on this board. On a machine without switches, set the position here instead.'
          : hv.reason !== null && hv.reason !== 'Connect a machine to home it.'
            ? `Homing is not available: ${hv.reason}`
            : 'Homing is offered once the board’s homing settings have been read.',
    ),
    send === undefined ? null : confirmFor(asking, hv, run, () => setAsking(null)),
    note === null ? null : h('p', { class: 'unavailable', role: 'status' }, note),
  );
}
