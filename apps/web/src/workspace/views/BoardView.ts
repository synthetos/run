/**
 * The Board view (Stage 1, read-only): the board's configuration as it was
 * read, organised in tabs so nothing needs a long scroll.
 *
 * - Overview: the OD-5 board drawing, where every screw terminal and pin is
 *   its own target (name, function, current setting), and what the board
 *   reported about itself.
 * - Motors, Axes, Inputs, Spindle and coolant, Communications: every value is
 *   the real settings read, in plain words with the raw key as secondary
 *   text. Values can be edited where Run may write them; edits collect as
 *   pending changes.
 * - All settings (grouped, searchable, with the drift check, P1-07), Backups
 *   (back up, and restore through the same write path) and Firmware (future,
 *   disabled).
 *
 * Settings writes (SAFETY §4.6, amendment 2026-11-02): the pending changes
 * tray (workspace/settings) shows the diff and is the only place that
 * writes, through the model's `applySettings`, behind the phase switch and
 * the idle gate. Every value shown is what the board answered to a GET
 * through the read allowlist; strings from the board go through `boardText`
 * (T-S85). Pin names come from the generated board definition (RUN_PLAN
 * rule 6).
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { boardText } from '@synthetos/safety';
import type { SettingValue } from '@synthetos/schema';
import { AxisModes } from '../../machine-ui/AxisModes.ts';
import { SettingsStatus } from '../../machine-ui/SettingsView.ts';
import { PendingTray, SettingEditor, SettingsTable } from '../settings/SettingsUi.ts';
import { BackupsHub, FirmwareTab } from './FirmwareViews.ts';
import { editBlocked } from '../settings/SettingsUi.ts';
import {
  AXIS_NAMES,
  MOTORS,
  RESERVED,
  clearDraft,
  connectorLabel,
  connectorPins,
  dialectOf,
  draftDiff,
  draftStore,
  motorAxis,
  pinByRef,
  plainValue,
  setDraft,
  settingMeta,
  settingsOf,
  stepsPerUnit,
  tinygV8,
  type PinInfo,
} from '../boardFacts.ts';
import { Icon } from '../icons.ts';
import { openReport } from '../../report/state.ts';
import { connected, type LiveView, type WorkspaceModel } from '../model.ts';
import { coolantText, displayReadouts, num, spindleText, UNKNOWN } from '../status.ts';
import { Keyed, TabBar, TabPane } from '../ui.ts';
import { boardTab, type BoardTab as Tab } from '../boardNavigation.ts';
import { uiLevel } from '../jobWorkflow.ts';
import { GuidedSettings } from '../settings/GuidedSettings.ts';

type Settings = Readonly<Record<string, SettingValue>>;

const REASON_TEXT: Readonly<Record<string, string>> = {
  'en-approved': 'An approved TinyG edge-next build.',
  'en-not-approved': 'A TinyG edge-next build that is not on the approved list yet.',
  'tg440-approved': 'An approved TinyG 440 build.',
  'tg440-not-approved': 'A TinyG 440 build that is not on the approved list.',
  'stock-449': 'Stock TinyG 449 firmware.',
  'g2core-read-only': 'g2core firmware, supported read-only.',
  'g2core-unknown-build': 'A g2core build Run does not know.',
  conflict: 'The board’s answers did not agree with each other.',
  probeFailed: 'The board did not answer the identification questions.',
  flowControl: 'The board’s flow control setting (ex) could not be read, or has a value Run doesn’t know.',
};

const NOT_CONNECTED_TEXT = 'Connect a board on the Run view. Its settings appear here, read with GETs only.';

function fact(label: string, value: string, raw: string, attr?: string): ComponentChild {
  return h('div', { key: raw }, h('dt', null, label, h('small', { class: 'raw-key' }, raw)), h('dd', attr === undefined ? null : { 'data-board-fact': attr }, value));
}

/** A value from the read, plain words first and the raw key after; "Not read" when absent. With `edit`, its editor below. */
function cell(key: string, settings: Settings, dialect: string | null, edit: LiveView | null = null): ComponentChild {
  if (RESERVED.has(key)) return h('td', { key, class: 'muted' }, h(Keyed, { value: 'Reserved on this firmware', raw: key }));
  const v = plainValue(key, settings[key], dialect);
  const d = draftDiff(key, settings);
  return h(
    'td',
    { key, class: v === null ? 'muted' : undefined, title: settingMeta(key, dialect).description },
    h(Keyed, { value: v ?? 'Unknown', raw: key }),
    d === 'changed' || d === 'unread' ? h('span', { class: 'draft-badge', title: `Pending: ${String(draftStore.value.value[key])}` }, 'pending') : null,
    edit === null ? null : h('div', { class: 'cell-edit' }, h(SettingEditor, { k: key, view: edit, compact: true })),
  );
}

