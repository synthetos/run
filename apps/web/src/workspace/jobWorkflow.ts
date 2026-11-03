/** Navigation state only. Changing a step never commands the machine. */
import { signal } from '@preact/signals';
import { stored } from './storage.ts';

export const JOB_STEPS = [
  { id: 'machine', label: 'Machine' },
  { id: 'stock', label: 'Stock & workholding' },
  { id: 'place', label: 'Place job' },
  { id: 'check', label: 'Check' },
  { id: 'run', label: 'Run' },
] as const;
export type JobStep = typeof JOB_STEPS[number]['id'];
export const jobStep = signal<JobStep>('machine');
export type LibrarySection = 'machines' | 'tools' | 'materials';
export const librarySection = signal<LibrarySection>('machines');

/** Interface level (OD-13): Simple is the hobbyist's one-screen pane; Advanced adds the tabs. Per browser, presentation only. */
export type UiLevel = 'simple' | 'advanced';
const isUiLevel = (v: unknown): v is UiLevel => v === 'simple' || v === 'advanced';
export const uiLevel = stored<UiLevel>('ui-level', 'simple', isUiLevel);
