import { c25, c25HandSet } from '@synthetos/safety';
import { h, type ComponentChild } from 'preact';
import type { MotionAxis, MotionCommand, SnapshotMessage } from '../../../machine-worker/rpc.ts';
import { settingsOf } from '../../boardFacts.ts';
import type { ControlBlock } from '../../controlBlock.ts';
import { ControlBlockCard, currentBlock } from '../../ControlBlockCard.ts';
import { type IconName } from '../../icons.ts';
import { uiLevel } from '../../jobWorkflow.ts';
import { connected, type LiveView, type WorkspaceModel } from '../../model.ts';
import { axesText, goToZeroPath, machineAxes, machineZ, motionUi, offsetsView, type MotionUi } from '../../motion.ts';
import { PositionStatus } from '../../positionStatus.ts';
import { ProbeZ } from '../../probe/ProbeZ.ts';
import { ageText } from '../../reportAge.ts';
import { goToZeroSafeZ } from '../../safeZ.ts';
import { coord } from '../../status.ts';
import { atToolChange, TC_GO_REASON, zeroBlocked } from '../../toolChangeControls.ts';
import { ConfirmCard, IconButton } from '../../ui.ts';
import { UnknownChip } from '../../unknownModal.ts';
import { WorkZeroConfirm } from '../../workZeroConfirm.ts';
import { isLive, LIVE_HOOKS, STATIC_HOOKS, type Hooks } from './motionHooks.ts';

/**
 * The Position readout with the hobbyist's two actions on each axis row (OD-13): Zero here (G10 L20 in the active
 * system, C16) and Go to zero (Z rises first, C25), plus Zero all and Go to zero for X, Y and Z in the same column,
 * on the status line's row. Only the machine's axes are shown. While a block holds (controlBlock.ts: read only,
 * UNKNOWN, alarm, another tab, ...) one card at the top says why and offers the way out, and the actions are not
 * drawn at all (owner, 2026-11-09); a passing gate (a move or a job running) leaves them in place, disabled.
 */
function positionBody({ model }: PositionProps, hk: Hooks): ComponentChild {
  const { m, view, axes, ui, settings, send, enabled } = positionMachine({ model });
  const { row, age, units, wcs, homed, tool }: { row: (a: MotionAxis) => { readonly work: number | null; readonly machine: number | null; readonly homed: boolean | null; }; age: { readonly text: string; readonly lag: string; }; units: string | null; wcs: DroWcs | null; homed: boolean | null; tool: number | undefined; } = positionReadouts({ m, view, axes, ui });
  const system = offsetsView(view).system ?? 'G54';
  const zNow = machineZ(view);
  const ztm = typeof settings['ztm'] === 'number' ? (settings['ztm'] as number) : null;
  // OD-23: lift to ztm − 1 only after a homing seen in this connection (safeZ.ts).
  const { safe, handSet } = goToZeroSafeZ({ homed: ui.homed, zHomedHere: (m?.snapshot.notices.homedAxes ?? []).includes('z'), ztm, zNow });
  type Confirm = { readonly kind: 'set' | 'go'; readonly axes: readonly MotionAxis[] } | null;
  const [confirm, setConfirm] = hk.state<Confirm>(null);
  const [note, setNote] = hk.state<string | null>(null);
  const run = (command: MotionCommand): void => {
    setConfirm(null);
    setNote(null);
    void send?.(command).then(setNote);
  };
  // H74 (2026-11-08): at a tool change only the Z re-zero (toolChangeControls.ts).
  const snap = m?.snapshot ?? null;
  const act = (icon: IconName, label: string, onClick: () => void, blocked: string | null = null): ComponentChild =>
    h(IconButton, { icon, label, why: blocked ?? ui.reason ?? null, attrs: { 'data-machine-control': 'zero' }, ...(enabled && blocked === null ? { onClick } : { disabled: true }) });
  const card =
    confirm === null || !enabled
      ? null
      : positionConfirmation({ confirm, system, row, setConfirm, run, safe, zNow, handSet });
  const xyz: readonly MotionAxis[] = ['x', 'y', 'z'];
  const block = currentBlock(model);
  const actions = block === null;
  const advanced = uiLevel.value.value === 'advanced';
  return positionSection({ m, age, block, model, actions, advanced, units, axes, row, act, setConfirm, snap, wcs, homed, tool, view, xyz, card, note });
}

