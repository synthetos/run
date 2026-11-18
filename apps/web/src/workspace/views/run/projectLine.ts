import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { projectStore } from '../../../projects/browserStore.ts';
import { projectsState } from '../../../projects/store.ts';
import { saveDraftToProject } from '../../fileBridge.ts';
import { type Job } from '../../jobModel.ts';

/** Under the job's file: the project it belongs to, or Save to project for a draft with a file open. */
export function JobProjectLine({ job, fileOpen, onNote }: { readonly job: Job | null; readonly fileOpen: boolean; readonly onNote: (n: string | null) => void }): ComponentChild {
  const projects = projectsState.value;
  const [target, setTarget] = useState('');
  useEffect(() => {
    if (job?.projectId === null && !projects.loaded) void projectStore();
  }, [job?.projectId, projects.loaded]);
  if (job === null) return null;
  if (job.projectId !== null) {
    const project = projects.list.find((p) => p.id === job.projectId) ?? null;
    return h('p', { class: 'fine job-project' }, 'In project ', h('span', { 'data-job': 'project' }, project === null ? 'project' : project.name));
  }
  if (!fileOpen) return null;
  return h(
    'p',
    { class: 'job-save', 'data-job': 'save' },
    h(
      'select',
      { 'aria-label': 'Project to save the draft to', value: target, 'data-job': 'save-target', onChange: (e: Event) => setTarget((e.currentTarget as HTMLSelectElement).value) },
      h('option', { value: '' }, projects.list.length === 0 ? 'No projects yet' : 'Choose a project'),
      projects.list.map((p) => h('option', { key: p.id, value: p.id }, p.name)),
    ),
    h('button', { type: 'button', class: 'small', 'data-action': 'job-save-to-project', disabled: target === '', onClick: () => void saveDraftToProject(target).then((r) => onNote(r.ok ? `Saved to the project as “${r.job.name}”.` : r.reason)) }, 'Save to project'),
  );
}
