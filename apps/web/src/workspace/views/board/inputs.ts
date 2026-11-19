/**
 * The Inputs tab (Board settings spec §5.4, mockup 2026-11-18-board-config-inputs): switch contact once at the top,
 * one row per input with every mode by meaning (the data's `inputs` and value lists), and the homing summary with
 * one line per consequence, each axis linking to its Homing section on Axes. Every control is a `SettingControl`:
 * pending changes collect for Review and apply; a read-only board shows them locked.
 *
 * Test switches (live input state) is not built yet: it waits for the safety review and bench checks BC-1 to BC-4.
 * The seam is the optional `states` prop (input-state token → value, e.g. `{ in1: 0 }`): when given, a Now column
 * shows Pressed, Released or Off. Nothing here reads the inputs.
 */
import { h, type ComponentChild } from 'preact';
import { changeRisk, type SettingsFile } from '@synthetos/schema';
import { connectorPins, draftStore, settingMeta, settingsOf } from '../../boardFacts.ts';
import { boardTab } from '../../boardNavigation.ts';
import type { LiveView } from '../../model.ts';
import { Dismissable } from '../../notes/Dismissable.ts';
import { defsFor } from '../../settings/defs.ts';
import { SettingControl } from '../../settings/SettingControl.ts';
import { homingSummary, inputConsequences, inputRows, type InputRow } from './inputsModel.ts';
import { Empty, type Settings } from './shared.ts';

type States = Readonly<Record<string, number>>;

const STATE_WORDS: Readonly<Record<NonNullable<InputRow['state']>, string>> = { pressed: 'Pressed', released: 'Released', off: 'Off' };

/** The current value's help sentence from the data, if it has one. */
function valueHelp(key: string, view: LiveView | null): string | null {
  const meta = settingMeta(key, view?.readout.dialectId ?? null);
  const v = draftStore.value.value[key] ?? view?.readout.settings[key];
  return meta.values?.find((x) => x.value === v)?.help ?? null;
}

function ContactRow({ label, k, view }: { readonly label: string; readonly k: string; readonly view: LiveView | null }): ComponentChild {
  const help = valueHelp(k, view);
  return h('div', { class: 'contact-row' }, h('span', { class: 'contact-label' }, label), h(SettingControl, { k, view }), help === null ? null : h('span', { class: 'fine' }, help));
}

function ContactSection({ view, defs }: { readonly view: LiveView | null; readonly defs: SettingsFile }): ComponentChild {
  const probe = defs.probeContact;
  return h(
    'section',
    { class: 'cfg-section board-card', 'data-region': 'switch-contact' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'tan-label' }, 'Switch contact'), h('span', { class: 'fine' }, 'One setting for every switch input.')),
    h(ContactRow, { label: 'Limit and homing switches', k: 'st', view }),
    probe?.token !== undefined
      ? h(ContactRow, { label: 'Probe input', k: probe.token, view })
      : probe?.fixed !== undefined
        ? h('div', { class: 'contact-row' }, h('span', { class: 'contact-label' }, 'Probe input'), h('span', { 'data-probe-contact': '' }, probe.fixed))
        : null,
  );
}

function InputRowView({ r, view, live }: { readonly r: InputRow; readonly view: LiveView | null; readonly live: boolean }): ComponentChild {
  const risk = r.pending && r.planned !== null ? changeRisk(view?.readout.dialectId ?? '', r.functionKey, r.board ?? undefined, r.planned) : null;
  return h(
    'tr',
    { key: r.id, class: r.pending ? 'drafted' : undefined },
    h('th', { scope: 'row' }, h('strong', null, r.label), ' ', h('small', { class: 'pin-ref' }, r.pin)),
    live ? h('td', { 'data-input-state': r.id }, r.state === null ? 'Not read' : STATE_WORDS[r.state]) : null,
    h('td', null, h(SettingControl, { k: r.functionKey, view })),
    h('td', null, risk?.highRisk === true ? h('span', { class: 'tag danger' }, 'High risk') : null),
  );
}

