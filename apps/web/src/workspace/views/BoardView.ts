/**
 * The Board view (Stage 1, read-only): what the board reported about itself,
 * the OD-5 board illustration with the settings read for each connection,
 * the full settings read with the drift check (P1-07), "Back up settings",
 * and the firmware Update panel as future, disabled UI.
 *
 * Every value is what the board answered to a GET through the read
 * allowlist; strings from the board go through `boardText` (T-S85). Nothing
 * here writes to the board.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { boardText } from '@synthetos/safety';
import { settingsSchemaFor, type SettingValue } from '@synthetos/schema';
import { backupBlocked } from '../../live/backup.ts';
import { AxisModes } from '../../machine-ui/AxisModes.ts';
import { SettingsView, valueText } from '../../machine-ui/SettingsView.ts';
import { Icon } from '../icons.ts';
import { connected, type LiveView, type WorkspaceModel } from '../model.ts';
import { UNKNOWN } from '../status.ts';

type Tab = 'board' | 'settings' | 'backups' | 'firmware';
type Connector = 'motor1' | 'motor2' | 'motor3' | 'motor4' | 'xy' | 'za' | 'outputs';

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
  flowControl: 'The board uses hardware flow control, which this release does not drive.',
};

function fact(label: string, value: string, raw: string, attr?: string): ComponentChild {
  return h('div', { key: raw }, h('dt', null, label, h('small', { class: 'raw-key' }, raw)), h('dd', attr === undefined ? null : { 'data-board-fact': attr }, value));
}

/** The probe facts in plain words, with the raw key as secondary text. */
function BoardFacts({ view }: { readonly view: LiveView | null }): ComponentChild {
  const s = view?.message?.snapshot ?? null;
  const on = view !== null && connected(view);
  const id = s?.identity ?? null;
  const c = s?.classification ?? null;
  const dialect = c?.dialectId === 'tinyg-en' ? 'TinyG edge-next' : c?.dialectId === 'tinyg-440' ? 'TinyG 440' : c?.dialectId === null || c === null ? 'Not identified' : c.dialectId;
  const readOnly = s?.overlays.includes('READ_ONLY') === true;
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
          fact('Approval', c === null ? UNKNOWN : (REASON_TEXT[c.reason] ?? c.reason), c?.reason ?? 'classification', 'approval'),
        )
      : h('p', { class: 'fine' }, 'Connect a board on the Run view. Its build, hardware version and settings appear here, read with GETs only.'),
    on && readOnly
      ? h(
          'p',
          { class: 'note', 'data-board-fact': 'read-only' },
          'Why read only: this is the Phase 1 release, so every board is connected read-only. Run reads positions and settings and writes nothing to the board.',
          c?.detail === undefined || c.detail === '' ? null : h('small', { class: 'raw-key block' }, boardText(c.detail)),
        )
      : null,
  );
}

const MOTOR_KEYS = ['ma', 'sa', 'tr', 'mi', 'po', 'pm', 'pl'];
const CONNECTOR_KEYS: Readonly<Record<Connector, readonly string[]>> = {
  motor1: MOTOR_KEYS.map((k) => `1${k}`),
  motor2: MOTOR_KEYS.map((k) => `2${k}`),
  motor3: MOTOR_KEYS.map((k) => `3${k}`),
  motor4: MOTOR_KEYS.map((k) => `4${k}`),
  xy: ['st', 'xsn', 'xsx', 'ysn', 'ysx'],
  za: ['st', 'zsn', 'zsx', 'asn', 'asx'],
  outputs: ['spep', 'spdp', 'spph', 'coph', 'comp', 'cofp'],
};
const CONNECTOR_TITLE: Readonly<Record<Connector, string>> = {
  motor1: 'Motor 1',
  motor2: 'Motor 2',
  motor3: 'Motor 3',
  motor4: 'Motor 4',
  xy: 'X / Y inputs',
  za: 'Z / A inputs',
  outputs: 'Spindle / coolant',
};

