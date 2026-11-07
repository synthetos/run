/**
 * Probe Z, step 1: Setup (SAFETY §4.5c). Plate thickness, depth limit and feed (presets plus a custom value), and
 * the spindle check. Moves nothing; the jog pad stays usable for positioning.
 */
import { h, type ComponentChild } from 'preact';
import { PROBE_LIMITS } from '@synthetos/machine';
import { checkForm, type ProbeForm } from './probeForm.ts';
import { mm } from './probeStrings.ts';
import { ProbeCard } from './ProbeCard.ts';
import { focusOnMount } from '../ui.ts';

export interface ProbeSetupProps {
  readonly form: ProbeForm;
  readonly zjh: number | null;
  readonly system: string;
  /** The thickness came from this browser's memory: say to check it. */
  readonly remembered: boolean;
  readonly advanced: boolean;
  readonly onChange: (form: ProbeForm) => void;
  readonly onNext: () => void;
  readonly onCancel: () => void;
}

const valueOf = (e: Event): string => (e.currentTarget as HTMLInputElement).value;

/** Presets as a segmented choice, then Custom, which opens a field. */
function choice(p: {
  readonly name: string;
  readonly unit: string;
  readonly presets: readonly number[];
  readonly value: string;
  readonly custom: boolean;
  readonly error: string | undefined;
  readonly onPick: (value: string, custom: boolean) => void;
}): ComponentChild {
  const id = `probe-${p.name.toLowerCase().replace(/\s+/g, '-')}`;
  return h(
    'div',
    { class: 'probe-field', role: 'group', 'aria-labelledby': `${id}-label` },
    h('span', { id: `${id}-label`, class: 'probe-label' }, p.name),
    h(
      'span',
      { class: 'seg' },
      p.presets.map((v) => h('button', { type: 'button', key: v, class: !p.custom && p.value === String(v) ? 'selected' : undefined, 'aria-pressed': !p.custom && p.value === String(v) ? 'true' : 'false', 'data-probe-preset': `${p.name}:${v}`, onClick: () => p.onPick(String(v), false) }, `${v}`)),
      h('button', { type: 'button', class: p.custom ? 'selected' : undefined, 'aria-pressed': p.custom ? 'true' : 'false', 'data-probe-preset': `${p.name}:custom`, onClick: () => p.onPick(p.value, true) }, 'Custom'),
    ),
    p.custom ? h('input', { id, type: 'text', inputmode: 'decimal', class: 'probe-input', value: p.value, 'aria-label': `${p.name}, ${p.unit}`, onInput: (e: Event) => p.onPick(valueOf(e), true) }) : null,
    h('small', null, p.unit),
    p.error === undefined ? null : h('p', { class: 'probe-error', role: 'alert' }, p.error),
  );
}

export function ProbeSetup(props: ProbeSetupProps): ComponentChild {
  const { form, onChange } = props;
  const L = PROBE_LIMITS;
  const result = checkForm(form, props.zjh);
  const errors = result.ok ? {} : result.errors;
  const ready = result.ok && form.spindleStopped;
  const set = (patch: Partial<ProbeForm>): void => onChange({ ...form, ...patch });
  return h(
    ProbeCard,
    { title: 'Probe Z', stage: 'setup', step: 'setup' },
    h('p', { class: 'probe-lead' }, `Sets ${props.system} Z zero from a touch plate.`),
    h('p', null, 'Jog the tool over the spot you want to measure. Leave room for the plate under it, and stay closer to it than the depth limit.'),
    h(
      'div',
      { class: 'probe-field' },
      h('label', { class: 'probe-label', for: 'probe-thickness' }, 'Plate thickness'),
      h('input', { id: 'probe-thickness', type: 'text', inputmode: 'decimal', class: 'probe-input', value: form.thickness, ...(form.thickness === '' ? { ref: focusOnMount } : {}), onInput: (e: Event) => set({ thickness: valueOf(e) }) }),
      h('small', null, 'mm'),
      h('p', { class: 'fine' }, props.remembered ? 'Last used. Check it matches this plate.' : 'Measure it; Run can’t check this.'),
      errors.thickness === undefined || form.thickness === '' ? null : h('p', { class: 'probe-error', role: 'alert' }, errors.thickness),
    ),
    choice({ name: 'Depth limit', unit: 'mm', presets: L.depthMm.presets, value: form.depth, custom: form.depthCustom, error: errors.depth, onPick: (depth, depthCustom) => set({ depth, depthCustom }) }),
    choice({ name: 'Feed', unit: 'mm/min', presets: L.feed.presets, value: form.feed, custom: form.feedCustom, error: errors.feed, onPick: (feed, feedCustom) => set({ feed, feedCustom }) }),
    props.advanced && result.stopMm !== null ? h('p', { class: 'fine', 'data-probe': 'stop-distance' }, `Stop distance about ${mm(result.stopMm)} mm, calculated from zjh ${props.zjh} at F${form.feed}.`) : null,
    h('label', { class: 'probe-check' }, h('input', { type: 'checkbox', 'data-action': 'probe-spindle', checked: form.spindleStopped, onChange: (e: Event) => set({ spindleStopped: (e.currentTarget as HTMLInputElement).checked }) }), ' The spindle or router is stopped. Switch off a router at its own switch.'),
    h(
      'div',
      { class: 'probe-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'probe-cancel', onClick: props.onCancel }, 'Cancel'),
      h('button', { type: 'button', class: 'small primary', 'data-action': 'probe-touch', ...(ready ? { onClick: props.onNext } : { disabled: true }) }, 'Test the plate'),
    ),
  );
}

