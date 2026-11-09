/**
 * Why Home is off, said where Home is (first-time walk 2026-11-08, C17): the reason was only in the disabled
 * button's hover tip. When the board's settings are read and no axis has a homing switch and search speed set, the
 * Position panel says so in a line under the buttons, with "Set up homing", which opens Board → Axes (its homing
 * and switch settings). Opening a view sends nothing.
 */
import { h, type ComponentChild } from 'preact';
import { boardTab, viewRequest } from './boardNavigation.ts';

export const HOMING_OFF = 'Home is off: no axis has a homing switch and search speed set on this board.';

export function HomingOffNote(): ComponentChild {
  return h(
    'p',
    { class: 'fine homing-off', 'data-home': 'off-reason' },
    `${HOMING_OFF} `,
    h('button', { type: 'button', class: 'link', 'data-action': 'homing-setup', onClick: () => { boardTab.value = 'axes'; viewRequest.value = 'board'; } }, 'Set up homing'),
  );
}
