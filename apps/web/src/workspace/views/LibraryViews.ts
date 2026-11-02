/**
 * The Tools and Materials views (MACHINING_ASSISTANT §2, §3, §8) on
 * `@synthetos/library` records: the tool library with descriptions, notes
 * and purchase links, and the material library (built-in and mine) with its
 * safety notes.
 *
 * Every placeholder number is shown with its placeholder flag. Links people
 * add go through `safeExternalLink` (http(s) only) and render as plain
 * external links: a new tab, `rel="noopener noreferrer nofollow"`, never
 * fetched. The Synthetos store is mocked and labelled.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { isPlaceholder, type Sourced } from '@synthetos/library';
import {
  addTool,
  allMaterials,
  doNotMachine,
  editMyMaterial,
  FAMILIES,
  FAMILY_COLOR,
  forkMaterial,
  hostOf,
  material,
  materialView,
  money,
  myMaterialStore,
  NOT_OFFERED,
  safeExternalLink,
  SOURCE_LABELS,
  TOOL_KINDS,
  toolStore,
  updateTool,
  type Material,
  type MaterialView,
  type PurchaseLink,
  type Tool,
  type ToolEntry,
} from '../library.ts';
import { Icon } from '../icons.ts';
import { num } from '../status.ts';

export const PLACEHOLDER_NOTE = 'Placeholder values: not yet sourced. They show the shape of the data, not machining advice.';

/** A sourced number with its placeholder flag, never a bare number. */
function sourced<T>(v: Sourced<T>, show: (value: T) => string): ComponentChild {
  return h('span', { class: 'sourced' }, show(v.value), isPlaceholder(v) ? h('span', { class: 'tag mock', title: v.note ?? 'Placeholder value: no cited source yet.' }, 'Placeholder') : null);
}

/** A purchase line: a plain external link when `safeExternalLink` accepts it, plain text otherwise. */
export function PurchaseLine({ p }: { readonly p: PurchaseLink }): ComponentChild {
  const link = safeExternalLink(p.url);
  const what = [p.vendor, p.sku].filter((x): x is string => x !== undefined && x !== '').join(' · ');
  const meta = [p.price === undefined ? null : money(p.price, p.currency), p.boughtAt === undefined ? null : `bought ${p.boughtAt}`].filter((x) => x !== null).join(' · ');
  return h(
    'li',
    { class: 'purchase' },
    link === null ? h('span', null, what) : h('a', { href: link.href, target: link.target, rel: link.rel, 'data-external': hostOf(link.href) }, what, ' ', Icon('external', 13), h('span', { class: 'sr-only' }, ' (opens in a new tab)')),
    meta === '' ? null : h('small', null, meta),
  );
}

function AddLink({ onAdd }: { readonly onAdd: (p: PurchaseLink) => string | null }): ComponentChild {
  const [vendor, setVendor] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  return h(
    'form',
    {
      class: 'add-link',
      onSubmit: (e: Event) => {
        e.preventDefault();
        const link = safeExternalLink(url.trim());
        if (link === null) {
          setError('Enter a full web address that starts with https or http.');
          return;
        }
        const refused = onAdd({ kind: 'link', vendor: vendor.trim().slice(0, 60) || hostOf(link.href), url: link.href });
        if (refused !== null) {
          setError(refused);
          return;
        }
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

/** A side view of the tool, in proportion, from its type and geometry. */
export function ToolArt({ tool, large = false }: { readonly tool: Tool; readonly large?: boolean }): ComponentChild {
  const g = tool.geometry;
  const H = 100;
  const k = H / Math.max(g.overallLength, 1);
  const d = Math.max(g.diameter * k * (large ? 1.6 : 2.2), 3);
  const sd = Math.max(g.shank * k * (large ? 1.6 : 2.2), 3);
  const flute = g.fluteLength * k;
  const cx = 20;
  const fluteTop = H - flute;
  const l = cx - d / 2;
  const r = cx + d / 2;
  const angle = g.vAngle ?? g.pointAngle ?? 118;
  const tipLen = Math.min(flute, d / 2 / Math.tan(((angle / 2) * Math.PI) / 180));
  const body =
    tool.type === 'ball'
      ? `M${l} ${fluteTop}L${r} ${fluteTop}L${r} ${H - d / 2}A${d / 2} ${d / 2} 0 0 1 ${l} ${H - d / 2}Z`
      : tool.type === 'v-bit' || tool.type === 'drill' || tool.type === 'chamfer' || tool.type === 'engraver'
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
          if (Number.isFinite(n) && n > 0) onChange(n);
        },
      }),
      unit === '' ? null : h('i', null, unit),
    ),
  );
}