/** "Edit values" for a tab's tables: editors appear under each value Run may write. */
function EditToggle({ view, editing, onToggle }: { readonly view: LiveView | null; readonly editing: boolean; readonly onToggle: () => void }): ComponentChild {
  const blocked = editBlocked(view);
  return h(
    'div',
    { class: 'edit-bar' },
    h('button', { type: 'button', class: `small${editing ? ' primary' : ''}`, 'data-action': 'toggle-edit', 'aria-pressed': editing ? 'true' : 'false', disabled: blocked !== null, title: blocked ?? 'Edit values; changes collect in Pending changes', onClick: onToggle }, editing ? 'Done editing' : 'Edit values'),
    h('span', { class: 'fine' }, blocked ?? (editing ? 'Review pending changes before applying.' : 'Reported by the board.')),
  );
}

function Empty({ view }: { readonly view: LiveView | null }): ComponentChild {
  return h('p', { class: 'board-empty' }, view !== null && connected(view) ? 'Waiting for board settings.' : NOT_CONNECTED_TEXT);
}

// ---------------------------------------------------------------- overview

/** The probe facts in plain words, with the raw key as secondary text. */
function BoardFacts({ view }: { readonly view: LiveView | null }): ComponentChild {
  const s = view?.message?.snapshot ?? null;
  const on = view !== null && connected(view);
  const id = s?.identity ?? null;
  const c = s?.classification ?? null;
  const dialect = c?.dialectId === 'tinyg-en' ? 'TinyG edge-next' : c?.dialectId === 'tinyg-440' ? 'TinyG 440' : c?.dialectId === null || c === null ? 'Not identified' : c.dialectId;
  const readOnly = s?.overlays.includes('READ_ONLY') === true;
  const settings = settingsOf(view);
  const units = view?.message?.dro.units ?? null;
  const wcs = view?.message?.dro.wcs.code ?? null;
  return h(
    'section',
    { class: 'insp', 'data-region': 'board-facts', 'aria-labelledby': 'board-facts-title' },
    h(
      'header',
      null,
      h(
        'h2',
        { id: 'board-facts-title', class: 'board-facts-title' },
        on && c?.dialectId === 'tinyg-en' ? h('img', { class: 'edge-next-icon', src: '/brand/edge-next/tinyg-edge-next-2026-icon.png', alt: 'TinyG edge-next', width: 28, height: 28, 'data-board-logo': 'edge-next' }) : null,
        'This board',
      ),
      h('span', { class: `tag${readOnly ? ' mock' : ''}` }, on ? (readOnly ? 'Read only' : 'Connected') : 'Not connected'),
    ),
    on
      ? h(
          'dl',
          { class: 'facts board-facts' },
          fact('Board id', boardText(id?.id) || 'Not reported', 'id', 'id'),
          fact('Firmware build', typeof id?.fb === 'number' ? id.fb.toFixed(2) : UNKNOWN, 'fb', 'fb'),
          fact('Firmware version', typeof id?.fv === 'number' ? String(id.fv) : UNKNOWN, 'fv', 'fv'),
          fact('Hardware platform', id?.hp === undefined ? UNKNOWN : boardText(String(id.hp)), 'hp', 'hp'),
          fact('Hardware version', id?.hv === undefined ? UNKNOWN : boardText(String(id.hv)), 'hv', 'hv'),
          id?.fbs === undefined ? null : fact('Build identity', boardText(id.fbs), 'fbs', 'fbs'),
          fact('Firmware dialect', dialect, 'dialect', 'dialect'),
          fact('Units now', units === 'mm' ? 'millimetres (G21)' : units === 'in' ? 'inches (G20)' : 'Not read', 'unit', 'unit'),
          fact('Units at power-up', plainValue('gun', settings['gun'], dialectOf(view)) ?? 'Not read', 'gun', 'gun'),
          fact('Coordinate system', wcs ?? 'Not read', 'coor', 'coor'),
          fact('Approval', c === null ? UNKNOWN : (REASON_TEXT[c.reason] ?? c.reason), c?.reason ?? 'classification', 'approval'),
        )
      : h('p', { class: 'fine' }, NOT_CONNECTED_TEXT),
    on && readOnly
      ? h(
          'p',
          { class: 'note', 'data-board-fact': 'read-only' },
          'Phase 1 connects every board read-only: Run reads positions and settings and writes nothing.',
          c?.detail === undefined || c.detail === '' ? null : h('small', { class: 'raw-key block' }, boardText(c.detail)),
        )
      : null,
    h(
      'div',
      { class: 'board-report' },
      h('button', { type: 'button', class: 'small quiet-link', 'data-action': 'report-board', onClick: () => openReport({ origin: 'board', kind: 'firmware' }) }, Icon('flag', 14), 'Report a firmware problem'),
    ),
  );
}

