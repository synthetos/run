/**
 * Step 6 (spec §6.3): two pick cards, the demo name plate or a new project by name (R10). The mount creates it
 * (createDemo.ts) when the primary is pressed; the view is pure and keeps its state in module signals.
 */
import { signal } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import { PickCard } from '../PickCard.ts';

export const PROJECT_TITLE = 'First project';
export const PROJECT_LEAD = 'Start from the demo or from your own files.';
export const CREATE_LABEL = 'Create project';
export type ProjectChoice = 'demo' | 'new';

export const projectChoice = signal<ProjectChoice>('demo');
export const projectName = signal('');
export const projectError = signal<string | null>(null);
export const projectBusy = signal(false);

const CARDS: readonly { readonly value: ProjectChoice; readonly title: string; readonly text: string }[] = [
  { value: 'demo', title: 'Demo project', text: 'Name plate, 60 × 30 mm pocket and text. File, tool and stock already set. Good for a first dry run.' },
  { value: 'new', title: 'New project', text: 'Name it, then add your own G-code files. You can drop files in later too.' },
];

export interface FirstProjectProps {
  readonly choice: ProjectChoice;
  readonly onChoice: (c: ProjectChoice) => void;
  readonly name: string;
  readonly onName: (n: string) => void;
  readonly error: string | null;
}

export function FirstProject(p: FirstProjectProps): ComponentChild {
  return h(
    'div',
    { class: 'wizard-project' },
    CARDS.map((c) =>
      h(
        PickCard,
        { key: c.value, name: 'wizard-project', value: c.value, title: c.title, text: c.text, checked: p.choice === c.value, onChange: () => p.onChoice(c.value) },
        c.value === 'new' && p.choice === 'new'
          ? h('span', { class: 'wizard-field wizard-name' }, h('span', null, 'Project name'), h('input', { value: p.name, maxLength: 80, 'data-wizard': 'project-name', onInput: (e: Event) => p.onName((e.currentTarget as HTMLInputElement).value) }))
          : null,
      ),
    ),
    p.error === null ? null : h('p', { class: 'wizard-line', role: 'alert' }, p.error),
  );
}
