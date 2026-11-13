/**
 * The terminal's questions (H91, OD-31), each the one the matching button or the Run step asks:
 * - a typed spindle, zero, offset or home line: the button's own confirmation (C24, C16, C27, C28, C29, C4, C26);
 * - a typed move whose travel the session could not check: the travel question (the Run step's modal, C40/C41 data):
 *   Home, Move anyway, Cancel;
 * - a typed G0 that moves X or Y with Z low: "Z is low. Raise Z first?" with Raise only where the session offers it.
 * Centred below the machine strip like every confirmation (OD-16): Pause and Stop job stay reachable.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { c24, c27, c28, c29 } from '@synthetos/safety';
import type { MotionAxis, MotionCommand } from '../machine-worker/rpc.ts';
import { confirmFor } from '../workspace/homing.ts';
import { settingsOf } from '../workspace/boardFacts.ts';
import { axesText, homingView } from '../workspace/motion.ts';
import type { WorkspaceModel } from '../workspace/model.ts';
import { ChoiceModal, Details } from '../workspace/run/ChoiceModal.ts';
import { skipSpindleConfirm } from '../workspace/spindleConfirm.ts';
import { ConfirmCard } from '../workspace/ui.ts';
import { WorkZeroConfirm } from '../workspace/workZeroConfirm.ts';
import { lowZQuestion, travelQuestion, type TravelFinding, type TypedMoveNotice } from './format.ts';
import type { TerminalCommand } from './translate.ts';

export type ButtonCommand = Extract<TerminalCommand, { readonly kind: 'spindle' | 'coolant' | 'offset' | 'home' }>;

/** A question the terminal is asking, or null. */
export type Ask =
  | { readonly kind: 'button'; readonly command: ButtonCommand }
  | { readonly kind: 'travel'; readonly line: string; readonly finding: TravelFinding; readonly lowZ: 'raise' | 'asTyped' | null }
  | { readonly kind: 'lowZ'; readonly line: string; readonly notice: TypedMoveNotice; readonly travel: string | null };

/** What the user chose. `move`: send the line again with these answers. `send`: the button's command, confirmed. */
export type AskResult =
  | { readonly kind: 'cancel' }
  | { readonly kind: 'send'; readonly command: MotionCommand }
  | { readonly kind: 'move'; readonly line: string; readonly travel: string | null; readonly lowZ: 'raise' | 'asTyped' | null }
  | { readonly kind: 'home'; readonly axis: MotionAxis };

function system(model: WorkspaceModel | null): string {
  const coor = model?.live.value.message?.snapshot.live.coor;
  return coor !== undefined && coor >= 1 && coor <= 6 ? `G${53 + coor}` : 'the active system';
}

function SpindleConfirm({ command, onResult }: { readonly command: Extract<MotionCommand, { op: 'spindleOn' }>; readonly onResult: (r: AskResult) => void }): ComponentChild {
  const [skip, setSkip] = useState(false);
  return h(
    ConfirmCard,
    {
      text: c24({ direction: command.direction === 'cw' ? 'CW' : 'CCW', rpm: command.rpm }),
      confirm: 'Start spindle',
      safety: 'C24',
      onCancel: () => onResult({ kind: 'cancel' }),
      onConfirm: () => {
        if (skip) skipSpindleConfirm();
        onResult({ kind: 'send', command });
      },
    },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: skip, onChange: (e: Event) => setSkip((e.currentTarget as HTMLInputElement).checked) }), ' Don’t ask again until I reload this page'),
  );
}

