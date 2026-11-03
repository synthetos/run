/**
 * The Projects view, Stage 1 (local): docs/design/PROJECTS.md §1-§4.
 *
 * Left: the projects in this browser, newest change first. Right: the open
 * project: cover and name, description, files (drag and drop or the picker,
 * with roles and notes, "Open in Run" for G-code), images, links, and the
 * machine, stock, material and tools it was cut with. "Share to forum" is
 * shown and disabled until accounts arrive.
 *
 * Everything is kept in this browser's IndexedDB (projects/store.ts). Nothing
 * here reaches a machine: "Open in Run" only loads the file into the Run
 * view's preview and check.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../workspace/icons.ts';
import { openJob, openProjectJob } from '../workspace/fileBridge.ts';
import { activeJob, stockFootprint, updateActiveJob, withSetup, type Job } from '../workspace/jobModel.ts';
import { allMaterials, machineStore, safeExternalLink, toolStore, hostOf } from '../workspace/library.ts';
import { FixtureThumb } from '../workspace/views/SetupView.ts';
import { projectStore, withProjects as act } from './browserStore.ts';
import { Description } from './description.ts';
import { formatBytes, LIMITS, ROLE_LABEL, type FileRole } from './limits.ts';
import { projectsState, projectUsage, type Project, type ProjectFile, type ProjectSetup } from './store.ts';
import { applyImport, checkDrawing, JOB_ROLE_LABEL, rolesFor, scaled, skippedText, type ImportCheck, type JobRole, type Units } from './useInJob.ts';

export { projectStore };

const blobUrls = new Map<string, string>();

/** An object URL for a stored image, created once per page and revoked when the image is removed. */
function useBlobUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(id === null ? null : (blobUrls.get(id) ?? null));
  useEffect(() => {
    if (id === null) {
      setUrl(null);
      return;
    }
    const known = blobUrls.get(id);
    if (known !== undefined) {
      setUrl(known);
      return;
    }
    let live = true;
    void projectStore()
      .then((s) => s.blob(id))
      .then((b) => {
        if (b === null || !live) return;
        const made = URL.createObjectURL(b);
        blobUrls.set(id, made);
        setUrl(made);
      });
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}

function forget(id: string): void {
  const url = blobUrls.get(id);
  if (url !== undefined) URL.revokeObjectURL(url);
  blobUrls.delete(id);
}

function dateText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Thumb({ project }: { readonly project: Project }): ComponentChild {
  const url = useBlobUrl(project.cover);
  return h('span', { class: 'project-thumb', 'aria-hidden': 'true' }, url === null ? Icon('projects', 20) : h('img', { src: url, alt: '' }));
}

function UsageMeter({ used }: { readonly used: number }): ComponentChild {
  const share = Math.min(1, used / LIMITS.project);
  return h(
    'div',
    { class: 'usage', 'data-project': 'usage' },
    h('span', null, `${formatBytes(used)} of ${formatBytes(LIMITS.project)} used in this project`),
    h('div', { class: 'usage-bar', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': LIMITS.project, 'aria-valuenow': used, 'aria-label': 'Project storage used', 'data-level': share > 0.85 ? 'high' : 'ok' }, h('span', { style: { width: `${(share * 100).toFixed(1)}%` } })),
  );
}

// ---------------------------------------------------------------- files and images

function Dropzone({ project, onResult }: { readonly project: Project; readonly onResult: (added: readonly string[], refused: readonly string[]) => void }): ComponentChild {
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

/** The stored file as a File for the opener; null when its bytes are gone. */
async function fileOf(file: ProjectFile): Promise<File | null> {
  const s = await projectStore();
  const b = await s.blob(file.id);
  return b === null ? null : new File([b], file.name, { type: 'text/plain' });
}

function FileRow({ project, file, onView, onImport }: { readonly project: Project; readonly file: Project['files'][number]; readonly onView: (v: string) => void; readonly onImport: (r: ImportRequest) => void }): ComponentChild {
  const [note, setNote] = useState(file.note);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const open = (): void => {
    setError(null);
    void fileOf(file).then(async (f) => {
      if (f === null) {
        setError('The file is no longer stored in this browser.');
        return;
      }
      const r = await openJob(f, { kind: 'project', projectId: project.id, fileId: file.id });
      if (r.ok) onView('run');
      else setError(r.reason);
    });
  };
  const use = (role: JobRole): void => {
    setMenu(false);
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
      file.role === 'gcode' ? h('button', { type: 'button', class: 'small', 'data-action': 'project-open-in-run', onClick: open }, Icon('run', 14), 'Open in Run') : null,
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
      h('input', {
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
      }),
    ),
  );
}

function ImageTile({ project, image }: { readonly project: Project; readonly image: Project['images'][number] }): ComponentChild {
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
            void act((s) => s.removeImage(project.id, image.id)).then(() => {
              forget(image.id);
            }),
        },
        Icon('trash', 13),
      ),
    ),
  );
}