/** What a pin's settings say, row by row (readouts from the status report or the read-only poll). */
function PinSettings({ pin, view }: { readonly pin: PinInfo; readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const snapshot = view !== null && connected(view) ? view.message?.snapshot : undefined;
  const r = displayReadouts(snapshot);
  const rows = pin.keys.map((k) => {
    if (RESERVED.has(k)) return [settingMeta(k, dialect).label, 'Reserved on this firmware', k] as const;
    if (k === 'spe') return ['Spindle, reported', spindleText(r), 'spe'] as const;
    if (k === 'cof' || k === 'com') return [k === 'cof' ? 'Flood, reported' : 'Mist, reported', coolantText(r), k] as const;
    if (k === 'spc' || k === 'spd' || k === 'sps') return null;
    return [settingMeta(k, dialect).label, plainValue(k, settings[k], dialect) ?? 'Not read', k] as const;
  });
  const shown = rows.filter((x): x is readonly [string, string, string] => x !== null);
  const coolantSeen = new Set<string>();
  return h(
    'dl',
    { class: 'facts pin-facts' },
    shown
      .filter(([label, value]) => {
        const key = `${label}${value}`;
        if (coolantSeen.has(value) && label.endsWith('reported')) return false;
        coolantSeen.add(value);
        return key !== '';
      })
      .map(([label, value, raw]) => h('div', { key: raw }, h('dt', null, label, h('small', { class: 'raw-key' }, raw)), h('dd', null, value))),
  );
}

function PinCard({ pin, view, onClose }: { readonly pin: PinInfo; readonly view: LiveView | null; readonly onClose: () => void }): ComponentChild {
  return h(
    'section',
    { class: 'insp pin-card', 'data-pin-card': pin.ref, 'aria-labelledby': 'pin-title' },
    h('header', null, h('h2', { id: 'pin-title' }, h('span', { class: 'pin-ref big' }, pin.ref), ` ${pin.label}`), h('button', { type: 'button', class: 'icon-button quiet', 'data-action': 'clear-pin', 'aria-label': 'Close the pin', onClick: onClose }, '×')),
    h('p', { class: 'pin-function' }, pin.function, pin.mcu === undefined ? null : h('small', { class: 'raw-key' }, ` ${pin.mcu}`)),
    h('p', { class: 'fine' }, connectorLabel(pin.connector)),
    pin.keys.length === 0 || pin.role === 'motor' ? null : h(PinSettings, { pin, view }),
    pin.note === undefined ? null : h('p', { class: 'note' }, pin.note),
    h('p', { class: 'raw-key block' }, `Source: ${pin.src}`),
  );
}

const MOTOR_FIELDS = ['ma', 'sa', 'tr', 'mi', 'po', 'pm'] as const;

/** One motor's settings as read, with a proposed draft beside each. Nothing is written. */
export function MotorDraft({ motor, view }: { readonly motor: number; readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const draft = draftStore.value.value;
  const micro = tinygV8()?.motors.microsteps.value ?? [1, 2, 4, 8];
  const keys = MOTOR_FIELDS.map((f) => `${motor}${f}`);
  const changed = keys.filter((k) => draftDiff(k, settings) === 'changed' || draftDiff(k, settings) === 'unread');
  const val = (k: string): number | undefined => {
    const d = draft[k];
    if (d !== undefined) return d;
    const b = settings[k];
    return typeof b === 'number' ? b : undefined;
  };
  const board = (f: string): number | undefined => {
    const b = settings[`${motor}${f}`];
    return typeof b === 'number' ? b : undefined;
  };
  const boardSteps = stepsPerUnit(board('sa'), board('mi'), board('tr'));
  const draftSteps = stepsPerUnit(val(`${motor}sa`), val(`${motor}mi`), val(`${motor}tr`));
  const input = (f: (typeof MOTOR_FIELDS)[number]): ComponentChild => {
    const k = `${motor}${f}`;
    const m = settingMeta(k, dialect);
    const current = val(k);
    const onPick = (raw: string): void => {
      const n = Number.parseFloat(raw);
      const b = settings[k];
      setDraft(k, !Number.isFinite(n) || (typeof b === 'number' && Math.abs(b - n) < 1e-9) ? null : n);
    };
    if (f === 'mi' || m.values !== null) {
      const options = f === 'mi' ? micro.map((x) => ({ value: x, label: String(x) })) : (m.values ?? []).filter((e) => f !== 'ma' || e.value < AXIS_NAMES.length);
      return h('span', { class: 'select-wrap' }, h('select', { 'aria-label': `${m.label}, draft`, value: current === undefined ? '' : String(current), onChange: (e: Event) => onPick((e.currentTarget as HTMLSelectElement).value) }, current === undefined ? h('option', { value: '' }, 'Choose') : null, options.map((o) => h('option', { value: String(o.value), key: o.value }, o.label))));
    }
    return h('span', { class: 'unit-input' }, h('input', { type: 'number', step: 'any', min: 0, 'aria-label': `${m.label}, draft`, value: current === undefined ? '' : current, onChange: (e: Event) => onPick((e.currentTarget as HTMLInputElement).value) }), m.unit === '' ? null : h('i', null, m.unit.replace('deg/step', '°').replace('mm/rev', 'mm')));
  };
  return h(
    'section',
    { class: 'insp motor-draft', 'data-motor': String(motor), 'aria-labelledby': `motor-${motor}-title` },
    h('header', null, h('h2', { id: `motor-${motor}-title` }, `Motor ${motor}`), h('span', { class: 'tag' }, motorAxis(settings, motor) === null ? 'Axis unknown' : `Drives ${motorAxis(settings, motor) as string}`)),
    h(
      'table',
      { class: 'draft-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Setting'), h('th', { scope: 'col' }, 'On the board'), h('th', { scope: 'col' }, 'Draft'))),
      h(
        'tbody',
        null,
        MOTOR_FIELDS.map((f) => {
          const k = `${motor}${f}`;
          const m = settingMeta(k, dialect);
          const d = draftDiff(k, settings);
          return h(
            'tr',
            { key: k, class: d === 'changed' || d === 'unread' ? 'drafted' : undefined },
            h('th', { scope: 'row', title: m.description }, m.label.replace(`Motor ${motor} `, '').replace(/^./, (c) => c.toUpperCase()), h('small', { class: 'raw-key' }, k)),
            h('td', null, plainValue(k, settings[k], dialect) ?? 'Not read'),
            h('td', null, input(f), d === 'changed' ? h('span', { class: 'draft-badge' }, 'changed') : d === 'unread' ? h('span', { class: 'draft-badge' }, 'unknown') : null),
          );
        }),
        h('tr', { class: 'derived' }, h('th', { scope: 'row' }, 'Steps per unit', h('small', { class: 'raw-key' }, '360 ÷ sa × mi ÷ tr')), h('td', null, boardSteps === null ? 'Not read' : num(boardSteps, 3)), h('td', null, draftSteps === null ? '' : num(draftSteps, 3))),
      ),
    ),
    h(
      'div',
      { class: 'draft-foot' },
      h('span', { class: 'fine' }, changed.length === 0 ? 'No pending changes for this motor.' : `${changed.length} pending ${changed.length === 1 ? 'change' : 'changes'}. Kept in this browser.`),
      changed.length === 0 ? null : h('button', { type: 'button', class: 'small quiet', 'data-action': 'clear-draft', onClick: () => clearDraft(keys) }, 'Clear'),
      changed.length === 0 ? null : h('span', { class: 'fine' }, 'Review and apply them in Pending changes above.'),
    ),
  );
}

