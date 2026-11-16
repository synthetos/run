import { h, type ComponentChild } from 'preact';
import { useRef } from 'preact/hooks';
import { projectDownload } from '../workspace/cloud/projectSyncState.ts';
import { isActiveProjectStore, publishProjects } from './browserStore.ts';
import type { Project } from './store.ts';
import { exportProjectZip } from './zip/export.ts';
import { useZipAction } from './useZipAction.ts';

function saveZip(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `${name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'project'}.zip`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function Notice({ text, error }: { text: string; error: boolean }): ComponentChild {
  return text ? h('p', { class: `fine${error ? ' tone-warn' : ''}`, role: error ? 'alert' : 'status', 'data-project-zip': 'notice' }, text) : null;
}
export function DownloadProject({ project }: { project: Project }): ComponentChild {
  const action = useZipAction();
  const download = () => action.run(async (store, progress) => {
    progress('Preparing project zip…');
    const blob = await exportProjectZip(store, project.id, { progress, download: projectDownload.open });
    if (!isActiveProjectStore(store)) throw new Error('The account changed; download the project again.');
    saveZip(blob, project.name); return 'Project zip downloaded.';
  });
  return h('div', { class: 'project-zip-action' },
    h('button', { type: 'button', class: 'small', disabled: action.busy, 'data-action': 'project-download', onClick: () => void download() }, action.busy ? 'Preparing zip…' : 'Download project'),
    h(Notice, action));
}
export function ImportProject({ onImported, disabled }: { onImported(id: string): void; disabled: boolean }): ComponentChild {
  const input = useRef<HTMLInputElement>(null); const action = useZipAction();
  const load = (file: File) => action.run(async (store, progress) => {
    progress('Reading project zip…');
    try {
      if (!file.name.toLowerCase().endsWith('.zip')) throw new Error('Choose a project zip file.');
      const project = await store.importZip(file, { progress });
      if (isActiveProjectStore(store)) onImported(project.id);
      return `Imported ${project.name}.`;
    } finally { publishProjects(store); }
  });
  return h('div', { class: 'project-zip-action' },
    h('button', { type: 'button', class: 'small', disabled: disabled || action.busy, 'data-action': 'project-import', onClick: () => input.current?.click() }, action.busy ? 'Importing…' : 'Import project'),
    h('input', { ref: input, type: 'file', accept: '.zip,application/zip', hidden: true, 'data-project': 'zip-input', onChange: (event: Event) => {
      const field = event.currentTarget as HTMLInputElement; const file = field.files?.[0]; field.value = '';
      if (file) void load(file);
    } }), h(Notice, action));
}
