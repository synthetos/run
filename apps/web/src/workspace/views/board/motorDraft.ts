import { h, type ComponentChild } from 'preact';
import {
  AXIS_NAMES,
  clearDraft,
  dialectOf,
  draftDiff,
  draftStore,
  motorAxis,
  plainValue,
  setDraft,
  settingMeta,
  settingsOf,
  stepsPerUnit,
  tinygV8
} from '../../boardFacts.ts';
import { type LiveView } from '../../model.ts';
import { num } from '../../status.ts';


export const MOTOR_FIELDS = ['ma', 'sa', 'tr', 'mi', 'po', 'pm'] as const;

/** One motor's settings as read, with a proposed draft beside each. Nothing is written. */
export function MotorDraft({ motor, view }: { readonly motor: number; readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const draft = draftStore.value.value;
  const micro = tinygV8()?.motors.microsteps.value ?? [1, 2, 4, 8];
  const keys = MOTOR_FIELDS.map((f) => `${motor}${f}`);
  const changed = keys.filter((k) => draftDiff(k, settings) === 'changed' || draftDiff(k, settings) === 'unread');
  const val = (k: string): number | undefined => {
    const d = draft[k];
    if (d !== undefined) return d;
    const b = settings[k];
    return typeof b === 'number' ? b : undefined;
  };
  const board = (f: string): number | undefined => {
    const b = settings[`${motor}${f}`];
    return typeof b === 'number' ? b : undefined;
  };
  const boardSteps = stepsPerUnit(board('sa'), board('mi'), board('tr'));
  const draftSteps = stepsPerUnit(val(`${motor}sa`), val(`${motor}mi`), val(`${motor}tr`));
  const input = (f: (typeof MOTOR_FIELDS)[number]): ComponentChild => {
    const k = `${motor}${f}`;
    const m = settingMeta(k, dialect);
    const current = val(k);
    const onPick = (raw: string): void => {
      const n = Number.parseFloat(raw);
      const b = settings[k];
      setDraft(k, !Number.isFinite(n) || (typeof b === 'number' && Math.abs(b - n) < 1e-9) ? null : n);
    };
    if (f === 'mi' || m.values !== null) {
      const options = f === 'mi' ? micro.map((x) => ({ value: x, label: String(x) })) : (m.values ?? []).filter((e) => f !== 'ma' || e.value < AXIS_NAMES.length);
      return h('span', { class: 'select-wrap' }, h('select', { 'aria-label': `${m.label}, draft`, value: current === undefined ? '' : String(current), onChange: (e: Event) => onPick((e.currentTarget as HTMLSelectElement).value) }, current === undefined ? h('option', { value: '' }, 'Choose') : null, options.map((o) => h('option', { value: String(o.value), key: o.value }, o.label))));
    }
    return h('span', { class: 'unit-input' }, h('input', { type: 'number', step: 'any', min: 0, 'aria-label': `${m.label}, draft`, value: current === undefined ? '' : current, onChange: (e: Event) => onPick((e.currentTarget as HTMLInputElement).value) }), m.unit === '' ? null : h('i', null, m.unit.replace('deg/step', '°').replace('mm/rev', 'mm')));
  };
  return h(
    'section',
    { class: 'insp motor-draft', 'data-motor': String(motor), 'aria-labelledby': `motor-${motor}-title` },
    h('header', null, h('h2', { id: `motor-${motor}-title` }, `Motor ${motor}`), h('span', { class: 'tag' }, motorAxis(settings, motor) === null ? 'Axis unknown' : `Drives ${motorAxis(settings, motor) as string}`)),
    h(
      'table',
      { class: 'draft-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Setting'), h('th', { scope: 'col' }, 'On the board'), h('th', { scope: 'col' }, 'Draft'))),
      h(
        'tbody',
        null,
        MOTOR_FIELDS.map((f) => {
          const k = `${motor}${f}`;
          const m = settingMeta(k, dialect);
          const d = draftDiff(k, settings);
          return h(
            'tr',
            { key: k, class: d === 'changed' || d === 'unread' ? 'drafted' : undefined },
            h('th', { scope: 'row', title: m.description }, m.label.replace(`Motor ${motor} `, '').replace(/^./, (c) => c.toUpperCase()), h('small', { class: 'raw-key' }, k)),
            h('td', null, plainValue(k, settings[k], dialect) ?? 'Not read'),
            h('td', null, input(f), d === 'changed' ? h('span', { class: 'draft-badge' }, 'changed') : d === 'unread' ? h('span', { class: 'draft-badge' }, 'unknown') : null),
          );
        }),
        h('tr', { class: 'derived' }, h('th', { scope: 'row' }, 'Steps per unit', h('small', { class: 'raw-key' }, '360 ÷ sa × mi ÷ tr')), h('td', null, boardSteps === null ? 'Not read' : num(boardSteps, 3)), h('td', null, draftSteps === null ? '' : num(draftSteps, 3))),
      ),
    ),
    h(
      'div',
      { class: 'draft-foot' },
      h('span', { class: 'fine' }, changed.length === 0 ? 'No pending changes for this motor.' : `${changed.length} pending ${changed.length === 1 ? 'change' : 'changes'}. Kept in this browser.`),
      changed.length === 0 ? null : h('button', { type: 'button', class: 'small quiet', 'data-action': 'clear-draft', onClick: () => clearDraft(keys) }, 'Clear'),
      changed.length === 0 ? null : h('span', { class: 'fine' }, 'Review and apply them in Pending changes above.'),
    ),
  );
}
