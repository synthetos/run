import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { projectStore } from '../../../projects/browserStore.ts';
import { projectsState } from '../../../projects/store.ts';
import { saveDraftToProject } from '../../fileBridge.ts';
import { jobSaved, type Job } from '../../jobModel.ts';
import { uiLevel } from '../../jobWorkflow.ts';
import { bedSizeText, jobStateText, machineText } from '../../revisionWords.ts';


/** The job's identity under the title: its name, project, machine and bed, and Save to project for the draft. */
export function JobIdentity({ job, fileOpen, onNote }: { readonly job: Job | null; readonly fileOpen: boolean; readonly onNote: (n: string | null) => void }): ComponentChild {
  const projects = projectsState.value;
  const [target, setTarget] = useState('');
  useEffect(() => {
    if (job?.projectId === null && !projects.loaded) void projectStore();
  }, [job?.projectId, projects.loaded]);
  if (job === null) return null;
  const project = job.projectId === null ? null : (projects.list.find((p) => p.id === job.projectId) ?? null);
  const bed = job.setup.bed;
  const advanced = uiLevel.value.value === 'advanced';
  return h(
    'p',
    { class: 'job-identity', 'data-job': 'identity' },
    h('span', { 'data-job': 'name' }, job.name),
    ' · ',
    job.projectId === null ? h('span', { 'data-job': 'project' }, 'local draft') : h('span', { 'data-job': 'project' }, project === null ? 'project' : project.name),
    ' · ',
    h('span', { 'data-job': 'machine' }, job.machine === null ? 'no machine' : machineText(job.machine.name, job.machine.revision, advanced)),
    ' · ',
    h('span', { 'data-job': 'bed', 'data-bed': bed.source.kind }, `bed ${bedSizeText(bed)}${advanced && bed.source.kind !== 'placeholder' && job.setup.bedFrom === 'machine' ? `, revision ${bed.revision}` : ''}`),
    ' · ',
    h('span', { 'data-job': 'state' }, jobStateText(job.revision, jobSaved.value, advanced)),
    job.projectId !== null || !fileOpen
      ? null
      : h(
        'span',
        { class: 'job-save', 'data-job': 'save' },
        h(
          'select',
          { 'aria-label': 'Project to save the draft to', value: target, 'data-job': 'save-target', onChange: (e: Event) => setTarget((e.currentTarget as HTMLSelectElement).value) },
          h('option', { value: '' }, projects.list.length === 0 ? 'No projects yet' : 'Choose a project'),
          projects.list.map((p) => h('option', { key: p.id, value: p.id }, p.name)),
        ),
        h('button', { type: 'button', class: 'small', 'data-action': 'job-save-to-project', disabled: target === '', onClick: () => void saveDraftToProject(target).then((r) => onNote(r.ok ? `Saved to the project as “${r.job.name}”.` : r.reason)) }, 'Save to project'),
      ),
  );
}
