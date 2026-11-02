/**
 * The Run view (Stage 1, read-only): connect, the live position, the G-code
 * preview with its timeline, the G-code, Console and Live job tabs, and the
 * job card. Jog, spindle, coolant and overrides are shown as what is coming
 * and send nothing.
 *
 * The preview is the TB-03 PreviewPanel (gcode.worker, Preview3D, LineList)
 * arranged by `runLayout`. There is no Play, Simulate or Animate control
 * (SAFETY H15, T-S41): the timeline scrubs and highlights lines, nothing
 * moves.
 */
import { h, type ComponentChild } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { w13 } from '@synthetos/safety';
import { DIALECTS, type DialectId } from '@synthetos/protocol';
import { LITE_THRESHOLD_LINES, PREVIEW_DIALECTS, type PreviewMode } from '../../gcode-worker/pipeline.ts';
import type { WorkerLike } from '../../gcode-worker/client.ts';
import { Dro } from '../../machine-ui/Dro.ts';
import { TranscriptSave } from '../../machine-ui/TranscriptSave.ts';
import { PreviewPanel, markerText, type LiveMarkerView, type PreviewParts } from '../../preview/PreviewPanel.ts';
import { DIALECT_LABEL, MODE_LABEL, fileLevel, on, progressText } from '../../preview/PreviewView.ts';
import type { PreviewResult } from '../../gcode-worker/pipeline.ts';
import { routineChanges, shownCounts } from '../../preview/gcodeList.ts';
import type { SettingValue } from '@synthetos/schema';
import { ConnectPanel } from '../../live/ConnectPanel.ts';
import { connectorPins, dialectOf, plainValue, settingsOf, type PinInfo } from '../boardFacts.ts';
import { Icon } from '../icons.ts';
import { readStored, writeStored } from '../storage.ts';
import { CheckRow, TabBar, TabPane } from '../ui.ts';
import { connected, type LiveView, type WorkspaceModel } from '../model.ts';
import { fileFacts, sampleFile, SAMPLES } from '../samples.ts';
import { COOLANT_TITLE, coolantText, coord, displayReadouts, num, SPINDLE_TITLE, spindleText, UNKNOWN } from '../status.ts';

export interface RunViewProps {
  readonly model: WorkspaceModel | null;
  readonly spawn: (() => WorkerLike) | null;
  readonly marker?: ReadonlySignal<LiveMarkerView | null>;
  readonly onView: (view: string) => void;
}

export function RunView({ model, spawn, marker, onView }: RunViewProps): ComponentChild {
  const live = model?.live.value ?? null;
  const reportedLine = live !== null && connected(live) ? (live.message?.snapshot.live.line ?? null) : null;
  return h(PreviewPanel, { spawn, ...(marker === undefined ? {} : { marker }), reportedLine, layout: (parts: PreviewParts) => runLayout(parts, model, onView) });
}

// ---------------------------------------------------------------- connect

/** The Connect card: the existing LIVE entry flow (live/ConnectPanel.ts), restyled. C1 opens as a dialog. */
export function ConnectNotice({ model, onView }: { readonly model: WorkspaceModel | null; readonly onView: (view: string) => void }): ComponentChild {
  const view = model?.live.value ?? null;
  const actions = model?.actions.value ?? null;
  const step = view?.entry.step ?? 'idle';
  const isConnected = view !== null && connected(view);
  const panel = h(ConnectPanel, {
    state: view?.entry ?? { step: 'idle' },
    advisoryBlocked: view?.advisoryBlocked ?? null,
    onConnect: () => actions?.connect(),
    onConfirm: (ticked) => actions?.confirm(ticked),
    onCancel: () => actions?.cancel(),
    onDisconnect: () => actions?.disconnect(),
  });
  const heading = isConnected
    ? step === 'live'
      ? 'Connected. Inspect before you operate.'
      : 'Connected'
    : step === 'refused'
      ? 'Not connected'
      : 'Connect your TinyG';
  const copy = isConnected
    ? 'Phase 1 is read-only: positions and settings are read and nothing is written to the board.'
    : 'Run checks sign-in, the safety advisory and a short checklist, then your browser asks which USB port to use.';
  return h(
    'div',
    { class: `scenario-notice connect-notice${isConnected ? ' is-connected' : ''}`, 'data-region': 'connect' },
    h('div', { class: 'notice-text' }, h('strong', null, heading), h('p', null, copy)),
    h('div', { class: 'notice-actions' }, step === 'c1' ? null : panel, isConnected ? h('button', { type: 'button', class: 'small', onClick: () => onView('board') }, 'Open the board') : null),
    step === 'c1'
      ? h(
          'div',
          { class: 'dialog-wrap', role: 'presentation' },
          h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'c1-title' }, h('div', { class: 'dialog-head' }, h('h2', { id: 'c1-title' }, 'Before you connect')), panel),
        )
      : null,
  );
}

// ---------------------------------------------------------------- position

