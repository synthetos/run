/** The probe input's live reading, in words (never colour alone). Advanced adds the raw token and polarity. */
import { h, type ComponentChild } from 'preact';
import type { ProbeSnapshot } from '@synthetos/machine';

type Input = NonNullable<ProbeSnapshot['input']>;

const WORDS: Readonly<Record<string, string>> = { touching: 'Touching', clear: 'Not touching', disabled: 'Input disabled', none: 'No reading' };
const RAW: Readonly<Record<string, string>> = { touching: '1', clear: '0', disabled: '-1', none: '—' };

export function InputReading({ input, advanced }: { readonly input: Input | null; readonly advanced: boolean }): ComponentChild {
  const key = input?.reading ?? 'none';
  return h(
    'div',
    { class: `probe-reading reading-${key}`, role: 'status', 'data-probe-reading': key },
    h('span', null, `Probe input${input === null ? '' : ` (${input.label})`}`),
    h('strong', null, WORDS[key]),
    advanced && input !== null ? h('small', { class: 'probe-raw' }, `${input.token} = ${RAW[key]} · prbp ${input.activeLow ? '0 (active low)' : '1 (active high)'} · read only`) : null,
  );
}