type PositionProps = { readonly model?: WorkspaceModel | null };

function positionSection({ m, age, block, model, actions, advanced, units, axes, row, act, setConfirm, snap, wcs, homed, tool, view, xyz, card, note }: { readonly m: SnapshotMessage | null; readonly age: { readonly text: string; readonly lag: string; }; readonly block: ControlBlock | null; readonly model: WorkspaceModel | null | undefined; readonly actions: boolean; readonly advanced: boolean; readonly units: string | null; readonly axes: readonly ("a" | "x" | "y" | "z")[]; readonly row: (a: MotionAxis) => { readonly work: number | null; readonly machine: number | null; readonly homed: boolean | null; }; readonly act: (icon: IconName, label: string, onClick: () => void, blocked?: string | null) => ComponentChild; readonly setConfirm: (v: { readonly kind: "set" | "go"; readonly axes: readonly MotionAxis[]; } | null) => void; readonly snap: SessionSnapshot | null; readonly wcs: DroWcs | null; readonly homed: boolean | null; readonly tool: number | undefined; readonly view: LiveView | null; readonly xyz: readonly ("a" | "x" | "y" | "z")[]; readonly card: ComponentChild | ComponentChild | null; readonly note: string | null }): ComponentChild {
  return h(
    'section',
    { class: 'insp sec-position', 'data-region': 'position', 'aria-labelledby': 'position-title' },
    h(
      'header',
      null,
      h('h2', { id: 'position-title' }, 'Position'),
      h(
        'span',
        { class: 'pos-head-right' },
        m === null ? null : h('span', { class: `source lag-${age.lag}`, 'data-position': 'freshness', title: `${age.text}. The age is the time since the controller last said anything.` }, age.lag === 'none' ? age.text : age.text.slice(age.text.indexOf('·') + 2))
      )
    ),
    // UNKNOWN's exits also under another card: "I've checked the machine" clears it without motion (T-S105).
    block === null || block.kind === 'unknown' ? null : h(ControlBlockCard, { block, model: model ?? null }),
    // UNKNOWN is one question on connect (unknownModal.ts); the panel keeps a small way back to it.
    block === null ? null : h(UnknownChip, { model: model ?? null }),
    positionGrid({ actions, advanced, units, axes, row, act, setConfirm, snap, m, wcs, homed, tool, view, xyz }),
    actions ? h(ProbeZ, { model: model ?? null }) : null,
    card,
    note === null ? null : h('p', { class: 'motion-note', role: 'status', 'data-position': 'note' }, note)
  );
}

function positionReadouts({ m, view, axes, ui }: { readonly m: SnapshotMessage | null; readonly view: LiveView | null; readonly axes: readonly ("x" | "y" | "z" | "a")[]; readonly ui: MotionUi }) {
  const dro = m?.dro.axes ?? [];
  const row = (a: MotionAxis): { readonly work: number | null; readonly machine: number | null; readonly homed: boolean | null; } => dro.find((d) => d.axis === a) ?? { work: null, machine: null, homed: null };
  const age = view === null ? { text: 'Not connected', lag: 'none' } : ageText(view);
  const wcs = m?.dro.wcs ?? null;
  // `home` as read at connect (the jog gate's view of it), else what the per-axis reports say.
  const homedRows = axes.map(row).filter((d) => d.homed !== null);
  const homed: boolean | null = ui.homed ?? (homedRows.length === 0 ? null : homedRows.every((d) => d.homed === true));
  const tool = m?.snapshot.live.tool;
  const units = m?.dro.units ?? null;
  return { row, age, units, wcs, homed, tool };
}

