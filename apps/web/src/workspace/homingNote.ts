/**
 * Why Home is off, said where Home is (first-time walk 2026-11-08, C17): the reason was only in the disabled
 * button's hover tip. When the board's settings are read and no axis has a homing switch and search speed set, the
 * Position panel says so in a line under the buttons, with "Set up homing", which opens Board → Axes (its homing
 * and switch settings). Opening a view sends nothing.
 */
import { h, type ComponentChild } from 'preact';
import { boardTab, viewRequest } from './boardNavigation.ts';
import { usePublishNotes } from './notes/usePublishNotes.ts';

export const HOMING_OFF = 'Home is off: no axis has a homing switch and search speed set on this board.';

/**
 * Simple's line under Home (owner, 2026-11-09: the explanation is a note): "Set up homing", the way to turn Home on,
 * stays where Home is; the sentence saying why it is off is in the Notes tab.
 */
export function HomingOffNote(): ComponentChild {
  usePublishNotes('homing-off', [{ id: 'homing-off', topic: 'Homing', title: 'Home is off.', body: 'No axis has a homing switch and search speed set on this board.', link: { kind: 'board', tab: 'axes', label: 'Set up homing' } }]);
  return h(
    'p',
    { class: 'fine homing-off', 'data-home': 'off-reason', title: HOMING_OFF },
    h('button', { type: 'button', class: 'link', 'data-action': 'homing-setup', onClick: () => { boardTab.value = 'axes'; viewRequest.value = 'board'; } }, 'Set up homing'),
  );
}
