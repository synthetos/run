/**
 * Analyze → Operations (docs/design/ANALYZE.md §3, slice 1): one card per CAM operation, named as the file names it,
 * with its tool from the tool table, its plunge and cut feeds, and the cutting check, which asks one question at a
 * time (material, then the machine's spindle facts, then the operation's own inputs). A missing answer affects only
 * the check, never the time or the findings. The speed comparison sits in Advanced, from the built-in rules only.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { GuardedEngine, LEVELS, RulesEngine, type FeedRegime, type GuardedPlan } from '@synthetos/advisor';
import type { Material } from '@synthetos/library';
import { ContextHelp } from '../../../shell/ContextHelp.ts';
import type { AdvisorRow } from '../../advisorModel.ts';
import { machineFields, operationFields, setMachineField, setOperationField } from '../../advisorState.ts';
import { viewRequest } from '../../boardNavigation.ts';
import { machineQuestion, operationQuestion, type Question } from '../../cuttingQuestions.ts';
import { selectedMachine, toolStore, type ToolEntry } from '../../library.ts';
import { lineRange, mm, plural, time, whole } from './format.ts';
import { QuestionField } from './QuestionField.ts';

const KIND_TEXT: Readonly<Record<FeedRegime['kind'], string>> = { plunge: 'Plunges', ramp: 'Ramps', cut: 'Cuts' };

export function regimeText(r: FeedRegime): string {
  const feed = r.feed === null ? 'no feed set' : `${whole(r.feed)} mm/min`;
  return `${KIND_TEXT[r.kind]} at ${feed}: ${mm(r.mm)}, ${r.seconds === null ? 'not timed' : time(r.seconds)}${r.kind === 'cut' ? '' : `, ${plural(r.moves, 'move', 'moves')}`}.`;
}

/** "T1 · 6 mm flat end mill", or "T1 · not in your tool table", or null with no tool. */
export function toolLabel(tool: number | null, tools: readonly ToolEntry[]): string | null {
  if (tool === null) return null;
  const entry = tools.find((t) => t.number === tool);
  return entry === undefined ? `T${tool} · not in your tool table` : `T${tool} · ${entry.tool.name}`;
}

function Levels({ row }: { readonly row: AdvisorRow }): ComponentChild {
  const [output, setOutput] = useState<{ row: AdvisorRow; value: GuardedPlan } | null>(null);
  useEffect(() => {
    let active = true;
    if (row.context !== null) void new GuardedEngine(new RulesEngine()).plan(row.context).then((value) => { if (active) setOutput({ row, value }); });
    return () => { active = false; };
  }, [row]);
  const plan = output?.row === row ? output.value : null;
  if (plan === null || plan.recommendations.length === 0) return null;
  return h(
    'details',
    { class: 'analyze-levels' },
    h('summary', null, 'Compare speeds'),
    h(
      'table',
      { class: 'advisor-table', 'data-advisor': 'table' },
      h('caption', { class: 'fine' }, 'From the built-in rules. Check them against your tool maker’s data.'),
      h('thead', null, h('tr', null, ['Level', 'Feed (mm/min)', 'Spindle (rpm)', 'Dial'].map((label) => h('th', { scope: 'col', key: label }, label)))),
      h('tbody', null, LEVELS.map((level) => {
        const value = plan.recommendations.find((r) => r.level === level);
        return value === undefined ? null : h('tr', { key: level }, h('th', { scope: 'row' }, level), h('td', null, whole(value.feed)), h('td', null, whole(value.rpm)), h('td', null, value.dialSetting ?? '—'));
      })),
    ),
  );
}

function Check({ row, gate, advanced }: { readonly row: AdvisorRow; readonly gate: boolean; readonly advanced: boolean }): ComponentChild {
  const op = row.operation;
  const question = operationQuestion(op.tool, operationFields(op.id), toolStore.value.value);
  const field = question === null ? null : h(QuestionField, { question, value: operationFields(op.id)[question.key] ?? '', onChange: (k, v) => setOperationField(op.id, k, v) });
  // The tool in the spindle is asked at once: the preview carves with it too (preview/carveTools.ts).
  if (gate) return question?.key === 'tool' ? field : null;
  const plan = row.plan;
  if (plan?.ok === true) {
    return h(
      'div',
      { class: 'analyze-advice', 'data-advisor': 'advice' },
      h('p', { 'data-advisor': 'verdict' }, `Cutting check: ${plan.comparison?.verdict.replaceAll('-', ' ') ?? 'not available'}.`),
      plan.provenance.placeholder ? h('p', { class: 'warn-text', 'data-advisor': 'placeholder' }, 'From placeholder data. Not advice yet. ', h(ContextHelp, { id: `advisor-source-${op.id}`, label: 'About placeholder inputs' }, `Not advice until sourced. Placeholder inputs: ${plan.provenance.placeholderInputs.join(', ')}.`)) : null,
      advanced ? h('ul', { class: 'fine' }, plan.comparison?.reasons.map((reason) => h('li', { key: reason }, reason))) : null,
      advanced ? h(Levels, { row }) : null,
    );
  }
  if (field !== null) return field;
  return h('p', { class: 'warn-text', 'data-advisor': 'needs-input' }, row.problem);
}

