/**
 * Step 2 (spec §6.3): the machine template, its name and bed, then the existing Connect flow (views/run/connect.ts)
 * with the board's identity once it is on. The draft is a module signal (machineDraft) the mount reads when Next
 * saves it; the view itself is pure.
 */
import { signal } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import type { MachineProfile } from '@synthetos/library';
import { ConnectNotice } from '../../workspace/views/run/connect.ts';
import { CATALOGUE } from '../../workspace/machineDrawings.ts';
import { connected, type WorkspaceModel } from '../../workspace/model.ts';
import { boardLabel } from '../../workspace/status.ts';
import type { MachineDraft } from '../machineDraft.ts';

export const MACHINE_TITLE = 'Your machine';
export const MACHINE_LEAD = 'Tell Run what is on the bench, then connect once.';
export const MORE_BOARDS = 'More boards? Add each one later from Machines, the same way.';
export const BOARD_NOTE = 'More than one board on the bench? The browser asks which port. This machine binds to the board it connected to, by its id.';

/** The step's draft while it is open; null until the step initialises it from the record or the first template. */
export const machineDraft = signal<MachineDraft | null>(null);

export interface MachineProps {
  readonly model: WorkspaceModel | null;
  readonly draft: MachineDraft;
  readonly onDraft: (d: MachineDraft) => void;
  /** The machine already bound to the connected board, when there is one. */
  readonly owner: MachineProfile | null;
  readonly onUseOwner: (m: MachineProfile) => void;
}

/** The connected board's id, or null. */
export function liveBoardId(model: WorkspaceModel | null): string | null {
  const v = model?.live.value ?? null;
  if (v === null || !connected(v)) return null;
  const id = v.message?.snapshot.identity?.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

function numberField(label: string, key: 'width' | 'depth' | 'thickness', p: MachineProps): ComponentChild {
  return h('label', { class: 'wizard-field wizard-num' }, h('span', null, label), h('span', { class: 'wizard-unit' }, h('input', { type: 'number', min: 1, step: 'any', value: p.draft[key], onInput: (e: Event) => p.onDraft({ ...p.draft, [key]: Number.parseFloat((e.currentTarget as HTMLInputElement).value) }) }), h('i', null, 'mm')));
}

export function Machine(p: MachineProps): ComponentChild {
  const view = p.model?.live.value ?? null;
  const on = view !== null && connected(view);
  const pickTemplate = (e: Event): void => {
    const t = CATALOGUE.find((x) => x.id === (e.currentTarget as HTMLSelectElement).value);
    if (t !== undefined) p.onDraft({ ...p.draft, templateId: t.id, width: t.travel.x, depth: t.travel.y });
  };
  return h(
    'div',
    { class: 'wizard-machine' },
    h(
      'div',
      { class: 'wizard-field-row' },
      h('label', { class: 'wizard-field wizard-select' }, h('span', null, 'Machine'), h('select', { value: p.draft.templateId, onChange: pickTemplate }, CATALOGUE.map((t) => h('option', { key: t.id, value: t.id }, t.name)))),
      h('label', { class: 'wizard-field wizard-name' }, h('span', null, 'Machine name'), h('input', { value: p.draft.name, maxLength: 60, onInput: (e: Event) => p.onDraft({ ...p.draft, name: (e.currentTarget as HTMLInputElement).value }) })),
    ),
    h('div', { class: 'wizard-field-row' }, numberField('Bed width', 'width', p), numberField('Bed depth', 'depth', p), numberField('Bed thickness', 'thickness', p)),
    on && view !== null
      ? h('p', { class: 'wizard-line', 'data-wizard': 'board' }, `Connected · ${boardLabel(view)}`)
      : h(ConnectNotice, { model: p.model }),
    p.owner === null ? null : h('p', { class: 'wizard-line', role: 'status' }, 'This board is ', h('strong', null, p.owner.name), '. ', h('button', { type: 'button', class: 'small', 'data-action': 'wizard-use-machine', onClick: () => p.onUseOwner(p.owner as MachineProfile) }, 'Continue with it')),
    h('p', { class: 'wizard-line' }, BOARD_NOTE, ' ', MORE_BOARDS),
  );
}
