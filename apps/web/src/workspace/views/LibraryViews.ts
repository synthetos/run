/**
 * The Tools and Materials views (MACHINING_ASSISTANT §2, §3, §8) on
 * `@synthetos/library` records: the tool library with descriptions, notes
 * and purchase links, and the material library (built-in and mine) with its
 * safety notes and a full create/edit form for my own materials.
 *
 * Every placeholder number is shown with its placeholder flag; numbers people
 * type in are recorded as their own (`userValue`). Links people add go
 * through `safeExternalLink` (http(s) only) and render as plain external
 * links: a new tab, `rel="noopener noreferrer nofollow"`, never fetched. The
 * Synthetos store is mocked and labelled.
 *
 * Tools live in software, in this library: TinyG has no firmware tool table
 * and none is shown. (g2core may get one later; `Tool.firmwareSlot` keeps the
 * shape for that, unused here.)
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { isPlaceholder, userValue, MATERIAL_FAMILIES, TOOL_MATERIALS, type CoolantNeed, type HardnessScale, type MaterialCutting, type SafetySeverity, type BehaviourKind, type Sourced } from '@synthetos/library';
import {
  addTool,
  allMaterials,
  createMaterial,
  deleteMaterial,
  doNotMachine,
  FAMILIES,
  FAMILY_COLOR,
  forkMaterial,
  hostOf,
  material,
  materialView,
  money,
  myMaterialCount,
  myMaterialStore,
  NOT_OFFERED,
  safeExternalLink,
  SOURCE_LABELS,
  TOOL_KINDS,
  toolStore,
  updateMaterial,
  updateTool,
  type Material,
  type MaterialFields,
  type MaterialView,
  type PurchaseLink,
  type Tool,
  type ToolEntry,
} from '../library.ts';
import { Icon } from '../icons.ts';
import { num } from '../status.ts';
import { TabBar, TabPane } from '../ui.ts';

export const PLACEHOLDER_NOTE = 'Placeholder values: not yet sourced. They show the shape of the data, not machining advice.';

/** A sourced number with its placeholder flag, never a bare number. */
function sourced<T>(v: Sourced<T>, show: (value: T) => string): ComponentChild {
  return h('span', { class: 'sourced' }, show(v.value), isPlaceholder(v) ? h('span', { class: 'tag mock', title: v.note ?? 'Placeholder value: no cited source yet.' }, 'Placeholder') : null);
}

// ---------------------------------------------------------------- links

/** A purchase line: a plain external link when `safeExternalLink` accepts it, plain text otherwise. */
export function PurchaseLine({ p, onRemove }: { readonly p: PurchaseLink; readonly onRemove?: () => void }): ComponentChild {
  const link = safeExternalLink(p.url);
  const name = p.vendor !== '' ? p.vendor : link === null ? p.url : hostOf(link.href);
  const meta = [p.sku, p.price === undefined ? null : money(p.price, p.currency), p.boughtAt === undefined ? null : `bought ${p.boughtAt}`].filter((x) => x !== null && x !== undefined && x !== '').join(' · ');
  return h(
    'li',
    { class: 'purchase' },
    link === null ? h('span', null, name) : h('a', { href: link.href, target: link.target, rel: link.rel, 'data-external': hostOf(link.href), title: link.href }, name, Icon('external', 12), h('span', { class: 'sr-only' }, ' (opens in a new tab)')),
    meta === '' ? null : h('small', null, meta),
    onRemove === undefined ? null : h('button', { type: 'button', class: 'icon-button quiet remove', 'data-action': 'remove-link', 'aria-label': `Remove the link to ${name}`, onClick: onRemove }, Icon('trash', 14)),
  );
}

