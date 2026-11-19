/**
 * One motor as a card (Board settings spec §5.5, mockup 2026-11-18-board-config-motors): the rows of the motor's
 * group in the settings file, each a `SettingControl`, plus the derived steps per mm (or per degree for a motor that
 * drives a rotary axis), shown board → new while a change to step angle, microsteps or travel is pending.
 */
import { h, type ComponentChild } from 'preact';
import type { SettingValue, SettingsFile } from '@synthetos/schema';
import { AXIS_NAMES, draftStore, plainValue, stepsPerUnit } from '../../boardFacts.ts';
import { boardTab } from '../../boardNavigation.ts';
import type { LiveView } from '../../model.ts';
import { boardBuild, defsFor } from '../../settings/defs.ts';
import { SettingControl } from '../../settings/SettingControl.ts';
import { numberWords } from '../../settings/units.ts';

type Settings = Readonly<Record<string, SettingValue>>;

const num = (s: Settings, k: string): number | undefined => (typeof s[k] === 'number' ? (s[k] as number) : undefined);

function steps(s: Settings, m: number): number | null {
  return stepsPerUnit(num(s, `${m}sa`), num(s, `${m}mi`), num(s, `${m}tr`));
}

const stepWords = (v: number | null): string => (v === null ? 'Not read' : numberWords(Number(v.toFixed(3))));

/** "320", or "320 → 1 280" while a change to the scale is pending. */
export function stepsText(board: Settings, planned: Settings, m: number): string {
  const before = steps(board, m);
  const after = steps(planned, m);
  return before === after ? stepWords(before) : `${stepWords(before)} → ${stepWords(after)}`;
}

function extra(k: string, planned: Settings): string | null {
  const sa = num(planned, k);
  if (!k.endsWith('sa') || sa === undefined || !(sa > 0)) return null;
  return `${numberWords(Math.round(360 / sa))} steps per turn`;
}

function Row({ k, short, view, planned }: { readonly k: string; readonly short: string; readonly view: LiveView | null; readonly planned: Settings }): ComponentChild {
  const more = extra(k, planned);
  return h('tr', { 'data-motor-row': k }, h('th', { scope: 'row' }, short), h('td', null, h(SettingControl, { k, view }), more === null ? null : h('span', { class: 'fine motor-extra' }, more)));
}

/** A motor's values as text, for the Overview's motor pin panel; they are changed on Motors (one home per setting). */
export function MotorFacts({ m, view }: { readonly m: number; readonly view: LiveView | null }): ComponentChild {
  const defs = defsFor(view);
  const board: Settings = view?.readout.settings ?? {};
  if (defs === null) return null;
  const rows = [...defs.tokens.values()].filter((d) => d.group === `motor-${m}`);
  return h(
    'section',
    { class: 'insp', 'data-motor-facts': String(m) },
    h('dl', { class: 'facts' }, rows.map((d) => h('div', { key: d.key }, h('dt', null, d.short), h('dd', null, plainValue(d.key, board[d.key], view?.readout.dialectId ?? null, boardBuild(view)) ?? 'Not read')))),
    h('button', { type: 'button', class: 'small', 'data-action': 'open-motors', onClick: () => { boardTab.value = 'motors'; } }, 'Change on Motors'),
  );
}

export function MotorCard({ m, view, defs }: { readonly m: number; readonly view: LiveView | null; readonly defs: SettingsFile }): ComponentChild {
  const board: Settings = view?.readout.settings ?? {};
  const planned: Settings = { ...board, ...draftStore.value.value };
  const ma = num(planned, `${m}ma`);
  const rotary = ma !== undefined && ma >= 3;
  const rows = [...defs.tokens.values()].filter((d) => d.group === `motor-${m}`);
  return h(
    'section',
    { class: 'board-card motor-card', 'data-motor-card': String(m) },
    h(
      'div',
      { class: 'sec-head' },
      h('h3', { class: 'card-title' }, `Motor ${m}`),
      ma === undefined ? null : h('span', { class: 'tag' }, `drives ${AXIS_NAMES[ma] ?? `axis ${ma}`}`),
      h('span', { class: 'grow' }),
      h('span', { class: 'fine' }, `M${m} terminals`),
    ),
    h(
      'table',
      { class: 'cfg-table motor-table' },
      h(
        'tbody',
        null,
        rows.map((d) => h(Row, { key: d.key, k: d.key, short: d.short, view, planned })),
        h('tr', { key: 'spu' }, h('th', { scope: 'row' }, rotary ? 'Steps per degree' : 'Steps per mm'), h('td', { class: 'num', 'data-steps-per-unit': '' }, stepsText(board, planned, m))),
      ),
    ),
  );
}
