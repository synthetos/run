import { ContextHelp } from '../../shell/ContextHelp.ts';
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { GuardedEngine, LEVELS, MockAiEngine, RulesEngine, type GuardedPlan } from '@synthetos/advisor';
import type { AdvisorFields, AdvisorRow } from '../advisorModel.ts';
import { advisorEngine, advisorOperations, advisorProfiles, advisorRows, advisorStock, machineFields, operationFields, setMachineField, setOperationField } from '../advisorState.ts';
import { currentFile } from '../fileBridge.ts';
import { selectedMachine, toolStore } from '../library.ts';

const number = (v: number | null): string => v === null ? 'Not specified' : Math.round(v).toLocaleString('en-US');
type Change = (key: string, value: string) => void;
function field(label: string, key: string, values: AdvisorFields, change: Change, options?: readonly (readonly [string, string])[]): ComponentChild {
  const update = (e: Event): void => change(key, (e.currentTarget as HTMLInputElement).value);
  const props = { 'data-action': 'advisor-input', 'data-advisor-field': key, value: values[key] ?? '' };
  return h('label', null, h('span', null, label), options === undefined
    ? h('input', { ...props, onInput: update, type: key === 'dial' ? 'text' : 'number', ...(key === 'dial' ? { placeholder: '1=10000, 2=12000' } : { min: '0', step: 'any' }) })
    : h('select', { ...props, onChange: update }, h('option', { value: '' }, 'Choose…'), options.map(([value, text]) => h('option', { value, key: value }, text))));
}

function MachineInputs(): ComponentChild {
  const profile = selectedMachine.value;
  if (profile === null) return h('p', { class: 'fine' }, 'Select a machine in Machines to enter its cutting limits.');
  const fields = machineFields.value;
  return h('details', { class: 'panel', open: true },
    h('summary', null, `Machine inputs · ${profile.name}`),
    h('p', { class: 'fine' }, `Profile drive: ${profile.drive === 'any' ? 'unspecified' : profile.drive}. Spindle: ${profile.spindle || 'unspecified'}. Supplementary inputs below are saved for this profile; they do not change board settings.`),
    h('div', { class: 'advisor-fields' },
      field('Frame class', 'frame', fields, setMachineField, [['hobby', 'Hobby'], ['medium', 'Medium'], ['rigid', 'Rigid']]),
      field('Spindle control', 'spindle', fields, setMachineField, [['dial-router', 'Router dial'], ['pwm', 'PWM'], ['vfd', 'VFD']]),
      field('Minimum rpm', 'minRpm', fields, setMachineField), field('Maximum rpm', 'maxRpm', fields, setMachineField), field('Rated power (kW)', 'powerKw', fields, setMachineField),
      profile.axes?.x?.maxFeed !== undefined && profile.axes.y?.maxFeed !== undefined
        ? h('p', null, `Profile XY maximum: ${number(Math.min(profile.axes.x.maxFeed, profile.axes.y.maxFeed))} mm/min`)
        : field('Maximum XY feed (mm/min)', 'xy', fields, setMachineField),
      profile.axes?.z?.maxFeed !== undefined ? h('p', null, `Profile Z maximum: ${number(profile.axes.z.maxFeed)} mm/min`) : field('Maximum Z feed (mm/min)', 'z', fields, setMachineField),
      fields['spindle'] === 'dial-router' ? field('Dial table (setting=rpm)', 'dial', fields, setMachineField) : null,
      field('Acceleration (mm/s²), optional', 'accel', fields, setMachineField), field('Junction deviation (mm), optional', 'junction', fields, setMachineField)),
    h('p', { class: 'fine' }, 'Acceleration and junction deviation enable the feed estimate. Use measured or documented values; the estimate assumes each continuous cut starts and ends at rest.'),
    !advisorProfiles.saved.value ? h('p', { class: 'warn-text' }, 'Storage unavailable: these inputs last for this page only.') : null);
}

