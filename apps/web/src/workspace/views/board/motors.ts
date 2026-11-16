import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import {
  dialectOf,
  MOTORS,
  settingsOf,
  stepsPerUnit
} from '../../boardFacts.ts';
import { type LiveView } from '../../model.ts';
import { num } from '../../status.ts';
import { MOTOR_FIELDS, MotorDraft } from './motorDraft.ts';
import { cell, Empty } from './shared.ts';

export function MotorsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [motor, setMotor] = useState(1);
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const read = MOTORS.some((m) => settings[`${m}ma`] !== undefined);
  return h(
    'div',
    { class: 'configure-grid' },
    h(
      'div',
      { class: 'list-panel' },
      h('div', { class: 'panel-title' }, h('h2', null, 'Motors'), h('span', { class: 'fine' }, 'Choose a motor to draft changes')),
      read
        ? h(
          'div',
          { class: 'tool-table-wrap' },
          h(
            'table',
            { class: 'cfg-table' },
            h('thead', null, h('tr', null, ...['Motor', 'Drives', 'Step angle', 'Travel per rev', 'Microsteps', 'Polarity', 'Power', 'Steps per unit'].map((t) => h('th', { scope: 'col', key: t }, t)))),
            h(
              'tbody',
              null,
              MOTORS.map((m) => {
                const n = (k: string): number | undefined => (typeof settings[`${m}${k}`] === 'number' ? (settings[`${m}${k}`] as number) : undefined);
                const spu = stepsPerUnit(n('sa'), n('mi'), n('tr'));
                return h(
                  'tr',
                  { key: m, 'aria-selected': motor === m ? 'true' : 'false', onClick: () => setMotor(m), 'data-motor-row': String(m) },
                  h('th', { scope: 'row' }, h('button', { type: 'button', class: 'row-link', onClick: () => setMotor(m) }, `Motor ${m}`)),
                  ...MOTOR_FIELDS.map((f) => cell(`${m}${f}`, settings, dialect)),
                  h('td', { class: 'num' }, spu === null ? 'Unknown' : num(spu, 3)),
                );
              }),
            ),
          ),
        )
        : h(Empty, { view }),
    ),
    h('aside', { class: 'inspector', 'aria-label': 'Motor draft' }, h(MotorDraft, { motor, view })),
  );
}