/** The TinyG v8 drawing (OD-5: connector positions as derived public facts; pin names from the board definition). */
function BoardIllustration({ selected, onSelect, settings }: { readonly selected: string | null; readonly onSelect: (ref: string) => void; readonly settings: Settings }): ComponentChild {
  const [hover, setHover] = useState<string | null>(null);
  const target = (pin: PinInfo | null, ref: string, cx: number, cy: number, w: number, hgt: number, r: number, extra: ComponentChild[] = []): ComponentChild => {
    const label = pin === null ? ref : `${pin.ref} ${pin.label}: ${pin.function}`;
    return h(
      'g',
      {
        key: ref,
        class: `pin-target${selected === ref ? ' selected' : ''}${pin?.role === 'motor' && selected !== null && selected.startsWith(`${pin.connector}.`) ? ' sibling' : ''}`,
        role: 'button',
        tabindex: 0,
        'aria-label': label,
        'aria-pressed': selected === ref ? 'true' : 'false',
        'data-pin': ref,
        onClick: () => onSelect(ref),
        onMouseEnter: () => setHover(ref),
        onMouseLeave: () => setHover((x) => (x === ref ? null : x)),
        onFocus: () => setHover(ref),
        onBlur: () => setHover((x) => (x === ref ? null : x)),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(ref);
          }
        },
      },
      h('title', null, label),
      h('rect', { x: cx - w / 2, y: cy - hgt / 2, width: w, height: hgt, rx: 4, class: 'hit' }),
      h('circle', { cx, cy, r, class: 'contact' }),
      h('path', { d: `m${cx - r / 2} ${cy}h${r}`, class: 'contact-slot' }),
      h('circle', { cx, cy, r: r + 3.5, class: 'ring' }),
      ...extra,
    );
  };
  const header = (id: string, x: number): ComponentChild[] => {
    const pins = connectorPins(id);
    return [
      h('rect', { key: `${id}-body`, x, y: 58, width: 138, height: 35, class: 'connector' }),
      ...pins.map((p, i) => target(p, p.ref, x + 14 + i * 22, 75, 22, 62, 6.5, [h('text', { x: x + 14 + i * 22, y: 104, class: 'pin-print', 'text-anchor': 'middle' }, p.label.replace('3.3v', '3V3').replace('Spindle', 'Spin').replace('SpinDir', 'Dir').replace('SpinPWM', 'PWM').replace('Coolant', 'Cool').toUpperCase())])),
      h('text', { key: `${id}-label`, x, y: 124, class: 'board-print' }, connectorLabel(id).toUpperCase()),
    ];
  };
  const motor = (n: number, x: number): ComponentChild[] => {
    const pins = connectorPins(`M${n}`);
    const ma = settings[`${n}ma`];
    return [
      h('text', { key: `m${n}-t`, x: x + 2, y: 382, class: 'board-print' }, `MOTOR ${n}`),
      h('rect', { key: `m${n}-c`, x: x + 19, y: 398, width: 48, height: 47, class: 'chip' }),
      h('circle', { key: `m${n}-p`, cx: x + 58, cy: 473, r: 15, class: 'pot' }),
      h('circle', { key: `m${n}-pi`, cx: x + 58, cy: 473, r: 10, class: 'pot-in' }),
      h('rect', { key: `m${n}-b`, x, y: 507, width: 95, height: 35, class: 'connector' }),
      ...pins.map((p, i) => target(p, p.ref, x + 12 + i * 23.5, 524, 23.5, 56, 7)),
      h('text', { key: `m${n}-a`, x, y: 566, class: 'board-print' }, typeof ma === 'number' ? `${AXIS_NAMES[ma] ?? `axis ${ma}`} AXIS` : 'AXIS ?'),
    ];
  };
  const power = connectorPins('J1');
  const tipPin = hover === null ? null : pinByRef(hover);
  const tipAt = (ref: string): { x: number; y: number } => {
    const [c, n] = ref.split('.') as [string, string];
    const i = Number(n) - 1;
    if (c === 'J8') return { x: 159 + i * 22, y: 150 };
    if (c === 'J7') return { x: 324 + i * 22, y: 150 };
    if (c === 'J6') return { x: 489 + i * 22, y: 150 };
    if (c === 'J1') return { x: i === 0 ? 610 : 634, y: 480 };
    const m = Number(c.slice(1));
    return { x: [482, 362, 242, 122][m - 1]! + 12 + i * 23.5, y: 480 };
  };
  const tip = tipPin === null ? null : tipAt(tipPin.ref);
  return h(
    'svg',
    { class: 'board-svg', viewBox: '0 0 700 620', role: 'group', 'aria-label': 'TinyG v8 board drawing. Choose any terminal or pin to see its name, what it does and its current setting.' },
    h('rect', { x: 35, y: 30, width: 630, height: 560, rx: 15, class: 'board-base' }),
    ...[[51, 46], [649, 46], [51, 574], [649, 574]].map(([cx, cy]) => h('circle', { cx, cy, r: 7, class: 'board-hole', key: `${cx}-${cy}` })),
    h('path', { d: 'M125 490V340l25-30V140M185 490V340l25-30V140M245 490V340l25-30V140M305 490V340l25-30V140M365 490V340l25-30V140M425 490V340l25-30V140M485 490V340l25-30V140M545 490V340l25-30V140', class: 'board-trace' }),
    h('text', { x: 310, y: 330, class: 'board-title' }, 'TinyG'),
    h('text', { x: 405, y: 330, class: 'board-print' }, 'v8'),
    h('rect', { x: 270, y: 180, width: 85, height: 85, rx: 3, class: 'chip' }),
    h('text', { x: 282, y: 228, class: 'board-print' }, 'ATxmega'),
    h('rect', { x: 25, y: 125, width: 85, height: 62, rx: 3, class: 'usb' }),
    h('rect', { x: 25, y: 136, width: 27, height: 39, class: 'usb-in' }),
    h('text', { x: 62, y: 161, class: 'board-print dark' }, 'USB'),
    h('rect', { x: 596, y: 504, width: 54, height: 59, class: 'connector' }),
    h('text', { x: 596, y: 581, class: 'board-print' }, 'J1 POWER'),
    ...(power.length === 2 ? [target(power[0] as PinInfo, (power[0] as PinInfo).ref, 610, 519, 26, 26, 7), target(power[1] as PinInfo, (power[1] as PinInfo).ref, 634, 542, 26, 26, 7)] : []),
    ...header('J8', 145),
    ...header('J7', 310),
    ...header('J6', 475),
    ...motor(4, 122),
    ...motor(3, 242),
    ...motor(2, 362),
    ...motor(1, 482),
    h('rect', { x: 505, y: 183, width: 54, height: 39, class: 'chip' }),
    h('text', { x: 511, y: 245, class: 'board-print' }, 'ICSP'),
    h('circle', { cx: 610, cy: 178, r: 12, class: 'pot' }),
    h('text', { x: 590, y: 205, class: 'board-print' }, 'RESET'),
    h('rect', { x: 611, y: 405, width: 34, height: 53, class: 'connector' }),
    h('text', { x: 613, y: 474, class: 'board-print' }, 'FAN'),
    h('g', { class: 'leds' }, ...[238, 258, 278, 337, 357].map((y) => h('rect', { x: 66, y, width: 9, height: 5, key: String(y) }))),
    ...[['PWR', 244], ['TX', 264], ['RX', 284], ['SPIN', 343], ['COOL', 363]].map(([t, y]) => h('text', { x: 82, y, class: 'board-print', key: String(t) }, t)),
    tip === null || tipPin === null
      ? null
      : h(
          'g',
          { class: 'pin-tip', 'aria-hidden': 'true', transform: `translate(${Math.min(Math.max(tip.x, 120), 580)} ${tip.y})` },
          h('rect', { x: -110, y: -16, width: 220, height: 34, rx: 6 }),
          h('text', { x: 0, y: -1, 'text-anchor': 'middle', class: 'tip-a' }, `${tipPin.ref} · ${tipPin.label}`),
          h('text', { x: 0, y: 12, 'text-anchor': 'middle', class: 'tip-b' }, tipPin.function),
        ),
  );
}