function settingRows(view: LiveView | null, keys: readonly string[]): ComponentChild {
  const dialect = view?.readout.dialectId ?? null;
  const settings: Readonly<Record<string, SettingValue>> = view?.readout.settings ?? {};
  let defs: ReturnType<typeof settingsSchemaFor>['settings'] | null = null;
  try {
    defs = dialect === null ? null : settingsSchemaFor(dialect).settings;
  } catch {
    defs = null;
  }
  const rows = keys.filter((k) => settings[k] !== undefined);
  if (rows.length === 0) return h('p', { class: 'fine' }, view !== null && connected(view) ? 'These settings have not been read yet, or this firmware does not have them.' : 'Connect a board to read this connection’s settings.');
  return h(
    'dl',
    { class: 'facts' },
    rows.map((k) => {
      const o = defs?.get(k)?.overlay;
      const unit = o === undefined || o.unit === 'enum' ? '' : ` ${o.unit}`;
      return h('div', { key: k }, h('dt', { title: o?.description ?? '' }, o?.label ?? k, h('small', { class: 'raw-key' }, k)), h('dd', null, `${valueText(settings[k])}${unit}`));
    }),
  );
}

/** The TinyG v8 board illustration (OD-5: connector positions and labels as derived public facts only). */
function BoardIllustration({ selected, onSelect, motorAxis }: { readonly selected: Connector; readonly onSelect: (c: Connector) => void; readonly motorAxis: (n: number) => string }): ComponentChild {
  const pins = (x: number, y: number, n: number, r: number): ComponentChild[] => {
    const step = n === 6 ? 22 : 23;
    return Array.from({ length: n }, (_, i) => h('g', { key: String(i) }, h('circle', { cx: x + i * step, cy: y, r, class: 'contact' }), h('path', { d: `m${x + i * step - 3} ${y}h6`, class: 'contact-slot' })));
  };
  const hotspot = (id: Connector, label: string, children: ComponentChild[]): ComponentChild =>
    h(
      'g',
      {
        key: id,
        class: 'board-hotspot',
        role: 'button',
        tabindex: 0,
        'aria-label': `Show ${label}`,
        'aria-pressed': selected === id ? 'true' : 'false',
        'data-connector': id,
        onClick: () => onSelect(id),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(id);
          }
        },
      },
      ...children,
    );
  const header = (id: Connector, label: string, x: number): ComponentChild =>
    hotspot(id, label, [h('rect', { x: x - 8, y: 48, width: 154, height: 81, class: 'hit' }), h('rect', { x, y: 58, width: 138, height: 35, class: 'connector' }), ...pins(x + 13, 75, 6, 6), h('text', { x, y: 113, class: 'board-print' }, label)]);
  const motor = (n: number, x: number): ComponentChild =>
    hotspot(`motor${n}` as Connector, `motor ${n}`, [
      h('rect', { x: x - 11, y: 358, width: 112, height: 208, class: 'hit' }),
      h('text', { x: x + 2, y: 382, class: 'board-print' }, `MOTOR ${n}`),
      h('rect', { x: x + 19, y: 398, width: 48, height: 47, class: 'chip' }),
      h('circle', { cx: x + 58, cy: 473, r: 15, class: 'pot' }),
      h('circle', { cx: x + 58, cy: 473, r: 10, class: 'pot-in' }),
      h('rect', { x, y: 507, width: 95, height: 35, class: 'connector' }),
      ...pins(x + 11, 524, 4, 7),
      h('text', { x, y: 557, class: 'board-print' }, motorAxis(n)),
    ]);
  return h(
    'svg',
    { class: 'board-svg', viewBox: '0 0 700 620', role: 'group', 'aria-label': 'TinyG v8 board illustration. Motors 4 to 1 along the lower edge, USB at left, inputs and outputs along the top. Choose a connection to see its settings.' },
    h('rect', { x: 35, y: 30, width: 630, height: 560, rx: 15, class: 'board-base' }),
    ...[[51, 46], [649, 46], [51, 574], [649, 574]].map(([cx, cy]) => h('circle', { cx, cy, r: 7, class: 'board-hole', key: `${cx}-${cy}` })),
    h('path', { d: 'M125 490V340l25-30V120M185 490V340l25-30V120M245 490V340l25-30V120M305 490V340l25-30V120M365 490V340l25-30V120M425 490V340l25-30V120M485 490V340l25-30V120M545 490V340l25-30V120', class: 'board-trace' }),
    h('text', { x: 310, y: 330, class: 'board-title' }, 'TinyG'),
    h('text', { x: 405, y: 330, class: 'board-print' }, 'v8'),
    h('rect', { x: 270, y: 180, width: 85, height: 85, rx: 3, class: 'chip' }),
    h('text', { x: 282, y: 228, class: 'board-print' }, 'ATxmega'),
    h('rect', { x: 25, y: 125, width: 85, height: 62, rx: 3, class: 'usb' }),
    h('rect', { x: 25, y: 136, width: 27, height: 39, class: 'usb-in' }),
    h('text', { x: 62, y: 161, class: 'board-print dark' }, 'USB'),
    h('rect', { x: 596, y: 504, width: 54, height: 59, class: 'connector' }),
    h('text', { x: 600, y: 581, class: 'board-print' }, 'POWER'),
    h('circle', { cx: 610, cy: 519, r: 7, class: 'contact' }),
    h('circle', { cx: 634, cy: 542, r: 7, class: 'contact' }),
    header('za', 'Z / A inputs', 145),
    header('xy', 'X / Y inputs', 310),
    header('outputs', 'Spindle / coolant', 475),
    motor(4, 122),
    motor(3, 242),
    motor(2, 362),
    motor(1, 482),
    h('rect', { x: 505, y: 183, width: 54, height: 39, class: 'chip' }),
    h('text', { x: 511, y: 245, class: 'board-print' }, 'ICSP'),
    h('circle', { cx: 610, cy: 158, r: 12, class: 'pot' }),
    h('text', { x: 590, y: 185, class: 'board-print' }, 'RESET'),
    h('rect', { x: 611, y: 405, width: 34, height: 53, class: 'connector' }),
    h('text', { x: 613, y: 478, class: 'board-print' }, 'FAN'),
    h('g', { class: 'leds' }, ...[238, 258, 278, 337, 357].map((y) => h('rect', { x: 66, y, width: 9, height: 5, key: String(y) }))),
    ...[['PWR', 244], ['TX', 264], ['RX', 284], ['SPIN', 343], ['COOL', 363]].map(([t, y]) => h('text', { x: 82, y, class: 'board-print', key: String(t) }, t)),
  );
}

