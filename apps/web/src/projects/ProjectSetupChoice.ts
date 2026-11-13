import { h, type ComponentChild } from 'preact';
import { ChoiceModal } from '../workspace/run/ChoiceModal.ts';
import { pendingSetupChoice } from './setupChoice.ts';
export function ProjectSetupChoice(): ComponentChild {
  const choice = pendingSetupChoice.value;
  if (choice === null) return null;
  return h(ChoiceModal, {
    title: 'Choose the setup',
    body: `Use the project's setup (${choice.project}) or keep this job's (${choice.job})?`,
    onDismiss: () => choice.answer('cancel'),
    // ChoiceModal focuses its last button. This planning choice defaults to the project's setup.
    choices: [
      { id: 'cancel-project-setup', label: 'Cancel', onClick: () => choice.answer('cancel') },
      { id: 'keep-job-setup', label: "Keep this job's setup", onClick: () => choice.answer('job') },
      { id: 'use-project-setup', label: "Use the project's setup", primary: true, onClick: () => choice.answer('project') },
    ],
  });
}