type OverviewSide = 'board' | 'pin';

function OverviewTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [selected, setSelected] = useState<string | null>(null);
  const [side, setSide] = useState<OverviewSide>('board');
  const settings = settingsOf(view);
  const pin = selected === null ? null : pinByRef(selected);
  const select = (ref: string): void => {
    setSelected(ref);
    setSide('pin');
  };
  return h(
    'div',
    { class: 'configure-grid' },
    h(
      'div',
      { class: 'viewer board-canvas' },
      h('div', { class: 'viewer-top' }, h('span', { class: 'viewer-label' }, 'TinyG v8 · choose any terminal')),
      h(BoardIllustration, { selected, onSelect: select, settings }),
      h('div', { class: 'viewer-foot' }, 'Drawn from public information about the board · pin names from the board definition · check your board’s revision'),
    ),
    h(
      'aside',
      { class: 'inspector tabbed', 'aria-label': 'Board' },
      h(TabBar<OverviewSide>, { label: 'Board details', prefix: 'bside', variant: 'underline', current: side, onSelect: setSide, tabs: [{ id: 'board', label: 'This board' }, { id: 'pin', label: pin === null ? 'Selected pin' : pin.ref }] }),
      h(TabPane, { prefix: 'bside', id: 'board', current: side, class: 'tpane insp-scroll' }, h(BoardFacts, { view })),
      h(
        TabPane,
        { prefix: 'bside', id: 'pin', current: side, class: 'tpane insp-scroll' },
        pin === null
          ? h('section', { class: 'insp' }, h('p', { class: 'fine' }, 'Select a pin to see its wiring and settings.'))
          : pin.role === 'motor'
            ? [h(PinCard, { key: 'card', pin, view, onClose: () => setSelected(null) }), h(MotorDraft, { key: 'draft', motor: Number(pin.connector.slice(1)), view })]
            : h(PinCard, { pin, view, onClose: () => setSelected(null) }),
      ),
    ),
  );
}

