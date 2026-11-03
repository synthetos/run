/**
 * The Machines view: start from a machine like yours, make a copy, and make
 * it yours (WORKSPACE_TENETS 6). Profiles are kept in this browser through
 * the library adapter; cloud sync comes later. A copy pins the template and
 * copies no board settings, homing or safety facts.
 *
 * The TinyG settings tab makes the tie between the profile and the board
 * explicit: each profile field names the TinyG key it maps to, beside the
 * board's current value and a difference badge. Where the two differ the
 * profile value can be added to the Board view's pending changes (never
 * written from here; SAFETY §4.10 rule 4: a profile is never applied
 * automatically, and applying goes through C5 and the write path).
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { CATALOGUE, machineDrawing, type MachineTemplate } from '../machineDrawings.ts';
import type { SettingValue } from '@synthetos/schema';
import { machineStore, selectedMachine, selectedMachineStore, type AxisProfile, type MachineProfile } from '../library.ts';
import { dialectOf, motorFor, plainValue, setDraft, settingMeta, settingsOf, stepsPerUnit, tinygV8 } from '../boardFacts.ts';
import { editBlocked } from '../settings/SettingsUi.ts';
import { writableKey } from '../settings/pending.ts';
import { Icon } from '../icons.ts';
import { boardLabel, num } from '../status.ts';
import { connected, type LiveView, type WorkspaceModel } from '../model.ts';
import { TabBar, TabPane } from '../ui.ts';

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
      h('div', { class: 'grow' }, h('span', { class: 'kicker' }, 'Your machine'), h('h2', null, 'No machine yet'), h('p', null, 'Copy a template below, then adjust it to your machine.')),
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

// ---------------------------------------------------------------- the TinyG mapping

type AxisId = 'x' | 'y' | 'z' | 'a';
type Settings = Readonly<Record<string, SettingValue>>;

export interface MappingRow {
  readonly id: string;
  readonly label: string;
  /** The TinyG key(s) the field maps to, as shown. */
  readonly keyText: string;
  /** The key a draft would write (null for derived rows). */
  readonly key: string | null;
  readonly unit: string;
  readonly profile: number | undefined;
  readonly board: number | undefined;
  readonly boardText: string;
  readonly field: keyof AxisProfile | 'travel' | null;
  readonly derived?: boolean;
  readonly options?: readonly { readonly value: number; readonly label: string }[];
}

const nOf = (s: Settings, k: string): number | undefined => (typeof s[k] === 'number' ? (s[k] as number) : undefined);

/** The profile fields of one axis, each with the TinyG key it maps to and the board's value (pure, for the tests). */
export function mappingRows(profile: MachineProfile, axis: AxisId, settings: Settings, dialect: string | null): readonly MappingRow[] {
  const ax: AxisProfile = profile.axes?.[axis] ?? {};
  const { motor, assumed } = motorFor(settings, axis);
  const mk = (f: string): string => (motor === null ? `?${f}` : `${motor}${f}`);
  const row = (id: keyof AxisProfile, label: string, key: string): MappingRow => {
    const m = settingMeta(key, dialect);
    const b = nOf(settings, key);
    return { id, label, keyText: key, key: key.startsWith('?') ? null : key, unit: m.unit, profile: ax[id], board: b, boardText: plainValue(key, settings[key], dialect) ?? 'Not read', field: id, ...(m.values === null ? {} : { options: m.values }) };
  };
  const tn = nOf(settings, `${axis}tn`);
  const tm = nOf(settings, `${axis}tm`);
  const span = tn !== undefined && tm !== undefined ? Math.abs(tm - tn) : undefined;
  const travel = axis === 'a' ? undefined : profile.travel[axis];
  const rows: MappingRow[] = [];
  if (axis !== 'a') rows.push({ id: 'travel', label: 'Travel', keyText: `${axis}tm − ${axis}tn`, key: null, unit: 'mm', profile: travel, board: span, boardText: span === undefined ? 'Not read' : `${num(span, 1)} mm`, field: 'travel' });
  rows.push(row('stepAngle', 'Step angle', mk('sa')), row('microsteps', 'Microsteps', mk('mi')), row('travelPerRev', 'Travel per revolution', mk('tr')));
  const pSteps = stepsPerUnit(ax.stepAngle ?? nOf(settings, mk('sa')), ax.microsteps ?? nOf(settings, mk('mi')), ax.travelPerRev ?? nOf(settings, mk('tr')));
  const bSteps = stepsPerUnit(nOf(settings, mk('sa')), nOf(settings, mk('mi')), nOf(settings, mk('tr')));
  rows.push({ id: 'steps', label: 'Steps per mm', keyText: 'from sa, mi, tr', key: null, unit: '', profile: ax.stepAngle === undefined && ax.microsteps === undefined && ax.travelPerRev === undefined ? undefined : (pSteps ?? undefined), board: bSteps ?? undefined, boardText: bSteps === null ? 'Not read' : num(bSteps, 3), field: null, derived: true });
  rows.push(
    row('maxVelocity', 'Max velocity (rapids)', `${axis}vm`),
    row('maxFeed', 'Max feed', `${axis}fr`),
    row('jerk', 'Jerk', `${axis}jm`),
    row('homingSearch', 'Homing search velocity', `${axis}sv`),
    row('homingLatch', 'Homing latch velocity', `${axis}lv`),
    row('latchBackoff', 'Latch backoff', `${axis}lb`),
    row('zeroBackoff', 'Zero backoff', `${axis}zb`),
    row('minSwitch', 'Min switch', `${axis}sn`),
    row('maxSwitch', 'Max switch', `${axis}sx`),
  );
  return assumed ? rows.map((r) => (r.keyText.startsWith(String(motor)) ? { ...r, keyText: `${r.keyText} (motor ${motor} assumed)` } : r)) : rows;
}