function textArea(label: string, value: string, onChange: (s: string) => void, max = 2000): ComponentChild {
  return h('label', { class: 'field', key: label }, h('span', null, label), h('textarea', { class: 'text-area', rows: 3, maxLength: max, value, onChange: (e: Event) => onChange((e.currentTarget as HTMLTextAreaElement).value.slice(0, max)) }));
}

function ToolInspector({ entry }: { readonly entry: ToolEntry }): ComponentChild {
  const tool = entry.tool;
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Readonly<Record<string, unknown>>): void => setError(updateTool(tool.id, patch));
  const geo = (field: string, n: number): void => set({ geometry: { ...tool.geometry, [field]: n } });
  return h(
    'aside',
    { tabindex: 0, class: 'inspector', 'aria-label': 'Selected tool' },
    h(
      'section',
      { class: 'insp', 'data-tool': tool.id },
      h('header', null, h('h2', null, `T${entry.number} · ${tool.name}`), h('span', { class: 'tag' }, TOOL_KINDS[tool.type] ?? tool.type)),
      h('div', { class: 'tool-drawing' }, h(ToolArt, { tool, large: true })),
      h(
        'div',
        { class: 'field-grid' },
        numberField('Diameter', tool.geometry.diameter, 'mm', (n) => geo('diameter', n)),
        numberField('Flutes', tool.geometry.flutes, '', (n) => geo('flutes', Math.max(1, Math.round(n))), 1),
        numberField('Flute length', tool.geometry.fluteLength, 'mm', (n) => geo('fluteLength', n), 0.5),
        numberField('Overall length', tool.geometry.overallLength, 'mm', (n) => geo('overallLength', n), 0.5),
      ),
      textArea('Description', tool.description, (description) => set({ description })),
      textArea('Notes', tool.notes, (notes) => set({ notes })),
      error === null ? null : h('p', { class: 'field-error', role: 'alert' }, `Not saved: ${error}`),
      h(
        'dl',
        { class: 'facts' },
        h('div', null, h('dt', null, 'Maker'), h('dd', null, [tool.manufacturer, tool.partNumber].filter((x) => x !== undefined && x !== '').join(' · ') || 'Not recorded')),
        h('div', null, h('dt', null, 'Material'), h('dd', null, `${tool.toolMaterial} · ${tool.coating}`)),
        h('div', null, h('dt', null, 'Cut so far'), h('dd', null, `${num(tool.life.minutes)} min`)),
        h('div', null, h('dt', null, 'Version'), h('dd', null, String(tool.version))),
      ),
    ),
    h(
      'section',
      { class: 'insp' },
      h('header', null, h('h2', null, 'Where to buy')),
      entry.store === null ? null : h('ul', { class: 'purchases' }, h('li', { class: 'purchase' }, h('span', null, `Synthetos · ${entry.store}`, h('span', { class: 'tag mock' }, 'Store · mock')))),
      tool.purchase.length === 0 && entry.store === null ? h('p', { class: 'fine' }, 'No purchase links yet.') : h('ul', { class: 'purchases' }, tool.purchase.map((p, i) => h(PurchaseLine, { p, key: String(i) }))),
      h(AddLink, { onAdd: (p) => updateTool(tool.id, { purchase: [...tool.purchase, p] }) }),
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
            h('tbody', null, tool.cuttingData.map((c, i) => h('tr', { key: String(i) }, h('td', null, material(c.materialRef.id)?.name ?? c.materialRef.id), h('td', null, String(c.vc)), h('td', null, String(c.fz)), h('td', null, SOURCE_LABELS[c.source] ?? c.source)))),
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
  const shown = tools.filter((t) => filter === 'all' || t.tool.type === filter);
  const current = tools.find((t) => t.tool.id === selected) ?? shown[0] ?? tools[0] ?? null;
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
              ['v-bit', 'V-bits'],
              ['drill', 'Drills'],
              ['o-flute', 'O-flutes'],
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
              shown.map((e) =>
                h(
                  'tr',
                  { key: e.tool.id, 'aria-selected': current?.tool.id === e.tool.id ? 'true' : 'false', onClick: () => setSelected(e.tool.id) },
                  h('td', { class: 't-art' }, h(ToolArt, { tool: e.tool })),
                  h('td', null, h('button', { type: 'button', class: 'row-link', onClick: () => setSelected(e.tool.id) }, h('strong', null, `T${e.number} · ${e.tool.name}`)), h('small', null, TOOL_KINDS[e.tool.type] ?? e.tool.type)),
                  h('td', { class: 'num' }, `${e.tool.geometry.diameter} mm`),
                  h('td', { class: 'num' }, String(e.tool.geometry.flutes)),
                  h('td', null, `${e.tool.toolMaterial}${e.tool.coating === 'uncoated' ? '' : ` · ${e.tool.coating}`}`),
                  h('td', { class: 'used' }, e.tool.notes === '' ? '—' : e.tool.notes),
                ),
              ),
            ),
          ),
        ),
      ),
      current === null ? h('aside', { class: 'inspector' }, h('section', { class: 'insp' }, h('p', null, 'No tools yet. Add one to begin.'))) : h(ToolInspector, { entry: current, key: current.tool.id }),
    ),
  );
}