// ---------------------------------------------------------------- description, links, setup

function DescriptionSection({ project }: { readonly project: Project }): ComponentChild {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(project.description);
  useEffect(() => setText(project.description), [project.id]);
  if (!editing) {
    return h(
      'div',
      null,
      project.description.trim() === '' ? h('p', { class: 'fine' }, 'Add notes about this project.') : h(Description, { text: project.description }),
      h('button', { type: 'button', class: 'small quiet-link', 'data-action': 'project-edit-description', onClick: () => setEditing(true) }, Icon('edit', 13), project.description.trim() === '' ? 'Write a description' : 'Edit'),
    );
  }
  return h(
    'div',
    { class: 'description-edit' },
    h('label', { class: 'sr-only', for: 'project-description' }, 'Description'),
    h('textarea', { id: 'project-description', value: text, rows: 7, 'data-project': 'description-input', onInput: (e: Event) => setText((e.currentTarget as HTMLTextAreaElement).value) }),
    h('p', { class: 'fine' }, 'Blank lines start a paragraph. Lines starting with - make a list, 1. a numbered list. **bold**, and [title](web address) for a link.'),
    h(
      'div',
      { class: 'edit-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'small primary',
          'data-action': 'project-save-description',
          onClick: () =>
            void act((s) => s.describe(project.id, text)).then(() => {
              setEditing(false);
            }),
        },
        'Save description',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'small',
          'data-action': 'project-cancel-description',
          onClick: () => {
            setText(project.description);
            setEditing(false);
          },
        },
        'Cancel',
      ),
    ),
  );
}

function LinksSection({ project }: { readonly project: Project }): ComponentChild {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  return h(
    'div',
    null,
    project.links.length === 0
      ? h('p', { class: 'fine' }, 'Add drawings, videos or a forum thread.')
      : h(
          'ul',
          { class: 'link-list' },
          project.links.map((l) => {
            const safe = safeExternalLink(l.url);
            return h(
              'li',
              { key: l.id },
              Icon('link', 15),
              safe === null ? h('span', null, l.title) : h('a', { href: safe.href, rel: safe.rel, target: safe.target, title: safe.href }, l.title, ' ', h('small', null, hostOf(safe.href))),
              h('button', { type: 'button', class: 'small icon-button quiet', 'aria-label': `Remove the link ${l.title}`, 'data-action': 'project-remove-link', onClick: () => void act((s) => s.removeLink(project.id, l.id)) }, Icon('trash', 14)),
            );
          }),
        ),
    h(
      'form',
      {
        class: 'link-form',
        onSubmit: (e: Event) => {
          e.preventDefault();
          void act((s) => s.addLink(project.id, title, url)).then(
            () => {
              setTitle('');
              setUrl('');
              setError(null);
            },
            (x: unknown) => setError(x instanceof Error ? x.message : String(x)),
          );
        },
      },
      h('input', { type: 'text', value: title, placeholder: 'Title', 'aria-label': 'Link title', maxLength: 120, onInput: (e: Event) => setTitle((e.currentTarget as HTMLInputElement).value) }),
      h('input', { type: 'url', value: url, placeholder: 'Web address', 'aria-label': 'Link address', onInput: (e: Event) => setUrl((e.currentTarget as HTMLInputElement).value) }),
      h('button', { type: 'submit', class: 'small', disabled: url.trim() === '', 'data-action': 'project-add-link' }, 'Add link'),
    ),
    error === null ? null : h('p', { class: 'fine tone-warn', role: 'alert' }, error),
  );
}

