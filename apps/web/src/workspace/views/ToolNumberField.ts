/**
 * The T number field of the tool inspector (workspace/toolNumbers.ts): the number a file's `T… M6` uses for this
 * tool, so the 3D view can draw it. A clash or a bad value is refused with the reason, and the field goes back
 * to the saved number.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { setToolNumber } from '../toolNumbers.ts';

export function ToolNumberField({ id, number }: { readonly id: string; readonly number: number }): ComponentChild {
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  return h(
    'label',
    { class: 'field', key: 'tool-number' },
    h('span', null, 'T number'),
    h('span', { class: 'unit-input' }, h('input', {
      type: 'number',
      min: 1,
      step: 1,
      value: draft ?? String(number),
      'data-tool-field': 'number',
      'aria-invalid': error === null ? undefined : 'true',
      onInput: (e: Event) => setDraft((e.currentTarget as HTMLInputElement).value),
      onChange: (e: Event) => {
        const issue = setToolNumber(id, Number((e.currentTarget as HTMLInputElement).value));
        setError(issue);
        setDraft(null);
      },
    })),
    error === null ? null : h('small', { class: 'field-error', role: 'alert', 'data-tool-field': 'number-error' }, error),
  );
}