function Operation({ row }: { readonly row: AdvisorRow }): ComponentChild {
  const op = row.operation;
  const fields = operationFields(op.id);
  const change: Change = (key, value) => setOperationField(op.id, key, value);
  const engine = advisorEngine.value;
  const [output, setOutput] = useState<{ row: AdvisorRow; engine: string; value: GuardedPlan } | null>(null);
  useEffect(() => {
    let active = true;
    if (row.context !== null) void new GuardedEngine(engine === 'rules' ? new RulesEngine() : new MockAiEngine()).plan(row.context).then((value) => {
      if (active) setOutput({ row, engine, value });
    });
    return () => { active = false; };
  }, [row, engine]);
  const recommendations = output?.row === row && output.engine === engine ? output.value : null;
  const plan = row.plan;
  return h('section', { class: 'panel advisor-operation', 'data-advisor-operation': op.id },
    h('h2', null, `${op.name} · line ${op.line}${op.tool === null ? '' : ` · T${op.tool}`}`),
    h('p', null, `File programmed: ${number(op.feed)} mm/min · ${number(op.rpm)} rpm (commanded)`),
    h('details', { open: row.problem !== null }, h('summary', null, 'Cutting inputs'),
      h('p', { class: 'fine' }, 'Confirm depth and stepover from CAM. File bounds do not establish cutting engagement.'),
      h('div', { class: 'advisor-fields' },
        op.tool === null ? field('Tool already in the spindle', 'tool', fields, change, toolStore.value.value.map((t) => [String(t.number), `T${t.number} · ${t.tool.name}`])) : null,
        field('Operation', 'kind', fields, change, [['slot', 'Slot'], ['pocket', 'Pocket'], ['adaptive', 'Adaptive'], ['profile', 'Profile'], ['finish', 'Finish'], ['drill', 'Drill'], ['v-carve', 'V-carve']]),
        field('Depth of cut (mm)', 'ap', fields, change), field('Stepover (mm)', 'ae', fields, change),
        field('Coolant', 'coolant', fields, change, [['none', 'None'], ['air', 'Air'], ['mist', 'Mist'], ['flood', 'Flood']]))),
    row.problem === null ? null : h('p', { class: 'warn-text', 'data-advisor': 'needs-input' }, row.problem),
    plan?.ok === true ? h('div', null,
      plan.provenance.placeholder ? h('p', { class: 'warn-text', 'data-advisor': 'placeholder' }, 'Placeholder data · not advice ', h(ContextHelp, { id: `advisor-source-${op.id}`, label: 'About placeholder inputs' }, `Not advice until sourced. Placeholder inputs: ${plan.provenance.placeholderInputs.join(', ')}.`)) : null,
      h('p', { 'data-advisor': 'verdict' }, `Rules comparison: ${plan.comparison?.verdict.replaceAll('-', ' ') ?? 'not available'}`),
      h('ul', null, plan.comparison?.reasons.map((reason) => h('li', { key: reason }, reason))),
      h('p', { class: 'fine', 'data-advisor': 'achievable' }, row.achievable === null ? 'Achievable feed estimate unavailable: supply motion inputs and a full, certain preview path (up to 10,000 vertices).' : `Achievable feed: about ${number(row.achievable)} mm/min (estimate; continuous cuts start and end at rest).`),
      plan.provenance.sources.length === 0 ? null : h('details', null, h('summary', null, 'Sources'), h('ul', null, plan.provenance.sources.map((source) => h('li', { key: source }, source)))),
      ...plan.notes.map((note) => h('p', { key: note, class: 'fine' }, note))) : null,
    h('table', { class: 'advisor-table', 'data-advisor': 'table' },
      h('caption', null, engine === 'rules' ? 'Rules · local' : 'AI assistant (preview) · canned example, not advice'),
      h('thead', null, h('tr', null, ['Level', 'Feed (mm/min)', 'Spindle (rpm)', 'Dial'].map((label) => h('th', { scope: 'col', key: label }, label)))),
      h('tbody', null, LEVELS.map((level) => {
        const value = recommendations?.recommendations.find((r) => r.level === level);
        return h('tr', { key: level }, h('th', { scope: 'row' }, level), h('td', null, value === undefined ? 'Unavailable' : number(value.feed)), h('td', null, value === undefined ? 'Unavailable' : number(value.rpm)), h('td', null, value?.dialSetting ?? 'Not applicable'));
      }))),
    recommendations === null ? null : h('details', null, h('summary', null, 'Why these values'), h('ul', { class: 'fine' }, [...new Set([...recommendations.recommendations.flatMap((r) => r.reasons), ...recommendations.refused.map((r) => r.reason)])].map((reason) => h('li', { key: reason }, reason)))));
}

export function AnalyzeView(): ComponentChild {
  const file = currentFile.value;
  const stock = advisorStock.value;
  return h('div', { class: 'analyze-view' },
    h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, 'Analyze'), h('p', null, file?.name ?? 'Open a file in Run.'))),
    h('div', { class: 'scroll-region', tabindex: 0 },
      h('div', { class: 'panel' },
        h('label', null, 'Engine ', h('select', { 'data-action': 'advisor-engine', value: advisorEngine.value, onChange: (e: Event) => { advisorEngine.value = (e.currentTarget as HTMLSelectElement).value === 'mock-ai' ? 'mock-ai' : 'rules'; } }, h('option', { value: 'rules' }, 'Rules · local'), h('option', { value: 'mock-ai' }, 'AI assistant (preview)'))),
        h(ContextHelp, { id: 'advisor-help', label: 'About the analysis', below: true }, 'Review only; no changes to the file, machine or Start checks. AI preview calls no model. Geometry uses the preview’s assumed start at machine zero.'),
        h('p', null, `Stock: ${stock?.name ?? 'choose a material in Setup'}`),
        stock?.safety.map((note) => h('p', { class: 'warn-text', key: note.text }, note.text))),
      h(MachineInputs, null),
      advisorOperations.value.problem === null ? null : h('p', { class: 'warn-text' }, advisorOperations.value.problem),
      advisorRows.value.length === 0 ? h('p', { class: 'fine' }, 'No cutting operations available. Load a file in Run.') : advisorRows.value.map((row) => h(Operation, { row, key: row.operation.id }))));
}