function stockText(): string {
  const job = activeJob.value;
  if (job === null) return 'Not recorded';
  const s = job.setup.stock;
  const { w, d } = stockFootprint(s);
  const shape = s.shape === 'round' ? `Round ⌀${s.diameter ?? w}` : `${s.shape === 'sheet' ? 'Sheet' : 'Block'} ${w} × ${d}`;
  return `${shape} × ${s.thickness} mm`;
}

function SetupSection({ project }: { readonly project: Project }): ComponentChild {
  const setup = project.setup;
  const save = (next: ProjectSetup): void => void act((s) => s.setSetup(project.id, next));
  const machines = machineStore.value.value;
  const materials = allMaterials.value;
  const tools = toolStore.value.value;
  const chosenTools = new Set(setup.tools.map((t) => t.id));
  return h(
    'div',
    { class: 'setup-refs', 'data-project': 'setup' },
    h('span', null, 'Machine'),
    h(
      'select',
      {
        value: setup.machine?.id ?? '',
        'aria-label': 'Machine',
        onChange: (e: Event) => {
          const id = (e.currentTarget as HTMLSelectElement).value;
          const m = machines.find((x) => x.id === id);
          save({ ...setup, machine: m === undefined ? null : { id: m.id, name: m.name } });
        },
      },
      h('option', { value: '' }, machines.length === 0 ? 'No machine profiles yet (Machines view)' : 'Not recorded'),
      machines.map((m) => h('option', { key: m.id, value: m.id }, m.name)),
    ),
    h('span', null, 'Stock'),
    h(
      'div',
      null,
      setup.stock === null ? h('span', { class: 'fine' }, 'Not recorded. ') : h('span', null, setup.stock.name, ' '),
      h('button', { type: 'button', class: 'small quiet-link', 'data-action': 'project-use-stock', onClick: () => save({ ...setup, stock: { id: 'setup.stock', name: stockText() } }) }, setup.stock === null ? 'Use the stock from Setup' : 'Update from Setup'),
    ),
    h('span', null, 'Material'),
    h(
      'select',
      {
        value: setup.material?.id ?? '',
        'aria-label': 'Material',
        onChange: (e: Event) => {
          const id = (e.currentTarget as HTMLSelectElement).value;
          const m = materials.find((x) => x.material.id === id);
          save({ ...setup, material: m === undefined ? null : { id: m.material.id, version: m.material.version, name: m.material.name } });
        },
      },
      h('option', { value: '' }, 'Not recorded'),
      materials.map((m) => h('option', { key: m.material.id, value: m.material.id }, m.material.name)),
    ),
    h('span', null, 'Tools'),
    h(
      'div',
      { class: 'tool-picks', role: 'group', 'aria-label': 'Tools used' },
      tools.map((t) =>
        h(
          'button',
          {
            type: 'button',
            key: t.tool.id,
            class: 'tool-chip',
            'aria-pressed': chosenTools.has(t.tool.id) ? 'true' : 'false',
            title: `${t.tool.name}, version ${t.tool.version}`,
            onClick: () =>
              save({
                ...setup,
                tools: chosenTools.has(t.tool.id) ? setup.tools.filter((x) => x.id !== t.tool.id) : [...setup.tools, { id: t.tool.id, version: t.tool.version, name: t.tool.name, number: t.number }],
              }),
          },
          `T${t.number} ${t.tool.name}`,
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- use in job: drawings and jobs

/**
 * A drawing on its way into the job: read with the outline reader, shown with its geometry, size, units and
 * scale and what was left out, and accepted only on Accept. The stored file is untouched either way.
 */
function DrawingImport({ request, onDone }: { readonly request: ImportRequest; readonly onDone: (text: string | null) => void }): ComponentChild {
  const { file, role } = request;
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [units, setUnits] = useState<Units>('mm');
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(role === 'bed' ? 19 : role === 'stock' ? 6.35 : 12);
  const [bedTopZ, setBedTopZ] = useState(() => activeJob.value?.setup.bed.toMachine.z ?? 0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void projectStore()
      .then((s) => s.blob(file.id))
      .then(async (b) => {
        if (!live) return;
        if (b === null) setCheck({ ok: false, reason: 'The file is no longer stored in this browser.' });
        else setCheck(checkDrawing(file, new TextDecoder().decode(await b.arrayBuffer())));
      });
    return () => {
      live = false;
    };
  }, [file.id]);
  const parsed = check?.ok === true ? scaled(check.parsed, units, scale) : null;
  const num = (e: Event, min: number): number | null => {
    const n = Number.parseFloat((e.currentTarget as HTMLInputElement).value);
    return Number.isFinite(n) && n >= min ? n : null;
  };
  return h(
    'div',
    { class: 'panel drawing-import', 'data-project': 'import', 'data-import-role': role, role: 'region', 'aria-label': `Use ${file.name} as ${JOB_ROLE_LABEL[role]}` },
    h('div', { class: 'panel-head' }, h('h3', null, `Use ${file.name} as ${role === 'bed' ? 'the bed drawing' : role === 'stock' ? 'the stock outline' : 'the fixture'}`)),
    check === null
      ? h('p', { class: 'fine' }, 'Reading the drawing…')
      : !check.ok
        ? h('p', { class: 'fine tone-warn', role: 'alert', 'data-import': 'refused' }, check.reason)
        : parsed === null
          ? null
          : [
              h('div', { class: 'fixture-item', key: 'geom' }, h(FixtureThumb, { outline: parsed.outline, holes: parsed.holes }), h('div', null, h('strong', { 'data-import': 'size' }, `${Math.round(parsed.width)} × ${Math.round(parsed.depth)} mm`), h('small', null, `${parsed.outline.length} outline points · ${parsed.holes.length} holes · read as ${units === 'mm' ? 'millimetres' : 'inches'}${scale === 1 ? '' : ` × ${scale}`}`), skippedText(parsed) === '' ? null : h('small', { class: 'tone-warn', 'data-import': 'skipped' }, skippedText(parsed)))),
              h(
                'div',
                { class: 'field-grid three', key: 'fields' },
                h('label', { class: 'field' }, h('span', null, 'Drawing units'), h('span', { class: 'select-wrap' }, h('select', { 'aria-label': 'Drawing units', 'data-import': 'units', value: units, onChange: (e: Event) => setUnits((e.currentTarget as HTMLSelectElement).value as Units) }, h('option', { value: 'mm' }, 'mm'), h('option', { value: 'in' }, 'inches')))),
                h('label', { class: 'field' }, h('span', null, 'Scale'), h('span', { class: 'unit-input' }, h('input', { type: 'number', step: 0.001, min: 0.001, value: scale, 'data-import': 'scale', onInput: (e: Event) => { const n = num(e, 0.001); if (n !== null) setScale(n); } }), h('i', null, '×'))),
                h('label', { class: 'field' }, h('span', null, role === 'bed' ? 'Thickness' : role === 'stock' ? 'Stock thickness' : 'Fixture height'), h('span', { class: 'unit-input' }, h('input', { type: 'number', step: 0.1, min: 0.1, value: height, 'data-import': 'height', onInput: (e: Event) => { const n = num(e, 0.1); if (n !== null) setHeight(n); } }), h('i', null, 'mm'))),
                role !== 'bed' ? null : h('label', { class: 'field' }, h('span', null, 'Bed top, machine Z'), h('span', { class: 'unit-input' }, h('input', { type: 'number', step: 0.1, value: bedTopZ, 'data-import': 'bed-top', onInput: (e: Event) => { const n = num(e, -100000); if (n !== null) setBedTopZ(n); } }), h('i', null, 'mm'))),
              ),
              h('p', { class: 'fine', key: 'note' }, 'Check one known dimension against the size above before accepting. The original file and its hash stay in the project; a photo is never used as geometry.'),
            ],
    error === null ? null : h('p', { class: 'fine tone-warn', role: 'alert', 'data-import': 'error' }, error),
    h(
      'div',
      { class: 'edit-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'import-cancel', onClick: () => onDone(null) }, 'Cancel'),
      h(
        'button',
        {
          type: 'button',
          class: 'small primary',
          'data-action': 'import-accept',
          disabled: check === null || !check.ok,
          onClick: () => {
            if (check === null || !check.ok) return;
            const r = applyImport(role, file, check, { units, scale, height, bedTopZ });
            if (r.ok) onDone(r.text);
            else setError(r.reason);
          },
        },
        'Accept',
      ),
    ),
  );
}

function JobRow({ project, job, onView }: { readonly project: Project; readonly job: Job; readonly onView: (v: string) => void }): ComponentChild {
  const [error, setError] = useState<string | null>(null);
  const file = project.files.find((f) => f.id === job.file?.fileId);
  const current = activeJob.value?.id === job.id;
  return h(
    'li',
    { class: 'file-row job-row', 'data-project-job': job.name, 'aria-current': current ? 'true' : undefined },
    h('span', { class: 'file-icon', 'aria-hidden': 'true' }, Icon('run', 18)),
    h(
      'div',
      { class: 'file-name' },
      h('strong', null, job.name, current ? h('span', { class: 'tag ok' }, 'Open') : null),
      h('small', null, `${file === undefined ? (job.file === null ? 'no file' : `${job.file.name} (file removed)`) : file.name} · ${job.machine === null ? 'no machine' : `${job.machine.name}, bed revision ${job.setup.bed.revision}${job.setup.bed.source.kind === 'placeholder' ? ' (placeholder)' : ''}`} · revision ${job.revision} · changed ${dateText(job.updatedAt)}`),
      error === null ? null : h('small', { class: 'tone-warn', role: 'alert' }, error),
    ),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'project-open-job', disabled: file === undefined, onClick: () => void openProjectJob(project.id, job.id).then((r) => { if (r.ok) onView('run'); else setError(r.reason); }) }, Icon('run', 14), 'Open'),
      h('button', { type: 'button', class: 'small icon-button quiet', 'aria-label': `Remove the job ${job.name}`, 'data-action': 'project-remove-job', onClick: () => void act((s) => s.removeJob(project.id, job.id)) }, Icon('trash', 15)),
    ),
  );
}

// ---------------------------------------------------------------- detail

function ProjectDetail({ project, onView, onDeleted }: { readonly project: Project; readonly onView: (v: string) => void; readonly onDeleted: () => void }): ComponentChild {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ added: readonly string[]; refused: readonly string[] } | null>(null);
  const [importing, setImporting] = useState<ImportRequest | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const cover = useBlobUrl(project.cover);
  const used = projectUsage(project);
  useEffect(() => {
    setName(project.name);
    setRenaming(false);
    setConfirming(false);
    setResult(null);
    setImporting(null);
    setImported(null);
  }, [project.id]);
  const saveName = (): void => {
    void act((s) => s.rename(project.id, name)).then(
      () => setRenaming(false),
      () => setName(project.name),
    );
  };
  const gcode = project.files.filter((f) => f.role === 'gcode').length;
  return h(
    'article',
    { class: 'project-detail', 'data-project': 'detail', 'aria-labelledby': 'project-name' },
    h(
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
        h(UsageMeter, { used }),
        h(
          'div',
          { class: 'project-actions' },
          confirming
            ? [
                h('span', { key: 'q', class: 'fine' }, `Delete “${project.name}” and its ${project.files.length + project.images.length} files from this browser?`),
                h('button', { key: 'y', type: 'button', class: 'small danger', 'data-action': 'project-confirm-delete', onClick: () => void act((s) => s.remove(project.id)).then(onDeleted) }, 'Delete project'),
                h('button', { key: 'n', type: 'button', class: 'small', 'data-action': 'project-cancel-delete', onClick: () => setConfirming(false) }, 'Keep it'),
              ]
            : [
                h('button', { key: 's', type: 'button', class: 'small', disabled: true, 'aria-describedby': 'share-later', 'data-action': 'project-share' }, 'Share to forum'),
                h('span', { key: 'sn', class: 'share-note', id: 'share-later' }, 'Sharing arrives with your Synthetos account'),
                h('button', { key: 'd', type: 'button', class: 'small quiet-link', 'data-action': 'project-delete', onClick: () => setConfirming(true) }, Icon('trash', 13), 'Delete'),
              ],
        ),
      ),
    ),
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
        gcode === 0 ? null : h('p', { class: 'fine' }, '“Open in Run” opens the file as this project’s job: its machine, bed, stock and fixture are saved here and come back with it. ', h('button', { type: 'button', class: 'small quiet-link', 'data-action': 'project-go-run', onClick: () => onView('run') }, 'Go to Run')),
        h('h2', { class: 'tan-label' }, 'Jobs'),
        project.jobs.length === 0 ? h('p', { class: 'fine', 'data-project': 'no-jobs' }, 'No jobs yet. “Open in Run” on a G-code file starts one; “Save to project” in Run brings a draft here.') : h('ul', { class: 'file-list', 'data-project': 'jobs' }, project.jobs.map((j) => h(JobRow, { key: j.id, project, job: j, onView }))),
      ),
      h(
        'section',
        { 'aria-label': 'Setup and links' },
        h('h2', { class: 'tan-label' }, 'Cut with'),
        h(SetupSection, { project }),
        h('h2', { class: 'tan-label' }, 'Links'),
        h(LinksSection, { project }),
      ),
    ),
  );
}