/** One web address and Add. Shop name and price sit behind "More". */
export function AddLink({ onAdd }: { readonly onAdd: (p: PurchaseLink) => string | null }): ComponentChild {
  const [url, setUrl] = useState('');
  const [more, setMore] = useState(false);
  const [vendor, setVendor] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  return h(
    'form',
    {
      class: 'add-link',
      onSubmit: (e: Event) => {
        e.preventDefault();
        const link = safeExternalLink(url.trim());
        if (link === null) {
          setError('Enter a full web address that starts with https');
          return;
        }
        const n = Number.parseFloat(price);
        const refused = onAdd({ kind: 'link', vendor: vendor.trim().slice(0, 60) || hostOf(link.href), url: link.href, ...(Number.isFinite(n) && n >= 0 ? { price: Math.round(n * 100) / 100, currency: 'USD' } : {}) });
        if (refused !== null) {
          setError(refused);
          return;
        }
        setUrl('');
        setVendor('');
        setPrice('');
        setError(null);
      },
    },
    h(
      'div',
      { class: 'add-link-row' },
      h('input', { type: 'url', value: url, maxLength: 500, placeholder: 'Paste a web address', 'aria-label': 'Link', onInput: (e: Event) => setUrl((e.currentTarget as HTMLInputElement).value) }),
      h('button', { type: 'submit', class: 'small', 'data-action': 'add-link' }, Icon('plus', 14), 'Add'),
      h('button', { type: 'button', class: 'small quiet', 'data-action': 'more-link', 'aria-expanded': more ? 'true' : 'false', onClick: () => setMore(!more) }, 'More'),
    ),
    more
      ? h(
          'div',
          { class: 'add-link-more' },
          h('input', { value: vendor, maxLength: 60, placeholder: 'Shop (optional)', 'aria-label': 'Shop', onInput: (e: Event) => setVendor((e.currentTarget as HTMLInputElement).value) }),
          h('input', { type: 'number', min: 0, step: 0.01, value: price, placeholder: 'Price, USD', 'aria-label': 'Price in US dollars', onInput: (e: Event) => setPrice((e.currentTarget as HTMLInputElement).value) }),
        )
      : null,
    error === null ? null : h('p', { class: 'field-error', role: 'alert' }, error),
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

function textArea(label: string, value: string, onChange: (s: string) => void, max = 2000, rows = 3): ComponentChild {
  return h('label', { class: 'field', key: label }, h('span', null, label), h('textarea', { class: 'text-area', rows, maxLength: max, value, onChange: (e: Event) => onChange((e.currentTarget as HTMLTextAreaElement).value.slice(0, max)) }));
}

type ToolTab = 'details' | 'buy' | 'cutting';

function ToolInspector({ entry }: { readonly entry: ToolEntry }): ComponentChild {
  const tool = entry.tool;
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ToolTab>('details');
  const set = (patch: Readonly<Record<string, unknown>>): void => setError(updateTool(tool.id, patch));
  const geo = (field: string, n: number): void => set({ geometry: { ...tool.geometry, [field]: n } });
  const links = tool.purchase.length + (entry.store === null ? 0 : 1);
  return h(
    'aside',
    { class: 'inspector tabbed', 'aria-label': 'Selected tool', 'data-tool': tool.id },
    h('header', { class: 'insp-head' }, h('div', { class: 'tool-head' }, h('div', { class: 'tool-mini-art' }, h(ToolArt, { tool, large: true })), h('div', null, h('h2', null, `T${entry.number} · ${tool.name}`), h('p', { class: 'fine' }, `${TOOL_KINDS[tool.type] ?? tool.type} · ${tool.geometry.diameter} mm · ${tool.geometry.flutes} flutes`)))),
    h(TabBar<ToolTab>, { label: 'Tool', prefix: 'tool', variant: 'underline', current: tab, onSelect: setTab, tabs: [{ id: 'details', label: 'Details' }, { id: 'buy', label: 'Where to buy', ...(links === 0 ? {} : { badge: String(links) }) }, { id: 'cutting', label: 'Cutting data' }] }),
    h(
      TabPane,
      { prefix: 'tool', id: 'details', current: tab, class: 'tpane insp-scroll' },
      h(
        'section',
        { class: 'insp' },
        h(
          'div',
          { class: 'field-grid' },
          numberField('Diameter', tool.geometry.diameter, 'mm', (n) => geo('diameter', n)),
          numberField('Flutes', tool.geometry.flutes, '', (n) => geo('flutes', Math.max(1, Math.round(n))), 1),
          numberField('Flute length', tool.geometry.fluteLength, 'mm', (n) => geo('fluteLength', n), 0.5),
          numberField('Overall length', tool.geometry.overallLength, 'mm', (n) => geo('overallLength', n), 0.5),
        ),
        textArea('Description', tool.description, (description) => set({ description }), 2000, 2),
        textArea('Notes', tool.notes, (notes) => set({ notes }), 2000, 2),
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
    ),
    h(
      TabPane,
      { prefix: 'tool', id: 'buy', current: tab, class: 'tpane insp-scroll' },
      h(
        'section',
        { class: 'insp' },
        h(
          'ul',
          { class: 'purchases' },
          entry.store === null ? null : h('li', { class: 'purchase' }, h('span', null, `Synthetos · ${entry.store}`), h('span', { class: 'tag mock' }, 'Store · mock')),
          tool.purchase.map((p, i) => h(PurchaseLine, { p, key: String(i), onRemove: () => setError(updateTool(tool.id, { purchase: tool.purchase.filter((_, j) => j !== i) })) })),
        ),
        h(AddLink, { onAdd: (p) => updateTool(tool.id, { purchase: [...tool.purchase, p] }) }),
      ),
    ),
    h(
      TabPane,
      { prefix: 'tool', id: 'cutting', current: tab, class: 'tpane insp-scroll' },
      h(
        'section',
        { class: 'insp' },
        tool.cuttingData.length === 0
          ? h('p', { class: 'fine' }, 'No cutting data yet.')
          : h(
              'table',
              { class: 'slot-table' },
              h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Material'), h('th', { scope: 'col' }, 'Surface speed (m/min)'), h('th', { scope: 'col' }, 'Chipload (mm/tooth)'), h('th', { scope: 'col' }, 'Source'))),
              h('tbody', null, tool.cuttingData.map((c, i) => h('tr', { key: String(i) }, h('td', null, material(c.materialRef.id)?.name ?? c.materialRef.id), h('td', null, String(c.vc)), h('td', null, String(c.fz)), h('td', null, SOURCE_LABELS[c.source] ?? c.source)))),
            ),
        h('p', { class: 'fine' }, PLACEHOLDER_NOTE),
      ),
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
      h('div', { class: 'title-block' }, h('h1', null, 'Tool library'), h('p', null, 'Your cutters, kept in this browser.')),
      h('div', { class: 'view-actions' }, h('button', { type: 'button', class: 'primary', 'data-action': 'add-tool', onClick: () => setSelected(addTool()) }, Icon('plus', 15), 'Add a tool')),
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
                  h('td', { class: 'used' }, e.tool.notes === '' ? 'No notes' : e.tool.notes),
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
const COOLANT_TEXT: Readonly<Record<CoolantNeed, string>> = { required: 'Coolant required', recommended: 'Coolant recommended', none: 'No coolant needed', avoid: 'Avoid coolant' };

export function SafetyNotes({ m, compact = false }: { readonly m: Material; readonly compact?: boolean }): ComponentChild {
  if (m.safety.length === 0) return null;
  return h('ul', { class: `safety-notes${compact ? ' compact' : ''}`, 'data-region': 'material-safety' }, m.safety.map((s, i) => h('li', { key: String(i), class: SEVERITY_CLASS[s.severity] ?? 'warn' }, s.text)));
}

/** The material's flags inline: the worst safety note and the coolant need. Icons with text, never colour alone. */
function MaterialFlags({ m }: { readonly m: Material }): ComponentChild {
  const banned = doNotMachine(m);
  const hazard = m.safety.some((s) => s.severity === 'hazard');
  const caution = m.safety.some((s) => s.severity === 'caution');
  return h(
    'span',
    { class: 'mat-flags' },
    banned
      ? h('span', { class: 'flag danger', title: m.safety.find((s) => s.severity === 'do-not-machine')?.text }, Icon('hazard', 13), 'Do not machine')
      : hazard
        ? h('span', { class: 'flag warn', title: m.safety.filter((s) => s.severity === 'hazard').map((s) => s.text).join(' ') }, Icon('hazard', 13), 'Hazard')
        : caution
          ? h('span', { class: 'flag muted', title: m.safety.filter((s) => s.severity === 'caution').map((s) => s.text).join(' ') }, Icon('warning', 13), 'Caution')
          : null,
    banned ? null : h('span', { class: `flag coolant need-${m.coolant.need}`, title: COOLANT_TEXT[m.coolant.need] }, Icon('droplet', 13), m.coolant.need === 'required' ? 'Coolant' : m.coolant.need === 'recommended' ? 'Air or mist' : m.coolant.need === 'avoid' ? 'Keep dry' : 'Dry'),
  );
}

type MatTab = 'overview' | 'cutting' | 'links';

function MaterialInspector({ view, onSelect, onEdit }: { readonly view: MaterialView; readonly onSelect: (id: string) => void; readonly onEdit: (id: string) => void }): ComponentChild {
  const m = view.material;
  const [tab, setTab] = useState<MatTab>('overview');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const banned = doNotMachine(m);
  const parent = m.forkOf === undefined ? null : material(m.forkOf.id);
  const mine = view.source === 'mine';
  const tabs: { id: MatTab; label: string; badge?: string }[] = [{ id: 'overview', label: 'Overview' }];
  if (!banned) tabs.push({ id: 'cutting', label: 'Cutting data' });
  tabs.push({ id: 'links', label: 'Links', ...(m.purchase.length === 0 ? {} : { badge: String(m.purchase.length) }) });
  return h(
    'aside',
    { class: 'inspector tabbed', 'aria-label': 'Selected material', 'data-material': m.id },
    h(
      'header',
      { class: 'insp-head' },
      h('div', { class: 'mat-head' }, swatch(m), h('div', { class: 'grow' }, h('h2', null, m.name), h('p', { class: 'fine' }, [FAMILIES[m.family], m.grade].filter((x) => x !== '').join(' · '))), h('span', { class: `tag${mine ? ' ok' : ''}` }, mine ? 'Mine' : 'Built-in')),
      h(
        'div',
        { class: 'mat-actions' },
        !mine && !banned
          ? h(
              'button',
              {
                type: 'button',
                class: 'small',
                'data-action': 'fork-material',
                onClick: () => {
                  const id = forkMaterial(m.id);
                  if (id !== null) onSelect(id);
                },
              },
              'Make my own copy',
            )
          : null,
        mine ? h('button', { type: 'button', class: 'small', 'data-action': 'edit-material', onClick: () => onEdit(m.id) }, Icon('edit', 14), 'Edit') : null,
        mine
          ? confirm
            ? h(
                'span',
                { class: 'confirm-row' },
                h('button', { type: 'button', class: 'small danger', 'data-action': 'delete-material', onClick: () => { if (!deleteMaterial(m.id)) setError('Only your own materials can be deleted.'); } }, 'Delete it'),
                h('button', { type: 'button', class: 'small quiet', 'data-action': 'cancel-delete', onClick: () => setConfirm(false) }, 'Keep'),
              )
            : h('button', { type: 'button', class: 'small quiet', 'data-action': 'ask-delete', onClick: () => setConfirm(true) }, Icon('trash', 14), 'Delete')
          : null,
      ),
      error === null ? null : h('p', { class: 'field-error', role: 'alert' }, error),
    ),
    h(TabBar<MatTab>, { label: 'Material', prefix: 'mat', variant: 'underline', current: tab, onSelect: setTab, tabs }),
    h(
      TabPane,
      { prefix: 'mat', id: 'overview', current: tab, class: 'tpane insp-scroll' },
      h(
        'section',
        { class: 'insp' },
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
              m.physical.kc === undefined ? null : h('div', null, h('dt', null, 'Cutting force kc'), h('dd', null, sourced(m.physical.kc, (v) => `${num(v)} N/mm²`))),
              parent === null || m.forkOf === undefined ? null : h('div', null, h('dt', null, 'Copied from'), h('dd', null, `${parent.name}, version ${m.forkOf.version}`)),
            ),
        banned || m.coolant.reason === '' ? null : h('p', { class: 'fine' }, m.coolant.reason),
        m.behaviour.length === 0 ? null : h('ul', { class: 'behaviour' }, m.behaviour.map((b) => h('li', { key: b.text }, b.text))),
        m.notes === '' ? null : h('p', { class: 'mat-notes' }, m.notes),
      ),
    ),
    banned
      ? null
      : h(
          TabPane,
          { prefix: 'mat', id: 'cutting', current: tab, class: 'tpane insp-scroll' },
          h(
            'section',
            { class: 'insp' },
            m.cutting.length === 0 ? h('p', { class: 'fine' }, 'No cutting data.') : null,
            m.cutting.map((row) =>
              h(
                'div',
                { key: row.toolMaterial, class: 'cut-block' },
                h('h3', { class: 'tan-label' }, `${row.toolMaterial === 'hss' ? 'HSS' : `${row.toolMaterial.slice(0, 1).toUpperCase()}${row.toolMaterial.slice(1)}`} tools`),
                h(
                  'dl',
                  { class: 'facts' },
                  h('div', null, h('dt', null, 'Surface speed'), h('dd', null, sourced(row.vc, (v) => `${v.min}–${v.max} m/min`))),
                  h('div', null, h('dt', null, 'Chip load'), h('dd', null, sourced(row.chipload, (v) => (v.kind === 'factor' ? `${v.min}–${v.max} × diameter` : `${v.points.length}-point curve`)))),
                  h('div', null, h('dt', null, 'Hobby frame'), h('dd', null, sourced(row.engagement, (v) => `${v.hobby.ap} × diameter deep, ${v.hobby.ae} × diameter wide`))),
                ),
              ),
            ),
            h('p', { class: 'fine' }, PLACEHOLDER_NOTE),
          ),
        ),
    h(
      TabPane,
      { prefix: 'mat', id: 'links', current: tab, class: 'tpane insp-scroll' },
      h(
        'section',
        { class: 'insp' },
        m.purchase.length === 0 ? (mine ? null : h('p', { class: 'fine' }, 'Copy this material to add links.')) : h('ul', { class: 'purchases' }, m.purchase.map((p, i) => h(PurchaseLine, { p, key: String(i), ...(mine ? { onRemove: () => setError(updateMaterial(m.id, { ...fieldsOf(m), purchase: m.purchase.filter((_, j) => j !== i) })) } : {}) }))),
        mine ? h(AddLink, { onAdd: (p) => updateMaterial(m.id, { ...fieldsOf(m), purchase: [...m.purchase, p] }) }) : null,
      ),
    ),
  );
}

function fieldsOf(m: Material): MaterialFields {
  const { id: _id, version: _v, forkOf: _f, ...rest } = m;
  return rest;
}

export function MaterialsView(): ComponentChild {
  const list = allMaterials.value;
  const [filter, setFilter] = useState<'all' | 'builtin' | 'mine'>('all');
  const [selected, setSelected] = useState<string>(list[0]?.material.id ?? '');
  const [form, setForm] = useState<{ readonly mode: 'new' } | { readonly mode: 'edit'; readonly id: string } | null>(null);
  const shown = list.filter((m) => filter === 'all' || m.source === filter);
  const current = materialView(selected) ?? shown[0] ?? null;
  const families = MATERIAL_FAMILIES.filter((f) => shown.some((m) => m.material.family === f));
  const editing = form?.mode === 'edit' ? materialView(form.id) : null;
  return h(
    'div',
    { class: 'materials-view' },
    h(
      'div',
      { class: 'view-head' },
      h('div', { class: 'title-block' }, h('h1', null, 'Materials'), h('p', null, 'What you cut, with its safety notes.')),
      h('div', { class: 'view-actions' }, h('button', { type: 'button', class: 'primary', 'data-action': 'new-material', onClick: () => setForm({ mode: 'new' }) }, Icon('plus', 15), 'New material')),
    ),
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
              ['mine', `Mine (${myMaterialCount.value})`],
            ] as const
          ).map(([id, label]) => h('button', { type: 'button', key: id, class: `chip${filter === id ? ' selected' : ''}`, 'aria-pressed': filter === id ? 'true' : 'false', onClick: () => setFilter(id) }, label)),
          h('span', { class: 'sync-line' }, myMaterialStore.saved.value ? 'Saved in this browser' : 'Not saved: this browser blocks storage'),
        ),
        h(
          'div',
          { tabindex: 0, class: 'tool-table-wrap' },
          h(
            'table',
            { class: 'mat-table' },
            h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Swatch')), h('th', { scope: 'col' }, 'Material'), h('th', { scope: 'col' }, 'Grade'), h('th', { scope: 'col' }, 'Safety and coolant'), h('th', { scope: 'col' }, 'Source'))),
            families.map((f) =>
              h(
                'tbody',
                { key: f },
                h('tr', { class: 'family-row' }, h('th', { scope: 'rowgroup', colSpan: 5 }, FAMILIES[f])),
                shown
                  .filter((v) => v.material.family === f)
                  .map((v) => {
                    const m = v.material;
                    const on = current?.material.id === m.id;
                    return h(
                      'tr',
                      { key: m.id, 'aria-selected': on ? 'true' : 'false', onClick: () => setSelected(m.id) },
                      h('td', { class: 'sw' }, swatch(m)),
                      h('td', null, h('button', { type: 'button', class: 'material-row row-link', 'aria-pressed': on ? 'true' : 'false', onClick: () => setSelected(m.id) }, m.name)),
                      h('td', { class: 'grade' }, m.grade),
                      h('td', null, h(MaterialFlags, { m })),
                      h('td', null, h('span', { class: `tag${v.source === 'mine' ? ' ok' : ''}` }, v.source === 'mine' ? 'Mine' : 'Built-in')),
                    );
                  }),
              ),
            ),
          ),
          h('p', { class: 'fine pad mat-foot' }, NOT_OFFERED),
        ),
      ),
      current === null ? h('aside', { class: 'inspector' }) : h(MaterialInspector, { view: current, onSelect: setSelected, onEdit: (id) => setForm({ mode: 'edit', id }), key: current.material.id }),
    ),
    form === null
      ? null
      : h(MaterialForm, {
          key: form.mode === 'edit' ? form.id : 'new',
          initial: editing?.material ?? null,
          onClose: () => setForm(null),
          onSave: (fields) => {
            if (form.mode === 'edit') {
              const refused = updateMaterial(form.id, fields);
              if (refused === null) setForm(null);
              return refused;
            }
            const made = createMaterial(fields);
            if ('error' in made) return made.error;
            setSelected(made.id);
            setFilter('all');
            setForm(null);
            return null;
          },
        }),
  );
}