function positionMachine({ model }: { readonly model: WorkspaceModel | null | undefined }) {
  const view = model?.live.value ?? null;
  const m = view !== null && connected(view) ? view.message : null;
  const ui = motionUi(view);
  const send = model?.actions.value?.motion;
  const enabled = ui.enabled && send !== undefined;
  const settings = settingsOf(view);
  const axes = machineAxes(settings);
  return { m, view, axes, ui, settings, send, enabled };
}

function positionConfirmation({ confirm, system, row, setConfirm, run, safe, zNow, handSet }: { readonly confirm: { readonly kind: "set" | "go"; readonly axes: readonly MotionAxis[]; }; readonly system: string; readonly row: (a: MotionAxis) => { readonly work: number | null; readonly machine: number | null; readonly homed: boolean | null; }; readonly setConfirm: (v: { readonly kind: "set" | "go"; readonly axes: readonly MotionAxis[]; } | null) => void; readonly run: (command: MotionCommand) => void; readonly safe: number; readonly zNow: number | null; readonly handSet: boolean }) {
  return confirm.kind === 'set'
    ? h(WorkZeroConfirm, { axes: confirm.axes, system, machine: (a: MotionAxis) => row(a).machine, advanced: uiLevel.value.value === 'advanced', onCancel: () => setConfirm(null), onConfirm: () => run({ op: 'setZero', axes: confirm.axes }) })
    : h(ConfirmCard, { text: `${c25({ axes: axesText(confirm.axes), path: goToZeroPath(confirm.axes, safe, zNow) })}${handSet ? ` ${c25HandSet()}` : ''}`, confirm: 'Go to zero', safety: 'C25', onCancel: () => setConfirm(null), onConfirm: () => run({ op: 'goToZero', axes: confirm.axes, safeZ: safe }) });
}

function positionGrid({ actions, advanced, units, axes, row, act, setConfirm, snap, m, wcs, homed, tool, view, xyz }: { readonly actions: boolean; readonly advanced: boolean; readonly units: string | null; readonly axes: readonly ("a" | "x" | "y" | "z")[]; readonly row: (a: MotionAxis) => { readonly work: number | null; readonly machine: number | null; readonly homed: boolean | null; }; readonly act: (icon: IconName, label: string, onClick: () => void, blocked?: string | null) => ComponentChild; readonly setConfirm: (v: { readonly kind: "set" | "go"; readonly axes: readonly MotionAxis[]; } | null) => void; readonly snap: SessionSnapshot | null; readonly m: SnapshotMessage | null; readonly wcs: DroWcs | null; readonly homed: boolean | null; readonly tool: number | undefined; readonly view: LiveView | null; readonly xyz: readonly ("a" | "x" | "y" | "z")[] }): ComponentChild {
  return h(
    'div',
    { class: `dro-grid${actions ? '' : ' no-actions'}`, role: 'table', 'aria-label': 'Position' },
    // The actions' column heads name the icons (Zero, Go) at both levels; Simple hides the other heads.
    positionColumnHeads({ advanced, actions, units }),
    axes.map((a) => {
      const d = row(a);
      return positionAxisRow({ a, d, actions, act, setConfirm, snap });
    }),
    // The status line on the grid's last row, with the X, Y and Z actions in the per-axis actions' column.
    m === null && !actions
      ? null
      : positionStatusRow({ m, wcs, homed, tool, advanced, units, view, actions, act, xyz, setConfirm, snap })
  );
}