const AXIS_NAMES = ['X', 'Y', 'Z', 'A', 'B', 'C'];

function BoardTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [selected, setSelected] = useState<Connector>('motor1');
  const settings = view?.readout.settings ?? {};
  const motorAxis = (n: number): string => {
    const ma = settings[`${n}ma`];
    return typeof ma === 'number' ? `${AXIS_NAMES[ma] ?? `axis ${ma}`} axis` : 'Not read';
  };
  return h(
    'div',
    { class: 'configure-grid' },
    h(
      'div',
      { class: 'viewer board-canvas' },
      h('div', { class: 'viewer-top' }, h('span', { class: 'viewer-label' }, 'TinyG v8 · board illustration')),
      h(BoardIllustration, { selected, onSelect: setSelected, motorAxis }),
      h('div', { class: 'viewer-foot' }, 'Public-board illustration (OD-5) · exact revision must be verified'),
    ),
    h(
      'aside',
      { tabindex: 0, class: 'inspector', 'aria-label': 'Board' },
      h(BoardFacts, { view }),
      h(
        'section',
        { class: 'insp', 'aria-labelledby': 'connection-title' },
        h('header', null, h('h2', { id: 'connection-title' }, CONNECTOR_TITLE[selected]), h('span', { class: 'tag' }, 'Read from the board')),
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Choose a connection'),
          h(
            'span',
            { class: 'select-wrap' },
            h(
              'select',
              { value: selected, onChange: (e: Event) => setSelected((e.currentTarget as HTMLSelectElement).value as Connector) },
              (Object.keys(CONNECTOR_TITLE) as Connector[]).map((c) => h('option', { value: c, key: c }, CONNECTOR_TITLE[c])),
            ),
          ),
        ),
        settingRows(view, CONNECTOR_KEYS[selected]),
        h('p', { class: 'fine' }, 'Changing these settings is a later, separately reviewed phase. Phase 1 reads them only.'),
      ),
    ),
  );
}

