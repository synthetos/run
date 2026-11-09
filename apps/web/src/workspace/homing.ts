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
import { ConfirmCard, IconButton } from './ui.ts';
import type { IconName } from './icons.ts';
import { HomingOffNote } from './homingNote.ts';

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
  return h(ConfirmCard, { text: c26(), confirm: 'Set machine position', safety: 'C26', onCancel: cancel, onConfirm: () => run({ op: 'setPosition', axes: asking.axes }) });
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
    return v === null ? '—' : v ? 'yes' : 'no';
  };
  // Disabled controls carry the reason as their title; a block is said once, in the Position panel's card (controlBlock.ts).
  const button = (label: string, aria: string, onClick: () => void, ok: boolean, cls = 'small', why: string | null = null): ComponentChild =>
    h('button', { type: 'button', class: cls, 'aria-label': aria, 'data-machine-control': 'home', ...(enabled && ok ? { onClick } : { disabled: true, title: (enabled ? why : hv.reason) ?? undefined }) }, label);
  const change = view?.message?.snapshot.notices.change?.text ?? null;
  return h(
    'section',
    { class: 'insp sec-home', 'aria-labelledby': 'home-title' },
    h('header', null, h('h2', { id: 'home-title' }, 'Home'), hv.read ? null : h('span', { class: 'tag', 'data-home': 'unread' }, 'Settings not read yet')),
    h(
      'table',
      { class: 'zero-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Axis'), h('th', { scope: 'col' }, 'Switch'), h('th', { scope: 'col' }, 'Homed'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))),
      h(
        'tbody',
        null,
        HOME_AXES.filter((a) => a !== 'a' || hv.axes.a.configured).map((a) =>
          h(
            'tr',
            { key: a, 'data-home-axis': a },
            h('th', { scope: 'row' }, a.toUpperCase()),
            h('td', { 'data-home-config': a, title: hv.axes[a].configured ? undefined : (hv.axes[a].reason ?? undefined) }, hv.axes[a].configured ? (hv.axes[a].end === 'min' ? 'min' : 'max') : 'none'),
            h('td', { 'data-home-state': a }, homedText(a)),
            h('td', { class: 'zero-actions' }, button('Home', `Home ${a.toUpperCase()}`, () => setAsking({ kind: 'home', axes: [a] }), hv.axes[a].configured, 'small', hv.axes[a].reason)),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'motion-recovery' },
      button('Home all', `Home all configured axes${hv.configured.length > 0 ? ` (${axesText(hv.configured)})` : ''}`, () => setAsking({ kind: 'home', axes: hv.configured }), hv.configured.length > 0, 'small primary', 'No axis has a homing switch and search speed set.'),
      // For a machine without switches, or before its homing settings are read: offered whenever the machine is at rest (OD-13 §4).
      button('Set machine zero here…', 'Set the machine zero here, without homing', () => setAsking({ kind: 'position', axes: POSITION_AXES }), true),
    ),
    enabled && hv.read && hv.configured.length === 0 ? h(HomingOffNote, null) : null,
    enabled ? confirmFor(asking, hv, run, () => setAsking(null)) : null,
    note === null && change === null ? null : h('p', { class: 'motion-note', role: 'status', 'data-home': 'note' }, note ?? change),
  );
}

type HomeProps = { readonly model?: WorkspaceModel | null };

/** Simple (OD-13): Home all and Set machine zero here on one row, with their confirmations in place. */
function homeQuickBody({ model }: HomeProps, hk: Hooks): ComponentChild {
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
  const quick = (icon: IconName, label: string, onClick: () => void, ok: boolean, why: string | null, primary: boolean): ComponentChild =>
    h(IconButton, { icon, label, primary, why: (enabled ? why : hv.reason) ?? null, attrs: { 'data-machine-control': 'home' }, ...(enabled && ok ? { onClick } : { disabled: true }) });
  return h(
    'div',
    { class: 'home-quick', 'data-region': 'home-quick' },
    h(
      'div',
      { class: 'motion-recovery' },
      quick('home', `Home all configured axes${hv.configured.length > 0 ? ` (${axesText(hv.configured)})` : ''}`, () => setAsking({ kind: 'home', axes: hv.configured }), hv.configured.length > 0, 'No axis has a homing switch and search speed set.', true),
      quick('machineZero', 'Set the machine zero here, without homing', () => setAsking({ kind: 'position', axes: POSITION_AXES }), true, null, false),
    ),
    // C17: the reason Home is off, as text with the way to set it up, not only the button's hover tip.
    enabled && hv.read && hv.configured.length === 0 ? h(HomingOffNote, null) : null,
    enabled ? confirmFor(asking, hv, run, () => setAsking(null)) : null,
    note === null ? null : h('p', { class: 'motion-note', role: 'status', 'data-home': 'note' }, note),
  );
}

function HomeQuickLive(props: HomeProps): ComponentChild {
  return homeQuickBody(props, LIVE);
}

export function HomeQuick(props: HomeProps = {}): ComponentChild {
  return isLive(props.model) ? h(HomeQuickLive, props) : homeQuickBody(props, STATIC);
}

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
 * The UNKNOWN card with its ways out (SAFETY §3 as amended; W6 is given here once after connecting, OD-18): a sentence
 * and real buttons (owner, 2026-11-09). "I've checked the machine" is always offered (it moves nothing; one click, the
 * sentence is the confirmation, owner 2026-11-04); "Home the machine…" when homing is configured and motion is on;
 * "Set machine zero here…" (G28.3, C26) where motion is on. A board Run could not identify is the control card's
 * (controlBlock.ts), not this one.
 */
export function UnknownExits({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const [asking, setAsking] = useState<Asking>(null);
  const [note, setNote] = useState<string | null>(null);
  const view = model?.live.value ?? null;
  if (!unknownApplies(view) || view?.message?.snapshot.classification?.dialectId === null) return null;
  const send = model?.actions.value?.motion;
  const hv = homingView(view, settingsOf(view));
  const run = (command: MotionCommand): void => {
    setAsking(null);
    setNote(null);
    void send?.(command).then(setNote);
  };
  const canHome = hv.enabled && hv.configured.length > 0;
  // A machine without switches, or one whose homing settings are not read yet, sets its zero here (OD-13 §4).
  const canPosition = hv.enabled;
  return h(
    'div',
    { class: 'control-block unknown-exits', 'data-region': 'unknown-exits', 'data-block': 'unknown', role: 'alert' },
    h('p', null, h('strong', null, 'Position not verified.'), ' The last session ended while connected, so the machine may have moved. Check it, then confirm.'),
    h(
      'div',
      { class: 'control-block-actions' },
      h('button', { type: 'button', class: 'small primary', 'data-action': 'unknown-verify', onClick: () => run({ op: 'positionVerify' }) }, 'I’ve checked the machine'),
      canHome ? h('button', { type: 'button', class: 'small', 'data-action': 'unknown-home', onClick: () => setAsking({ kind: 'home', axes: hv.configured }) }, 'Home the machine…') : null,
      canPosition ? h('button', { type: 'button', class: 'small', 'data-action': 'unknown-position', onClick: () => setAsking({ kind: 'position', axes: POSITION_AXES }) }, 'Set machine zero here…') : null,
    ),
    send === undefined ? null : confirmFor(asking, hv, run, () => setAsking(null)),
    note === null ? null : h('p', { class: 'unavailable', role: 'status' }, note),
  );
}