// ---------------------------------------------------------------- the material form

interface CutForm {
  readonly on: boolean;
  readonly vcMin: string;
  readonly vcMax: string;
  readonly fzMin: string;
  readonly fzMax: string;
  readonly ap: readonly string[];
  readonly ae: readonly string[];
}

export interface MaterialFormState {
  readonly name: string;
  readonly family: Material['family'];
  readonly grade: string;
  readonly description: string;
  readonly notes: string;
  readonly coolantNeed: CoolantNeed;
  readonly coolantReason: string;
  readonly hardness: string;
  readonly hardnessScale: HardnessScale;
  readonly density: string;
  readonly kc: string;
  readonly cutting: Readonly<Record<string, CutForm>>;
  readonly safety: readonly { readonly severity: SafetySeverity; readonly text: string }[];
  readonly behaviour: readonly { readonly kind: BehaviourKind; readonly text: string }[];
  readonly sheets: string;
  readonly bars: string;
  readonly purchase: readonly PurchaseLink[];
}

const FRAMES = ['hobby', 'medium', 'rigid'] as const;
const str = (n: number | undefined): string => (n === undefined ? '' : String(n));

function cutFormOf(c: MaterialCutting | undefined): CutForm {
  const chip = c?.chipload.value;
  const e = c?.engagement.value;
  return {
    on: c !== undefined,
    vcMin: str(c?.vc.value.min),
    vcMax: str(c?.vc.value.max),
    fzMin: chip?.kind === 'factor' ? str(chip.min) : '',
    fzMax: chip?.kind === 'factor' ? str(chip.max) : '',
    ap: [str(e?.hobby.ap), str(e?.medium.ap), str(e?.rigid.ap)],
    ae: [str(e?.hobby.ae), str(e?.medium.ae), str(e?.rigid.ae)],
  };
}