function ageText(view: LiveView): { readonly text: string; readonly lag: string } {
  const m = view.message;
  if (m === null || m.snapshot.base === 'NOT_CONNECTED') return { text: 'Not connected', lag: 'none' };
  const base = m.dro.machineSource.ageMs;
  if (base === null) return { text: 'Waiting for position', lag: 'none' };
  const age = base + Math.max(0, view.now - view.receivedAt);
  const lag = m.snapshot.overlays.includes('STALE') || age >= m.lag.redMs ? 'red' : age >= m.lag.amberMs ? 'amber' : 'fresh';
  return { text: `${lag === 'fresh' ? 'Live' : lag === 'amber' ? 'Lagging' : 'Stale'} · ${(age / 1000).toFixed(2)} s`, lag };
}

export function PositionPanel({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const m = view !== null && connected(view) ? view.message : null;
  const axes = m === null ? (['x', 'y', 'z'] as const).map((axis) => ({ axis, work: null, machine: null, homed: null })) : m.dro.axes.filter((a) => a.work !== null || ['x', 'y', 'z'].includes(a.axis));
  const age = view === null ? { text: 'Not connected', lag: 'none' } : ageText(view);
  const wcs = m?.dro.wcs ?? null;
  const homed = m === null ? null : m.dro.axes.filter((a) => ['x', 'y', 'z'].includes(a.axis));
  const homingText =
    homed === null || homed.every((a) => a.homed === null) ? 'Not read' : homed.every((a) => a.homed === true) ? 'Homed (reported)' : `Not homed: ${homed.filter((a) => a.homed !== true).map((a) => a.axis.toUpperCase()).join(' ')}`;
  const tool = m?.snapshot.live.tool;
  const units = m?.dro.units ?? null;
  return h(
    'section',
    { class: 'insp sec-position', 'data-region': 'position', 'aria-labelledby': 'position-title' },
    h(
      'header',
      null,
      h('h2', { id: 'position-title' }, 'Position'),
      h('span', { class: `source lag-${age.lag}`, 'data-position': 'freshness', title: 'Machine position is read from the controller about twice a second; work position comes from its status reports.' }, age.text),
    ),
    h(
      'div',
      { class: 'dro-grid', role: 'table', 'aria-label': 'Position' },
      h('div', { class: 'dro-head', role: 'row' }, h('span', { role: 'columnheader' }, h('span', { class: 'sr-only' }, 'Axis')), h('span', { role: 'columnheader' }, units === null ? 'Work' : `Work, ${units}`), h('span', { role: 'columnheader' }, 'Machine, mm')),
      axes.map((a) =>
        h('div', { class: 'dro-row', role: 'row', key: a.axis, 'data-position-axis': a.axis }, h('span', { class: 'axis', role: 'rowheader' }, a.axis.toUpperCase()), h('strong', { role: 'cell', 'data-position': 'work' }, coord(a.work)), h('span', { role: 'cell', 'data-position': 'machine' }, coord(a.machine))),
      ),
    ),
    h(
      'dl',
      { class: 'facts' },
      h('div', null, h('dt', null, 'Work offset'), h('dd', { 'data-position': 'wcs' }, wcs?.code ?? (m === null ? UNKNOWN : 'Not read'))),
      h('div', null, h('dt', null, 'Homing'), h('dd', { 'data-position': 'homing' }, m === null ? UNKNOWN : homingText)),
      h('div', null, h('dt', null, 'Active tool'), h('dd', { 'data-position': 'tool' }, typeof tool === 'number' ? `T${tool}, reported` : m === null ? UNKNOWN : 'Not reported')),
    ),
    m === null
      ? h('p', { class: 'fine' }, 'Position appears when a board is connected. Unknown values show a dash, never zero.')
      : h('details', { class: 'more' }, h('summary', null, 'Where these numbers come from'), h(Dro, { message: m, elapsedMs: (view as LiveView).now - (view as LiveView).receivedAt })),
  );
}

// ---------------------------------------------------------------- inspector: coming later

export function JogSection(): ComponentChild {
  const pad = ['X−, Y+', 'Y+', 'X+, Y+', 'X−', 'Go to X0 Y0', 'X+', 'X−, Y−', 'Y−', 'X+, Y−'];
  const labels = ['↖', 'Y+', '↗', 'X−', '⌖', 'X+', '↙', 'Y−', '↘'];
  return h(
    'section',
    { class: 'insp sec-jog', 'aria-labelledby': 'jog-title' },
    h('header', null, h('h2', { id: 'jog-title' }, 'Jog'), h('span', { class: 'tag' }, 'Motion control')),
    h(
      'div',
      { class: 'jog', 'aria-disabled': 'true' },
      h(
        'div',
        { class: 'jog-pads' },
        h('div', { class: 'jog-pad', role: 'group', 'aria-label': 'X and Y' }, pad.map((label, i) => h('button', { type: 'button', disabled: true, class: `j${i % 2 === 0 && i !== 4 ? ' diag' : ''}`, 'aria-label': label, key: label, 'data-machine-control': i === 4 ? 'zero' : 'jog' }, labels[i]))),
        h('div', { class: 'jog-z', role: 'group', 'aria-label': 'Z' }, h('button', { type: 'button', disabled: true, class: 'j', 'aria-label': 'Z up', 'data-machine-control': 'jog' }, 'Z+'), h('button', { type: 'button', disabled: true, class: 'j', 'aria-label': 'Z down', 'data-machine-control': 'jog' }, 'Z−')),
      ),
      h('div', { class: 'seg full', role: 'group', 'aria-label': 'Step size' }, ['0.1', '1', '10', '50', 'Hold'].map((s) => h('button', { type: 'button', disabled: true, class: s === '1' ? 'selected' : undefined, key: s, 'data-machine-control': 'jog' }, s))),
    ),
    h('p', { class: 'unavailable', 'data-jog': 'note' }, 'Jogging arrives with motion control. These controls show what is coming and send nothing.'),
  );
}

/** The J6 output pins with what the board's settings say about each (board definition labels, never generic ones). */
function OutputPins({ settings, dialect }: { readonly settings: Readonly<Record<string, SettingValue>>; readonly dialect: string | null }): ComponentChild {
  const pins = connectorPins('J6').filter((p) => p.role === 'output');
  if (pins.length === 0) return null;
  const setting = (p: PinInfo): string => {
    if (p.signal === 'out.spindleEnable') return plainValue('spep', settings['spep'], dialect) ?? 'polarity not read';
    if (p.signal === 'out.spindleDirection') return plainValue('spdp', settings['spdp'], dialect) ?? 'polarity not read';
    if (p.signal === 'out.spindlePwm') return 'speed signal';
    return 'mist and flood share it';
  };
  return h(
    'ul',
    { class: 'pin-list', 'aria-label': 'Spindle and coolant pins on J6' },
    pins.map((p) =>
      h(
        'li',
        { key: p.ref, 'data-pin-row': p.ref },
        h('span', { class: 'pin-ref' }, p.ref),
        h('span', { class: 'pin-name' }, p.label, h('small', null, p.function)),
        h('span', { class: 'pin-set' }, setting(p)),
      ),
    ),
  );
}

/**
 * Spindle and coolant as the board reports them (edge-next `spe`, `spc`, `spd`, `sps`, `cof`, `com`): from its
 * status list when it carries them, otherwise from the read-only GETs Run asks about once a second. Display
 * only: the controls stay disabled, and nothing that pauses or stops reads these values.
 */
export function SpindleSection({ model }: { readonly model?: WorkspaceModel | null } = {}): ComponentChild {
  const view = model?.live.value ?? null;
  const snapshot = view !== null && connected(view) ? view.message?.snapshot : undefined;
  const r = displayReadouts(snapshot);
  const spindle = spindleText(r);
  const spindleLine = spindle.startsWith('On') ? `Spindle o${spindle.slice(1)}` : spindle;
  const coolant = coolantText(r);
  const settings = settingsOf(view);
  return h(
    'section',
    { class: 'insp sec-spindle', 'aria-labelledby': 'spindle-title' },
    h('header', null, h('h2', { id: 'spindle-title' }, 'Spindle and coolant'), h('span', { class: 'tag' }, 'Reported')),
    h(
      'div',
      { class: 'spindle-state' },
      h('span', { class: `spindle-mark${spindle.startsWith('On') ? ' on' : ''}`, 'aria-hidden': 'true' }, Icon('spindle', 26)),
      h(
        'div',
        { class: 'spindle-text' },
        h('strong', { 'data-spindle': 'spindle', title: SPINDLE_TITLE }, spindleLine),
        h('small', { 'data-spindle': 'coolant', title: COOLANT_TITLE }, `Coolant: ${coolant === UNKNOWN ? UNKNOWN : coolant === 'Off' ? 'off' : coolant}`),
      ),
    ),
    h(OutputPins, { settings, dialect: dialectOf(view) }),
    h(
      'div',
      { class: 'spindle-controls' },
      h('div', { class: 'seg full', role: 'group', 'aria-label': 'Spindle (J6.3 Spindle, J6.4 SpinDir)' }, ['Off', 'On · CW', 'On · CCW'].map((s) => h('button', { type: 'button', disabled: true, key: s, 'data-machine-control': 'spindle' }, s))),
      h('div', { class: 'inline-field' }, h('span', null, 'J6.6 Coolant'), h('span', { class: 'toggles' }, h('button', { type: 'button', class: 'toggle', disabled: true, 'aria-pressed': 'false', 'data-machine-control': 'coolant' }, 'Mist'), h('button', { type: 'button', class: 'toggle', disabled: true, 'aria-pressed': 'false', 'data-machine-control': 'coolant' }, 'Flood'))),
    ),
    h('p', { class: 'unavailable' }, 'Control arrives with motion control. Readouts are for display only: a command queued behind a move shows once it runs, and the speed is commanded, not measured. Never rely on them for safety.'),
  );
}

export function OverridesSection(): ComponentChild {
  const row = (label: string, id: string): ComponentChild =>
    h(
      'div',
      { class: 'ovr', key: id },
      h('div', { class: 'ovr-head' }, h('span', null, label), h('output', null, '100 %')),
      h('div', { class: 'ovr-row' }, h('button', { type: 'button', class: 'small step', disabled: true, 'aria-label': `${label} minus 10 percent`, 'data-machine-control': 'override' }, '−10'), h('input', { type: 'range', min: 10, max: 200, value: 100, disabled: true, 'aria-label': `${label} override`, 'data-machine-control': 'override' }), h('button', { type: 'button', class: 'small step', disabled: true, 'aria-label': `${label} plus 10 percent`, 'data-machine-control': 'override' }, '+10')),
    );
  return h(
    'section',
    { class: 'insp sec-overrides', 'aria-labelledby': 'ovr-title' },
    h('header', null, h('h2', { id: 'ovr-title' }, 'Overrides'), h('span', { class: 'tag mock' }, 'Needs firmware support')),
    row('Feed', 'feed'),
    row('Spindle speed', 'spindle'),
    h('p', { class: 'fine' }, 'TinyG edge-next has no feed or spindle overrides yet. These controls send nothing until the firmware supports them.'),
  );
}

type InspTab = 'jog' | 'spindle' | 'overrides';

/** The Run inspector: position always on top, the rest as tabs so nothing needs a long scroll. */
function RunInspector({ model, onView }: { readonly model: WorkspaceModel | null; readonly onView: (view: string) => void }): ComponentChild {
  const [tab, setTab] = useState<InspTab>('spindle');
  return h(
    'aside',
    { class: 'inspector run-inspector', 'aria-label': 'Machine' },
    h(ConnectNotice, { model, onView }),
    h(PositionPanel, { model }),
    h(
      'div',
      { class: 'insp-tabs' },
      h(TabBar<InspTab>, {
        label: 'Machine controls',
        prefix: 'insp',
        variant: 'underline',
        current: tab,
        onSelect: setTab,
        tabs: [
          { id: 'spindle', label: 'Spindle and coolant' },
          { id: 'jog', label: 'Jog' },
          { id: 'overrides', label: 'Overrides' },
        ],
      }),
    ),
    h(TabPane, { prefix: 'insp', id: 'spindle', current: tab, class: 'tpane insp-pane' }, h(SpindleSection, { model })),
    h(TabPane, { prefix: 'insp', id: 'jog', current: tab, class: 'tpane insp-pane' }, h(JogSection, null)),
    h(TabPane, { prefix: 'insp', id: 'overrides', current: tab, class: 'tpane insp-pane' }, h(OverridesSection, null)),
  );
}

// ---------------------------------------------------------------- job card

const fmtMm = (n: number): string => String(Math.round(n * 100) / 100);

/** The job's checks as a compact list: icon, short label, value. Details sit behind the expander. */
function jobChecks(result: PreviewResult, facts: ReturnType<typeof fileFacts>): ComponentChild[] {
  const s = result.summary;
  const b = s.bounds;
  const routine = routineChanges(result);
  const counts = shownCounts(result);
  const changes = counts.change;
  const rows: ComponentChild[] = [
    s.blocked
      ? h(CheckRow, { key: 'v', tone: 'danger', label: `Blocked: ${num(Math.max(1, s.counts.block))} ${s.counts.block === 1 ? 'finding stops' : 'findings stop'} this file`, attr: 'verdict' })
      : h(CheckRow, { key: 'v', tone: 'ok', label: 'No blocking findings', attr: 'verdict' }),
  ];
  if (s.counts.warn > 0) rows.push(h(CheckRow, { key: 'w', tone: 'warn', label: `${num(s.counts.warn)} ${s.counts.warn === 1 ? 'warning' : 'warnings'}`, attr: 'warn' }));
  if (changes > 0) rows.push(h(CheckRow, { key: 'c', tone: 'warn', label: `${num(changes)} ${changes === 1 ? 'change' : 'changes'}`, attr: 'change' }));
  if (routine.total > 0) {
    const parts = [routine.comments > 0 ? 'comments removed' : null, routine.renumbered > 0 ? 'line numbers' : null, routine.empty > 0 ? 'empty lines' : null].filter((x): x is string => x !== null);
    rows.push(h('li', { key: 'n', class: 'check-row tone-info', 'data-check': 'routine', title: `Run's routine clean-up, not listed line by line: ${parts.join(', ')}` }, h('span', { class: 'check-icon' }, Icon('lines', 15)), h('span', { class: 'check-label' }, 'Clean-up by Run'), h('strong', { class: 'check-value' }, `${num(routine.total)} lines`)));
  }
  rows.push(h(CheckRow, { key: 'e', tone: 'info', icon: 'ruler', label: 'Extent', value: b === null ? 'nothing drawn' : `${fmtMm(b.max[0] - b.min[0])} × ${fmtMm(b.max[1] - b.min[1])} × ${fmtMm(b.max[2] - b.min[2])} mm`, attr: 'extent' }));
  rows.push(h(CheckRow, { key: 'l', tone: 'info', icon: 'lines', label: 'Lines', value: num(result.sourceLines.length), attr: 'lines' }));
  const tools = facts.tools.length === 0 ? 'none named' : facts.tools.map((t) => `T${t}`).join(', ');
  rows.push(h(CheckRow, { key: 't', tone: 'info', icon: 'tools', label: 'Tools', value: facts.spindle.length === 0 ? tools : `${tools} · ${facts.spindle.map((x) => num(x)).join(', ')} rpm`, attr: 'tools' }));
  return rows;
}

function JobDetails({ result, facts }: { readonly result: PreviewResult; readonly facts: ReturnType<typeof fileFacts> }): ComponentChild {
  const s = result.summary;
  const b = s.bounds;
  return h(
    'div',
    { class: 'job-details' },
    facts.operations.length === 0
      ? null
      : h(
          'section',
          null,
          h('h3', null, 'Operations'),
          h('ol', { class: 'job-ops' }, facts.operations.slice(0, 8).map((op, i) => h('li', { key: String(op.line) }, h('span', { class: `op-swatch op-${i < 3 ? i + 1 : 4}`, 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'name' }, op.name, h('small', null, `from line ${num(op.line)}`))))),
        ),
    h(
      'section',
      null,
      h('h3', null, 'The check'),
      h(
        'dl',
        { class: 'job-facts', 'data-preview': 'summary-detail' },
        h('dt', null, 'Findings'),
        h('dd', null, `${num(s.counts.block)} block, ${num(s.counts.warn)} warn, ${num(s.counts.change)} change, ${num(s.counts.info)} info`),
        h('dt', null, 'Lines'),
        h('dd', null, `${num(result.fileLines)} in the file, ${num(result.sourceLines.length)} to send`),
        h('dt', null, 'Extent'),
        h('dd', null, b === null ? 'nothing drawn' : `X ${fmtMm(b.min[0])} to ${fmtMm(b.max[0])}, Y ${fmtMm(b.min[1])} to ${fmtMm(b.max[1])}, Z ${fmtMm(b.min[2])} to ${fmtMm(b.max[2])} mm`),
        h('dt', null, 'Distance'),
        h('dd', null, `${fmtMm(s.stats.feedMm)} mm cutting, ${fmtMm(s.stats.rapidMm)} mm traverse, ${num(s.stats.arcs)} arcs`),
        h('dt', null, 'Envelope'),
        h('dd', null, 'From the board’s travel settings, once a board is connected.'),
        h('dt', null, 'Start'),
        h('dd', null, 'Assumed machine at 0, 0, 0 in G54 with zero offsets, G21 G90 G17.'),
        h('dt', null, 'Time'),
        h('dd', null, 'Estimated with the job engine, later.'),
      ),
      fileLevel(s.fileLevel),
    ),
  );
}

/** The job: a card at the top of the Run view with the file, its checks, and the Check → Set zero → Start steps. */
function JobCard({ parts }: { readonly parts: PreviewParts }): ComponentChild {
  const { state, actions } = parts;
  const loading = state.status === 'loading';
  const disabled = !state.ready || loading;
  const result = state.status === 'ready' ? state.result : null;
  const facts = useMemo(() => (result === null ? null : fileFacts(result.bytes)), [result]);
  const title = state.fileName === null ? 'No file open' : state.fileName.replace(/\.[^.]+$/, '');
  const checked = result !== null && !result.summary.blocked;
  return h(
    'section',
    { class: `job-card${result === null ? ' empty' : ''}`, 'data-region': 'job', 'aria-labelledby': 'run-title' },
    h(
      'div',
      { class: 'job-id' },
      h('span', { class: 'job-icon', 'aria-hidden': 'true' }, Icon('file', 22)),
      h(
        'div',
        { class: 'job-name' },
        h('h1', { id: 'run-title' }, title),
        h(
          'p',
          null,
          h('span', { class: state.fileName === null ? 'sr-only' : 'mono', 'data-preview': 'file-name' }, state.fileName ?? 'none'),
          state.fileName === null ? (loading ? 'Checking the file…' : 'Open a G-code file or a sample to check it.') : result === null ? (loading ? ' · checking…' : '') : ` · ${num(result.fileLines)} lines`,
        ),
      ),
    ),
    result === null || facts === null ? h('div', { class: 'job-checks-empty' }) : h('ul', { class: 'job-checks', 'data-preview': 'summary', 'aria-label': 'The file check' }, jobChecks(result, facts)),
    h(
      'div',
      { class: 'job-actions' },
      h('ol', { class: 'flow', 'aria-label': 'Before you start' }, h('li', { class: checked ? 'done' : undefined }, h('span', null, checked ? '✓' : '1'), 'Check'), h('li', null, h('span', null, '2'), 'Set zero'), h('li', null, h('span', null, '3'), 'Start')),
      h('button', { type: 'button', class: 'primary', disabled: true, 'data-action': 'start-job', 'data-machine-control': 'start', 'aria-describedby': 'start-later', title: 'Running jobs arrives in a later phase' }, 'Start job'),
      h(
        'label',
        { class: `file-button${disabled ? ' is-disabled' : ''}` },
        h('input', {
          type: 'file',
          accept: '.nc,.gcode,.ngc,.tap,.txt,.cnc,text/plain',
          disabled,
          'data-preview': 'file',
          ...on('onChange', actions.onFile, (f) => (e: Event) => {
            const file = (e.currentTarget as HTMLInputElement).files?.[0];
            if (file !== undefined) f(file);
          }),
        }),
        Icon('upload', 15),
        result === null ? 'Open a file' : 'Open another',
      ),
    ),
    result === null || facts === null
      ? h('p', { class: 'sr-only', id: 'start-later' }, 'Running jobs arrives in a later phase.')
      : h(
          'details',
          { class: 'job-more' },
          h('summary', null, 'Details'),
          h('div', { class: 'job-pop' }, h(JobDetails, { result, facts }), h('p', { class: 'fine', id: 'start-later' }, 'Running jobs arrives in a later phase. Today you can check the file, the setup and the tools.')),
        ),
  );
}

/** Traverses (G0) on or off: a toolbar toggle, remembered in this browser. */
function TraverseToggle({ parts }: { readonly parts: PreviewParts }): ComponentChild {
  const { state, actions } = parts;
  const onRapids = actions.onRapids;
  useEffect(() => {
    const stored = readStored('preview-traverses', (v: unknown): v is boolean => typeof v === 'boolean');
    if (stored !== null && stored !== state.showRapids) onRapids?.(stored);
    // Once, when the actions arrive.
  }, [onRapids === undefined]);
  return h(
    'button',
    {
      type: 'button',
      class: 'tool-toggle',
      'aria-pressed': state.showRapids ? 'true' : 'false',
      disabled: !state.ready,
      'data-preview': 'rapids',
      title: state.showRapids ? 'Hide traverses (G0 moves)' : 'Show traverses (G0 moves)',
      ...on('onClick', onRapids, (f) => () => {
        const next = !state.showRapids;
        writeStored('preview-traverses', next);
        f(next);
      }),
    },
    h('span', { class: 'toggle-dash', 'aria-hidden': 'true' }),
    'Traverses',
  );
}

// ---------------------------------------------------------------- dock

function hexText(hex: string): string {
  let s = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = Number.parseInt(hex.slice(i, i + 2), 16);
    s += c === 10 ? '' : c === 13 ? '' : c < 32 || c === 127 ? `\\x${hex.slice(i, i + 2)}` : String.fromCharCode(c);
  }
  return s;
}

