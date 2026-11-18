/**
 * Step 3 (spec §6.3): the board's build against the newest release Run supports, the offer text from
 * firmware/updateOffer.ts, and "Update firmware", which runs the Board tab's update flow in place (R5): the
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
import type { FirmwareState } from '../firmwareStep.ts';

export const FIRMWARE_TITLE = 'Firmware';
export const FIRMWARE_LEAD = 'Run controls the firmware it was tested against.';
export const CONNECT_FOR_FIRMWARE = 'Connect the machine to check its firmware.';
export const UPDATE_LABEL = 'Update firmware';

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

/** Marks the offered release on the Board tab's list and opens the flow in the frame. */
export function startUpdate(state: FirmwareState): void {
  if (state.kind === 'needed' || state.kind === 'available') releaseRequest.value = state.offer.release.file;
  firmwareUpdating.value = true;
}

const embed = (model: WorkspaceModel | null): ComponentChild => h('div', { class: 'wizard-embed' }, h(FirmwareTab, { model }));

function offerBody(p: FirmwareProps, state: Extract<FirmwareState, { kind: 'needed' | 'available' }>): ComponentChild {
  return h(
    'div',
    null,
    h(
      'table',
      { class: 'wizard-facts' },
      h('tbody', null,
        h('tr', null, h('th', { scope: 'row' }, 'On the board'), h('td', null, h('strong', null, `TinyG ${fbText(state.offer.current)}`))),
        h('tr', null, h('th', { scope: 'row' }, 'Run expects'), h('td', null, h('strong', null, `TinyG ${fbText(state.offer.release.fb)}`))),
      ),
    ),
    h('p', { class: 'wizard-line', 'data-firmware-step': 'text' }, offerText(state.offer)),
    p.mismatch !== null
      ? h('p', { class: 'wizard-line', role: 'alert' }, p.mismatch)
      : p.updating
        ? embed(p.model)
        : h('div', { class: 'wizard-actions' }, h('button', { type: 'button', class: 'primary', 'data-action': 'wizard-update', onClick: p.onUpdate }, UPDATE_LABEL)),
  );
}

export function Firmware(p: FirmwareProps): ComponentChild {
  const s = p.state;
  if (s.kind === 'disconnected') return h('div', null, h('p', { class: 'wizard-line' }, CONNECT_FOR_FIRMWARE), h(ConnectNotice, { model: p.model }));
  const board = p.board === null ? null : h('p', { class: 'wizard-line', 'data-wizard': 'board' }, `Connected · ${p.board}`);
  if (s.kind === 'updating') return h('div', null, board, embed(p.model));
  if (s.kind === 'current') return h('div', null, board, h('p', { class: 'wizard-line', 'data-firmware-step': 'current' }, s.fb === null ? 'The firmware is current.' : `Firmware ${fbText(s.fb)} is current.`));
  return h('div', null, board, offerBody(p, s));
}
