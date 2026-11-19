/**
 * The Motors tab (Board settings spec §5.5): the motor idle timeout, then one card per motor, built from each motor's
 * group in the settings file. Each motor is its own sub-tab, named with the axis it drives, so nothing scrolls
 * (owner walk 2026-11-19). The cards are the editor: changes become pending and go through Review and apply.
 */
import { h, type ComponentChild } from 'preact';
import type { SettingsFile } from '@synthetos/schema';
import { AXIS_NAMES, MOTORS, settingsOf } from '../../boardFacts.ts';
import type { LiveView } from '../../model.ts';
import { defsFor } from '../../settings/defs.ts';
import { plannedDrafts } from '../../settings/editGate.ts';
import { SettingControl } from '../../settings/SettingControl.ts';
import { MotorCard } from './motorCard.ts';
import { Empty } from './shared.ts';
import { SubTabs, subTabChoice, type SubTab } from './subTabs.ts';

/** "Motor 1 · X", with the count of its pending changes as the badge. */
function motorTab(m: number, view: LiveView | null, defs: SettingsFile): SubTab {
  const drafts = plannedDrafts(view);
  const ma = drafts[`${m}ma`] ?? view?.readout.settings[`${m}ma`];
  const axis = typeof ma === 'number' ? AXIS_NAMES[ma] : undefined;
  const pending = Object.keys(drafts).filter((k) => defs.tokens.get(k)?.group === `motor-${m}`).length;
  return { id: String(m), label: axis === undefined ? `Motor ${m}` : `Motor ${m} · ${axis}`, ...(pending === 0 ? {} : { badge: String(pending) }) };
}

export function MotorsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  const defs = defsFor(view);
  const motors = MOTORS.filter((m) => settings[`${m}ma`] !== undefined);
  if (motors.length === 0 || defs === null) return h('div', { class: 'scroll-region' }, h(Empty, { view }));
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll motors-tab' },
    defs.tokens.has('mt')
      ? h('div', { class: 'motor-idle board-card', 'data-region': 'motor-idle' }, h('label', null, defs.tokens.get('mt')?.label ?? 'mt'), h(SettingControl, { k: 'mt', view }))
      : null,
    h(SubTabs, { name: 'Motors', prefix: 'board-motors', tabs: motors.map((m) => motorTab(m, view, defs)), choice: subTabChoice.motors, render: (id) => h(MotorCard, { m: Number(id), view, defs }) }),
  );
}
