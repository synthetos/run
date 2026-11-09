/**
 * The tool inspector's Name field (first-time walk 2026-11-08, C1): the name the library, the 3D view's key and
 * Advanced all show. A new tool is "T<n> tool" until renamed. An empty or refused name is said and the field goes
 * back to the saved name.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { updateTool } from '../library.ts';

export function ToolNameField({ id, name }: { readonly id: string; readonly name: string }): ComponentChild {
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  return h(
    'label',
    { class: 'field span-2', key: 'tool-name' },
    h('span', null, 'Name'),
    h('input', {
      type: 'text',
      maxLength: 120,
      value: draft ?? name,
      'data-tool-field': 'name',
      'aria-invalid': error === null ? undefined : 'true',
      onInput: (e: Event) => setDraft((e.currentTarget as HTMLInputElement).value),
      onChange: (e: Event) => {
        const next = (e.currentTarget as HTMLInputElement).value.trim();
        setError(next === '' ? 'A tool needs a name.' : updateTool(id, { name: next }));
        setDraft(null);
      },
    }),
    error === null ? null : h('small', { class: 'field-error', role: 'alert', 'data-tool-field': 'name-error' }, error),
  );
}
