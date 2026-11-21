/** Project header, editing actions, files and setup sections. */
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ContextHelp } from '../shell/ContextHelp.ts';
import { executionLock, openProjectFile } from '../workspace/fileBridge.ts';
import { Icon } from '../workspace/icons.ts';
import { activeJob } from '../workspace/jobModel.ts';
import { withProjects as act } from './browserStore.ts';
import { isGcodeFile } from './limits.ts';
import { projectUsage, type Project } from './store.ts';

import { DrawingImport, JobRow } from './projectJobs.ts';
import { dateText, Dropzone, FileRow, ImageTile, UsageMeter, useBlobUrl, type ImportRequest } from './projectMedia.ts';
import { DescriptionSection, LinksSection, SetupSection } from './projectSections.ts';
import { DownloadProject } from './ProjectZipActions.ts';
function ProjectOpen({ project, onView }: { readonly project: Project; readonly onView: (view: string) => void }): ComponentChild {
  const files = project.files.filter(isGcodeFile);
  const [selected, setSelected] = useState(activeJob.value?.projectId === project.id ? activeJob.value.file?.fileId ?? '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = files.find((f) => f.id === selected) ?? files[0];
  const open = (): void => {
    if (file === undefined || busy || executionLock.value !== null) return;
    setBusy(true);
    setError(null);
    void openProjectFile(project.id, file.id).then((r) => {
      if (r.ok) onView('job');
      else setError(r.reason);
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'The file could not be opened.')).finally(() => setBusy(false));
  };
  return h('div', { class: 'project-open' },
    h('div', { class: 'project-open-controls' },
      h('label', { class: 'field' }, h('span', null, 'G-code file'), h('select', { 'data-project': 'open-file', value: file?.id ?? '', disabled: busy || files.length === 0, onChange: (e: Event) => setSelected((e.currentTarget as HTMLSelectElement).value) },
        files.length === 0 ? h('option', { value: '' }, 'Add a G-code file to this project') : files.map((f) => h('option', { key: f.id, value: f.id }, f.name)))),
      h('button', { type: 'button', class: 'small primary', 'data-action': 'project-open', disabled: file === undefined || busy || executionLock.value !== null, onClick: open }, Icon('run', 14), busy ? 'Opening…' : 'Open in Job'),
      executionLock.value === null ? null : h(ContextHelp, { id: `project-open-locked-${project.id}`, label: 'Why opening another job is unavailable' }, `${executionLock.value} Stop the current job before opening another file.`)),
    error === null ? null : h('p', { class: 'fine tone-warn', role: 'alert' }, error));
}

function ProjectHero({ project, onView, onDeleted }: { readonly project: Project; readonly onView: (v: string) => void; readonly onDeleted: () => void }): ComponentChild {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const [confirming, setConfirming] = useState(false);
  const cover = useBlobUrl(project.cover);
  const used = projectUsage(project);
  useEffect(() => {
    setName(project.name);
    setRenaming(false);
    setConfirming(false);
  }, [project.id]);
  const saveName = (): void => {
    void act((s) => s.rename(project.id, name)).then(
      () => setRenaming(false),
      () => setName(project.name),
    );
  };
  const gcode = project.files.filter(isGcodeFile).length;
  return h(
      'div',
      { class: 'pj-hero' },
      h(
        'div',
        { class: 'project-cover' },
        cover === null ? h('div', { class: 'cover-empty' }, Icon('image', 28), 'Add a photo: the first one becomes the cover') : h('img', { src: cover, alt: `Cover of ${project.name}` }),
      ),
      h(
        'div',
        { class: 'project-title' },
        renaming
          ? h(
              'form',
              {
                class: 'project-title-row',
                onSubmit: (e: Event) => {
                  e.preventDefault();
                  saveName();
                },
              },
              h('input', { class: 'rename', type: 'text', value: name, maxLength: 120, 'aria-label': 'Project name', 'data-project': 'name-input', ref: (el: HTMLInputElement | null) => el?.focus(), onInput: (e: Event) => setName((e.currentTarget as HTMLInputElement).value) }),
              h('button', { type: 'submit', class: 'small primary', 'data-action': 'project-save-name' }, 'Save'),
              h('button', { type: 'button', class: 'small', 'data-action': 'project-cancel-rename', onClick: () => { setName(project.name); setRenaming(false); } }, 'Cancel'),
            )
          : h('div', { class: 'project-title-row' }, h('h1', { id: 'project-name', 'data-project': 'name' }, project.name), h('button', { type: 'button', class: 'small icon-button quiet', 'aria-label': 'Rename the project', 'data-action': 'project-rename', onClick: () => setRenaming(true) }, Icon('edit', 16))),
        h('p', { class: 'project-meta' }, `Created ${dateText(project.createdAt)} · changed ${dateText(project.updatedAt)} · ${project.files.length} ${project.files.length === 1 ? 'file' : 'files'}${gcode === 0 ? '' : ` (${gcode} G-code)`} · ${project.images.length} ${project.images.length === 1 ? 'photo' : 'photos'}`),
        h(ProjectOpen, { key: project.id, project, onView }),
        h(UsageMeter, { used }),
        h(
          'div',
          { class: 'project-actions' },
          confirming
            ? [
                h('span', { key: 'q', class: 'fine' }, `Delete “${project.name}” and its ${project.files.length + project.images.length} files?`),
                h('button', { key: 'y', type: 'button', class: 'small danger', 'data-action': 'project-confirm-delete', onClick: () => void act((s) => s.remove(project.id)).then(onDeleted) }, 'Delete project'),
                h('button', { key: 'n', type: 'button', class: 'small', 'data-action': 'project-cancel-delete', onClick: () => setConfirming(false) }, 'Keep it'),
              ]
            : [
                h(DownloadProject, { key: 'zip', project }),
                h('button', { key: 's', type: 'button', class: 'small', disabled: true, 'aria-describedby': 'share-later', 'data-action': 'project-share' }, 'Share to forum'),
                h('span', { key: 'sn', class: 'share-note', id: 'share-later' }, 'Sharing arrives with your Synthetos account'),
                h('button', { key: 'd', type: 'button', class: 'small quiet-link', 'data-action': 'project-delete', onClick: () => setConfirming(true) }, Icon('trash', 13), 'Delete'),
              ],
        ),
      ),
    );
}
export function ProjectDetail({ project, onView, onDeleted }: { readonly project: Project; readonly onView: (v: string) => void; readonly onDeleted: () => void }): ComponentChild {
  const [result, setResult] = useState<{ added: readonly string[]; refused: readonly string[] } | null>(null);
  const [importing, setImporting] = useState<ImportRequest | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const gcode = project.files.filter(isGcodeFile).length;
  return h('article', { class: 'project-detail', 'data-project': 'detail', 'aria-labelledby': 'project-name' },
    h(ProjectHero, { project, onView, onDeleted }),
    h(
      'div',
      { class: 'project-sections' },
      h(
        'section',
        { 'aria-label': 'Files and description' },
        h('h2', { class: 'tan-label' }, 'Description'),
        h(DescriptionSection, { project }),
        h('h2', { class: 'tan-label' }, 'Files'),
        h(Dropzone, { project, onResult: (added, refused) => setResult({ added, refused }) }),
        result === null
          ? null
          : h(
              'div',
              { role: 'status', 'data-project': 'upload-result' },
              result.added.length === 0 ? null : h('p', { class: 'fine' }, `Added ${result.added.join(', ')}.`),
              result.refused.length === 0 ? null : h('ul', { class: 'upload-errors' }, result.refused.map((r) => h('li', { key: r }, r))),
            ),
        project.files.length === 0 ? null : h('ul', { class: 'file-list' }, project.files.map((f) => h(FileRow, { key: f.id, project, file: f, onView, onImport: (r) => { setImported(null); setImporting(r); } }))),
        importing === null ? null : h(DrawingImport, { key: `${importing.file.id}:${importing.role}`, request: importing, onDone: (text) => { setImporting(null); setImported(text); } }),
        imported === null ? null : h('p', { class: 'fine', role: 'status', 'data-project': 'import-result' }, imported),
        project.images.length === 0 ? null : [h('h2', { key: 'h', class: 'tan-label' }, 'Photos'), h('ul', { key: 'l', class: 'image-strip' }, project.images.map((i) => h(ImageTile, { key: i.id, project, image: i })))],
        gcode === 0 ? null : h('p', { class: 'fine' }, 'Open a saved job or start one from a file. ', h('button', { type: 'button', class: 'small quiet-link', 'data-action': 'project-go-run', onClick: () => onView('job') }, 'Back to Job')),
        h('h2', { class: 'tan-label' }, 'Jobs'),
        project.jobs.length === 0 ? h('p', { class: 'fine', 'data-project': 'no-jobs' }, 'No jobs yet. Open a G-code file in Job, then choose Save to project.') : h('ul', { class: 'file-list', 'data-project': 'jobs' }, project.jobs.map((j) => h(JobRow, { key: j.id, project, job: j, onView }))),
      ),
      h(
        'section',
        { 'aria-label': 'Setup and links' },
        h('h2', { class: 'tan-label' }, 'Cut with'),
        h(SetupSection, { project }),
        h('h2', { class: 'tan-label' }, 'Links'),
        h(LinksSection, { project }),
      ),
    ));
}
