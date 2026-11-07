/**
 * Probe Z's result (SAFETY §4.5c, H90): what the board reported, whether Z zero changed, and what to do next. It
 * stays until the owner says the plate is off. Lift Z is the ordinary jog, on the owner's press only; an alarm is
 * cleared only through C13. Nothing retries.
 */
import { h, type ComponentChild } from 'preact';
import type { ProbeOutcome } from '@synthetos/machine';
import { outcomeCopy, outcomeStatus } from './probeCopy.ts';
import { mm } from './probeStrings.ts';
import { LIFT_MM } from './probeView.ts';
import { ProbeCard } from './ProbeCard.ts';

export interface ProbeResultProps {
  readonly outcome: ProbeOutcome;
  readonly system: string;
  /** The controller is in alarm now: Clear alarm is offered instead of Lift Z. */
  readonly alarm: boolean;
  /** Why Lift Z can't be sent now, or null when it can. */
  readonly liftBlocked: string | null;
  readonly advanced: boolean;
  readonly onLift: () => void;
  readonly onClear: () => void;
  readonly onPlateOff: () => void;
}

export function ProbeResult(props: ProbeResultProps): ComponentChild {
  const { outcome } = props;
  const copy = outcomeCopy(outcome, props.system);
  const status = outcomeStatus(outcome);
  const showLift = !props.alarm && (copy.action === 'lift' || copy.action === 'clear');
  return h(
    ProbeCard,
    { title: copy.headline, stage: null, step: 'result', focusHeading: true },
    h('div', { 'data-probe-outcome': outcome.kind, ...(copy.ok ? { role: 'status' } : { role: 'alert' }) }, h('p', null, copy.body)),
    props.advanced && status !== null ? h('p', { class: 'fine probe-raw', 'data-probe': 'status' }, `Board status ${status}`) : null,
    props.advanced && outcome.kind === 'contactZeroSet' ? h('p', { class: 'fine', 'data-probe': 'stop-distance' }, `Stop distance about ${mm(outcome.stopMm)} mm, calculated, taken off the zero.`) : null,
    outcome.kind === 'cancelled' ? null : h('p', { class: 'probe-plate', 'data-probe': 'plate' }, 'Take the touch plate and lead off the machine, then confirm. Until then Run won’t start a job or the spindle.'),
    h(
      'div',
      { class: 'probe-actions' },
      props.alarm ? h('button', { type: 'button', class: 'small', 'data-action': 'probe-clear-alarm', onClick: props.onClear }, 'Clear alarm…') : null,
      showLift ? h('button', { type: 'button', class: 'small', 'data-action': 'probe-lift', ...(props.liftBlocked === null ? { onClick: props.onLift } : { disabled: true, title: props.liftBlocked }) }, `Lift Z ${LIFT_MM} mm`) : null,
      h('button', { type: 'button', class: 'small primary', 'data-action': 'probe-plate-off', onClick: props.onPlateOff }, 'The plate is off'),
    ),
  );
}
