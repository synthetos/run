/**
 * One axis as a card (Board settings spec §5.6, mockup 2026-11-18-board-config-axes): Mode (and Radius in radius
 * mode), Travel with its rule in words, Speed, and Homing (the switch from Inputs with a link there, then the homing
 * speeds and backoffs). Every value is a `SettingControl`; the axis-mode safety fact, when there is one, is the
 * card's first line.
 */
import { h, type ComponentChild } from 'preact';
import type { SettingValue, SettingsFile } from '@synthetos/schema';
import { axisModeFact, type AxisModeView } from '../../../machine-ui/AxisModes.ts';
import { boardTab } from '../../boardNavigation.ts';
import type { LiveView } from '../../model.ts';
import { SettingControl } from '../../settings/SettingControl.ts';
import { numberWords, unitWords } from '../../settings/units.ts';
import type { AxisCard } from './axesModel.ts';

type Settings = Readonly<Record<string, SettingValue>>;

interface CardProps {
  readonly c: AxisCard;
  readonly defs: SettingsFile;
  readonly view: LiveView | null;
  readonly planned: Settings;
  readonly open: boolean;
  readonly modes: AxisModeView | null;
}

const num = (s: Settings, k: string): number | null => (typeof s[k] === 'number' ? (s[k] as number) : null);

/** A rotary rapid speed also reads in turns a minute (230 400 °/min is 640 turns a minute). */
function extra(defs: SettingsFile, planned: Settings, k: string): string | null {
  const v = num(planned, k);
  if (!k.endsWith('vm') || v === null || defs.tokens.get(k)?.unit !== 'deg/min') return null;
  return `${numberWords(Math.round(v / 360))} turns a minute`;
}

function Row({ k, p }: { readonly k: string; readonly p: CardProps }): ComponentChild {
  const d = p.defs.tokens.get(k);
  if (d === undefined) return null;
  const more = extra(p.defs, p.planned, k);
  return h('tr', { 'data-axis-row': k }, h('th', { scope: 'row' }, d.short), h('td', null, h(SettingControl, { k, view: p.view }), more === null ? null : h('span', { class: 'fine axis-extra' }, more)));
}

function Section({ title, keys, p, id, children }: { readonly title: string; readonly keys: readonly string[]; readonly p: CardProps; readonly id?: string; readonly children?: ComponentChild }): ComponentChild {
  return h(
    'div',
    { class: 'axis-section', ...(id === undefined ? {} : { id }) },
    h('h4', { class: 'tan-label' }, title),
    children,
    h('table', { class: 'cfg-table axis-table' }, h('tbody', null, keys.map((k) => h(Row, { key: k, k, p })))),
  );
}

function travelLength(p: CardProps): string | null {
  const a = p.c.axis;
  const tn = num(p.planned, `${a}tn`);
  const tm = num(p.planned, `${a}tm`);
  if (tn === null || tm === null || tn === tm) return null;
  const u = unitWords(p.defs.tokens.get(`${a}tn`)?.unit);
  const n = numberWords(Number(Math.abs(tm - tn).toFixed(3)));
  return `Length ${u.startsWith('°') ? `${n}${u}` : `${n} ${u}`}.`;
}

function Homing({ p }: { readonly p: CardProps }): ComponentChild {
  const a = p.c.axis;
  if (!p.defs.tokens.has(`${a}sn`)) return null;
  const keys = [`${a}sv`, `${a}lv`, `${a}lb`, `${a}zb`, `${a}jh`];
  const line = h('p', { class: 'homing-line' }, p.c.homingLine, ' ', h('a', { href: '#board-pane-inputs', 'data-action': 'open-inputs', onClick: () => { boardTab.value = 'inputs'; } }, 'Change switches on Inputs'));
  if (p.c.homingLine.startsWith('Homes towards')) return h(Section, { title: 'Homing', keys, p, id: `board-axis-${a}-homing` }, line);
  return h('div', { class: 'axis-section', id: `board-axis-${a}-homing` }, h('h4', { class: 'tan-label' }, 'Homing'), line, h('details', { class: 'axis-more' }, h('summary', null, 'Homing speeds'), h('table', { class: 'cfg-table axis-table' }, h('tbody', null, keys.map((k) => h(Row, { key: k, k, p }))))));
}

export function AxisCardView(p: CardProps): ComponentChild {
  const { c } = p;
  const a = c.axis;
  const fact = axisModeFact(p.modes, a);
  const radius = c.rotary && c.mode === 3;
  const length = travelLength(p);
  return h(
    'details',
    { class: 'board-card axis-card', 'data-axis-card': a, id: `board-axis-${a}`, open: p.open },
    h('summary', null, h('strong', null, `${a.toUpperCase()} axis`), ' ', h('span', { class: 'fine axis-summary' }, c.summary.split(' · ').slice(1).join(' · ')), c.motor === null ? null : h('span', { class: 'tag' }, `motor ${c.motor}`)),
    fact === null ? null : h('p', { class: 'note', 'data-axis': fact.axis, 'data-axis-fact': fact.code }, fact.text),
    c.modeLine === null ? null : h('p', { class: 'note info' }, c.modeLine),
    h('div', { class: 'axis-sections' },
      h(Section, { title: 'Mode', keys: radius ? [`${a}am`, `${a}ra`] : [`${a}am`], p }),
      h(Section, { title: 'Travel', keys: [`${a}tn`, `${a}tm`], p }, length === null ? null : h('p', { class: 'fine' }, length), h('p', { class: 'fine travel-line', 'data-travel-line': '' }, c.travelLine)),
      h(Section, { title: 'Speed', keys: [`${a}vm`, `${a}fr`, `${a}jm`, `${a}jd`], p }),
      h(Homing, { p }),
    ),
  );
}