function ButtonConfirm({ command, model, advanced, onResult }: { readonly command: ButtonCommand; readonly model: WorkspaceModel | null; readonly advanced: boolean; readonly onResult: (r: AskResult) => void }): ComponentChild {
  const c = command.command;
  const cancel = (): void => onResult({ kind: 'cancel' });
  const send = (): void => onResult({ kind: 'send', command: c });
  switch (c.op) {
    case 'spindleOn':
      return h(SpindleConfirm, { command: c, onResult });
    case 'setZero': {
      const mpo = model?.live.value.message?.snapshot.live.mpo ?? {};
      return h(WorkZeroConfirm, { axes: c.axes, system: system(model), machine: (a: MotionAxis) => mpo[a] ?? null, advanced, onCancel: cancel, onConfirm: send });
    }
    case 'tempOffset':
      return h(ConfirmCard, { text: c27({ axes: axesText(c.axes), system: system(model) }), confirm: 'Set temporary offset', safety: 'C27', onCancel: cancel, onConfirm: send });
    case 'clearTempOffset':
      return h(ConfirmCard, { text: c28({ system: system(model) }), confirm: 'Clear temporary offset', safety: 'C28', onCancel: cancel, onConfirm: send });
    case 'selectCoord':
      return h(ConfirmCard, { text: c29({ system: `G${53 + c.system}` }), confirm: `Use G${53 + c.system}`, safety: 'C29', onCancel: cancel, onConfirm: send });
    case 'home':
    case 'setPosition': {
      const view = model?.live.value ?? null;
      return confirmFor({ kind: c.op === 'home' ? 'home' : 'position', axes: c.axes }, homingView(view, settingsOf(view)), (cmd) => onResult({ kind: 'send', command: cmd }), cancel);
    }
    /* c8 ignore next 2 -- the translator asks no confirmation for any other command */
    default:
      return null;
  }
}

function TravelAsk({ ask, onResult }: { readonly ask: Extract<Ask, { kind: 'travel' }>; readonly onResult: (r: AskResult) => void }): ComponentChild {
  const q = travelQuestion(ask.finding);
  const past = ask.finding.past;
  const homeAxis = past !== undefined && ['X', 'Y', 'Z', 'A'].includes(past.axis) ? (past.axis.toLowerCase() as MotionAxis) : null;
  return h(ChoiceModal, { onDismiss: () => onResult({ kind: 'cancel' }),
    title: past === undefined ? 'Travel not checked' : `${past.axis} isn't homed`,
    body: q.text,
    safety: past === undefined ? 'C40' : 'C41',
    region: 'terminal-travel',
    details: h(Details, { texts: [{ text: ask.finding.text.replace(/^line \d+: /, '') }] }),
    choices: [
      ...(homeAxis === null ? [] : [{ id: 'terminal-travel-home', label: `Home ${past?.axis ?? ''}`, machine: 'home', onClick: () => onResult({ kind: 'home', axis: homeAxis }) }]),
      { id: 'terminal-travel-move', label: 'Move anyway', machine: 'typed', onClick: () => onResult({ kind: 'move', line: ask.line, travel: q.finding, lowZ: ask.lowZ }) },
      { id: 'terminal-travel-cancel', label: 'Cancel', onClick: () => onResult({ kind: 'cancel' }) },
    ],
  });
}

function LowZAsk({ ask, onResult }: { readonly ask: Extract<Ask, { kind: 'lowZ' }>; readonly onResult: (r: AskResult) => void }): ComponentChild {
  const q = lowZQuestion(ask.notice);
  /* c8 ignore next -- a lowZ ask is made only from a notice that carries the question */
  if (q === null) return null;
  return h(ChoiceModal, { onDismiss: () => onResult({ kind: 'cancel' }),
    title: 'Z is low',
    // The title already says Z is low: the body asks, or says why Raise is not offered and what Move as typed means.
    body: q.why === null ? 'Raise Z first? Then the move runs.' : `${q.why} Move as typed only if the path is clear.`,
    region: 'terminal-low-z',
    choices: q.choices.map((c) => ({
      id: `terminal-lowz-${c.choice}`,
      label: c.label,
      ...(c.choice === 'raise' ? { primary: true, machine: 'typed' } : c.choice === 'asTyped' ? { machine: 'typed' } : {}),
      onClick: () => onResult(c.choice === 'cancel' ? { kind: 'cancel' } : { kind: 'move', line: ask.line, travel: ask.travel, lowZ: c.choice }),
    })),
  });
}

export function TerminalAsk({ ask, model, advanced, onResult }: { readonly ask: Ask | null; readonly model: WorkspaceModel | null; readonly advanced: boolean; readonly onResult: (r: AskResult) => void }): ComponentChild {
  if (ask === null) return null;
  if (ask.kind === 'button') return h(ButtonConfirm, { command: ask.command, model, advanced, onResult });
  if (ask.kind === 'travel') return h(TravelAsk, { ask, onResult });
  return h(LowZAsk, { ask, onResult });
}
