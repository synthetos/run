import { librarySavedText, librarySyncView } from '../workspace/cloud/librarySync.ts';
import { accountProjects, projectDownload } from '../workspace/cloud/projectSyncState.ts';
import { AccountProject } from './AccountProject.ts';
/** Project navigation, account download prompts, and the Job files drawer. */
import { signal } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../workspace/icons.ts';
import { activeJob } from '../workspace/jobModel.ts';
import { withProjects as act, projectStore } from './browserStore.ts';
import { formatBytes } from './limits.ts';
import { projectsState, projectUsage } from './store.ts';

import { ProjectDetail } from './ProjectDetail.ts';
import { ImportProject } from './ProjectZipActions.ts';
import { DrawingImport } from './projectJobs.ts';
import { dateText, Dropzone, FileRow, Thumb, type ImportRequest } from './projectMedia.ts';
export type { ImportRequest } from './projectMedia.ts';
export { projectStore };
const selectedProjectId = signal<string | null>(null);

export function ProjectsView({ onView }: { readonly onView: (v: string) => void }): ComponentChild {
  const state = projectsState.value;
  const openId = selectedProjectId.value;
  const remote = accountProjects.value;
  const setOpenId = (id: string | null): void => { selectedProjectId.value = id; };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void projectStore();
  }, []);
  const open = state.list.find((p) => p.id === openId) ?? state.list[0] ?? null;
  const create = (): void => {
    void act((s) => s.create(`Project ${state.list.length + 1}`)).then((p) => setOpenId(p.id));
  };
  return h(
    'div',
    { class: 'projects-view' },
    h(
      'div',
      { class: 'view-head' },
      h('div', { class: 'title-block' }, h('h1', null, 'Projects'), h('p', null, state.loaded && !state.persistent ? 'This browser refused storage: projects last for this page only.' : 'Files, photos, notes and setup, kept together.')),
      h('p', { class: 'sync-line', 'data-project-saved': '', role: 'status' }, librarySavedText(state.persistent)),
      h('div', { class: 'view-actions' }, h(ImportProject, { onImported: setOpenId, disabled: !state.loaded }), h('button', { type: 'button', class: 'primary', disabled: !state.loaded, 'data-action': 'project-new', onClick: create }, Icon('plus', 16), 'New project')),
    ),
    h(
      'div',
      { class: 'projects-layout' },
      h(
        'nav',
        { class: 'project-list-panel', 'aria-label': 'Projects' },
        h('div', { class: 'project-list-head' }, h('strong', null, state.list.length === 0 ? 'No projects' : `${state.list.length} ${state.list.length === 1 ? 'project' : 'projects'}`), h('span', { class: 'fine' }, librarySyncView.value.mode === 'account' ? 'Your projects' : 'In this browser')),
        state.list.length === 0
          ? h('div', { class: 'project-empty' }, h('strong', null, state.loaded ? 'Start a project' : 'Loading projects…'), 'Keep the G-code, photos, notes and the setup of a job together, so next time you know exactly how it was cut.')
          : h(
              'div',
              { class: 'project-list' },
              state.list.map((p) =>
                h(
                  'button',
                  { type: 'button', key: p.id, class: 'project-row', 'aria-current': open?.id === p.id ? 'true' : undefined, 'data-project-row': p.name, onClick: () => { setOpenId(p.id); if (remote.includes(p.id)) void projectDownload.open(p.id).catch(() => undefined); } },
                  h(Thumb, { project: p }),
                  h('span', null, h('strong', null, p.name), h('small', null, remote.includes(p.id) ? 'In your account, not downloaded' : `${p.files.length} ${p.files.length === 1 ? 'file' : 'files'} · ${formatBytes(projectUsage(p))} · ${dateText(p.updatedAt)}`)),
                ),
              ),
            ),
      ),
      open === null
        ? h('div', { class: 'panel empty-panel project-detail-empty' }, h('h2', null, 'No project open'), h('p', null, 'Create a project and add files or photos. Saved in this browser.'))
        : remote.includes(open.id) ? h(AccountProject, { key: open.id, project: open }) : h(ProjectDetail, { key: open.id, project: open, onView, onDeleted: () => setOpenId(null) }),
    ),
  );
}

/** Browse project files even when the current job is a demo or an empty draft. */
export function JobFiles({ onView }: { readonly onView: (view: string) => void }): ComponentChild {
  const [importing, setImporting] = useState<ImportRequest | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [browseId, setBrowseId] = useState<string | null>(null);
  const job = activeJob.value;
  const projects = projectsState.value.list;
  const project = projects.find((p) => p.id === browseId) ?? projects.find((p) => p.id === job?.projectId) ?? projects.find((p) => p.id === selectedProjectId.value) ?? projects[0] ?? null;
  useEffect(() => { void projectStore(); }, []);
  useEffect(() => { setBrowseId(null); }, [job?.id]);
  useEffect(() => { setImporting(null); setNote(null); }, [job?.id, project?.id]);
  return h('section', { class: 'job-files-content' }, h('h2', null, 'Project files'),
    project === null ? h('p', null, 'Create a project to add G-code, drawings and reference files.') : [
      h('label', { class: 'field' }, h('span', null, 'Project'), h('select', { 'aria-label': 'Project files', value: project.id, onChange: (e: Event) => setBrowseId((e.currentTarget as HTMLSelectElement).value) }, projects.map((p) => h('option', { key: p.id, value: p.id }, p.name)))),
      h(Dropzone, { project, onResult: (added, refused) => setNote([...added.map((n) => `Added ${n}`), ...refused].join('; ')) }),
      h('ul', { class: 'file-list' }, project.files.map((file) => h(FileRow, { key: file.id, project, file, onView, onImport: setImporting, openLabel: 'Open as the job' }))),
    ],
    importing === null ? null : h(DrawingImport, { key: `${importing.file.id}:${importing.role}`, request: importing, onDone: (text) => { setImporting(null); setNote(text); } }),
    note === null ? null : h('p', { role: 'status' }, note),
    h('button', { type: 'button', class: 'small', 'data-action': 'job-projects', onClick: () => { if (project !== null) selectedProjectId.value = project.id; onView('projects'); } }, project === null ? 'Create or open a project' : 'Open project details'));
}