function InputTable({ view, rows, live }: { readonly view: LiveView | null; readonly rows: readonly InputRow[]; readonly live: boolean }): ComponentChild {
  const head = ['Input', ...(live ? ['Now'] : []), 'What it does', ''];
  return h(
    'section',
    { class: 'cfg-section board-card', 'data-region': 'switch-inputs' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'tan-label' }, 'Switch inputs')),
    h('table', { class: 'cfg-table inputs-table' }, h('thead', null, h('tr', null, ...head.map((t) => h('th', { scope: 'col', key: t }, t)))), h('tbody', null, rows.map((r) => h(InputRowView, { key: r.id, r, view, live })))),
    h(Dismissable, { id: 'board/inputs-pullups', label: 'the inputs note', inNotes: false }, h('p', { class: 'fine' }, 'Inputs have 2.7 kΩ pull-ups to 3.3 V.')),
  );
}

function inputAxes(defs: SettingsFile): string[] {
  return [...new Set(defs.inputs.map((i) => /^([a-z])s[nx]$/.exec(i.function)?.[1]).filter((a): a is string => a !== undefined))];
}

function HomingSection({ defs, settings, planned, pending }: { readonly defs: SettingsFile; readonly settings: Settings; readonly planned: Settings; readonly pending: boolean }): ComponentChild {
  const lines = inputConsequences(defs, settings, planned);
  return h(
    'section',
    { class: 'cfg-section board-card', 'data-region': 'homing-summary' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'tan-label' }, pending ? 'Homing, with the pending changes' : 'Homing')),
    h(
      'div',
      { class: 'chips' },
      homingSummary(defs, planned, inputAxes(defs)).map((x) =>
        h('a', { key: x.axis, class: 'chip', href: `#board-axis-${x.axis}-homing`, 'data-axis-link': x.axis, title: 'Homing speeds and backoffs are on Axes', onClick: () => { boardTab.value = 'axes'; } }, x.text),
      ),
    ),
    lines.length === 0 ? null : h('div', { class: 'consequences', 'data-region': 'input-consequences' }, lines.map((l) => h('p', { key: l, class: 'note' }, l))),
  );
}

/** A dialect without a settings file: the board's switch inputs with their raw values, nothing editable. */
function RawInputs({ view }: { readonly view: LiveView | null }): ComponentChild {
  const pins = [...connectorPins('J7'), ...connectorPins('J8')].filter((p) => p.role === 'input');
  return h(
    'section',
    { class: 'cfg-section board-card' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'tan-label' }, 'No definition yet'), h('span', { class: 'fine' }, 'Reported by the board. Run has no description for these, so they are shown as read and never changed.')),
    h('table', { class: 'cfg-table' }, h('tbody', null, pins.map((p) => h('tr', { key: p.ref }, h('th', { scope: 'row' }, h('strong', null, p.label), ' ', h('small', { class: 'pin-ref' }, p.ref)), h('td', null, h(SettingControl, { k: p.keys[0] as string, view })))))),
  );
}

export function InputsTab({ view, states }: { readonly view: LiveView | null; readonly states?: States }): ComponentChild {
  const settings = settingsOf(view);
  if (Object.keys(settings).length === 0) return h('div', { class: 'scroll-region' }, h(Empty, { view }));
  const defs = defsFor(view);
  if (defs === null) return h('div', { tabindex: 0, class: 'scroll-region cfg-scroll' }, h(RawInputs, { view }));
  const drafts = draftStore.value.value;
  const rows = inputRows(defs, settings, drafts, states);
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll inputs-tab' },
    h(ContactSection, { view, defs }),
    h(InputTable, { view, rows, live: states !== undefined }),
    h(HomingSection, { defs, settings, planned: { ...settings, ...drafts }, pending: rows.some((r) => r.pending) }),
  );
}
