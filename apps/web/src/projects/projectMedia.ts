/** Project file controls, image previews and storage usage. */
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { executionLock, openProjectFile } from '../workspace/fileBridge.ts';
import { Icon } from '../workspace/icons.ts';
import { updateActiveJob, withSetup } from '../workspace/jobModel.ts';
import { withProjects as act, projectStore, projectScope } from './browserStore.ts';
import { formatBytes, isGcodeFile, LIMITS, ROLE_LABEL, type FileRole } from './limits.ts';
import { type Project, type ProjectFile } from './store.ts';
import { JOB_ROLE_LABEL, rolesFor, type JobRole } from './useInJob.ts';

/** URLs are scoped to the current project session and revoked when the image or account changes. */
export function useBlobUrl(id: string | null): string | null {
  const key = `${projectScope.value}/${id}`;
  const [current, setCurrent] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (id === null) return;
    let live = true; let url: string | null = null;
    void projectStore().then(s => s.blob(id)).then(blob => {
      if (blob === null || !live) return;
      url = URL.createObjectURL(blob); setCurrent({ key, url });
    }).catch(() => undefined);
    return () => { live = false; if (url !== null) URL.revokeObjectURL(url); };
  }, [key, id]);
  return current?.key === key ? current.url : null;
}

export function dateText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Thumb({ project }: { readonly project: Project }): ComponentChild {
  const url = useBlobUrl(project.cover);
  return h('span', { class: 'project-thumb', 'aria-hidden': 'true' }, url === null ? Icon('projects', 20) : h('img', { src: url, alt: '' }));
}