/** The form's starting state: a new material, or the fields of one of mine. */
export function materialFormOf(m: Material | null): MaterialFormState {
  return {
    name: m?.name ?? '',
    family: m?.family ?? 'wood',
    grade: m?.grade ?? '',
    description: m?.description ?? '',
    notes: m?.notes ?? '',
    coolantNeed: m?.coolant.need ?? 'none',
    coolantReason: m?.coolant.reason ?? '',
    hardness: str(m?.physical.hardness?.value.value),
    hardnessScale: m?.physical.hardness?.value.scale ?? 'HB',
    density: str(m?.physical.density?.value),
    kc: str(m?.physical.kc?.value),
    cutting: Object.fromEntries(TOOL_MATERIALS.map((t) => [t, cutFormOf(m?.cutting.find((c) => c.toolMaterial === t))])),
    safety: m?.safety ?? [],
    behaviour: m?.behaviour ?? [],
    sheets: (m?.stockForms ?? []).flatMap((s) => (s.kind === 'sheet' ? [String(s.thickness)] : [])).join(', '),
    bars: (m?.stockForms ?? []).flatMap((s) => (s.kind === 'bar' ? [String(s.diameter)] : [])).join(', '),
    purchase: m?.purchase ?? [],
  };
}

/** A number the user typed, kept with its original source when unchanged, or recorded as theirs. */
function keep<T>(typed: T, original: Sourced<T> | undefined): Sourced<T> {
  return original !== undefined && JSON.stringify(original.value) === JSON.stringify(typed) ? original : userValue(typed);
}

