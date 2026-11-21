import { toolDisplayName } from '../workspace/tools/displayName.ts';
/** Project descriptions, links and setup references. */
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../workspace/icons.ts';
import { activeJob, stockFootprint } from '../workspace/jobModel.ts';
import { allMaterials, hostOf, machineRevision, machineStore, safeExternalLink, toolStore } from '../workspace/library.ts';
import { Dismissable } from '../workspace/notes/Dismissable.ts';
import { withProjects as act } from './browserStore.ts';
import { Description } from './description.ts';
import { type Project, type ProjectSetup } from './store.ts';

export function DescriptionSection({ project }: { readonly project: Project }): ComponentChild {
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
    h(Dismissable, { id: 'projects/description-format', label: 'the formatting help', inNotes: false }, h('p', { class: 'fine' }, 'A blank line starts a new paragraph. Start a line with - for a list, or 1. for a numbered list. Use **bold** for bold text and [title](web address) for a link.')),
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

export function LinksSection({ project }: { readonly project: Project }): ComponentChild {
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

export function stockText(): string {
  const job = activeJob.value;
  if (job === null) return 'Not recorded';
  const s = job.setup.stock;
  const { w, d } = stockFootprint(s);
  const shape = s.shape === 'round' ? `Round ⌀${s.diameter ?? w}` : `${s.shape === 'sheet' ? 'Sheet' : 'Block'} ${w} × ${d}`;
  return `${shape} × ${s.thickness} mm`;
}

export function SetupSection({ project }: { readonly project: Project }): ComponentChild {
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
          save({ ...setup, machine: m === undefined ? null : { id: m.id, name: m.name, version: machineRevision(m) } });
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
      h('button', { type: 'button', class: 'small quiet-link', 'data-action': 'project-use-stock', onClick: () => save({ ...setup, stock: { id: 'setup.stock', name: stockText() }, ...(activeJob.value === null ? {} : { stockSnapshot: structuredClone(activeJob.value.setup.stock) }) }) }, setup.stock === null ? 'Use the stock from Setup' : 'Update from Setup'),
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
            title: toolDisplayName(t.tool),
            onClick: () =>
              save({
                ...setup,
                tools: chosenTools.has(t.tool.id) ? setup.tools.filter((x) => x.id !== t.tool.id) : [...setup.tools, { id: t.tool.id, version: t.tool.version, name: toolDisplayName(t.tool), number: t.number }],
              }),
          },
          `T${t.number} ${toolDisplayName(t.tool)}`,
        ),
      ),
    ),
  );
}

