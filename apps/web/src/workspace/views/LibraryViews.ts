/**
 * The Tools and Materials views (MACHINING_ASSISTANT §2, §3, §8): the tool
 * library with descriptions, notes and purchase links, and the material
 * library (built-in and mine) with its safety notes.
 *
 * Every seeded number is a placeholder until it is sourced, and the views say
 * so. Links people add are http(s) only (`safeUrl`) and render as plain
 * external links: a new tab, `rel="noopener noreferrer nofollow"`, never
 * fetched. The Synthetos store is mocked and labelled.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import {
  addTool,
  allMaterials,
  FAMILIES,
  forkMaterial,
  hostOf,
  material,
  money,
  myMaterialStore,
  NOT_OFFERED,
  safeUrl,
  SOURCE_LABELS,
  TOOL_KINDS,
  toolStore,
  toolWear,
  updateMyMaterial,
  updateTool,
  type Material,
  type Purchase,
  type ToolRecord,
} from '../library.ts';
import { Icon } from '../icons.ts';
import { num } from '../status.ts';

export const PLACEHOLDER_NOTE = 'Placeholder values: not yet sourced. They show the shape of the data, not machining advice.';

/** A purchase line: a plain external link when a person entered a valid http(s) URL, plain text otherwise. */
export function PurchaseLine({ p }: { readonly p: Purchase }): ComponentChild {
  const url = safeUrl(p.url);
  const what = [p.vendor, p.sku === undefined ? null : p.sku].filter((x) => x !== null).join(' · ');
  const price = p.price === undefined ? '' : ` · ${money(p.price, p.currency)}`;
  return h(
    'li',
    { class: 'purchase' },
    url === null
      ? h('span', null, what, p.kind === 'store' ? h('span', { class: 'tag mock' }, 'Store · mock') : null)
      : h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow', 'data-external': hostOf(url) }, what, ' ', Icon('external', 13), h('span', { class: 'sr-only' }, ' (opens in a new tab)')),
    h('small', null, `${price.replace(/^ · /, '')}${p.boughtAt === undefined ? '' : `${price === '' ? '' : ' · '}bought ${p.boughtAt}`}`),
  );
}

function AddLink({ onAdd }: { readonly onAdd: (p: Purchase) => void }): ComponentChild {
  const [vendor, setVendor] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  return h(
    'form',
    {
      class: 'add-link',
      onSubmit: (e: Event) => {
        e.preventDefault();
        const clean = safeUrl(url);
        if (clean === null) {
          setError('Enter a full web address that starts with https or http.');
          return;
        }
        onAdd({ kind: 'link', vendor: vendor.trim().slice(0, 60) || hostOf(clean), url: clean });
        setVendor('');
        setUrl('');
        setError(null);
      },
    },
    h('label', { class: 'field' }, h('span', null, 'Shop'), h('span', { class: 'unit-input' }, h('input', { value: vendor, maxLength: 60, onInput: (e: Event) => setVendor((e.currentTarget as HTMLInputElement).value) }))),
    h('label', { class: 'field' }, h('span', null, 'Link'), h('span', { class: 'unit-input' }, h('input', { type: 'url', value: url, maxLength: 500, placeholder: 'Web address', onInput: (e: Event) => setUrl((e.currentTarget as HTMLInputElement).value) }))),
    error === null ? null : h('p', { class: 'field-error', role: 'alert' }, error),
    h('button', { type: 'submit', class: 'small' }, 'Add purchase link'),
  );
}

// ---------------------------------------------------------------- tools