const parse = (s: string): number | null => {
  const n = Number.parseFloat(s);
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
};

const toolMaterialName = (t: string): string => (t === 'hss' ? 'HSS' : `${t.slice(0, 1).toUpperCase()}${t.slice(1)}`);

/** The form as material fields, or the first problem in plain words. */
export function fieldsFromForm(f: MaterialFormState, original: Material | null): MaterialFields | string {
  if (f.name.trim() === '') return 'Give the material a name.';
  const physical: Record<string, unknown> = {};
  const hv = parse(f.hardness);
  if (hv !== null) physical['hardness'] = keep({ value: hv, scale: f.hardnessScale }, original?.physical.hardness);
  const dv = parse(f.density);
  if (dv !== null) physical['density'] = keep(dv, original?.physical.density);
  const kv = parse(f.kc);
  if (kv !== null) physical['kc'] = keep(kv, original?.physical.kc);
  const banned = f.safety.some((s) => s.severity === 'do-not-machine');
  const cutting: MaterialCutting[] = [];
  if (!banned) {
    for (const t of TOOL_MATERIALS) {
      const c = f.cutting[t];
      if (c === undefined || !c.on) continue;
      const vcMin = parse(c.vcMin);
      const vcMax = parse(c.vcMax);
      if (vcMin === null || vcMax === null) return `Enter the surface speed range for ${toolMaterialName(t)} tools.`;
      const old = original?.cutting.find((x) => x.toolMaterial === t);
      const fzMin = parse(c.fzMin);
      const fzMax = parse(c.fzMax);
      const chip = fzMin !== null && fzMax !== null ? keep<MaterialCutting['chipload']['value']>({ kind: 'factor', min: fzMin, max: fzMax }, old?.chipload) : old?.chipload;
      if (chip === undefined) return `Enter the chip load range for ${toolMaterialName(t)} tools.`;
      const eng: Record<string, { ap: number; ae: number }> = {};
      for (let i = 0; i < 3; i++) {
        const ap = parse(c.ap[i] ?? '');
        const ae = parse(c.ae[i] ?? '');
        if (ap === null || ae === null) return `Enter the depth and width for each machine frame (${toolMaterialName(t)} tools).`;
        eng[FRAMES[i] as string] = { ap, ae };
      }
      cutting.push({
        toolMaterial: t,
        vc: keep({ min: vcMin, max: vcMax }, old?.vc),
        chipload: chip,
        engagement: keep(eng as unknown as MaterialCutting['engagement']['value'], old?.engagement),
      });
    }
  }
  const sizes = (s: string): number[] | string => {
    const parts = s.split(/[,\s]+/).filter((x) => x !== '');
    const out = parts.map((x) => Number.parseFloat(x));
    return out.some((n) => !Number.isFinite(n) || n <= 0) ? 'Stock sizes are positive numbers in millimetres, separated by commas.' : out;
  };
  const sheets = sizes(f.sheets);
  const bars = sizes(f.bars);
  if (typeof sheets === 'string') return sheets;
  if (typeof bars === 'string') return bars;
  return {
    name: f.name.trim().slice(0, 120),
    family: f.family,
    grade: f.grade.trim().slice(0, 120),
    physical,
    cutting,
    coolant: { need: f.coolantNeed, reason: f.coolantReason.trim().slice(0, 300) },
    behaviour: f.behaviour.filter((b) => b.text.trim() !== '').map((b) => ({ kind: b.kind, text: b.text.trim().slice(0, 300) })),
    safety: f.safety.filter((s) => s.text.trim() !== '').map((s) => ({ severity: s.severity, text: s.text.trim().slice(0, 300) })),
    stockForms: [...sheets.map((thickness) => ({ kind: 'sheet' as const, thickness })), ...bars.map((diameter) => ({ kind: 'bar' as const, diameter }))],
    purchase: f.purchase,
    description: f.description.slice(0, 2000),
    notes: f.notes.slice(0, 4000),
  } as MaterialFields;
}