function positionAxisRow({ a, d, actions, act, setConfirm, snap }: { readonly a: MotionAxis; readonly d: { readonly work: number | null; readonly machine: number | null; readonly homed: boolean | null; }; readonly actions: boolean; readonly act: (icon: IconName, label: string, onClick: () => void, blocked?: string | null) => ComponentChild; readonly setConfirm: (v: { readonly kind: "set" | "go"; readonly axes: readonly MotionAxis[]; } | null) => void; readonly snap: SessionSnapshot | null }): ComponentChild {
  return h(
    'div',
    { class: 'dro-row', role: 'row', key: a, 'data-position-axis': a },
    h('span', { class: 'axis', role: 'rowheader' }, a.toUpperCase()),
    h('strong', { role: 'cell', 'data-position': 'work' }, coord(d.work)),
    h('span', { role: 'cell', 'data-position': 'machine' }, coord(d.machine)),
    actions ? h('span', { class: 'dro-actions', role: 'cell' }, act('zeroHere', `Set ${a.toUpperCase()} work zero here`, () => setConfirm({ kind: 'set', axes: [a] }), zeroBlocked(snap, [a])), act('goZero', `Go to ${a.toUpperCase()} zero`, () => setConfirm({ kind: 'go', axes: [a] }), atToolChange(snap) ? TC_GO_REASON : null)) : null
  );
}

function positionColumnHeads({ advanced, actions, units }: { readonly advanced: boolean; readonly actions: boolean; readonly units: string | null }): ComponentChild {
  return h(
    'div',
    { class: `dro-head${advanced || actions ? '' : ' sr-only'}`, role: 'row' },
    h('span', { role: 'columnheader' }, h('span', { class: 'sr-only' }, 'Axis')),
    h('span', { role: 'columnheader' }, h('span', { class: advanced ? undefined : 'sr-only' }, units === null ? 'Work' : `Work, ${units}`)),
    h('span', { role: 'columnheader' }, h('span', { class: advanced ? undefined : 'sr-only' }, 'Machine, mm')),
    actions ? h('span', { role: 'columnheader', class: 'dro-act-heads' }, h('span', { 'aria-hidden': 'true' }, 'Zero'), h('span', { 'aria-hidden': 'true' }, 'Go'), h('span', { class: 'sr-only' }, 'Actions')) : null
  );
}

function positionStatusRow({ m, wcs, homed, tool, advanced, units, view, actions, act, xyz, setConfirm, snap }: { readonly m: SnapshotMessage | null; readonly wcs: DroWcs | null; readonly homed: boolean | null; readonly tool: number | undefined; readonly advanced: boolean; readonly units: string | null; readonly view: LiveView | null; readonly actions: boolean; readonly act: (icon: IconName, label: string, onClick: () => void, blocked?: string | null) => ComponentChild; readonly xyz: readonly ("a" | "x" | "y" | "z")[]; readonly setConfirm: (v: { readonly kind: "set" | "go"; readonly axes: readonly MotionAxis[]; } | null) => void; readonly snap: SessionSnapshot | null }): ComponentChild {
  return h(
    'div',
    { class: 'dro-row pos-status-row', role: 'row' },
    h('span', { class: 'pos-status-cell', role: 'cell' }, m === null ? null : h(PositionStatus, { wcs: wcs?.code ?? null, homed, by: m.snapshot.notices.position?.by, tool: typeof tool === 'number' ? tool : null, units: advanced || units === null ? null : `Work in ${units}`, temporary: m.dro.marker?.g92 === true || offsetsView(view).temporaryInForce })),
    actions ? h('span', { class: 'dro-actions pos-all', role: 'cell' }, act('zeroHere', `Set ${axesText(xyz)} work zero here`, () => setConfirm({ kind: 'set', axes: xyz }), zeroBlocked(snap, xyz)), act('goZero', `Go to ${axesText(xyz)} zero`, () => setConfirm({ kind: 'go', axes: xyz }), atToolChange(snap) ? TC_GO_REASON : null)) : null
  );
}

function PositionLive(props: PositionProps): ComponentChild {
  return positionBody(props, LIVE_HOOKS);
}

export function PositionPanel(props: PositionProps = {}): ComponentChild {
  return isLive(props.model) ? h(PositionLive, props) : positionBody(props, STATIC_HOOKS);
}

type SessionSnapshot = SnapshotMessage['snapshot'];
type DroWcs = SnapshotMessage['dro']['wcs'];
