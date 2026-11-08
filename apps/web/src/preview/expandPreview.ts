/**
 * Expanding the 3D view (first-time walk 2026-11-08, B4): at laptop size the drawing shares the Job view with the
 * job card, the steps, the job panel and the G-code list. Expanded, it takes all of that space (the machine pane and
 * the strip, with Pause and Stop job, stay); a second press puts it back. For this page only.
 */
import { signal } from '@preact/signals';
import { h, type ComponentChild } from 'preact';

export const previewExpanded = signal(false);

/** The toolbar button that expands or shrinks the drawing. */
export function ExpandButton(): ComponentChild {
  const on = previewExpanded.value;
  return h(
    'button',
    { type: 'button', class: 'small expand-preview', 'data-action': 'preview-expand', 'aria-pressed': on ? 'true' : 'false', title: on ? 'Show the job panel and the G-code list again' : 'Give the 3D view the whole Job area', onClick: () => { previewExpanded.value = !on; } },
    on ? 'Shrink' : 'Expand',
  );
}
