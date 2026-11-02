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
import { DIALECT_LABEL, MODE_LABEL, fileLevel, on, progressText, summary } from '../../preview/PreviewView.ts';
import { ConnectPanel } from '../../live/ConnectPanel.ts';
import { Icon } from '../icons.ts';
import { connected, type LiveView, type WorkspaceModel } from '../model.ts';
import { fileFacts, sampleFile, SAMPLES } from '../samples.ts';
import { coord, num, UNKNOWN } from '../status.ts';

export interface RunViewProps {
  readonly model: WorkspaceModel | null;
  readonly spawn: (() => WorkerLike) | null;
  readonly marker?: ReadonlySignal<LiveMarkerView | null>;
  readonly onView: (view: string) => void;
}

export function RunView({ model, spawn, marker, onView }: RunViewProps): ComponentChild {
  return h(PreviewPanel, { spawn, ...(marker === undefined ? {} : { marker }), layout: (parts: PreviewParts) => runLayout(parts, model, onView) });
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
      h('span', { class: `source lag-${age.lag}`, 'data-position': 'freshness', title: 'Machine position is polled from the controller; work position comes from its status reports.' }, age.text),
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

function JogSection(): ComponentChild {
  const pad = ['X−, Y+', 'Y+', 'X+, Y+', 'X−', 'Go to X0 Y0', 'X+', 'X−, Y−', 'Y−', 'X+, Y−'];
  const labels = ['↖', 'Y+', '↗', 'X−', '⌖', 'X+', '↙', 'Y−', '↘'];
  return h(
    'section',
    { class: 'insp sec-jog', 'aria-labelledby': 'jog-title' },
    h('header', null, h('h2', { id: 'jog-title' }, 'Jog'), h('span', { class: 'tag' }, 'Motion control')),
    h('p', { class: 'unavailable', 'data-jog': 'note' }, 'Jogging arrives with motion control. These controls show what is coming and send nothing.'),
    h(
      'div',
      { class: 'jog', 'aria-disabled': 'true' },
      h(
        'div',
        { class: 'jog-pads' },
        h('div', { class: 'jog-pad', role: 'group', 'aria-label': 'X and Y' }, pad.map((label, i) => h('button', { type: 'button', disabled: true, class: `j${i % 2 === 0 && i !== 4 ? ' diag' : ''}`, 'aria-label': label, key: label }, labels[i]))),
        h('div', { class: 'jog-z', role: 'group', 'aria-label': 'Z' }, h('button', { type: 'button', disabled: true, class: 'j', 'aria-label': 'Z up' }, 'Z+'), h('button', { type: 'button', disabled: true, class: 'j', 'aria-label': 'Z down' }, 'Z−')),
      ),
      h('div', { class: 'seg full', role: 'group', 'aria-label': 'Step size' }, ['0.1', '1', '10', '50', 'Hold'].map((s) => h('button', { type: 'button', disabled: true, class: s === '1' ? 'selected' : undefined, key: s }, s))),
    ),
  );
}

function SpindleSection(): ComponentChild {
  return h(
    'section',
    { class: 'insp sec-spindle', 'aria-labelledby': 'spindle-title' },
    h('header', null, h('h2', { id: 'spindle-title' }, 'Spindle and coolant'), h('span', { class: 'tag' }, 'Commanded')),
    h(
      'div',
      { class: 'spindle-state' },
      h('svg', { class: 'spindle-dial', viewBox: '0 0 64 64', 'aria-hidden': 'true' }, h('circle', { cx: 32, cy: 32, r: 26, class: 'dial-track' })),
      h('div', { class: 'spindle-text' }, h('strong', null, UNKNOWN, h('small', null, ' rpm commanded')), h('span', null, 'No command sent from this page'), h('small', null, 'Coolant: no command sent')),
    ),
    h(
      'div',
      { class: 'spindle-controls' },
      h('div', { class: 'seg full', role: 'group', 'aria-label': 'Spindle' }, ['Off', 'On · CW', 'On · CCW'].map((s) => h('button', { type: 'button', disabled: true, key: s }, s))),
      h('div', { class: 'inline-field' }, h('span', null, 'Coolant'), h('span', { class: 'toggles' }, h('button', { type: 'button', class: 'toggle', disabled: true, 'aria-pressed': 'false' }, 'Mist'), h('button', { type: 'button', class: 'toggle', disabled: true, 'aria-pressed': 'false' }, 'Flood'))),
    ),
    h('p', { class: 'unavailable' }, 'Spindle and coolant control arrive with motion control. TinyG has no spindle speed sensor and does not report coolant: Run shows the last command it sent, never an actual speed.'),
  );
}

function OverridesSection(): ComponentChild {
  const row = (label: string, id: string): ComponentChild =>
    h(
      'div',
      { class: 'ovr', key: id },
      h('div', { class: 'ovr-head' }, h('span', null, label), h('output', null, '100 %')),
      h('div', { class: 'ovr-row' }, h('button', { type: 'button', class: 'small step', disabled: true, 'aria-label': `${label} minus 10 percent` }, '−10'), h('input', { type: 'range', min: 10, max: 200, value: 100, disabled: true, 'aria-label': `${label} override` }), h('button', { type: 'button', class: 'small step', disabled: true, 'aria-label': `${label} plus 10 percent` }, '+10')),
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

// ---------------------------------------------------------------- job card

function JobCard({ parts }: { readonly parts: PreviewParts }): ComponentChild {
  const { state } = parts;
  const result = state.status === 'ready' ? state.result : null;
  const facts = useMemo(() => (result === null ? null : fileFacts(result.bytes)), [result]);
  return h(
    'section',
    { class: 'insp sec-job', 'data-region': 'job', 'aria-labelledby': 'job-title' },
    h('header', null, h('h2', { id: 'job-title' }, 'Job'), h('span', { class: `tag${result?.summary.blocked === true ? ' danger' : result !== null ? ' ok' : ''}` }, result === null ? 'No file' : result.summary.blocked ? 'Blocked' : 'Checked')),
    result === null
      ? h('div', { class: 'job-none' }, h('p', null, state.status === 'loading' ? 'Checking the file…' : 'No file open. Open a G-code file or a sample and it appears here with its tools and the safety check.'))
      : h(
          'div',
          { class: 'job-body' },
          h('div', { class: 'job-file' }, Icon('file', 26), h('div', null, h('strong', null, state.fileName ?? ''), h('small', null, `${num(result.fileLines)} lines · ${facts?.toolChanges.length ?? 0} tool changes`))),
          facts === null || facts.operations.length === 0
            ? null
            : h('ol', { class: 'job-ops' }, facts.operations.slice(0, 8).map((op, i) => h('li', { key: String(op.line), title: `Operation ${i + 1}: ${op.name}` }, h('span', { class: `op-swatch op-${i < 3 ? i + 1 : 4}`, 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')), h('span', { class: 'name' }, op.name, h('small', null, `Operation ${i + 1} · from line ${num(op.line)}`))))),
          h(
            'dl',
            { class: 'facts' },
            h('div', null, h('dt', null, 'Tools in the file'), h('dd', null, facts === null || facts.tools.length === 0 ? 'None named' : facts.tools.map((t) => `T${t}`).join(', '))),
            h('div', null, h('dt', null, 'Spindle speeds'), h('dd', null, facts === null || facts.spindle.length === 0 ? 'None' : `${facts.spindle.map((s) => num(s)).join(', ')} rpm`)),
            h('div', null, h('dt', null, 'Estimated time'), h('dd', null, 'Arrives with the job engine')),
          ),
          h('h3', { class: 'job-sub' }, 'Analysis'),
          summary(result),
          fileLevel(result.summary.fileLevel),
        ),
    h(
      'div',
      { class: 'job-start' },
      h('ol', { class: 'flow', 'aria-label': 'Before you start' }, h('li', { class: result !== null && !result.summary.blocked ? 'done' : undefined }, h('span', null, '1'), 'Check'), h('li', null, h('span', null, '2'), 'Set zero'), h('li', null, h('span', null, '3'), 'Start')),
      h('button', { type: 'button', class: 'primary wide', disabled: true, 'data-action': 'start-job', 'aria-describedby': 'start-later' }, 'Start job'),
      h('p', { class: 'fine', id: 'start-later' }, 'Running jobs arrives in a later phase. Today you can check the file, the setup and the tools.'),
    ),
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
  const title = state.fileName === null ? 'Run' : state.fileName.replace(/\.[^.]+$/, '');
  return h(
    'div',
    { class: 'run-view', 'data-region': 'preview' },
    h(
      'div',
      { class: 'view-head' },
      h(
        'div',
        { class: 'title-block' },
        h('h1', { id: 'run-title' }, title),
        h('p', null, h('span', { class: 'file-label' }, 'File'), h('span', { class: 'mono', 'data-preview': 'file-name' }, state.fileName ?? 'none'), result === null ? null : h('span', null, ` · ${num(result.fileLines)} lines`)),
      ),
      h(
        'div',
        { class: 'view-actions' },
        h(
          'label',
          { class: `file-button secondary-action${disabled ? ' is-disabled' : ''}` },
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
          result === null ? 'Open a file' : 'Open another file',
        ),
      ),
    ),
    h(ConnectNotice, { model, onView }),
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
              h('label', { class: 'seg-check' }, h('input', { type: 'checkbox', checked: state.showRapids, disabled: !state.ready, 'data-preview': 'rapids', ...on('onChange', actions.onRapids, (f) => (e: Event) => { f((e.currentTarget as HTMLInputElement).checked); }) }), ' Rapids'),
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
            result !== null && !result.lite && state.drawing === 'webgl'
              ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Camera' }, h('button', { type: 'button', 'data-preview': 'fit', ...on('onClick', actions.onFit, (f) => () => { f(); }) }, 'Fit'))
              : null,
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
      h('aside', { tabindex: 0, class: 'inspector', 'aria-label': 'Machine and job' }, h(PositionPanel, { model }), h(JobCard, { parts }), h(JogSection, null), h(SpindleSection, null), h(OverridesSection, null)),
    ),
  );
}
