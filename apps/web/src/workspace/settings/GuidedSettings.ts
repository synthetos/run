import { h, type ComponentChild } from 'preact';
import { homingAxis, type SettingValue } from '@synthetos/schema';
import { ContextHelp } from '../../shell/ContextHelp.ts';
import { dialectOf, draftStore, plainValue, settingsOf } from '../boardFacts.ts';
import { machineAxes } from '../motion.ts';
import { selectedMachine, type MachineProfile } from '../library.ts';
import type { LiveView } from '../model.ts';
import { editBlocked, SettingEditor } from './SettingsUi.ts';
import { writableKey } from './pending.ts';

export const GUIDED_AXIS_FIELDS = [
  ['tn', 'Travel start'], ['tm', 'Travel end'],
  ['vm', 'Maximum rapid speed'], ['fr', 'Maximum feed rate'],
  ['sn', 'Minimum switch'], ['sx', 'Maximum switch'], ['sv', 'Homing search speed'],
] as const;

export function guidedAxes(machine: MachineProfile | null, settings: Readonly<Record<string, SettingValue>>): readonly ('x' | 'y' | 'z' | 'a')[] {
  return machine === null ? machineAxes(settings) : machine.axes?.a === undefined ? ['x', 'y', 'z'] : ['x', 'y', 'z', 'a'];
}

/** The same board keys and pending editor as Advanced; no direct writes. */
export function GuidedSettings({ view, prefix = 'guided' }: { readonly view: LiveView | null; readonly prefix?: string }): ComponentChild {
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const blocked = editBlocked(view);
  const planned: Readonly<Record<string, SettingValue>> = { ...settings, ...draftStore.value.value };
  const field = (key: string, label: string): ComponentChild => h('label', { class: 'field', key, 'data-guided-setting': key },
    h('span', null, label),
    dialect === null
      ? h('input', { disabled: true, 'aria-label': `${label}, draft`, placeholder: 'Not connected', title: blocked ?? 'Read the board settings first.' })
      : !writableKey(key, dialect)
        ? h('output', { class: 'guided-readonly', title: 'This firmware’s settings are read only.' }, plainValue(key, settings[key], dialect) ?? 'Not read')
        : h(SettingEditor, { k: key, view }));
  return h('div', { class: 'guided-settings', 'data-region': 'guided-settings' },
    h('div', { class: 'guided-settings-head' },
      field('gun', 'Default units'),
      h(ContextHelp, { id: `${prefix}-settings-help`, label: 'About changing these settings' }, blocked ?? (dialect !== null && !writableKey('gun', dialect) ? 'This firmware’s settings are read only.' : 'Changes stay pending until you review and apply them. Travel start and end are positions in machine coordinates. Homing moves towards the switch configured for homing. Default units apply when the controller starts.'))),
    guidedAxes(selectedMachine.value, settings).map((axis) => {
      const home = homingAxis(planned, axis);
      return h('section', { key: axis, class: 'guided-axis', 'data-guided-axis': axis },
        h('header', null, h('h3', null, `${axis.toUpperCase()} axis`),
          h('span', { class: 'fine', 'data-homing-direction': axis }, home.end === null ? 'Homing not configured' : `Home towards ${home.end === 'min' ? 'minimum' : 'maximum'}`),
          home.reason === null ? null : h(ContextHelp, { id: `${prefix}-${axis}-homing-help`, label: `About ${axis.toUpperCase()} homing` }, home.reason)),
        h('div', { class: 'guided-fields' }, GUIDED_AXIS_FIELDS.map(([suffix, label]) => field(`${axis}${suffix}`, label))));
    }));
}
