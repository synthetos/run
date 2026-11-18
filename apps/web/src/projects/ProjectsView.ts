import { librarySavedText, librarySyncView } from '../workspace/cloud/librarySync.ts';
import { accountProjects, projectDownload } from '../workspace/cloud/projectSyncState.ts';
import { AccountProject } from './AccountProject.ts';
/** Project navigation and account download prompts. */
import { signal } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from '../workspace/icons.ts';
import { withProjects as act, projectStore } from './browserStore.ts';
import { formatBytes } from './limits.ts';
import { projectsState, projectUsage } from './store.ts';

import { ProjectDetail } from './ProjectDetail.ts';
import { ImportProject } from './ProjectZipActions.ts';
import { dateText, Thumb } from './projectMedia.ts';
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
        ? h('div', { class: 'panel empty-panel project-detail-empty' }, h('h2', null, 'No project open'), h('p', null, 'Create a project and add files or photos.'))
        : remote.includes(open.id) ? h(AccountProject, { key: open.id, project: open }) : h(ProjectDetail, { key: open.id, project: open, onView, onDeleted: () => setOpenId(null) }),
    ),
  );
}

