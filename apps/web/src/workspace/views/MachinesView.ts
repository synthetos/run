/**
 * The Machines view: start from a machine like yours, make a copy, and make
 * it yours (WORKSPACE_TENETS 6). Profiles are kept in this browser through
 * the library adapter; cloud sync comes later. A copy pins the template and
 * copies no board settings, homing or safety facts.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { CATALOGUE, machineDrawing, type MachineTemplate } from '../machineDrawings.ts';
import { machineStore, selectedMachine, selectedMachineStore, type MachineProfile } from '../library.ts';
import { Icon } from '../icons.ts';
import { boardLabel } from '../status.ts';
import { connected, type WorkspaceModel } from '../model.ts';

export function MachineArt({ id, label }: { readonly id: string; readonly label?: string }): ComponentChild {
  const d = machineDrawing(id);
  return h(
    'svg',
    { class: 'machine-drawing', viewBox: d.viewBox, ...(label === undefined ? { 'aria-hidden': 'true' } : { role: 'img', 'aria-label': label }) },
    d.paths.map((p, i) => h('path', { d: p.d, class: p.cls, key: String(i) })),
  );
}

function copyOf(t: MachineTemplate, n: number): MachineProfile {
  return {
    id: `m-${t.id}-${Date.now().toString(36)}-${n}`,
    name: t.id === 'custom' ? 'My machine' : `My ${t.name}`,
    templateId: t.id,
    drive: t.drive,
    travel: t.travel,
    spindle: 'Trim router',
    createdAt: new Date().toISOString(),
  };
}

function MyMachine({ model, onView }: { readonly model: WorkspaceModel | null; readonly onView: (v: string) => void }): ComponentChild {
  const mine = selectedMachine.value;
  const view = model?.live.value ?? null;
  const isOn = view !== null && connected(view);
  const [editing, setEditing] = useState(false);
  if (mine === null) {
    return h(
      'div',
      { class: 'my-machine empty' },
      h(MachineArt, { id: 'custom' }),
      h('div', { class: 'grow' }, h('span', { class: 'kicker' }, 'Your machine'), h('h2', null, 'No machine yet'), h('p', null, 'Pick the machine closest to yours below and make a copy. You can change every detail.')),
      h('span', { class: `pill${isOn ? ' connected' : ''}` }, isOn ? 'Board connected' : 'Not connected'),
      h('span', null),
    );
  }
  const update = (patch: Partial<MachineProfile>): void => {
    machineStore.set(machineStore.value.value.map((m) => (m.id === mine.id ? { ...m, ...patch } : m)));
  };
  const num = (v: string, fallback: number): number => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return h(
    'div',
    { class: 'my-machine', 'data-machine': mine.id },
    h(MachineArt, { id: mine.templateId }),
    h(
      'div',
      { class: 'grow' },
      h('span', { class: 'kicker' }, 'Your machine'),
      editing
        ? h(
            'div',
            { class: 'field-grid machine-edit' },
            h('label', { class: 'field wide-field' }, h('span', null, 'Name'), h('span', { class: 'unit-input' }, h('input', { value: mine.name, maxLength: 60, onChange: (e: Event) => update({ name: (e.currentTarget as HTMLInputElement).value.slice(0, 60) || mine.name }) }))),
            ...(['x', 'y', 'z'] as const).map((a) =>
              h('label', { class: 'field', key: a }, h('span', null, `Travel ${a.toUpperCase()}`), h('span', { class: 'unit-input' }, h('input', { type: 'number', min: 1, value: mine.travel[a], onChange: (e: Event) => update({ travel: { ...mine.travel, [a]: num((e.currentTarget as HTMLInputElement).value, mine.travel[a]) } }) }), h('i', null, 'mm'))),
            ),
            h('label', { class: 'field' }, h('span', null, 'Spindle'), h('span', { class: 'unit-input' }, h('input', { value: mine.spindle, maxLength: 40, onChange: (e: Event) => update({ spindle: (e.currentTarget as HTMLInputElement).value.slice(0, 40) }) }))),
          )
        : [h('h2', { key: 'n' }, mine.name), h('p', { key: 'p' }, `${CATALOGUE.find((t) => t.id === mine.templateId)?.name ?? 'Custom'} · ${mine.drive === 'any' ? 'any drive' : `${mine.drive} drive`} · ${mine.travel.x} × ${mine.travel.y} × ${mine.travel.z} mm travel · ${mine.spindle}`), isOn && view !== null ? h('p', { key: 'b', class: 'fine' }, `Connected: ${boardLabel(view)}`) : null],
    ),
    h('span', { class: `pill${isOn ? ' connected' : ''}` }, isOn ? 'Connected' : 'Not connected'),
    h('div', { class: 'card-actions' }, h('button', { type: 'button', class: 'small', onClick: () => setEditing(!editing) }, editing ? 'Done' : 'Edit'), h('button', { type: 'button', class: 'small', onClick: () => onView('board') }, 'Open board')),
  );
}

export function MachinesView({ model, onView }: { readonly model: WorkspaceModel | null; readonly onView: (v: string) => void }): ComponentChild {
  const [filter, setFilter] = useState<'all' | 'belt' | 'screw'>('all');
  const [query, setQuery] = useState('');
  const list = CATALOGUE.filter((t) => (filter === 'all' || t.drive === filter || t.drive === 'any') && `${t.name} ${t.blurb}`.toLowerCase().includes(query.trim().toLowerCase()));
  const mine = machineStore.value.value;
  return h(
    'div',
    { class: 'machines-view' },
    h(
      'div',
      { class: 'view-head' },
      h('div', { class: 'title-block' }, h('h1', null, 'Machines'), h('p', null, 'Start from a machine like yours, then make every detail match what you built.')),
      h('div', { class: 'view-actions' }, h('span', { class: 'search-wrap' }, Icon('search', 15), h('input', { class: 'search', placeholder: 'Find a machine', 'aria-label': 'Find a machine', value: query, onInput: (e: Event) => setQuery((e.currentTarget as HTMLInputElement).value) }))),
    ),
    h(
      'div',
      { tabindex: 0, class: 'scroll-region' },
      h(MyMachine, { model, onView }),
      mine.length > 1
        ? h(
            'div',
            { class: 'filter-row my-list', role: 'group', 'aria-label': 'Your machines' },
            mine.map((m) => h('button', { type: 'button', class: `chip${selectedMachineStore.value.value === m.id ? ' selected' : ''}`, key: m.id, onClick: () => selectedMachineStore.set(m.id) }, m.name)),
          )
        : null,
      h(
        'div',
        { class: 'section-heading' },
        h('h2', null, 'Start from a machine like yours'),
        h(
          'div',
          { class: 'filter-row', role: 'group', 'aria-label': 'Filter by drive' },
          (
            [
              ['all', 'All'],
              ['belt', 'Belt driven'],
              ['screw', 'Screw driven'],
            ] as const
          ).map(([id, label]) => h('button', { type: 'button', key: id, class: `chip${filter === id ? ' selected' : ''}`, 'aria-pressed': filter === id ? 'true' : 'false', onClick: () => setFilter(id) }, label)),
        ),
      ),
      h(
        'div',
        { class: 'library-grid' },
        list.map((t) =>
          h(
            'article',
            { class: 'machine-card', key: t.id, 'data-template': t.id },
            h('div', { class: 'machine-art' }, h('span', { class: 'tag drive' }, t.drive === 'any' ? 'Any drive' : t.drive === 'belt' ? 'Belt drive' : 'Screw drive'), h(MachineArt, { id: t.id, label: `${t.name}, illustration` })),
            h(
              'div',
              { class: 'card-body' },
              h('h3', null, t.name),
              h('p', null, t.blurb),
              h('p', { class: 'meta' }, `${t.size} · ${t.note}`),
              h(
                'div',
                { class: 'card-bottom' },
                h('span', { class: 'fine' }, 'Example · source review pending'),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'small',
                    'data-action': 'copy-machine',
                    onClick: () => {
                      const copy = copyOf(t, mine.length + 1);
                      machineStore.set([...mine, copy]);
                      selectedMachineStore.set(copy.id);
                    },
                  },
                  'Make a copy',
                ),
              ),
            ),
          ),
        ),
      ),
      h('p', { class: 'fine catalogue-note' }, 'Templates are examples until each has a sourced revision and a controller compatibility review. Copying one never copies board settings, homing or safety facts. Your machines are kept in this browser; account sync comes later.'),
    ),
  );
}
