/**
 * After a reconnect (UNKNOWN), one question on connect (owner, 2026-11-09; registered with W6, OD-32): "Has the machine moved since last time?",
 * with its ways out as buttons (SAFETY §3 as amended; W6 is given here once after connecting, OD-18): Home (C4) when
 * homing is configured, It hasn't moved (positionVerify, one click: the question is the confirmation, owner
 * 2026-11-04), and Set position… (G28.3, C26). No banner. Later closes it until the next connect; the Position panel
 * keeps a small button that opens it again. It is drawn inside the one machine-message modal (AppShell's banner
 * stack). A board Run could not identify is the control card's, not this.
 */
import { h, type ComponentChild } from 'preact';
import { w6Question, w6QuestionBody, w6Verify } from '@synthetos/safety';
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { settingsOf } from './boardFacts.ts';
import { confirmFor, unknownApplies, type Asking } from './homing.ts';
import type { WorkspaceModel } from './model.ts';
import { homingView } from './motion.ts';
import type { MotionAxis } from '../machine-worker/rpc.ts';

const POSITION_AXES: readonly MotionAxis[] = ['x', 'y', 'z'];

/** The connection (snapshot epoch) the question was put off for with Later, or null. */
const laterFor = signal<number | null>(null);

/** Opens the question again (the Position panel's button, the Run step's list). */
export function askUnknownAgain(): void {
  laterFor.value = null;
}

export function UnknownModal({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const [asking, setAsking] = useState<Asking>(null);
  const [note, setNote] = useState<string | null>(null);
  const view = model?.live.value ?? null;
  const s = view?.message?.snapshot ?? null;
  if (!unknownApplies(view) || s === null || s.classification?.dialectId === null) return null;
  const send = model?.actions.value?.motion;
  const hv = homingView(view, settingsOf(view));
  const run = (command: Parameters<NonNullable<typeof send>>[0]): void => {
    setAsking(null);
    setNote(null);
    void send?.(command).then(setNote);
  };
  if (asking !== null) return confirmFor(asking, hv, run, () => setAsking(null));
  if (laterFor.value === s.epoch) return null;
  const canHome = hv.enabled && hv.configured.length > 0;
  // Inside the one machine-message modal (AppShell's banner stack), so it never stacks on another dialog.
  return h(
    'div',
    { class: 'unknown-exits unknown-question', 'data-region': 'unknown-exits', role: 'group', 'aria-labelledby': 'unknown-question-title' },
    h('h2', { id: 'unknown-question-title', class: 'choice-title' }, w6Question()),
    h('p', null, `${w6QuestionBody()}${note === null ? '' : ` ${note}`}`),
    h(
      'div',
      { class: 'notice-actions' },
      canHome ? h('button', { type: 'button', class: 'small', 'data-action': 'unknown-home', 'data-machine-control': 'home', onClick: () => setAsking({ kind: 'home', axes: hv.configured }) }, 'Home') : null,
      h('button', { type: 'button', class: 'small primary', 'data-action': 'unknown-verify', 'data-machine-control': 'verify', onClick: () => run({ op: 'positionVerify' }) }, w6Verify()),
      hv.enabled ? h('button', { type: 'button', class: 'small', 'data-action': 'unknown-position', 'data-machine-control': 'home', onClick: () => setAsking({ kind: 'position', axes: POSITION_AXES }) }, 'Set position…') : null,
      h('button', { type: 'button', class: 'small', 'data-action': 'unknown-later', onClick: () => { laterFor.value = s.epoch; } }, 'Later'),
    ),
  );
}

/** The Position panel's small way back to the question, while UNKNOWN holds. */
export function UnknownChip({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  if (!unknownApplies(view) || view?.message?.snapshot.classification?.dialectId === null) return null;
  return h('p', { class: 'unknown-chip', 'data-position': 'unknown' }, h('strong', null, 'Position not verified.'), ' ', h('button', { type: 'button', class: 'small', 'data-action': 'unknown-ask', onClick: askUnknownAgain }, 'Check…'));
}