interface ConsoleLine {
  readonly t: number;
  readonly dir: string;
  readonly text: string;
}

/** The Console tab: the worker's wire transcript of this link, read-only, refreshed while the tab is open. */
function ConsolePane({ model, active }: { readonly model: WorkspaceModel | null; readonly active: boolean }): ComponentChild {
  const view = model?.live.value ?? null;
  const epoch = view?.message?.snapshot.epoch ?? 0;
  const [lines, setLines] = useState<readonly ConsoleLine[] | null>(null);
  useEffect(() => {
    if (!active || model === null || epoch === 0) return;
    let stop = false;
    const pull = async (): Promise<void> => {
      const jsonl = await model.actions.value?.transcriptText();
      if (stop || jsonl === null || jsonl === undefined) return;
      const rows = jsonl.trim() === '' ? [] : jsonl.trim().split('\n');
      const parsed: ConsoleLine[] = [];
      for (const row of rows.slice(-400)) {
        try {
          const e = JSON.parse(row) as { t?: unknown; dir?: unknown; hex?: unknown };
          if (typeof e.t === 'number' && typeof e.dir === 'string' && typeof e.hex === 'string') parsed.push({ t: e.t, dir: e.dir, text: hexText(e.hex) });
        } catch {
          // A damaged row is skipped.
        }
      }
      setLines(parsed);
    };
    void pull();
    const timer = setInterval(() => void pull(), 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [active, model, epoch]);
  const t0 = lines?.[0]?.t ?? 0;
  return h(
    'div',
    { class: 'console-pane' },
    epoch === 0 || lines === null
      ? h('p', { class: 'live-empty' }, h('strong', null, 'The console shows the conversation with the board.'), 'Every line Run sends and every answer, once a board is connected in this tab. It only reads.')
      : h('ol', { class: 'console', 'data-console': 'lines', 'aria-label': 'Wire transcript' }, lines.map((l, i) => h('li', { key: String(i), class: l.dir === 'tx' ? 'tx' : 'rx' }, h('time', null, `${((l.t - t0) / 1000).toFixed(2)}`), h('span', { class: 'dir' }, l.dir === 'tx' ? '→' : '←'), h('span', null, l.text)))),
    view === null || view.message === null || view.message.snapshot.epoch === 0 ? null : h(TranscriptSave, { status: view.transcript, onSave: () => model?.actions.value?.saveTranscript() }),
  );
}

const STAT_TEXT: Readonly<Record<string, string>> = {
  initializing: 'Starting up',
  idle: 'Idle',
  programStop: 'Program stopped',
  end: 'Program ended',
  running: 'Running',
  held: 'Held',
  probing: 'Probing',
  homing: 'Homing',
  jogging: 'Jogging',
  softAlarm: 'Soft alarm',
  alarm: 'Alarm',
  shutdown: 'Shutdown',
  panic: 'Panic',
  interlock: 'Interlock',
  unknown: 'Unknown',
};

/** The Live job tab: what the status reports say now, and the feed of the last 60 s. Honest when nothing runs. */
function LivePane({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  if (view === null || !connected(view) || view.message === null) {
    return h('div', { class: 'live-empty', 'data-live': 'empty' }, h('strong', null, 'Live job data appears here while a board is connected.'), h('p', null, 'The machine state, the current line, actual against programmed feed and the planner buffers, all from the controller’s status reports. Running jobs arrives in a later phase.'));
  }
  const s = view.message.snapshot;
  const live = s.live;
  const dialect = DIALECTS.find((d) => d.id === s.classification?.dialectId);
  const blocks = dialect?.limits.plannerBlocks ?? null;
  const samples = view.samples;
  const maxFeed = Math.max(1, ...samples.map((x) => Math.max(x.feed ?? 0, x.vel ?? 0)));
  const tEnd = view.now;
  const pts = samples.filter((x) => x.vel !== null).map((x) => `${(300 - ((tEnd - x.t) / 60_000) * 300).toFixed(1)},${(68 - ((x.vel as number) / maxFeed) * 64).toFixed(1)}`);
  const feedPts = samples.filter((x) => x.feed !== null).map((x) => `${(300 - ((tEnd - x.t) / 60_000) * 300).toFixed(1)},${(68 - ((x.feed as number) / maxFeed) * 64).toFixed(1)}`);
  const qr = typeof live.qr === 'number' ? live.qr : null;
  return h(
    'div',
    { class: 'live-grid', 'data-live': 'connected' },
    h(
      'div',
      { class: 'live-progress' },
      h('span', { class: 'live-big', 'data-live': 'stat' }, live.machineClass === undefined ? UNKNOWN : (STAT_TEXT[live.machineClass] ?? live.machineClass)),
      h('span', { class: 'live-sub', 'data-live': 'line' }, typeof live.line === 'number' ? `Line ${num(live.line)} reported` : 'No line reported'),
      h('p', { class: 'fine' }, 'No job is running from this page. Progress, elapsed and remaining time appear with jobs in a later phase.'),
    ),
    h(
      'div',
      { class: 'live-feed' },
      h('div', { class: 'live-head' }, h('span', null, 'Feed: actual and programmed'), h('strong', { 'data-live': 'feed' }, `${live.vel === undefined ? UNKNOWN : num(live.vel)} / ${live.feed === undefined ? UNKNOWN : num(live.feed)}`)),
      h(
        'svg',
        { class: 'feed-chart', viewBox: '0 0 300 70', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Actual velocity over the last 60 seconds against programmed feed' },
        feedPts.length > 1 ? h('polyline', { class: 'prog', points: feedPts.join(' ') }) : null,
        pts.length > 1 ? h('polyline', { class: 'act', points: pts.join(' ') }) : null,
      ),
      h('div', { class: 'live-head' }, h('span', null, 'Planner buffers free'), h('strong', { 'data-live': 'qr' }, qr === null ? UNKNOWN : blocks === null ? String(qr) : `${qr} of ${blocks}`)),
      blocks === null || qr === null ? null : h('div', { class: 'qr-meter', 'aria-hidden': 'true' }, Array.from({ length: blocks }, (_, i) => h('i', { key: String(i), class: i < blocks - qr ? 'used' : undefined }))),
    ),
    h(
      'ol',
      { class: 'live-stream', 'aria-live': 'polite' },
      h('li', null, h('time', null, 'now'), h('span', null, s.overlays.includes('READ_ONLY') ? 'Read only: Run watches the status reports and writes nothing.' : 'Watching the status reports.')),
      typeof live.qr === 'number' && blocks !== null && live.qr === blocks ? h('li', null, h('time', null, 'now'), h('span', null, 'The planner queue is empty.')) : null,
    ),
  );
}

function Dock({ parts, model }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null }): ComponentChild {
  const [tab, setTab] = useState<'gcode' | 'console' | 'live'>('gcode');
  const result = parts.state.status === 'ready' ? parts.state.result : null;
  const live = model?.live.value ?? null;
  const tabs: readonly ['gcode' | 'console' | 'live', string][] = [
    ['gcode', 'G-code'],
    ['console', 'Console'],
    ['live', 'Live job'],
  ];
  return h(
    'div',
    { class: 'dock' },
    h(
      'div',
      { class: 'dock-tabs', role: 'tablist', 'aria-label': 'File and machine' },
      tabs.map(([id, label]) =>
        h(
          'button',
          { type: 'button', role: 'tab', id: `dock-tab-${id}`, 'aria-selected': tab === id ? 'true' : 'false', 'aria-controls': `dock-pane-${id}`, 'data-tab': id, key: id, onClick: () => setTab(id) },
          label,
          id === 'live' ? h('span', { class: `live-dot${live !== null && connected(live) ? ' on' : ''}`, 'aria-hidden': 'true' }) : null,
        ),
      ),
      h('span', { class: 'dock-summary' }, result === null ? 'No file open' : `${num(result.fileLines)} lines · ${num(result.sourceLines.length)} to send`),
    ),
    h(
      'div',
      { tabindex: 0, class: 'dock-panel' },
      h('div', { tabindex: 0, class: 'dock-pane', role: 'tabpanel', id: 'dock-pane-gcode', 'aria-labelledby': 'dock-tab-gcode', hidden: tab !== 'gcode' }, parts.slots.list ?? h('p', { class: 'live-empty' }, 'Open a file to see its lines here, each with its safety verdict.')),
      h('div', { tabindex: 0, class: 'dock-pane', role: 'tabpanel', id: 'dock-pane-console', 'aria-labelledby': 'dock-tab-console', hidden: tab !== 'console' }, h(ConsolePane, { model, active: tab === 'console' })),
      h('div', { tabindex: 0, class: 'dock-pane live', role: 'tabpanel', id: 'dock-pane-live', 'aria-labelledby': 'dock-tab-live', hidden: tab !== 'live' }, h(LivePane, { model })),
    ),
  );
}

// ---------------------------------------------------------------- layout

function runLayout(parts: PreviewParts, model: WorkspaceModel | null, onView: (view: string) => void): ComponentChild {
  const { state, actions, slots, live } = parts;
  const loading = state.status === 'loading';
  const disabled = !state.ready || loading;
  const result = state.status === 'ready' ? state.result : null;
  const sent = result?.sourceLines.length ?? 0;
  const scrubLine = state.scrub > 0 && result !== null ? (result.sourceLines[state.scrub - 1] ?? 0) : 0;
  return h(
    'div',
    { class: 'run-view', 'data-region': 'preview' },
    h(JobCard, { parts }),
    h(
      'div',
      { class: 'workspace-grid run-grid' },
      h(
        'div',
        { class: 'canvas-column' },
        h(
          'div',
          { class: 'viewer', ...(result === null ? {} : { 'data-lite': result.lite ? 'true' : 'false' }) },
          result !== null && !result.lite ? h('div', { class: 'preview-drawing', 'data-preview': 'drawing', 'data-drawing': state.drawing }, slots.drawing ?? null) : null,
          h(
            'div',
            { class: 'viewer-top' },
            h(
              'div',
              { class: 'seg viewer-options', role: 'group', 'aria-label': 'Preview options' },
              h(
                'span',
                { class: 'select-wrap compact' },
                h(
                  'select',
                  { 'aria-label': 'Dialect', value: state.dialect, disabled, ...on('onChange', actions.onDialect, (f) => (e: Event) => { f((e.currentTarget as HTMLSelectElement).value as DialectId); }) },
                  PREVIEW_DIALECTS.map((d) => h('option', { value: d, key: d }, DIALECT_LABEL[d] ?? d)),
                ),
              ),
              h(
                'span',
                { class: 'select-wrap compact' },
                h(
                  'select',
                  { 'aria-label': 'Preview mode', value: state.mode, disabled, 'data-preview': 'mode', ...on('onChange', actions.onMode, (f) => (e: Event) => { f((e.currentTarget as HTMLSelectElement).value as PreviewMode); }) },
                  (['auto', 'lite', 'full'] as const).map((m) => h('option', { value: m, key: m }, MODE_LABEL[m])),
                ),
              ),
            ),
            h(
              'div',
              { class: 'viewer-tools', role: 'group', 'aria-label': 'View' },
              h(TraverseToggle, { parts }),
              result !== null && !result.lite && state.drawing === 'webgl' ? h('button', { type: 'button', class: 'tool-toggle', 'data-preview': 'fit', ...on('onClick', actions.onFit, (f) => () => { f(); }) }, 'Fit') : null,
            ),
          ),
          result === null && !loading
            ? h(
                'div',
                { class: 'empty-prompt' },
                h('h2', null, state.status === 'error' ? 'The file could not be checked' : 'Open a file to check and preview it'),
                state.status === 'error'
                  ? h('p', { class: 'preview-error', role: 'alert', 'data-preview': 'error' }, state.error ?? 'The preview failed.')
                  : h('p', null, 'Every line is checked by the safety sanitiser and drawn in 3D. The file stays in this browser.'),
                h('div', { class: 'sample-row' }, SAMPLES.map((s) => h('button', { type: 'button', class: 'small', key: s.id, disabled, 'data-sample': s.id, ...on('onClick', actions.onFile, (f) => () => { f(sampleFile(s)); }) }, `Open the ${s.title.toLowerCase()} sample`))),
              )
            : null,
          loading
            ? h(
                'div',
                { class: 'empty-prompt preview-progress', role: 'status', 'data-preview': 'progress' },
                h('h2', null, progressText(state.progress)),
                h('button', { type: 'button', class: 'small', 'data-preview': 'cancel', ...on('onClick', actions.onCancel, (f) => () => { f(); }) }, 'Cancel'),
              )
            : null,
          result !== null && result.lite
            ? h(
                'p',
                { class: 'empty-prompt preview-lite', 'data-preview': 'lite' },
                result.liteBySize
                  ? `Lite mode: this file has more than ${LITE_THRESHOLD_LINES.toLocaleString('en-US')} lines, so it is not drawn. Choose Full to draw it anyway.`
                  : 'Lite mode: the list and summary only, no drawing.',
              )
            : null,
          live === null ? null : h('p', { class: `viewer-key pv-marker-readout lag-${live.lag}`, 'data-preview': 'marker-readout', role: 'status' }, markerText(live)),
          h('p', { class: 'viewer-notice', role: 'note', 'data-safety': 'W13' }, w13()),
        ),
        h(
          'div',
          { class: 'timeline', 'aria-label': 'Line scrubber' },
          h(
            'div',
            { class: 'track-wrap' },
            h('label', { class: 'sr-only', for: 'preview-scrub' }, 'Highlight lines up to'),
            h('input', {
              id: 'preview-scrub',
              type: 'range',
              min: 0,
              max: sent,
              step: 1,
              value: state.scrub,
              disabled: result === null,
              'data-preview': 'scrubber',
              'aria-valuetext': state.scrub === 0 ? 'no lines highlighted' : `highlighting up to file line ${String(scrubLine)}`,
              ...on('onInput', actions.onScrub, (f) => (e: Event) => { f(Number((e.currentTarget as HTMLInputElement).value)); }),
            }),
          ),
          h('output', { class: 'time', for: 'preview-scrub', 'data-preview': 'scrub-line' }, state.scrub === 0 ? 'none' : `file line ${String(scrubLine)}`),
        ),
        h(Dock, { parts, model }),
      ),
      h(RunInspector, { model, onView }),
    ),
  );
}