function OperationCard({ row, gate, advanced }: { readonly row: AdvisorRow; readonly gate: boolean; readonly advanced: boolean }): ComponentChild {
  const op = row.operation;
  const s = op.summary;
  const tool = toolLabel(s.tool, toolStore.value.value);
  const derived = s.tool !== null && s.name === `Tool ${s.tool}`;
  const missingTool = s.tool !== null && !toolStore.value.value.some((t) => t.number === s.tool);
  return h(
    'li',
    { class: 'analyze-op', 'data-advisor-operation': op.id },
    h('h3', null, derived ? tool : s.name),
    !derived && tool !== null ? h('p', { class: 'analyze-op-tool' }, tool, missingTool ? h('button', { type: 'button', class: 'small quiet', 'data-action': 'open-tools', onClick: () => { viewRequest.value = 'tools'; } }, 'Add it') : null) : null,
    derived && missingTool ? h('p', null, h('button', { type: 'button', class: 'small quiet', 'data-action': 'open-tools', onClick: () => { viewRequest.value = 'tools'; } }, 'Add it to the tool table')) : null,
    h('p', { class: 'fine', 'data-advisor': 'spans' }, `${s.spans.map((x) => lineRange(x.fromLine, x.toLine)).join(', then ').replace(/, then L/g, ', then l')}. ${s.seconds === null ? '' : `At least ${time(s.seconds)}.`}`),
    h('ul', { class: 'analyze-regimes rows', 'data-advisor': 'regimes' }, s.regimes.map((r) => h('li', { key: `${r.kind}-${r.feed}`, 'data-regime': r.kind }, regimeText(r)))),
    op.rpm === null ? null : h('p', { class: 'fine' }, `Spindle ${whole(op.rpm)} rpm.`),
    h(Check, { row, gate, advanced }),
  );
}

/** The question above every operation: material, then the machine. Null when the operations can ask their own. */
export function sharedQuestion(stock: Material | null): Question | null {
  if (stock === null) return { scope: 'setup', key: 'material', label: 'Choose a material to check cutting conditions.' };
  return machineQuestion(selectedMachine.value, machineFields.value);
}

export interface OperationsProps {
  readonly rows: readonly AdvisorRow[];
  readonly stock: Material | null;
  readonly problem: string | null;
  readonly advanced: boolean;
}

export function OperationsCard({ rows, stock, problem, advanced }: OperationsProps): ComponentChild {
  const shared = problem === null ? sharedQuestion(stock) : null;
  return h(
    'section',
    { class: 'panel analyze-ops', 'data-analyze': 'advice', 'aria-labelledby': 'analyze-ops-title' },
    h('div', { class: 'analyze-ops-head' },
      h('h2', { id: 'analyze-ops-title' }, `Operations${rows.length === 0 ? '' : ` (${rows.length})`}`),
      h('p', { class: 'fine' }, stock === null ? 'No material chosen.' : `Material: ${stock.name}.`),
      stock?.safety.map((note) => h('p', { class: 'warn-text', key: note.text }, note.text)),
      problem === null ? null : h('p', { class: 'warn-text' }, problem),
      shared === null ? null : h('p', { class: 'fine' }, 'To check the cutting speeds, Run needs a few facts. One at a time:'),
      shared === null ? null : h(QuestionField, { question: shared, value: machineFields.value[shared.key] ?? '', onChange: setMachineField }),
    ),
    rows.length === 0 ? h('p', { class: 'fine' }, 'No cutting moves in this file.') : h('ul', { class: 'analyze-op-list' }, rows.map((row) => h(OperationCard, { row, gate: shared !== null || problem !== null, advanced, key: row.operation.id }))),
  );
}