export type Diff = 'same' | 'differs' | 'unset' | 'unread';

export function rowDiff(r: MappingRow): Diff {
  if (r.profile === undefined) return 'unset';
  if (r.board === undefined) return 'unread';
  return Math.abs(r.profile - r.board) <= Math.max(1e-6, Math.abs(r.board) * 1e-6) ? 'same' : 'differs';
}

const DIFF_TEXT: Readonly<Record<Diff, string>> = { same: 'Same', differs: 'Differs', unset: 'Not set', unread: 'Unknown' };

function TinygMapping({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const mine = selectedMachine.value;
  const view: LiveView | null = model?.live.value ?? null;
  const [axis, setAxis] = useState<AxisId>('x');
  const [stagedCount, setStagedCount] = useState<number | null>(null);
  if (mine === null) return h('div', { class: 'scroll-region' }, h('p', { class: 'board-empty' }, 'Create a machine profile to compare settings.'));
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const rows = mappingRows(mine, axis, settings, dialect);
  const update = (patch: Partial<MachineProfile>): void => machineStore.set(machineStore.value.value.map((m) => (m.id === mine.id ? { ...m, ...patch } : m)));
  const setField = (r: MappingRow, v: number | undefined): void => {
    if (r.field === null) return;
    if (r.field === 'travel') {
      if (v !== undefined && axis !== 'a') update({ travel: { ...mine.travel, [axis]: v } });
      return;
    }
    const ax = { ...(mine.axes?.[axis] ?? {}) } as Record<string, number | undefined>;
    if (v === undefined) delete ax[r.field];
    else ax[r.field] = v;
    update({ axes: { ...(mine.axes ?? {}), [axis]: ax as AxisProfile } });
  };
  const fill = (): void => {
    const ax: Record<string, number> = {};
    for (const r of rows) if (r.field !== null && r.field !== 'travel' && r.board !== undefined) ax[r.field] = r.board;
    update({ axes: { ...(mine.axes ?? {}), [axis]: ax as AxisProfile } });
  };
  const allAxes: AxisId[] = ['x', 'y', 'z', 'a'];
  const proposals = allAxes.flatMap((a) => mappingRows(mine, a, settings, dialect).filter((r) => (r.key !== null || r.field === 'travel') && rowDiff(r) === 'differs').map((r) => ({ axis: a, r })));
  const st = nOf(settings, 'st');
  const stDiff = mine.switchType === undefined ? 'unset' : st === undefined ? 'unread' : mine.switchType === st ? 'same' : 'differs';
  if (stDiff === 'differs') proposals.push({ axis: 'x', r: { id: 'st', label: 'Switch type', keyText: 'st', key: 'st', unit: '', profile: mine.switchType, board: st, boardText: plainValue('st', st, dialect) ?? '', field: null } });
  const on = view !== null && connected(view);
  // Profile values as pending setting changes: the mapped key, or for travel the max end (tm = tn + travel).
  const staged = proposals.flatMap(({ axis: a, r }): { key: string; value: number }[] => {
    if (typeof r.profile !== 'number') return [];
    if (r.field === 'travel') {
      const tn = nOf(settings, `${a}tn`);
      return tn === undefined ? [] : [{ key: `${a}tm`, value: tn + r.profile }];
    }
    return r.key === null ? [] : [{ key: r.key, value: r.profile }];
  }).filter((x) => writableKey(x.key, dialect));
  const blocked = editBlocked(view);
  return h(
    'div',
    { class: 'configure-grid' },
    h(
      'div',
      { class: 'list-panel' },
      h(
        'div',
        { class: 'panel-title' },
        h('h2', null, `${mine.name} → TinyG`),
        h('div', { class: 'cfg-actions' }, h('div', { class: 'seg', role: 'group', 'aria-label': 'Axis' }, allAxes.map((a) => h('button', { type: 'button', key: a, class: axis === a ? 'selected' : undefined, 'aria-pressed': axis === a ? 'true' : 'false', 'data-axis-pick': a, onClick: () => setAxis(a) }, a.toUpperCase()))), h('button', { type: 'button', class: 'small', 'data-action': 'fill-from-board', disabled: !on || rows.every((r) => r.board === undefined), onClick: fill }, 'Fill from the board')),
      ),
      h(
        'div',
        { class: 'tool-table-wrap' },
        h(
          'table',
          { class: 'cfg-table map-table', 'data-region': 'tinyg-mapping' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Profile field'), h('th', { scope: 'col' }, 'Your profile'), h('th', { scope: 'col' }, 'On the board'), h('th', { scope: 'col' }, 'Difference'))),
          h(
            'tbody',
            null,
            rows.map((r) => {
              const d = rowDiff(r);
              return h(
                'tr',
                { key: r.id, class: r.derived === true ? 'derived' : undefined, 'data-map': r.id },
                h('th', { scope: 'row' }, r.label),
                h(
                  'td',
                  null,
                  r.derived === true
                    ? h('span', { class: 'mono' }, r.profile === undefined ? 'Not set' : num(r.profile, 3))
                    : r.options !== undefined
                      ? h('span', { class: 'select-wrap' }, h('select', { 'aria-label': `${r.label}, your profile`, value: r.profile === undefined ? '' : String(r.profile), onChange: (e: Event) => { const v = (e.currentTarget as HTMLSelectElement).value; setField(r, v === '' ? undefined : Number(v)); } }, h('option', { value: '' }, 'Not set'), r.options.map((o) => h('option', { value: String(o.value), key: o.value }, o.label))))
                      : h('span', { class: 'unit-input' }, h('input', { type: 'number', step: 'any', min: 0, 'aria-label': `${r.label}, your profile`, placeholder: 'Not set', value: r.profile ?? '', onChange: (e: Event) => { const v = Number.parseFloat((e.currentTarget as HTMLInputElement).value); setField(r, Number.isFinite(v) && v >= 0 ? v : undefined); } }), r.unit === '' ? null : h('i', null, r.unit)),
                ),
                h('td', { class: r.board === undefined ? 'muted' : undefined }, r.boardText),
                h('td', null, h('span', { class: `diff-badge diff-${d}` }, d === 'same' ? Icon('check', 12) : d === 'differs' ? Icon('warning', 12) : null, DIFF_TEXT[d])),
              );
            }),
            h(
              'tr',
              { class: 'global', 'data-map': 'st' },
              h('th', { scope: 'row' }, 'Switch type (all inputs)'),
              h('td', null, h('span', { class: 'select-wrap' }, h('select', { 'aria-label': 'Switch type, your profile', value: mine.switchType === undefined ? '' : String(mine.switchType), onChange: (e: Event) => { const v = (e.currentTarget as HTMLSelectElement).value; const { switchType: _drop, ...rest } = mine; machineStore.set(machineStore.value.value.map((m) => (m.id === mine.id ? (v === '' ? rest : { ...rest, switchType: Number(v) }) : m))); } }, h('option', { value: '' }, 'Not set'), h('option', { value: '0' }, 'normally open'), h('option', { value: '1' }, 'normally closed')))),
              h('td', null, h('code', { class: 'tinyg-key' }, 'st')),
              h('td', { class: st === undefined ? 'muted' : undefined }, plainValue('st', st, dialect) ?? 'Not read'),
              h('td', null, h('span', { class: `diff-badge diff-${stDiff}` }, DIFF_TEXT[stDiff])),
            ),
          ),
        ),
      ),
    ),
    h(
      'aside',
      { class: 'inspector', 'aria-label': 'Proposed draft' },
      h(
        'section',
        { class: 'insp', 'data-region': 'machine-draft' },
        h('header', null, h('h2', null, 'Proposed draft'), h('span', { class: 'tag' }, `${proposals.length} ${proposals.length === 1 ? 'change' : 'changes'}`)),
        proposals.length === 0
          ? h('p', { class: 'fine' }, on ? 'Your profile and the board agree wherever both are set.' : 'Connect a board to compare it with your profile.')
          : h('ul', { class: 'draft-list' }, proposals.map(({ r }) => h('li', { key: r.keyText }, h('span', null, r.label), h('span', { class: 'old' }, r.board === undefined ? 'Unknown' : String(Number(r.board.toFixed(4)))), Icon('chevron', 12), h('strong', { class: 'new' }, String(Number((r.profile as number).toFixed(4))))))),
        h(
          'button',
          {
            type: 'button',
            class: 'wide',
            'data-action': 'stage-profile',
            disabled: blocked !== null || staged.length === 0,
            title: blocked ?? 'Add these values to the pending changes in the Board view',
            onClick: () => {
              for (const x of staged) setDraft(x.key, x.value);
              setStagedCount(staged.length);
            },
          },
          'Add to pending changes',
        ),
        h('p', { class: 'fine', 'data-staged': stagedCount === null ? '' : String(stagedCount) }, stagedCount !== null ? `${stagedCount} ${stagedCount === 1 ? 'change was' : 'changes were'} added. Review and apply them in Board → Pending changes.` : (blocked ?? 'Review and apply these changes in Board → Pending changes.')),
      ),
      h(
        'section',
        { class: 'insp' },
        h('h3', { class: 'tan-label' }, 'How the axis maps'),
        h('p', { class: 'fine' }, (() => {
          const { motor, assumed } = motorFor(settings, axis);
          const board = tinygV8();
          return motor === null ? `No motor drives ${axis.toUpperCase()} on this board.` : `${axis.toUpperCase()} is driven by motor ${motor}${assumed ? ' (the factory order, until the board is read)' : ' (reported by the board)'}. Steps per mm = 360 ÷ step angle × microsteps ÷ travel per revolution.${board === null ? '' : ` This board supports ${board.motors.microsteps.value.join(', ')} microsteps.`}`;
        })()),
      ),
    ),
  );
}

type MachinesTab = 'mine' | 'tinyg' | 'catalogue';

export function MachinesView({ model, onView }: { readonly model: WorkspaceModel | null; readonly onView: (v: string) => void }): ComponentChild {
  const [filter, setFilter] = useState<'all' | 'belt' | 'screw'>('all');
  const [query, setQuery] = useState('');
  const mine = machineStore.value.value;
  const [tab, setTab] = useState<MachinesTab>('mine');
  const list = CATALOGUE.filter((t) => (filter === 'all' || t.drive === filter || t.drive === 'any') && `${t.name} ${t.blurb}`.toLowerCase().includes(query.trim().toLowerCase()));
  return h(
    'div',
    { class: 'machines-view' },
    h(
      'div',
      { class: 'view-head' },
      h('div', { class: 'title-block' }, h('h1', null, 'Machines')),
      h('div', { class: 'view-actions' }, h(TabBar<MachinesTab>, { label: 'Machines', prefix: 'mach', current: tab, onSelect: setTab, tabs: [{ id: 'mine', label: 'Your machine' }, { id: 'tinyg', label: 'TinyG settings' }, { id: 'catalogue', label: 'Start from a machine' }] })),
    ),
    h(
      TabPane,
      { prefix: 'mach', id: 'mine', current: tab, class: 'cpane' },
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
        h('p', { class: 'fine catalogue-note' }, 'Templates do not copy board settings or homing. Compare settings in the TinyG tab.'),
      ),
    ),
    h(TabPane, { prefix: 'mach', id: 'tinyg', current: tab, class: 'cpane' }, h(TinygMapping, { model })),
    h(
      TabPane,
      { prefix: 'mach', id: 'catalogue', current: tab, class: 'cpane' },
      h(
        'div',
        { tabindex: 0, class: 'scroll-region' },
        h(
          'div',
          { class: 'section-heading' },
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
          h('span', { class: 'search-wrap' }, Icon('search', 15), h('input', { class: 'search', placeholder: 'Find a machine', 'aria-label': 'Find a machine', value: query, onInput: (e: Event) => setQuery((e.currentTarget as HTMLInputElement).value) })),
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
                        setTab('mine');
                      },
                    },
                    'Make a copy',
                  ),
                ),
              ),
            ),
          ),
        ),
        h('p', { class: 'fine catalogue-note' }, 'Example templates: verify specifications and controller compatibility.'),
      ),
    ),
  );
}