// ---------------------------------------------------------------- materials

function swatch(m: Material): ComponentChild {
  const c = FAMILY_COLOR[m.family];
  return h('svg', { class: 'key-swatch', viewBox: '0 0 12 12', 'aria-hidden': 'true' }, h('rect', { x: 0.5, y: 0.5, width: 11, height: 11, rx: 2.5, fill: `rgb(${c[0]},${c[1]},${c[2]})` }));
}

const SEVERITY_CLASS: Readonly<Record<string, string>> = { 'do-not-machine': 'danger', hazard: 'danger', caution: 'warn', info: 'info' };

export function SafetyNotes({ m, compact = false }: { readonly m: Material; readonly compact?: boolean }): ComponentChild {
  if (m.safety.length === 0) return null;
  return h('ul', { class: `safety-notes${compact ? ' compact' : ''}`, 'data-region': 'material-safety' }, m.safety.map((s, i) => h('li', { key: String(i), class: SEVERITY_CLASS[s.severity] ?? 'warn' }, s.text)));
}

function MaterialInspector({ view, onSelect }: { readonly view: MaterialView; readonly onSelect: (id: string) => void }): ComponentChild {
  const m = view.material;
  const [error, setError] = useState<string | null>(null);
  const row = m.cutting[0];
  const banned = doNotMachine(m);
  const parent = m.forkOf === undefined ? null : material(m.forkOf.id);
  return h(
    'aside',
    { tabindex: 0, class: 'inspector', 'aria-label': 'Selected material' },
    h(
      'section',
      { class: 'insp', 'data-material': m.id },
      h('header', null, h('h2', null, m.name), h('span', { class: `tag${view.source === 'mine' ? ' ok' : ''}` }, view.source === 'mine' ? 'Mine' : 'Built-in')),
      h('p', { class: 'fine' }, [FAMILIES[m.family], m.grade].filter((x) => x !== '').join(' · ')),
      h(SafetyNotes, { m }),
      m.description === '' ? null : h('p', { class: 'lede' }, m.description),
      banned
        ? null
        : h(
            'dl',
            { class: 'facts' },
            h('div', null, h('dt', null, 'Coolant'), h('dd', null, m.coolant.need)),
            m.physical.density === undefined ? null : h('div', null, h('dt', null, 'Density'), h('dd', null, sourced(m.physical.density, (v) => `${v} g/cm³`))),
            m.physical.hardness === undefined ? null : h('div', null, h('dt', null, 'Hardness'), h('dd', null, sourced(m.physical.hardness, (v) => `${v.value} ${v.scale}`))),
            parent === null || m.forkOf === undefined ? null : h('div', null, h('dt', null, 'Copied from'), h('dd', null, `${parent.name}, version ${m.forkOf.version}`)),
          ),
      banned ? null : h('p', { class: 'fine' }, m.coolant.reason),
      m.behaviour.length === 0 ? null : h('ul', { class: 'behaviour' }, m.behaviour.map((b) => h('li', { key: b.text }, b.text))),
      view.source === 'builtin' && !banned
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
    view.source === 'mine'
      ? h(
          'section',
          { class: 'insp' },
          h('header', null, h('h2', null, 'My notes')),
          h('label', { class: 'field' }, h('span', null, 'Name'), h('span', { class: 'unit-input' }, h('input', { value: m.name, maxLength: 60, onChange: (e: Event) => setError(editMyMaterial(m.id, 'name', (e.currentTarget as HTMLInputElement).value.slice(0, 60) || m.name)) }))),
          textArea('Notes', m.notes, (notes) => setError(editMyMaterial(m.id, 'notes', notes))),
          error === null ? null : h('p', { class: 'field-error', role: 'alert' }, `Not saved: ${error}`),
          m.purchase.length === 0 ? null : h('ul', { class: 'purchases' }, m.purchase.map((p, i) => h(PurchaseLine, { p, key: String(i) }))),
          h(AddLink, { onAdd: (p) => editMyMaterial(m.id, 'purchase', [...m.purchase, p]) }),
        )
      : null,
    row === undefined
      ? null
      : h(
          'section',
          { class: 'insp' },
          h('header', null, h('h2', null, 'Cutting data'), isPlaceholder(row.vc) ? h('span', { class: 'tag mock' }, 'Placeholder') : null),
          h(
            'dl',
            { class: 'facts' },
            h('div', null, h('dt', null, `Surface speed, ${row.toolMaterial}`), h('dd', null, sourced(row.vc, (v) => `${v.min}–${v.max} m/min`))),
            h('div', null, h('dt', null, 'Chip load'), h('dd', null, sourced(row.chipload, (v) => (v.kind === 'factor' ? `${v.min}–${v.max} × D per tooth` : `${v.points.length}-point curve`)))),
            h('div', null, h('dt', null, 'Depth, hobby frame'), h('dd', null, sourced(row.engagement, (v) => `${v.hobby.ap} × D deep, ${v.hobby.ae} × D wide`))),
          ),
          h('p', { class: 'fine' }, PLACEHOLDER_NOTE),
        ),
  );
}

export function MaterialsView(): ComponentChild {
  const list = allMaterials.value;
  const [filter, setFilter] = useState<'all' | 'builtin' | 'mine'>('all');
  const [selected, setSelected] = useState<string>(list[0]?.material.id ?? '');
  const shown = list.filter((m) => filter === 'all' || m.source === filter);
  const current = materialView(selected) ?? shown[0] ?? null;
  const families = [...new Set(shown.map((m) => m.material.family))];
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
              h('h3', null, FAMILIES[f]),
              h(
                'ul',
                null,
                shown
                  .filter((v) => v.material.family === f)
                  .map((v) => {
                    const m = v.material;
                    const on = current?.material.id === m.id;
                    return h(
                      'li',
                      { key: m.id },
                      h(
                        'button',
                        { type: 'button', class: `material-row${on ? ' selected' : ''}`, 'aria-pressed': on ? 'true' : 'false', onClick: () => setSelected(m.id) },
                        swatch(m),
                        h('span', { class: 'grow' }, h('strong', null, m.name), h('small', null, m.grade)),
                        doNotMachine(m) ? h('span', { class: 'tag danger' }, 'Do not machine') : m.safety.some((s) => s.severity === 'hazard') ? h('span', { class: 'tag warn' }, 'Hazard') : null,
                        v.source === 'mine' ? h('span', { class: 'tag ok' }, 'Mine') : null,
                      ),
                    );
                  }),
              ),
            ),
          ),
          h('p', { class: 'fine pad' }, NOT_OFFERED),
        ),
      ),
      current === null ? h('aside', { class: 'inspector' }) : h(MaterialInspector, { view: current, onSelect: setSelected, key: current.material.id }),
    ),
  );
}
