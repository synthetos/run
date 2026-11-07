/**
 * Probe Z, step 3: Ready, the one confirmation (C39) for the move and the new Z zero (SAFETY §4.5c, H90). In flow, not
 * a dialog, so the live reading stays in view; W51 and W52 beside it; the plate checkbox; Cancel has the focus and
 * Enter starts nothing. One press sends one probe.
 */
import { h, type ComponentChild } from 'preact';
import type { ProbePlan, ProbeSnapshot } from '@synthetos/machine';
import { focusOnMount } from '../ui.ts';
import { InputReading } from './InputReading.ts';
import { ProbeCard } from './ProbeCard.ts';
import { probeSeconds } from './probeForm.ts';
import { c39, mm, w51, w52 } from './probeStrings.ts';

export interface ProbeReadyProps {
  readonly plan: ProbePlan | null;
  readonly system: string;
  readonly input: ProbeSnapshot['input'];
  /** false: not homed, so soft limits won't check the move. */
  readonly homed: boolean | null;
  readonly advanced: boolean;
  readonly plateOn: boolean;
  readonly onPlate: (on: boolean) => void;
  readonly onStart: () => void;
  readonly onCancel: () => void;
}

export function ProbeReady(props: ProbeReadyProps): ComponentChild {
  const { plan, input } = props;
  const touching = input?.reading === 'touching';
  const clear = input?.reading === 'clear';
  const canStart = plan !== null && clear && props.plateOn;
  return h(
    ProbeCard,
    { title: 'Ready', stage: 'ready', step: 'ready' },
    h(InputReading, { input, advanced: props.advanced }),
    plan === null
      ? h('p', { role: 'status' }, 'Waiting for the board.')
      : h(
          'div',
          { 'data-safety': 'C39' },
          h('p', { 'data-probe': 'c39' }, c39({ feed: plan.feed, depthMm: plan.depthMm, system: props.system, thicknessMm: plan.thicknessMm, stopMm: plan.stopMm })),
          h('p', { class: 'fine' }, `It takes about ${probeSeconds(plan.depthMm, plan.feed)} s to reach the depth limit.`),
        ),
    h('p', { class: 'probe-warn', 'data-safety': 'W52' }, w52()),
    h('p', { class: 'probe-warn', 'data-safety': 'W51' }, w51()),
    props.homed === false ? h('p', { class: 'fine', 'data-probe': 'unhomed' }, 'This machine isn’t homed, so soft limits won’t check this move.') : null,
    props.advanced && plan !== null ? h('p', { class: 'fine probe-raw', 'data-probe': 'gcode' }, `G21, G91 G38.2 Z-${mm(plan.depthMm)} F${mm(plan.feed)}, then G10 L20 P${systemNumber(props.system)} Z${mm(plan.zeroZ)} (${mm(plan.thicknessMm)} less ${mm(plan.stopMm)})`) : null,
    touching ? h('p', { class: 'probe-error', role: 'alert' }, 'The input reads touching. If the tool is on the plate, cancel, raise Z and start again.') : null,
    h('label', { class: 'probe-check' }, h('input', { type: 'checkbox', 'data-action': 'probe-plate', checked: props.plateOn, onChange: (e: Event) => props.onPlate((e.currentTarget as HTMLInputElement).checked) }), ' The plate is flat on the work, under the tool.'),
    h(
      'div',
      { class: 'probe-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'probe-cancel', ref: focusOnMount, onClick: props.onCancel }, 'Cancel'),
      h('button', { type: 'button', class: 'small primary', 'data-action': 'probe-start', ...(canStart ? { onClick: props.onStart } : { disabled: true }) }, 'Start probe'),
    ),
  );
}

/** `P1`..`P6` for G54..G59. */
export function systemNumber(system: string): number {
  const n = Number(system.slice(1)) - 53;
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : 1;
}
