/**
 * Analyze → Cutting advice (docs/design/ANALYZE.md §3, slice 1). One card per CAM operation, with its plunge, ramp
 * and cut regimes under it, and the advice asking only the next question it needs: material first, then the
 * machine's spindle facts, then the operation's own inputs. A missing answer affects only the advice, never the
 * motion summary. The conservative, balanced and aggressive values are in the operation's details (Advanced), and
 * only once they exist: no table of "Unavailable".
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { GuardedEngine, LEVELS, MockAiEngine, RulesEngine, type FeedRegime, type GuardedPlan } from '@synthetos/advisor';
import type { Material } from '@synthetos/library';
import { ContextHelp } from '../../../shell/ContextHelp.ts';
import type { AdvisorRow } from '../../advisorModel.ts';
import { advisorEngine, machineFields, operationFields, setMachineField, setOperationField } from '../../advisorState.ts';
import { machineQuestion, operationQuestion, type Question } from '../../cuttingQuestions.ts';
import { selectedMachine, toolStore } from '../../library.ts';
import { lineRange, mm, plural, time, whole } from './format.ts';
import { QuestionField } from './QuestionField.ts';

const KIND_TEXT: Readonly<Record<FeedRegime['kind'], string>> = { plunge: 'Plunge', ramp: 'Ramp', cut: 'Cut' };

export function regimeText(r: FeedRegime): string {
  const feed = r.feed === null ? 'no feed set' : `${whole(r.feed)} mm/min`;
  return `${KIND_TEXT[r.kind]} · ${feed} · ${mm(r.mm)} · ${r.seconds === null ? 'not timed' : time(r.seconds)}`;
}

function Levels({ row }: { readonly row: AdvisorRow }): ComponentChild {
  const engine = advisorEngine.value;
  const [output, setOutput] = useState<{ row: AdvisorRow; engine: string; value: GuardedPlan } | null>(null);
  useEffect(() => {
    let active = true;
    if (row.context !== null) void new GuardedEngine(engine === 'rules' ? new RulesEngine() : new MockAiEngine()).plan(row.context).then((value) => { if (active) setOutput({ row, engine, value }); });
    return () => { active = false; };
  }, [row, engine]);
  const plan = output?.row === row && output.engine === engine ? output.value : null;
  if (plan === null || plan.recommendations.length === 0) return null;
  return h(
    'details',
    { class: 'analyze-levels' },
    h('summary', null, 'Compare speeds'),
    h(
      'table',
      { class: 'advisor-table', 'data-advisor': 'table' },
      h('caption', null, engine === 'rules' ? 'Rules · local' : 'Demonstration · canned example, not advice'),
      h('thead', null, h('tr', null, ['Level', 'Feed (mm/min)', 'Spindle (rpm)', 'Dial'].map((label) => h('th', { scope: 'col', key: label }, label)))),
      h('tbody', null, LEVELS.map((level) => {
        const value = plan.recommendations.find((r) => r.level === level);
        return value === undefined ? null : h('tr', { key: level }, h('th', { scope: 'row' }, level), h('td', null, whole(value.feed)), h('td', null, whole(value.rpm)), h('td', null, value.dialSetting ?? '—'));
      })),
    ),
    h('ul', { class: 'fine' }, [...new Set([...plan.recommendations.flatMap((r) => r.reasons), ...plan.refused.map((r) => r.reason)])].map((reason) => h('li', { key: reason }, reason))),
  );
}

function Advice({ row, gate, advanced }: { readonly row: AdvisorRow; readonly gate: boolean; readonly advanced: boolean }): ComponentChild {
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
      plan.provenance.placeholder ? h('p', { class: 'warn-text', 'data-advisor': 'placeholder' }, 'Placeholder data. Not advice. ', h(ContextHelp, { id: `advisor-source-${op.id}`, label: 'About placeholder inputs' }, `Not advice until sourced. Placeholder inputs: ${plan.provenance.placeholderInputs.join(', ')}.`)) : null,
      h('p', { 'data-advisor': 'verdict' }, `Rules check: ${plan.comparison?.verdict.replaceAll('-', ' ') ?? 'not available'}.`),
      advanced ? h('ul', { class: 'fine' }, plan.comparison?.reasons.map((reason) => h('li', { key: reason }, reason))) : null,
      advanced ? h(Levels, { row }) : null,
      advanced && plan.provenance.sources.length > 0 ? h('details', null, h('summary', null, 'Sources'), h('ul', null, plan.provenance.sources.map((s) => h('li', { key: s }, s)))) : null,
    );
  }
  if (field !== null) return field;
  return h('p', { class: 'warn-text', 'data-advisor': 'needs-input' }, row.problem);
}

function OperationCard({ row, gate, advanced }: { readonly row: AdvisorRow; readonly gate: boolean; readonly advanced: boolean }): ComponentChild {
  const op = row.operation;
  const s = op.summary;
  return h(
    'section',
    { class: 'analyze-op', 'data-advisor-operation': op.id },
    h('h3', null, [s.name, s.tool === null || s.name === `Tool ${s.tool}` ? null : `T${s.tool}`].filter((p) => p !== null).join(' · ')),
    h('p', { class: 'fine', 'data-advisor': 'spans' }, `${s.spans.map((x) => lineRange(x.fromLine, x.toLine)).join(', then ').replace(/, then L/g, ', then l')}. ${mm(s.feedMm)} of feed moves${s.seconds === null ? '' : `, ${time(s.seconds)}`}.`),
    op.feed === null ? null : h('p', { 'data-advisor': 'programmed' }, `Cuts at ${whole(op.feed)} mm/min${op.rpm === null ? '' : `, spindle ${whole(op.rpm)} rpm`}.`),
    h('ul', { class: 'analyze-regimes', 'data-advisor': 'regimes' }, s.regimes.map((r) => h('li', { key: `${r.kind}-${r.feed}`, 'data-regime': r.kind }, regimeText(r), r.kind === 'cut' ? null : h('small', { class: 'fine' }, ` ${plural(r.moves, 'move', 'moves')}`)))),
    h(Advice, { row, gate, advanced }),
  );
}

export interface AdviceProps {
  readonly rows: readonly AdvisorRow[];
  readonly stock: Material | null;
  readonly problem: string | null;
  readonly advanced: boolean;
}

/** The question above every operation: material, then the machine. Null when the operations can ask their own. */
export function sharedQuestion(stock: Material | null): Question | null {
  if (stock === null) return { scope: 'setup', key: 'material', label: 'Choose a material to check cutting conditions.' };
  return machineQuestion(selectedMachine.value, machineFields.value);
}

export function AdviceCard({ rows, stock, problem, advanced }: AdviceProps): ComponentChild {
  const shared = problem === null ? sharedQuestion(stock) : null;
  return h(
    'section',
    { class: 'panel analyze-card', 'data-analyze': 'advice', 'aria-labelledby': 'analyze-advice-title' },
    h('h2', { id: 'analyze-advice-title' }, 'Cutting advice'),
    h('p', { class: 'fine' }, stock === null ? 'Not checked yet.' : `Stock: ${stock.name}.`),
    stock?.safety.map((note) => h('p', { class: 'warn-text', key: note.text }, note.text)),
    problem === null ? null : h('p', { class: 'warn-text' }, problem),
    shared === null ? null : h('p', { class: 'fine' }, 'To check these speeds against the tool and the material, Run needs a few facts. One at a time:'),
    shared === null ? null : h(QuestionField, { question: shared, value: machineFields.value[shared.key] ?? '', onChange: setMachineField }),
    rows.length === 0 ? h('p', { class: 'fine' }, 'No cutting moves in this file.') : rows.map((row) => h(OperationCard, { row, gate: shared !== null || problem !== null, advanced, key: row.operation.id })),
  );
}