/** A side view of the tool, in proportion, from its type and dimensions. */
export function ToolArt({ tool, large = false }: { readonly tool: ToolRecord; readonly large?: boolean }): ComponentChild {
  const total = Math.max(tool.overall, 1);
  const H = 100;
  const k = H / total;
  const d = Math.max(tool.diameter * k * (large ? 1.6 : 2.2), 3);
  const sd = Math.max(tool.shank * k * (large ? 1.6 : 2.2), 3);
  const flute = tool.fluteLength * k;
  const cx = 20;
  const fluteTop = H - flute;
  const l = cx - d / 2;
  const r = cx + d / 2;
  const tipLen = Math.min(flute, d / 2 / Math.tan((((tool.angle ?? 118) / 2) * Math.PI) / 180));
  const body =
    tool.type === 'ball'
      ? `M${l} ${fluteTop}L${r} ${fluteTop}L${r} ${H - d / 2}A${d / 2} ${d / 2} 0 0 1 ${l} ${H - d / 2}Z`
      : tool.type === 'vbit' || tool.type === 'drill' || tool.type === 'chamfer'
        ? `M${l} ${fluteTop}L${r} ${fluteTop}L${r} ${H - tipLen}L${cx} ${H}L${l} ${H - tipLen}Z`
        : `M${l} ${fluteTop}L${r} ${fluteTop}L${r} ${H}L${l} ${H}Z`;
  return h(
    'svg',
    { class: 'tool-art', viewBox: `0 -2 40 ${H + 4}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' },
    h('rect', { class: 'shank', x: cx - sd / 2, y: 0, width: sd, height: Math.max(fluteTop, 1) }),
    h('path', { class: 'body', d: body }),
    h('path', { class: 'flute', d: `M${l} ${fluteTop + flute * 0.15}L${r} ${fluteTop + flute * 0.35}M${l} ${fluteTop + flute * 0.5}L${r} ${fluteTop + flute * 0.7}` }),
  );
}

function numberField(label: string, value: number, unit: string, onChange: (n: number) => void, step = 0.001): ComponentChild {
  return h(
    'label',
    { class: 'field', key: label },
    h('span', null, label),
    h(
      'span',
      { class: 'unit-input' },
      h('input', {
        type: 'number',
        step,
        min: 0,
        value,
        onChange: (e: Event) => {
          const n = Number.parseFloat((e.currentTarget as HTMLInputElement).value);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        },
      }),
      unit === '' ? null : h('i', null, unit),
    ),
  );
}

function textArea(label: string, value: string, onChange: (s: string) => void, max = 2000): ComponentChild {
  return h('label', { class: 'field', key: label }, h('span', null, label), h('textarea', { class: 'text-area', rows: 3, maxLength: max, value, onChange: (e: Event) => onChange((e.currentTarget as HTMLTextAreaElement).value.slice(0, max)) }));
}

function ToolInspector({ tool }: { readonly tool: ToolRecord }): ComponentChild {
  const set = (patch: Partial<ToolRecord>): void => updateTool(tool.id, patch);
  const wear = toolWear(tool);
  return h(
    'aside',
    { tabindex: 0, class: 'inspector', 'aria-label': 'Selected tool' },
    h(
      'section',
      { class: 'insp', 'data-tool': tool.id },
      h('header', null, h('h2', null, `T${tool.number} · ${tool.name}`), h('span', { class: 'tag' }, TOOL_KINDS[tool.type] ?? tool.type)),
      h('div', { class: 'tool-drawing' }, h(ToolArt, { tool, large: true })),
      h(
        'div',
        { class: 'field-grid' },
        numberField('Diameter', tool.diameter, 'mm', (diameter) => set({ diameter })),
        numberField('Flutes', tool.flutes, '', (flutes) => set({ flutes: Math.max(1, Math.round(flutes)) }), 1),
        numberField('Flute length', tool.fluteLength, 'mm', (fluteLength) => set({ fluteLength }), 0.5),
        numberField('Overall length', tool.overall, 'mm', (overall) => set({ overall }), 0.5),
      ),
      textArea('Description', tool.description, (description) => set({ description })),
      textArea('Notes', tool.notes, (notes) => set({ notes })),
      h('dl', { class: 'facts' }, h('div', null, h('dt', null, 'Maker'), h('dd', null, [tool.manufacturer, tool.partNumber].filter((x) => x !== '').join(' · ') || 'Not recorded')), h('div', null, h('dt', null, 'Material'), h('dd', null, `${tool.material} · ${tool.coating}`)), h('div', null, h('dt', null, 'Wear'), h('dd', null, `${Math.round(wear.used * 100)} % of expected life · ${num(wear.minutes)} min`))),
    ),
    h(
      'section',
      { class: 'insp' },
      h('header', null, h('h2', null, 'Where to buy')),
      tool.purchase.length === 0 ? h('p', { class: 'fine' }, 'No purchase links yet.') : h('ul', { class: 'purchases' }, tool.purchase.map((p, i) => h(PurchaseLine, { p, key: String(i) }))),
      h(AddLink, { onAdd: (p) => set({ purchase: [...tool.purchase, p] }) }),
      h('p', { class: 'fine' }, 'Links open in a new tab and are never fetched by Run. The Synthetos store is a mock in this release.'),
    ),
    h(
      'section',
      { class: 'insp' },
      h('header', null, h('h2', null, 'Cutting data'), h('span', { class: 'tag mock' }, 'Placeholder')),
      tool.cuttingData.length === 0
        ? h('p', { class: 'fine' }, 'No cutting data yet.')
        : h(
            'table',
            { class: 'slot-table' },
            h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Material'), h('th', { scope: 'col' }, 'vc'), h('th', { scope: 'col' }, 'fz'), h('th', { scope: 'col' }, 'Source'))),
            h('tbody', null, tool.cuttingData.map((c) => h('tr', { key: c.materialRef }, h('td', null, material(c.materialRef)?.name ?? c.materialRef), h('td', null, String(c.vc)), h('td', null, String(c.fz)), h('td', null, SOURCE_LABELS[c.source] ?? c.source)))),
          ),
      h('p', { class: 'fine' }, PLACEHOLDER_NOTE),
    ),
    h(
      'section',
      { class: 'insp' },
      h('header', null, h('h2', null, 'Firmware tool table'), h('span', { class: 'tag mock' }, 'Needs firmware support')),
      h('p', { class: 'fine' }, 'The controller has no tool table today. It reports only the active tool number. If the firmware adds one, its slots line up with this library.'),
      h('button', { type: 'button', class: 'wide', disabled: true }, 'Compare with the controller'),
    ),
  );
}

export function ToolsView(): ComponentChild {
  const tools = toolStore.value.value;
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const shown = tools.filter((t) => filter === 'all' || t.type === filter);
  const current = tools.find((t) => t.id === selected) ?? shown[0] ?? tools[0] ?? null;
  return h(
    'div',
    { class: 'tools-view' },
    h(
      'div',
      { class: 'view-head' },
      h('div', { class: 'title-block' }, h('h1', null, 'Tool library'), h('p', null, 'Your cutters, kept in this browser. Account sync comes later.')),
      h('div', { class: 'view-actions' }, h('button', { type: 'button', class: 'primary', 'data-action': 'add-tool', onClick: () => setSelected(addTool()) }, 'Add a tool')),
    ),
    h(
      'div',
      { class: 'workspace-grid tools-grid' },
      h(
        'div',
        { class: 'list-panel' },
        h(
          'div',
          { class: 'filter-row', role: 'group', 'aria-label': 'Filter tools' },
          (
            [
              ['all', 'All'],
              ['flat', 'End mills'],
              ['ball', 'Ball nose'],
              ['vbit', 'V-bits'],
              ['drill', 'Drills'],
              ['oflute', 'O-flutes'],
            ] as const
          ).map(([id, label]) => h('button', { type: 'button', key: id, class: `chip${filter === id ? ' selected' : ''}`, 'aria-pressed': filter === id ? 'true' : 'false', onClick: () => setFilter(id) }, label)),
          h('span', { class: 'sync-line' }, toolStore.saved.value ? 'Saved in this browser' : 'Not saved: this browser blocks storage'),
        ),
        h(
          'div',
          { tabindex: 0, class: 'tool-table-wrap' },
          h(
            'table',
            { class: 'tool-table' },
            h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Drawing')), h('th', { scope: 'col' }, 'Tool'), h('th', { scope: 'col' }, 'Diameter'), h('th', { scope: 'col' }, 'Flutes'), h('th', { scope: 'col' }, 'Material'), h('th', { scope: 'col' }, 'Notes'))),
            h(
              'tbody',
              null,
              shown.map((t) =>
                h(
                  'tr',
                  { key: t.id, 'aria-selected': current?.id === t.id ? 'true' : 'false', onClick: () => setSelected(t.id) },
                  h('td', { class: 't-art' }, h(ToolArt, { tool: t })),
                  h('td', null, h('button', { type: 'button', class: 'row-link', onClick: () => setSelected(t.id) }, h('strong', null, `T${t.number} · ${t.name}`)), h('small', null, TOOL_KINDS[t.type] ?? t.type)),
                  h('td', { class: 'num' }, `${t.diameter} mm`),
                  h('td', { class: 'num' }, String(t.flutes)),
                  h('td', null, `${t.material}${t.coating === 'Uncoated' ? '' : ` · ${t.coating}`}`),
                  h('td', { class: 'used' }, t.notes === '' ? '—' : t.notes),
                ),
              ),
            ),
          ),
        ),
      ),
      current === null ? h('aside', { tabindex: 0, class: 'inspector' }, h('section', { class: 'insp' }, h('p', null, 'No tools yet. Add one to begin.'))) : h(ToolInspector, { tool: current, key: current.id }),
    ),
  );
}

// ---------------------------------------------------------------- materials

function swatch(m: Material): ComponentChild {
  const c = m.color;
  return h('svg', { class: 'key-swatch', viewBox: '0 0 12 12', 'aria-hidden': 'true' }, h('rect', { x: 0.5, y: 0.5, width: 11, height: 11, rx: 2.5, fill: `rgb(${c[0] ?? 128},${c[1] ?? 128},${c[2] ?? 128})` }));
}

function MaterialInspector({ m, onSelect }: { readonly m: Material; readonly onSelect: (id: string) => void }): ComponentChild {
  const row = m.cutting[0];
  return h(
    'aside',
    { tabindex: 0, class: 'inspector', 'aria-label': 'Selected material' },
    h(
      'section',
      { class: 'insp', 'data-material': m.id },
      h('header', null, h('h2', null, m.name), h('span', { class: `tag${m.source === 'mine' ? ' ok' : ''}` }, m.source === 'mine' ? 'Mine' : 'Built-in')),
      h('p', { class: 'fine' }, [FAMILIES[m.family] ?? m.family, m.grade].filter((x) => x !== '').join(' · ')),
      m.safety.length === 0 ? null : h('ul', { class: 'safety-notes', 'data-region': 'material-safety' }, m.safety.map((s, i) => h('li', { key: String(i), class: s.level }, s.text))),
      h('p', { class: 'lede' }, m.description),
      m.doNotMachine
        ? null
        : h(
            'dl',
            { class: 'facts' },
            h('div', null, h('dt', null, 'Coolant'), h('dd', null, m.coolant.need)),
            m.forkOf === undefined ? null : h('div', null, h('dt', null, 'Copied from'), h('dd', null, `${material(m.forkOf.id)?.name ?? m.forkOf.id}, version ${m.forkOf.version}`)),
          ),
      m.doNotMachine ? null : h('p', { class: 'fine' }, m.coolant.reason),
      m.behaviour.length === 0 ? null : h('ul', { class: 'behaviour' }, m.behaviour.map((b) => h('li', { key: b }, b))),
      m.source === 'builtin' && !m.doNotMachine
        ? h(
            'button',
            {
              type: 'button',
              class: 'wide',
              'data-action': 'fork-material',
              onClick: () => {
                const id = forkMaterial(m.id);
                if (id !== null) onSelect(id);
              },
            },
            'Make my own copy',
          )
        : null,
    ),
    m.source === 'mine'
      ? h(
          'section',
          { class: 'insp' },
          h('header', null, h('h2', null, 'My notes')),
          h('label', { class: 'field' }, h('span', null, 'Name'), h('span', { class: 'unit-input' }, h('input', { value: m.name, maxLength: 60, onChange: (e: Event) => updateMyMaterial(m.id, { name: (e.currentTarget as HTMLInputElement).value.slice(0, 60) || m.name }) }))),
          textArea('Notes', m.notes, (notes) => updateMyMaterial(m.id, { notes })),
          m.purchase.length === 0 ? null : h('ul', { class: 'purchases' }, m.purchase.map((p, i) => h(PurchaseLine, { p, key: String(i) }))),
          h(AddLink, { onAdd: (p) => updateMyMaterial(m.id, { purchase: [...m.purchase, p] }) }),
        )
      : null,
    row === undefined
      ? null
      : h(
          'section',
          { class: 'insp' },
          h('header', null, h('h2', null, 'Cutting data'), h('span', { class: 'tag mock' }, 'Placeholder')),
          h('dl', { class: 'facts' }, h('div', null, h('dt', null, `Surface speed, ${row.toolMaterial}`), h('dd', null, `${row.vc[0]}–${row.vc[1]} m/min`)), ...row.fz.map(([d, fz]) => h('div', { key: String(d) }, h('dt', null, `Chip load at ${d} mm`), h('dd', null, `${fz} mm/tooth`)))),
          h('p', { class: 'fine' }, PLACEHOLDER_NOTE),
        ),
  );
}

export function MaterialsView(): ComponentChild {
  const list = allMaterials.value;
  const [filter, setFilter] = useState<'all' | 'builtin' | 'mine'>('all');
  const [selected, setSelected] = useState<string>('al6061');
  const shown = list.filter((m) => filter === 'all' || m.source === filter);
  const current = material(selected) ?? shown[0] ?? null;
  const families = [...new Set(shown.map((m) => m.family))];
  return h(
    'div',
    { class: 'materials-view' },
    h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, 'Materials'), h('p', null, 'What you cut: built-in materials and your own copies, with their safety notes.'))),
    h(
      'div',
      { class: 'workspace-grid tools-grid' },
      h(
        'div',
        { class: 'list-panel' },
        h(
          'div',
          { class: 'filter-row', role: 'group', 'aria-label': 'Filter materials' },
          (
            [
              ['all', 'All'],
              ['builtin', 'Built-in'],
              ['mine', `Mine (${myMaterialStore.value.value.length})`],
            ] as const
          ).map(([id, label]) => h('button', { type: 'button', key: id, class: `chip${filter === id ? ' selected' : ''}`, 'aria-pressed': filter === id ? 'true' : 'false', onClick: () => setFilter(id) }, label)),
          h('span', { class: 'sync-line' }, myMaterialStore.saved.value ? 'Saved in this browser' : 'Not saved: this browser blocks storage'),
        ),
        h(
          'div',
          { tabindex: 0, class: 'tool-table-wrap material-list' },
          families.map((f) =>
            h(
              'section',
              { key: f, class: 'material-family' },
              h('h3', null, FAMILIES[f] ?? f),
              h(
                'ul',
                null,
                shown
                  .filter((m) => m.family === f)
                  .map((m) =>
                    h(
                      'li',
                      { key: m.id },
                      h(
                        'button',
                        { type: 'button', class: `material-row${current?.id === m.id ? ' selected' : ''}`, 'aria-pressed': current?.id === m.id ? 'true' : 'false', onClick: () => setSelected(m.id) },
                        swatch(m),
                        h('span', { class: 'grow' }, h('strong', null, m.name), h('small', null, m.grade)),
                        m.doNotMachine ? h('span', { class: 'tag danger' }, 'Do not machine') : m.safety.some((s) => s.level === 'danger') ? h('span', { class: 'tag warn' }, 'Hazardous dust') : null,
                        m.source === 'mine' ? h('span', { class: 'tag ok' }, 'Mine') : null,
                      ),
                    ),
                  ),
              ),
            ),
          ),
          h('p', { class: 'fine pad' }, NOT_OFFERED),
        ),
      ),
      current === null ? h('aside', { tabindex: 0, class: 'inspector' }) : h(MaterialInspector, { m: current, onSelect: setSelected, key: current.id }),
    ),
  );
}
