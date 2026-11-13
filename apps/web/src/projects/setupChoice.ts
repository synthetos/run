/** A local planning choice; no machine command is issued here. */
import { signal } from '@preact/signals';
export type SetupChoice = 'project' | 'job' | 'cancel';
export const pendingSetupChoice = signal<{ project: string; job: string; answer: (choice: SetupChoice) => void } | null>(null);
export function chooseProjectSetup(project: string, job: string): Promise<SetupChoice> {
  pendingSetupChoice.value?.answer('cancel');
  return new Promise(resolve => {
    pendingSetupChoice.value = { project, job, answer: choice => { pendingSetupChoice.value = null; resolve(choice); } };
  });
}
