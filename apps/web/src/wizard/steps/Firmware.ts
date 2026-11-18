/**
 * Step 3 (spec §6.3): the board's build against the newest release Run supports, the offer text from
 * firmware/updateOffer.ts, and "Update firmware" when the offer can run now (otherwise one line on why, and that
 * the update runs from Board → Firmware), which runs the Board tab's update flow in place (R5): the
 * whole FirmwareTab, with the offered release marked, inside the frame. The step names the board it is talking
 * to and refuses another board than the machine's (spec §6.3 step 2, boards). Nothing here flashes or decides.
 */
import { signal } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import { fbText, offerText } from '../../firmware/updateOffer.ts';
import { releaseRequest } from '../../workspace/boardNavigation.ts';
import type { WorkspaceModel } from '../../workspace/model.ts';
import { FirmwareTab } from '../../workspace/views/FirmwareViews.ts';
import { ConnectNotice } from '../../workspace/views/run/connect.ts';
import { HELD_TEXT, type FirmwareState } from '../firmwareStep.ts';

export const FIRMWARE_TITLE = 'Firmware';
export const FIRMWARE_LEAD = 'Run controls the firmware it was tested against.';
export const CONNECT_FOR_FIRMWARE = 'Connect the machine to check its firmware.';
export const UPDATE_LABEL = 'Update firmware';
export const CHECKING_TEXT = 'Checking the firmware against the release list.';
export const LIST_FAILED_TEXT = 'The release list could not load, so the firmware was not checked.';

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

/** Marks the offered release on the Board tab's list and opens the flow in the frame (only when the offer is up). */
export function startUpdate(state: FirmwareState): void {
  if ((state.kind === 'needed' || state.kind === 'available') && state.offer !== null) releaseRequest.value = state.offer.release.file;
  firmwareUpdating.value = true;
}

const embed = (model: WorkspaceModel | null): ComponentChild => h('div', { class: 'wizard-embed' }, h(FirmwareTab, { model }));
const line = (text: string, step: string): ComponentChild => h('p', { class: 'wizard-line', 'data-firmware-step': step }, text);

type Behind = Extract<FirmwareState, { kind: 'needed' | 'available' }>;

/** Under the facts: the other-board alert, the flow in place, why it cannot run now, or Update firmware. */
function offerAction(p: FirmwareProps, state: Behind): ComponentChild {
  if (p.mismatch !== null) return h('p', { class: 'wizard-line', role: 'alert' }, p.mismatch);
  if (p.updating) return embed(p.model);
  if (state.held !== null) return line(HELD_TEXT[state.held], 'held');
  return h('div', { class: 'wizard-actions' }, h('button', { type: 'button', class: 'primary', 'data-action': 'wizard-update', onClick: p.onUpdate }, UPDATE_LABEL));
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
    case 'unlisted': return line(`No firmware is listed for this hardware (v${s.hv}).`, 'unlisted');
    default: return line(`Firmware ${fbText(s.fb)} is current.`, 'current');
  }
}

export function Firmware(p: FirmwareProps): ComponentChild {
  const s = p.state;
  if (s.kind === 'disconnected') return h('div', null, h('p', { class: 'wizard-line' }, CONNECT_FOR_FIRMWARE), h(ConnectNotice, { model: p.model }));
  const board = p.board === null ? null : h('p', { class: 'wizard-line', 'data-wizard': 'board' }, `Connected · ${p.board}`);
  if (s.kind === 'updating') return h('div', null, board, embed(p.model));
  if (s.kind === 'needed' || s.kind === 'available') return h('div', null, board, offerBody(p, s));
  return h('div', null, board, statusLine(s));
}