// ---------------------------------------------------------------- motors, axes, inputs, outputs, comms

function MotorsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [motor, setMotor] = useState(1);
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const read = MOTORS.some((m) => settings[`${m}ma`] !== undefined);
  return h(
    'div',
    { class: 'configure-grid' },
    h(
      'div',
      { class: 'list-panel' },
      h('div', { class: 'panel-title' }, h('h2', null, 'Motors'), h('span', { class: 'fine' }, 'Choose a motor to draft changes')),
      read
        ? h(
            'div',
            { class: 'tool-table-wrap' },
            h(
              'table',
              { class: 'cfg-table' },
              h('thead', null, h('tr', null, ...['Motor', 'Drives', 'Step angle', 'Travel per rev', 'Microsteps', 'Polarity', 'Power', 'Steps per unit'].map((t) => h('th', { scope: 'col', key: t }, t)))),
              h(
                'tbody',
                null,
                MOTORS.map((m) => {
                  const n = (k: string): number | undefined => (typeof settings[`${m}${k}`] === 'number' ? (settings[`${m}${k}`] as number) : undefined);
                  const spu = stepsPerUnit(n('sa'), n('mi'), n('tr'));
                  return h(
                    'tr',
                    { key: m, 'aria-selected': motor === m ? 'true' : 'false', onClick: () => setMotor(m), 'data-motor-row': String(m) },
                    h('th', { scope: 'row' }, h('button', { type: 'button', class: 'row-link', onClick: () => setMotor(m) }, `Motor ${m}`)),
                    ...MOTOR_FIELDS.map((f) => cell(`${m}${f}`, settings, dialect)),
                    h('td', { class: 'num' }, spu === null ? 'Unknown' : num(spu, 3)),
                  );
                }),
              ),
            ),
          )
        : h(Empty, { view }),
    ),
    h('aside', { class: 'inspector', 'aria-label': 'Motor draft' }, h(MotorDraft, { motor, view })),
  );
}

const AXIS_MOTION = ['am', 'vm', 'fr', 'tn', 'tm', 'jm', 'jd'] as const;
const AXIS_HOMING = ['sn', 'sx', 'sv', 'lv', 'lb', 'zb', 'jh'] as const;
const MOTION_HEAD = ['Mode', 'Max velocity', 'Max feed', 'Travel min', 'Travel max', 'Jerk', 'Junction deviation'];
const HOMING_HEAD = ['Min switch', 'Max switch', 'Search velocity', 'Latch velocity', 'Latch backoff', 'Zero backoff', 'Homing jerk'];

function axisTable(title: string, head: readonly string[], fields: readonly string[], settings: Settings, dialect: string | null, edit: LiveView | null = null): ComponentChild {
  const axes = ['x', 'y', 'z', 'a', 'b', 'c'].filter((a) => fields.some((f) => settings[`${a}${f}`] !== undefined));
  return h(
    'section',
    { class: 'cfg-section' },
    h('h3', { class: 'tan-label' }, title),
    h(
      'table',
      { class: 'cfg-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Axis'), ...head.map((t) => h('th', { scope: 'col', key: t }, t)))),
      h('tbody', null, axes.map((a) => h('tr', { key: a }, h('th', { scope: 'row' }, a.toUpperCase()), ...fields.map((f) => (settings[`${a}${f}`] === undefined ? h('td', { key: f, class: 'muted' }, 'Unknown') : cell(`${a}${f}`, settings, dialect, edit)))))),
    ),
  );
}

function AxesTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [editing, setEditing] = useState(false);
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  if (settings['xam'] === undefined) return h('div', { class: 'scroll-region' }, h(Empty, { view }));
  const edit = editing && editBlocked(view) === null ? view : null;
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll' },
    h(EditToggle, { view, editing, onToggle: () => setEditing((e) => !e) }),
    view?.axisModes === null || view?.axisModes === undefined ? null : h(AxisModes, { view: view.axisModes }),
    axisTable('Motion', MOTION_HEAD, AXIS_MOTION, settings, dialect, edit),
    axisTable('Homing and switches', HOMING_HEAD, AXIS_HOMING, settings, dialect, edit),
    h('dl', { class: 'facts inline-facts' }, ...['st', 'sl', 'mt', 'ja', 'ct'].map((k) => h('div', { key: k }, h('dt', null, settingMeta(k, dialect).label, h('small', { class: 'raw-key' }, k)), h('dd', null, plainValue(k, settings[k], dialect) ?? 'Not read', edit === null ? null : h('div', { class: 'cell-edit' }, h(SettingEditor, { k, view: edit, compact: true })))))),
  );
}

function InputsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [editing, setEditing] = useState(false);
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const pins = [...connectorPins('J7'), ...connectorPins('J8')].filter((p) => p.role === 'input');
  const st = plainValue('st', settings['st'], dialect);
  const edit = editing && editBlocked(view) === null ? view : null;
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll' },
    h(EditToggle, { view, editing, onToggle: () => setEditing((e) => !e) }),
    h(
      'section',
      { class: 'cfg-section' },
      h('h3', { class: 'tan-label' }, 'Switch inputs'),
      h(
        'table',
        { class: 'cfg-table' },
        h('thead', null, h('tr', null, ...['Pin', 'Name', 'Input', 'What it does', 'Contact', 'Chip pin'].map((t) => h('th', { scope: 'col', key: t }, t)))),
        h(
          'tbody',
          null,
          pins.map((p) =>
            h(
              'tr',
              { key: p.ref },
              h('th', { scope: 'row' }, h('span', { class: 'pin-ref' }, p.ref)),
              h('td', null, h('strong', null, p.label)),
              h('td', null, p.function),
              cell(p.keys[0] as string, settings, dialect, edit),
              h('td', null, h(Keyed, { value: st ?? 'Not read', raw: 'st' })),
              h('td', { class: 'mono' }, p.mcu ?? 'Not applicable'),
            ),
          ),
        ),
      ),
      h('p', { class: 'fine' }, 'One switch type applies to all inputs. Inputs have 2.7 kΩ pull-ups to 3.3 V.'),
      edit === null ? null : h('dl', { class: 'facts inline-facts' }, h('div', null, h('dt', null, settingMeta('st', dialect).label, h('small', { class: 'raw-key' }, 'st')), h('dd', null, st ?? 'Not read', h('div', { class: 'cell-edit' }, h(SettingEditor, { k: 'st', view: edit, compact: true }))))),
    ),
  );
}

function OutputsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [editing, setEditing] = useState(false);
  const edit = editing && editBlocked(view) === null ? view : null;
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const pins = connectorPins('J6');
  const snapshot = view !== null && connected(view) ? view.message?.snapshot : undefined;
  const r = displayReadouts(snapshot);
  const pwm = Object.keys(settings).filter((k) => /^p1/.test(k)).sort();
  const srList = snapshot?.live.srList;
  const missing = srList !== undefined && !['spe', 'spc', 'sps', 'cof', 'com'].every((k) => srList.includes(k));
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll' },
    h(EditToggle, { view, editing, onToggle: () => setEditing((e) => !e) }),
    h(
      'section',
      { class: 'cfg-section' },
      h('h3', { class: 'tan-label' }, 'J6 spindle and coolant'),
      h(
        'table',
        { class: 'cfg-table' },
        h('thead', null, h('tr', null, ...['Pin', 'Name', 'What it does', 'Polarity', 'Chip pin'].map((t) => h('th', { scope: 'col', key: t }, t)))),
        h(
          'tbody',
          null,
          pins.map((p) =>
            h(
              'tr',
              { key: p.ref },
              h('th', { scope: 'row' }, h('span', { class: 'pin-ref' }, p.ref)),
              h('td', null, h('strong', null, p.label)),
              h('td', null, p.function),
              p.signal === 'out.spindleEnable' ? cell('spep', settings, dialect, edit) : p.signal === 'out.spindleDirection' ? cell('spdp', settings, dialect, edit) : p.signal === 'out.spindlePwm' ? cell('spph', settings, dialect) : p.signal === 'out.coolant' ? cell('coph', settings, dialect) : h('td', { class: 'muted' }, 'Not applicable'),
              h('td', { class: 'mono' }, p.mcu ?? 'Not applicable'),
            ),
          ),
        ),
      ),
      h('p', { class: 'fine' }, 'Mist and flood share the one coolant output on this board.'),
    ),
    h(
      'section',
      { class: 'cfg-section' },
      h('h3', { class: 'tan-label' }, 'Reported now'),
      h(
        'dl',
        { class: 'facts inline-facts' },
        h('div', null, h('dt', null, 'Spindle', h('small', { class: 'raw-key' }, 'spe spc sps')), h('dd', null, spindleText(r))),
        h('div', null, h('dt', null, 'Coolant', h('small', { class: 'raw-key' }, 'cof com')), h('dd', null, coolantText(r))),
      ),
      h('p', { class: 'fine' }, missing ? 'This board’s status list does not carry these: they were read once at connect and change only when the list carries them. Display only: never rely on them for safety.' : 'From the board’s status reports. Display only: never rely on them for safety.'),
    ),
    pwm.length === 0
      ? null
      : h(
          'section',
          { class: 'cfg-section' },
          h('h3', { class: 'tan-label' }, 'Spindle speed output (PWM)'),
          h('dl', { class: 'facts inline-facts' }, pwm.map((k) => h('div', { key: k }, h('dt', null, settingMeta(k, dialect).label, h('small', { class: 'raw-key' }, k)), h('dd', null, plainValue(k, settings[k], dialect) ?? 'Not read')))),
        ),
  );
}

function CommsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const srList = view !== null && connected(view) ? view.message?.snapshot.live.srList : undefined;
  if (settings['ej'] === undefined && srList === undefined) return h('div', { class: 'scroll-region' }, h(Empty, { view }));
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll' },
    h(
      'section',
      { class: 'cfg-section' },
      h('h3', { class: 'tan-label' }, 'Serial link'),
      h('dl', { class: 'facts inline-facts' }, ...['baud', 'ex', 'ec', 'ee', 'ej', 'jv', 'js', 'tv', 'qv', 'sv', 'si', 'rxm'].filter((k) => settings[k] !== undefined).map((k) => h('div', { key: k }, h('dt', null, settingMeta(k, dialect).label, h('small', { class: 'raw-key' }, k)), h('dd', null, `${plainValue(k, settings[k], dialect) ?? 'Not read'}${k === 'si' ? ' ms' : ''}`)))),
      h('p', { class: 'fine' }, 'Read-only communication settings. Changing them can prevent senders from connecting.'),
    ),
    h(
      'section',
      { class: 'cfg-section' },
      h('h3', { class: 'tan-label' }, 'Status report list'),
      srList === undefined ? h('p', { class: 'fine' }, 'Read when the board answers the first status request.') : h('ul', { class: 'key-chips', 'aria-label': 'Fields in the status report' }, srList.map((k) => h('li', { key: k }, settingMeta(k, dialect).label, h('code', { class: 'raw-key' }, k)))),
      h('p', { class: 'fine' }, 'Fields reported by this board. Read only.'),
    ),
  );
}

function SettingsTab({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region settings-tab' },
    h('div', { class: 'settings-read', 'data-region': 'settings' }, h(SettingsStatus, { phase: view?.readout.phase ?? { kind: 'idle' }, onKeep: () => model?.actions.value?.keepBoardSettings() })),
    uiLevel.value.value === 'simple' ? h(GuidedSettings, { view, prefix: 'board' }) : h(SettingsTable, { view }),
  );
}

// Firmware and Backups (SAFETY §4.8 as amended 2026-11-03 and 2026-11-09): the Firmware tab (the Update panel, then
// the firmware image backups, custom firmware and trusted builds) and the Backups tab (settings backups).
export { FirmwareTab } from './FirmwareViews.ts';

export function BoardView({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  // The old-firmware gate: a board below the signed list's minimum opens straight into the Update panel.
  const old = view?.message?.oldFirmware ?? null;
  const tab = boardTab.value;
  const setTab = (next: Tab): void => { boardTab.value = next; };
  const [oldSeen, setOldSeen] = useState<string | null>(null);
  const oldKey = old === null ? null : `${view?.message?.snapshot.epoch ?? 0}`;
  if (oldKey !== null && oldKey !== oldSeen) {
    setOldSeen(oldKey);
    if (tab !== 'firmware') setTab('firmware');
  }
  const drafts = Object.keys(draftStore.value.value).length;
  const tabs: readonly { id: Tab; label: string; badge?: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'motors', label: 'Motors', ...(drafts === 0 ? {} : { badge: String(drafts) }) },
    { id: 'axes', label: 'Axes' },
    { id: 'inputs', label: 'Inputs' },
    { id: 'io', label: 'Spindle and coolant' },
    { id: 'comms', label: 'Communications' },
    { id: 'settings', label: 'All settings' },
    { id: 'firmware', label: 'Firmware', ...(old === null ? {} : { badge: 'Update' }) },
    { id: 'backups', label: 'Backups' },
  ];
  const pane = (id: Tab, child: ComponentChild): ComponentChild => h(TabPane, { prefix: 'board', id, current: tab, class: 'cpane' }, child);
  return h(
    'div',
    { class: 'board-view' },
    h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, 'Board')), h('div', { class: 'view-actions board-tabs' }, h(TabBar<Tab>, { label: 'Board', prefix: 'board', attr: 'data-board-tab', current: tab, onSelect: setTab, tabs }))),
    h(PendingTray, { model }),
    pane('overview', h(OverviewTab, { view })),
    pane('motors', h(MotorsTab, { view })),
    pane('axes', h(AxesTab, { view })),
    pane('inputs', h(InputsTab, { view })),
    pane('io', h(OutputsTab, { view })),
    pane('comms', h(CommsTab, { view })),
    pane('settings', h(SettingsTab, { model })),
    pane('firmware', h('div', { class: 'firmware-tab' }, h(FirmwareTab, { model }), h(BackupsHub, { model, part: 'firmware' }))),
    pane('backups', h(BackupsHub, { model, part: 'settings' })),
  );
}