export function ProjectsView({ onView }: { readonly onView: (v: string) => void }): ComponentChild {
  const state = projectsState.value;
  const [openId, setOpenId] = useState<string | null>(null);
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
      h('div', { class: 'title-block' }, h('h1', null, 'Projects'), h('p', null, state.loaded && !state.persistent ? 'This browser refused storage: projects last for this page only.' : 'Files, photos, notes and setup, kept together in this browser.')),
      h('div', { class: 'view-actions' }, h('button', { type: 'button', class: 'primary', disabled: !state.loaded, 'data-action': 'project-new', onClick: create }, Icon('plus', 16), 'New project')),
    ),
    h(
      'div',
      { class: 'projects-layout' },
      h(
        'nav',
        { class: 'project-list-panel', 'aria-label': 'Projects' },
        h('div', { class: 'project-list-head' }, h('strong', null, state.list.length === 0 ? 'No projects' : `${state.list.length} ${state.list.length === 1 ? 'project' : 'projects'}`), h('span', { class: 'fine' }, 'In this browser')),
        state.list.length === 0
          ? h('div', { class: 'project-empty' }, h('strong', null, state.loaded ? 'Start a project' : 'Loading projects…'), 'Keep the G-code, photos, notes and the setup of a job together, so next time you know exactly how it was cut.')
          : h(
              'div',
              { class: 'project-list' },
              state.list.map((p) =>
                h(
                  'button',
                  { type: 'button', key: p.id, class: 'project-row', 'aria-current': open?.id === p.id ? 'true' : undefined, 'data-project-row': p.name, onClick: () => setOpenId(p.id) },
                  h(Thumb, { project: p }),
                  h('span', null, h('strong', null, p.name), h('small', null, `${p.files.length} ${p.files.length === 1 ? 'file' : 'files'} · ${formatBytes(projectUsage(p))} · ${dateText(p.updatedAt)}`)),
                ),
              ),
            ),
      ),
      open === null
        ? h('div', { class: 'panel empty-panel project-detail-empty' }, h('h2', null, 'No project open'), h('p', null, 'Create a project and add files or photos. Saved in this browser.'))
        : h(ProjectDetail, { key: open.id, project: open, onView, onDeleted: () => setOpenId(null) }),
    ),
  );
}
