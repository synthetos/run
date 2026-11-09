/** A labelled number input with a unit, as the Setup and Place panels use it. It only reports finite values at or above `min`. */
import { h, type ComponentChild } from 'preact';

export function field(label: string, value: number, onChange: (n: number) => void, unit = 'mm', step = 0.5, min = 0): ComponentChild {
  return h(
    'label',
    { class: 'field', key: label },
    h('span', null, label),
    h(
      'span',
      { class: 'unit-input' },
      h('input', {
        type: 'number',
        value,
        step,
        min,
        onChange: (e: Event) => {
          const n = Number.parseFloat((e.currentTarget as HTMLInputElement).value);
          if (Number.isFinite(n) && n >= min) onChange(n);
        },
      }),
      h('i', null, unit),
    ),
  );
}