function SettingsTab({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region settings-tab' },
    view?.axisModes === null || view?.axisModes === undefined ? null : h(AxisModes, { view: view.axisModes }),
    h(SettingsView, { dialectId: view?.readout.dialectId ?? null, phase: view?.readout.phase ?? { kind: 'idle' }, settings: view?.readout.settings ?? {}, onKeep: () => model?.actions.value?.keepBoardSettings() }),
  );
}

/** The backup's JSON shape, for the people who want to read it before they save one. */
const BACKUP_SHAPE = '{ "format": "synthetos-run-settings-backup", "version": 1, "takenAt", "board": { "id", "dialect", "fb", "fv", "hp", "hv" }, "units": { "unit", "g21Sent": false }, "groups": { "x": { … } }, "tokens": { "xvm": … }, "unanswered": [ … ] }';

export function BackupsTab({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const snapshot = view?.message?.snapshot ?? null;
  const blocked = backupBlocked(snapshot);
  const status = view?.backup ?? { kind: 'idle' as const };
  const busy = status.kind === 'reading' || view?.readout.phase.kind === 'reading';
  return h(
    'div',
    { class: 'configure-grid' },
    h(
      'div',
      { tabindex: 0, class: 'list-panel backups-panel' },
      h(
        'div',
        { class: 'section-heading tight' },
        h('h2', null, 'Back up settings'),
        h(
          'button',
          { type: 'button', class: 'primary small', 'data-action': 'backup', 'data-machine-control': 'read', disabled: blocked !== null || busy || model === null, 'aria-describedby': 'backup-why', onClick: () => model?.actions.value?.backup() },
          Icon('download', 16),
          status.kind === 'reading' ? 'Reading…' : 'Back up settings',
        ),
      ),
      h(
        'p',
        { class: 'fine', id: 'backup-why', 'data-backup': blocked === null ? 'ready' : 'blocked' },
        blocked ?? 'Reads every setting the read allowlist admits, one GET at a time, and saves them as a JSON file named by board id and date. The board is not changed.',
      ),
      status.kind === 'reading' ? h('p', { class: 'backup-progress', role: 'status', 'data-backup': 'reading' }, `Reading ${status.token === '' ? 'the last answer' : `"${status.token}"`}: ${status.done} of ${status.of}`) : null,
      status.kind === 'saved' ? h('p', { class: 'backup-progress ok', role: 'status', 'data-backup': 'saved' }, `Saved ${status.name}: ${status.answered} groups${status.unanswered === 0 ? '' : `, ${status.unanswered} unanswered (listed in the file)`}.`) : null,
      status.kind === 'failed' ? h('p', { class: 'backup-progress danger', role: 'alert', 'data-backup': 'failed' }, `The backup was not saved: ${status.message}`) : null,
      h(
        'ul',
        { class: 'lock-list backup-rules' },
        h('li', { class: 'ok' }, 'GET requests only, through the session’s read allowlist'),
        h('li', { class: 'ok' }, 'One request at a time: each waits for the board’s answer'),
        h('li', { class: 'ok' }, 'Units recorded as reported (unit); no G21 is sent, because Phase 1 writes nothing'),
        h('li', { class: 'locked' }, 'Restoring a backup is a settings write: a later, separately reviewed phase'),
      ),
      h('details', { class: 'more' }, h('summary', null, 'What the file contains'), h('code', { class: 'block' }, BACKUP_SHAPE)),
    ),
    h(
      'aside',
      { tabindex: 0, class: 'inspector', 'aria-label': 'Restore' },
      h(
        'section',
        { class: 'insp' },
        h('header', null, h('h2', null, 'Restore'), h('span', { class: 'tag' }, 'Settings writes')),
        h('p', { class: 'fine' }, 'Restore shows the difference between a backup and the board, then writes one setting at a time. It ships with settings writes, after Phase 1.'),
        h('button', { type: 'button', class: 'wide', disabled: true, 'data-machine-control': 'settings-write' }, 'Restore a backup'),
      ),
    ),
  );
}

export function FirmwareTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const id = view?.message?.snapshot.identity ?? null;
  const on = view !== null && connected(view);
  return h(
    'div',
    { class: 'configure-grid' },
    h(
      'div',
      { tabindex: 0, class: 'list-panel releases-panel' },
      h(
        'div',
        { class: 'fw-current' },
        h('div', { class: 'fw-chip' }, Icon('chip', 26)),
        h('div', { class: 'grow' }, h('span', { class: 'kicker' }, 'On this board'), h('h2', null, on && typeof id?.fb === 'number' ? `Firmware ${id.fb.toFixed(2)}` : 'Firmware not read'), h('p', null, on ? `Hardware version ${id?.hv === undefined ? UNKNOWN : boardText(String(id.hv))} · read when connected` : 'Connect a board to read its firmware version.')),
      ),
      h('div', { class: 'section-heading tight' }, h('h2', null, 'Releases'), h('span', { class: 'fine' }, 'Signed builds only, for this board’s hardware')),
      h('p', { class: 'fine pad' }, 'The signed release list arrives with firmware updates. No release is offered by this page.'),
    ),
    h(
      'aside',
      { tabindex: 0, class: 'inspector', 'aria-label': 'Firmware update' },
      h(
        'section',
        { class: 'insp', 'data-region': 'firmware-update' },
        h('header', null, h('h2', null, 'Update'), h('span', { class: 'tag' }, 'Own safety-reviewed phase')),
        h('ol', { class: 'fw-plan' }, ['Back up every setting', 'Restart into update mode', 'Write and verify the signed build', 'Reconnect and check the version', 'Restore your settings'].map((s, i) => h('li', { key: s }, h('span', null, String(i + 1)), s))),
        h('button', { type: 'button', class: 'primary wide', disabled: true, 'data-machine-control': 'firmware' }, 'Review the update'),
        h('p', { class: 'fine' }, 'Firmware updates are a separate phase with their own safety review. Nothing is written to the board from here.'),
      ),
    ),
  );
}