type FormTab = 'basics' | 'cutting' | 'safety' | 'stock';

const SEVERITY_LABEL: Readonly<Record<SafetySeverity, string>> = { 'do-not-machine': 'Do not machine', hazard: 'Hazard', caution: 'Caution', info: 'Note' };
const BEHAVIOUR_LABEL: Readonly<Record<BehaviourKind, string>> = { melts: 'Melts', 'work-hardens': 'Work-hardens', 'chip-evacuation': 'Chip evacuation', 'grain-direction': 'Grain direction' };

function MaterialForm({ initial, onClose, onSave }: { readonly initial: Material | null; readonly onClose: () => void; readonly onSave: (f: MaterialFields) => string | null }): ComponentChild {
  const [f, setF] = useState<MaterialFormState>(() => materialFormOf(initial));
  const [tab, setTab] = useState<FormTab>('basics');
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<MaterialFormState>): void => setF({ ...f, ...patch });
  const text = (label: string, key: 'name' | 'grade' | 'coolantReason', max: number, placeholder = ''): ComponentChild =>
    h('label', { class: 'field', key }, h('span', null, label), h('span', { class: 'unit-input' }, h('input', { value: f[key], maxLength: max, placeholder, onInput: (e: Event) => set({ [key]: (e.currentTarget as HTMLInputElement).value } as Partial<MaterialFormState>) })));
  const numIn = (label: string, value: string, onInput: (s: string) => void, unit = ''): ComponentChild =>
    h('label', { class: 'field', key: label }, h('span', null, label), h('span', { class: 'unit-input' }, h('input', { type: 'number', min: 0, step: 'any', value, onInput: (e: Event) => onInput((e.currentTarget as HTMLInputElement).value) }), unit === '' ? null : h('i', null, unit)));
  const select = <T extends string>(label: string, value: T, options: readonly (readonly [T, string])[], onChange: (v: T) => void): ComponentChild =>
    h('label', { class: 'field', key: label }, h('span', null, label), h('span', { class: 'select-wrap' }, h('select', { value, onChange: (e: Event) => onChange((e.currentTarget as HTMLSelectElement).value as T) }, options.map(([v, l]) => h('option', { value: v, key: v }, l)))));
  const cut = (t: string): CutForm => f.cutting[t] ?? cutFormOf(undefined);
  const setCut = (t: string, patch: Partial<CutForm>): void => set({ cutting: { ...f.cutting, [t]: { ...cut(t), ...patch } } });
  const banned = f.safety.some((s) => s.severity === 'do-not-machine');
  return h(
    'div',
    { class: 'dialog-wrap', role: 'presentation', onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); } },
    h(
      'form',
      {
        class: 'dialog wide material-form',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'material-form-title',
        'data-region': 'material-form',
        onSubmit: (e: Event) => {
          e.preventDefault();
          const fields = fieldsFromForm(f, initial);
          if (typeof fields === 'string') {
            setError(fields);
            return;
          }
          setError(onSave(fields));
        },
      },
      h('div', { class: 'dialog-head' }, h('h2', { id: 'material-form-title' }, initial === null ? 'New material' : `Edit ${initial.name}`), h('button', { type: 'button', class: 'icon-button quiet', 'data-action': 'close-material', 'aria-label': 'Close', onClick: onClose }, '×')),
      h(TabBar<FormTab>, {
        label: 'Material fields',
        prefix: 'mform',
        variant: 'underline',
        current: tab,
        onSelect: setTab,
        tabs: [
          { id: 'basics', label: 'Basics' },
          { id: 'cutting', label: 'Physical and cutting' },
          { id: 'safety', label: 'Safety and behaviour', ...(f.safety.length === 0 ? {} : { badge: String(f.safety.length) }) },
          { id: 'stock', label: 'Stock and links' },
        ],
      }),
      h(
        TabPane,
        { prefix: 'mform', id: 'basics', current: tab, class: 'tpane form-pane' },
        h('div', { class: 'field-grid' }, text('Name', 'name', 120, 'Walnut, 6082-T6, …'), select('Family', f.family, MATERIAL_FAMILIES.map((x) => [x, FAMILIES[x]] as const), (family) => set({ family }))),
        h('div', { class: 'field-grid' }, text('Grade', 'grade', 120, 'Optional'), select<CoolantNeed>('Coolant', f.coolantNeed, [['required', 'Required'], ['recommended', 'Recommended'], ['none', 'None'], ['avoid', 'Avoid']], (coolantNeed) => set({ coolantNeed }))),
        text('Why (coolant)', 'coolantReason', 300, 'Aluminium welds to the flutes without air or mist'),
        textArea('Description', f.description, (description) => set({ description }), 2000, 2),
        textArea('Notes', f.notes, (notes) => set({ notes }), 4000, 2),
      ),
      h(
        TabPane,
        { prefix: 'mform', id: 'cutting', current: tab, class: 'tpane form-pane' },
        h('h3', { class: 'tan-label' }, 'Physical'),
        h(
          'div',
          { class: 'field-grid four' },
          numIn('Hardness', f.hardness, (hardness) => set({ hardness })),
          select<HardnessScale>('Scale', f.hardnessScale, [['HB', 'HB'], ['HRB', 'HRB'], ['HRC', 'HRC'], ['HRM', 'HRM'], ['shore-D', 'Shore D'], ['janka-N', 'Janka (N)']], (hardnessScale) => set({ hardnessScale })),
          numIn('Density', f.density, (density) => set({ density }), 'g/cm³'),
          numIn('Cutting force kc', f.kc, (kc) => set({ kc }), 'N/mm²'),
        ),
        banned
          ? h('p', { class: 'fine' }, 'A material marked "Do not machine" has no cutting data.')
          : TOOL_MATERIALS.map((t) => {
              const c = cut(t);
              return h(
                'fieldset',
                { key: t, class: `cut-fields${c.on ? '' : ' off'}` },
                h('legend', null, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.on, onChange: (e: Event) => setCut(t, { on: (e.currentTarget as HTMLInputElement).checked }) }), ` ${toolMaterialName(t)} tools`)),
                c.on
                  ? h(
                      'div',
                      { class: 'field-grid four' },
                      numIn('Surface speed from', c.vcMin, (vcMin) => setCut(t, { vcMin }), 'm/min'),
                      numIn('to', c.vcMax, (vcMax) => setCut(t, { vcMax }), 'm/min'),
                      numIn('Chip load from', c.fzMin, (fzMin) => setCut(t, { fzMin }), '× diameter'),
                      numIn('to', c.fzMax, (fzMax) => setCut(t, { fzMax }), '× diameter'),
                      ...FRAMES.flatMap((fr, i) => [
                        numIn(`Depth, ${fr} frame`, c.ap[i] ?? '', (v) => setCut(t, { ap: c.ap.map((x, j) => (j === i ? v : x)) }), '× diameter'),
                        numIn(`Width, ${fr} frame`, c.ae[i] ?? '', (v) => setCut(t, { ae: c.ae.map((x, j) => (j === i ? v : x)) }), '× diameter'),
                      ]),
                    )
                  : null,
              );
            }),
      ),
      h(
        TabPane,
        { prefix: 'mform', id: 'safety', current: tab, class: 'tpane form-pane' },
        h('h3', { class: 'tan-label' }, 'Safety notes'),
        h('p', { class: 'fine' }, 'Shown wherever this material is chosen, never hidden.'),
        h(
          'ul',
          { class: 'row-editor' },
          f.safety.map((s, i) =>
            h(
              'li',
              { key: String(i) },
              h('span', { class: 'select-wrap' }, h('select', { value: s.severity, 'aria-label': `Safety note ${i + 1} severity`, onChange: (e: Event) => set({ safety: f.safety.map((x, j) => (j === i ? { ...x, severity: (e.currentTarget as HTMLSelectElement).value as SafetySeverity } : x)) }) }, (Object.keys(SEVERITY_LABEL) as SafetySeverity[]).map((k) => h('option', { value: k, key: k }, SEVERITY_LABEL[k])))),
              h('input', { value: s.text, maxLength: 300, 'aria-label': `Safety note ${i + 1}`, onInput: (e: Event) => set({ safety: f.safety.map((x, j) => (j === i ? { ...x, text: (e.currentTarget as HTMLInputElement).value } : x)) }) }),
              h('button', { type: 'button', class: 'icon-button quiet', 'data-action': 'remove-row', 'aria-label': `Remove safety note ${i + 1}`, onClick: () => set({ safety: f.safety.filter((_, j) => j !== i) }) }, Icon('trash', 14)),
            ),
          ),
        ),
        h('button', { type: 'button', class: 'small', 'data-action': 'add-safety', onClick: () => set({ safety: [...f.safety, { severity: 'caution', text: '' }] }) }, Icon('plus', 14), 'Add a safety note'),
        h('h3', { class: 'tan-label spaced' }, 'Behaviour'),
        h(
          'ul',
          { class: 'row-editor' },
          f.behaviour.map((b, i) =>
            h(
              'li',
              { key: String(i) },
              h('span', { class: 'select-wrap' }, h('select', { value: b.kind, 'aria-label': `Behaviour note ${i + 1} kind`, onChange: (e: Event) => set({ behaviour: f.behaviour.map((x, j) => (j === i ? { ...x, kind: (e.currentTarget as HTMLSelectElement).value as BehaviourKind } : x)) }) }, (Object.keys(BEHAVIOUR_LABEL) as BehaviourKind[]).map((k) => h('option', { value: k, key: k }, BEHAVIOUR_LABEL[k])))),
              h('input', { value: b.text, maxLength: 300, 'aria-label': `Behaviour note ${i + 1}`, onInput: (e: Event) => set({ behaviour: f.behaviour.map((x, j) => (j === i ? { ...x, text: (e.currentTarget as HTMLInputElement).value } : x)) }) }),
              h('button', { type: 'button', class: 'icon-button quiet', 'data-action': 'remove-row', 'aria-label': `Remove behaviour note ${i + 1}`, onClick: () => set({ behaviour: f.behaviour.filter((_, j) => j !== i) }) }, Icon('trash', 14)),
            ),
          ),
        ),
        h('button', { type: 'button', class: 'small', 'data-action': 'add-behaviour', onClick: () => set({ behaviour: [...f.behaviour, { kind: 'chip-evacuation', text: '' }] }) }, Icon('plus', 14), 'Add a behaviour note'),
      ),
      h(
        TabPane,
        { prefix: 'mform', id: 'stock', current: tab, class: 'tpane form-pane' },
        h('h3', { class: 'tan-label' }, 'Stock sizes'),
        h(
          'div',
          { class: 'field-grid' },
          h('label', { class: 'field' }, h('span', null, 'Sheet thicknesses, mm'), h('span', { class: 'unit-input' }, h('input', { value: f.sheets, placeholder: '3, 6, 12', onInput: (e: Event) => set({ sheets: (e.currentTarget as HTMLInputElement).value }) }))),
          h('label', { class: 'field' }, h('span', null, 'Bar diameters, mm'), h('span', { class: 'unit-input' }, h('input', { value: f.bars, placeholder: '10, 20', onInput: (e: Event) => set({ bars: (e.currentTarget as HTMLInputElement).value }) }))),
        ),
        h('h3', { class: 'tan-label spaced' }, 'Where to buy'),
        f.purchase.length === 0 ? null : h('ul', { class: 'purchases' }, f.purchase.map((p, i) => h(PurchaseLine, { p, key: String(i), onRemove: () => set({ purchase: f.purchase.filter((_, j) => j !== i) }) }))),
        h(AddLink, {
          onAdd: (p) => {
            if (f.purchase.length >= 20) return 'Twenty links at most.';
            set({ purchase: [...f.purchase, p] });
            return null;
          },
        }),
      ),
      error === null ? null : h('p', { class: 'field-error', role: 'alert' }, error),
      h(
        'div',
        { class: 'dialog-actions' },
        h('span', { class: 'fine grow' }, 'Numbers you enter are recorded as yours. Kept in this browser.'),
        h('button', { type: 'button', 'data-action': 'cancel-material', onClick: onClose }, 'Cancel'),
        h('button', { type: 'submit', class: 'primary', 'data-action': 'save-material' }, initial === null ? 'Create material' : 'Save changes'),
      ),
    ),
  );
}
