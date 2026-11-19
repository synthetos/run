/**
 * The Motors tab (Board settings spec §5.5): one card per motor in two columns, built from each motor's group in
 * the settings file. The cards are the editor: changes become pending and go through Review and apply.
 */
import { h, type ComponentChild } from 'preact';
import { MOTORS, settingsOf } from '../../boardFacts.ts';
import type { LiveView } from '../../model.ts';
import { defsFor } from '../../settings/defs.ts';
import { SettingControl } from '../../settings/SettingControl.ts';
import { MotorCard } from './motorCard.ts';
import { Empty } from './shared.ts';

export function MotorsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  const defs = defsFor(view);
  const read = MOTORS.some((m) => settings[`${m}ma`] !== undefined);
  if (!read || defs === null) return h('div', { class: 'scroll-region' }, h(Empty, { view }));
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll motors-tab' },
    defs.tokens.has('mt')
      ? h('div', { class: 'motor-idle board-card', 'data-region': 'motor-idle' }, h('label', null, 'Idle motors power off after'), h(SettingControl, { k: 'mt', view }))
      : null,
    h('div', { class: 'motor-grid' }, MOTORS.map((m) => h(MotorCard, { key: m, m, view, defs }))),
  );
}