export function BoardView({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const [tab, setTab] = useState<Tab>('board');
  const view = model?.live.value ?? null;
  const tabs: readonly [Tab, string][] = [
    ['board', 'Board'],
    ['settings', 'Settings'],
    ['backups', 'Backups'],
    ['firmware', 'Firmware'],
  ];
  return h(
    'div',
    { class: 'board-view' },
    h(
      'div',
      { class: 'view-head' },
      h('div', { class: 'title-block' }, h('h1', null, 'Board'), h('p', null, 'What the board reports about itself, read with GETs only. Nothing here changes the board.')),
      h(
        'div',
        { class: 'view-actions' },
        h(
          'div',
          { class: 'tabs', role: 'tablist', 'aria-label': 'Board' },
          tabs.map(([id, label]) => h('button', { type: 'button', role: 'tab', key: id, 'data-board-tab': id, 'aria-selected': tab === id ? 'true' : 'false', onClick: () => setTab(id) }, label)),
        ),
      ),
    ),
    h('div', { class: 'cpane', hidden: tab !== 'board' }, h(BoardTab, { view })),
    h('div', { class: 'cpane', hidden: tab !== 'settings' }, h(SettingsTab, { model })),
    h('div', { class: 'cpane', hidden: tab !== 'backups' }, h(BackupsTab, { model })),
    h('div', { class: 'cpane', hidden: tab !== 'firmware' }, h(FirmwareTab, { view })),
  );
}
