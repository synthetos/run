/**
 * One cutting-advice question (cuttingQuestions.ts): a select, a number field, or a link to where the answer lives
 * (Setup for the material, Machines for the machine or the tool library). Display only.
 */
import { h, type ComponentChild } from 'preact';
import { viewRequest } from '../../boardNavigation.ts';
import type { Question } from '../../cuttingQuestions.ts';

const GO: Readonly<Record<string, readonly [string, string]>> = {
  setup: ['setup', 'Open Setup'],
  machines: ['machines', 'Open Machines'],
};

export function QuestionField({ question, value, onChange }: { readonly question: Question; readonly value: string; readonly onChange: (key: string, value: string) => void }): ComponentChild {
  const go = GO[question.scope];
  if (go !== undefined) {
    const target = question.key === 'tool-library' ? 'tools' : go[0];
    return h('p', { class: 'analyze-question', 'data-advisor': 'question', 'data-question': question.key }, h('span', null, question.label), ' ', h('button', { type: 'button', class: 'small', 'data-action': `open-${target}`, onClick: () => { viewRequest.value = target; } }, question.key === 'tool-library' ? 'Open Tools' : go[1]));
  }
  const update = (e: Event): void => onChange(question.key, (e.currentTarget as HTMLInputElement | HTMLSelectElement).value);
  const props = { 'data-action': 'advisor-input', 'data-advisor-field': question.key, value, id: `advisor-${question.scope}-${question.key}` };
  return h(
    'div',
    { class: 'analyze-question', 'data-advisor': 'question', 'data-question': question.key },
    h('label', { for: props.id }, question.label),
    question.options === undefined
      ? h('input', { ...props, type: question.key === 'dial' ? 'text' : 'number', inputmode: question.key === 'dial' ? 'text' : 'decimal', min: '0', step: 'any', onChange: update })
      : h('select', { ...props, onChange: update }, h('option', { value: '' }, 'Choose…'), question.options.map(([v, text]) => h('option', { value: v, key: v }, text))),
    question.hint === undefined ? null : h('small', { class: 'fine' }, question.hint),
  );
}
