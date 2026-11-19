/**
 * Step 3 (spec §6.3): the board's build against the newest release Run supports, the offer text from
 * firmware/updateOffer.ts, and one "Update firmware" button (owner 167, 2026-11-19). The button leaves the wizard for
 * the full Board → Firmware → Update page, with the offered release marked; that page has Back to setup. No release
 * list or updater is drawn in the frame: the page keeps its own C6 confirm, backups and progress in view. The step
 * names the board it is talking to and refuses another board than the machine's (spec §6.3 step 2, boards). Nothing
 * here flashes or decides.
 */
import { signal } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import { fbText, offerText } from '../../firmware/updateOffer.ts';
import type { WorkspaceModel } from '../../workspace/model.ts';
import { ConnectNotice } from '../../workspace/views/run/connect.ts';
import { HELD_TEXT, type FirmwareState, type HeldReason } from '../firmwareStep.ts';
import { leaveSetupForFirmware } from '../setupActions.ts';

export const FIRMWARE_TITLE = 'Firmware';
export const FIRMWARE_LEAD = 'Run controls the firmware it was tested against.';
export const CONNECT_FOR_FIRMWARE = 'Connect the machine to check its firmware.';
export const UPDATE_LABEL = 'Update firmware';
export const SHOW_UPDATE_LABEL = 'Show the update';
export const UPDATING_TEXT = 'The update runs on Board → Firmware.';
export const CHECKING_TEXT = 'Checking the firmware against the release list.';
export const LIST_FAILED_TEXT = 'The release list could not load, so the firmware was not checked.';

/** Held reasons the Firmware page itself can resolve or explain; the others need another site or program. */
const PAGE_HELPS: ReadonlySet<HeldReason> = new Set(['unidentified', 'busy', 'read-only', 'other']);

/** True once "Update firmware" was pressed on this visit to the step; the mount resets it. */
export const firmwareUpdating = signal(false);

export interface FirmwareProps {
  readonly model: WorkspaceModel | null;
  readonly state: FirmwareState;
  readonly updating: boolean;
  readonly onUpdate: () => void;
  /** The connected board as a person reads it (status.ts boardLabel), or null. */
  readonly board: string | null;
  /** The connected board is not the machine's (homingStep.ts boardMismatch), or null. */
  readonly mismatch: string | null;
}

/** Opens Board → Firmware → Update, marking the release Run expects (the step's "Run expects" row). */
export function startUpdate(state: FirmwareState): void {
  const expected = state.kind === 'needed' || state.kind === 'available' ? state.facts.release.file : null;
  firmwareUpdating.value = true;
  leaveSetupForFirmware(expected);
}

const line = (text: string, step: string): ComponentChild => h('p', { class: 'wizard-line', 'data-firmware-step': step }, text);
const button = (onClick: () => void, label = UPDATE_LABEL): ComponentChild =>
  h('div', { class: 'wizard-actions' }, h('button', { type: 'button', class: 'primary', 'data-action': 'wizard-update', onClick }, label));

type Behind = Extract<FirmwareState, { kind: 'needed' | 'available' }>;

/** Under the facts: the other-board alert, why it cannot run now (with the page when it can help), or Update firmware. */
function offerAction(p: FirmwareProps, state: Behind): ComponentChild {
  if (p.mismatch !== null) return h('p', { class: 'wizard-line', role: 'alert' }, p.mismatch);
  if (state.held !== null) return h('div', null, HELD_TEXT[state.held] === '' ? null : line(HELD_TEXT[state.held], 'held'), PAGE_HELPS.has(state.held) ? button(p.onUpdate) : null);
  return button(p.onUpdate);
}

function offerBody(p: FirmwareProps, state: Behind): ComponentChild {
  return h(
    'div',
    null,
    h(
      'table',
      { class: 'wizard-facts' },
      h('tbody', null,
        h('tr', null, h('th', { scope: 'row' }, 'On the board'), h('td', null, h('strong', null, `TinyG ${fbText(state.facts.current)}`))),
        h('tr', null, h('th', { scope: 'row' }, 'Run expects'), h('td', null, h('strong', null, `TinyG ${fbText(state.facts.release.fb)}`))),
      ),
    ),
    line(offerText(state.facts), 'text'),
    offerAction(p, state),
  );
}

/** The one-line states: checking, list failed, hardware not listed, current. */
function statusLine(s: Exclude<FirmwareState, Behind | { kind: 'disconnected' | 'updating' }>): ComponentChild {
  switch (s.kind) {
    case 'checking': return line(CHECKING_TEXT, 'checking');
    case 'list-failed': return line(LIST_FAILED_TEXT, 'list-failed');
    case 'unlisted': return line(`No firmware is listed for this hardware (${typeof s.hv === 'number' ? `v${s.hv}` : s.hv}).`, 'unlisted');
    default: return line(`Firmware ${fbText(s.fb)} is current.`, 'current');
  }
}

export function Firmware(p: FirmwareProps): ComponentChild {
  const s = p.state;
  if (s.kind === 'disconnected') return h('div', null, h('p', { class: 'wizard-line' }, CONNECT_FOR_FIRMWARE), h(ConnectNotice, { model: p.model }));
  const board = p.board === null ? null : h('p', { class: 'wizard-line', 'data-wizard': 'board' }, `Connected · ${p.board}`);
  if (s.kind === 'updating') return h('div', null, board, line(UPDATING_TEXT, 'updating'), button(p.onUpdate, SHOW_UPDATE_LABEL));
  if (s.kind === 'needed' || s.kind === 'available') return h('div', null, board, offerBody(p, s));
  return h('div', null, board, statusLine(s));
}