export function UsageMeter({ used }: { readonly used: number }): ComponentChild {
  const share = Math.min(1, used / LIMITS.project);
  return h(
    'div',
    { class: 'usage', 'data-project': 'usage' },
    h('span', null, `${formatBytes(used)} of ${formatBytes(LIMITS.project)} used in this project`),
    h('div', { class: 'usage-bar', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': LIMITS.project, 'aria-valuenow': used, 'aria-label': 'Project storage used', 'data-level': share > 0.85 ? 'high' : 'ok' }, h('span', { style: { width: `${(share * 100).toFixed(1)}%` } })),
  );
}

// ---------------------------------------------------------------- files and images

export function Dropzone({ project, onResult }: { readonly project: Project; readonly onResult: (added: readonly string[], refused: readonly string[]) => void }): ComponentChild {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = (files: readonly File[]): void => {
    if (files.length === 0) return;
    setBusy(true);
    void act((s) => s.add(project.id, files))
      .then((r) => onResult(r.added, r.refused), (e: unknown) => onResult([], [e instanceof Error ? e.message : String(e)]))
      .finally(() => setBusy(false));
  };
  return h(
    'div',
    {
      class: `dropzone${over ? ' is-over' : ''}`,
      'data-project': 'dropzone',
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        add([...(e.dataTransfer?.files ?? [])]);
      },
    },
    Icon('upload', 22),
    h('div', { class: 'grow' }, h('strong', null, busy ? 'Adding…' : 'Drop files here'), h('span', null, `G-code up to ${formatBytes(LIMITS.gcode)}, other files up to ${formatBytes(LIMITS.other)}, photos up to ${formatBytes(LIMITS.imageBeforeEncode)} (scaled to 2000 px WebP, location data removed).`)),
    h(
      'label',
      { class: 'file-button' },
      h('input', {
        type: 'file',
        multiple: true,
        disabled: busy,
        'data-project': 'file-input',
        onChange: (e: Event) => {
          const input = e.currentTarget as HTMLInputElement;
          add([...(input.files ?? [])]);
          input.value = '';
        },
      }),
      Icon('plus', 14),
      'Choose files',
    ),
  );
}

/** What "Use in Job" asked for: a drawing to check and accept, with the role it would take. */
export interface ImportRequest {
  readonly file: ProjectFile;
  readonly role: Exclude<JobRole, 'gcode' | 'reference'>;
}

/** File actions share the central opener with the project header and Files drawer. */
export function FileRow({ project, file, onView, onImport, openLabel = 'Open in Job' }: { readonly project: Project; readonly file: Project['files'][number]; readonly onView: (v: string) => void; readonly onImport: (r: ImportRequest) => void; readonly openLabel?: string }): ComponentChild {
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const open = (): void => {
    setError(null);
    void openProjectFile(project.id, file.id).then((r) => {
      if (r.ok) onView('job');
      else setError(r.reason);
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'The file could not be opened.'));
  };
  const use = (role: JobRole): void => {
    setMenu(false);
    if (executionLock.value !== null) { setError(executionLock.value); return; }
    if (role === 'gcode') open();
    else if (role === 'reference') {
      setError(null);
      const job = updateActiveJob((j) => (j.setup.references.some((x) => x.fileId === file.id) ? j : withSetup(j, { references: [...j.setup.references, { fileId: file.id, name: file.name, hash: file.hash }] })));
      if (job === null) setError('No job is open yet.');
    } else onImport({ file, role });
  };
  return h(
    'li',
    { class: 'file-row', 'data-role': file.role, 'data-project-file': file.name },
    h('span', { class: 'file-icon', 'aria-hidden': 'true' }, Icon(file.role === 'gcode' ? 'file' : file.role === 'drawing' ? 'ruler' : 'lines', 18)),
    h(
      'div',
      { class: 'file-name' },
      h('strong', { title: file.name }, file.name),
      h('small', null, `${formatBytes(file.size)} · added ${dateText(file.addedAt)} · sha256 ${file.hash.slice(0, 10)}`),
      error === null ? null : h('small', { class: 'tone-warn', role: 'alert' }, error),
    ),
    h(
      'div',
      { class: 'row-actions' },
      isGcodeFile(file) ? h('button', { type: 'button', class: 'small', 'data-action': 'project-open-in-run', disabled: executionLock.value !== null, title: executionLock.value ?? undefined, onClick: open }, Icon('run', 14), openLabel) : null,
      h(
        'span',
        { class: 'use-menu' },
        h('button', { type: 'button', class: 'small', 'data-action': 'project-use-in-job', 'aria-haspopup': 'menu', 'aria-expanded': menu ? 'true' : 'false', onClick: () => setMenu(!menu) }, 'Use in Job', Icon('chevron', 12)),
        menu
          ? h(
              'div',
              { class: 'account-menu use-menu-list', role: 'menu', 'aria-label': `Use ${file.name} in the job as` },
              rolesFor(file).map((role) => h('button', { type: 'button', key: role, class: 'menu-item', role: 'menuitem', 'data-use-as': role, onClick: () => use(role) }, JOB_ROLE_LABEL[role])),
            )
          : null,
      ),
      h('button', { type: 'button', class: 'small icon-button quiet', 'aria-label': `Remove ${file.name}`, 'data-action': 'project-remove-file', onClick: () => void act((s) => s.removeFile(project.id, file.id)) }, Icon('trash', 15)),
    ),
    h(
      'div',
      { class: 'file-edit' },
      h(
        'select',
        {
          value: file.role,
          'aria-label': `Role of ${file.name}`,
          'data-project': 'file-role',
          onChange: (e: Event) => {
            const role = (e.currentTarget as HTMLSelectElement).value as FileRole;
            void act((s) => s.updateFile(project.id, file.id, { role })).catch((x: unknown) => setError(x instanceof Error ? x.message : String(x)));
          },
        },
        (Object.keys(ROLE_LABEL) as FileRole[]).map((r) => h('option', { key: r, value: r }, ROLE_LABEL[r])),
      ),
      h(FileNote, { project, file }),
    ),
  );
}

export function ImageTile({ project, image }: { readonly project: Project; readonly image: Project['images'][number] }): ComponentChild {
  const url = useBlobUrl(image.id);
  const cover = project.cover === image.id;
  return h(
    'li',
    { class: 'image-tile', 'data-project-image': image.name },
    url === null ? null : h('img', { src: url, alt: image.name, width: image.width, height: image.height }),
    h(
      'div',
      { class: 'tile-actions' },
      h('button', { type: 'button', class: 'small', disabled: cover, 'data-action': 'project-set-cover', onClick: () => void act((s) => s.setCover(project.id, image.id)) }, cover ? 'Cover' : 'Make cover'),
      h(
        'button',
        {
          type: 'button',
          class: 'small',
          'aria-label': `Remove ${image.name}`,
          'data-action': 'project-remove-image',
          onClick: () =>
            void act((s) => s.removeImage(project.id, image.id)),
        },
        Icon('trash', 13),
      ),
    ),
  );
}


function FileNote({ project, file }: { project: Project; file: ProjectFile }): ComponentChild {
  const [note, setNote] = useState(file.note);
  return h('input', {
        class: 'note-input',
        type: 'text',
        value: note,
        maxLength: 500,
        placeholder: 'Add a note: what it is, which version',
        'aria-label': `Note for ${file.name}`,
        'data-project': 'file-note',
        onInput: (e: Event) => setNote((e.currentTarget as HTMLInputElement).value),
        onBlur: () => {
          if (note !== file.note) void act((s) => s.updateFile(project.id, file.id, { note }));
        },
      });
}
