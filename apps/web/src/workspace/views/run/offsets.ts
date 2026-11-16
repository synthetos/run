import { c25, c25HandSet, c27, c28, c29 } from '@synthetos/safety';
import type { SettingValue } from '@synthetos/schema';
import { h, type ComponentChild } from 'preact';
import type { MotionAxis, MotionCommand, SnapshotMessage } from '../../../machine-worker/rpc.ts';
import { ContextHelp } from '../../../shell/ContextHelp.ts';
import { settingsOf } from '../../boardFacts.ts';
import { uiLevel } from '../../jobWorkflow.ts';
import { type LiveView, type WorkspaceModel } from '../../model.ts';
import { axesText, goToZeroPath, machineAxes, machineZ, motionUi, offsetsView, type MotionUi, type OffsetsView } from '../../motion.ts';
import { goToZeroSafeZ } from '../../safeZ.ts';
import { coord, UNKNOWN } from '../../status.ts';
import { atToolChange, TC_GO_REASON, TC_OFFSET_REASON, zeroBlocked } from '../../toolChangeControls.ts';
import { ConfirmCard } from '../../ui.ts';
import { WorkZeroConfirm } from '../../workZeroConfirm.ts';
import { isLive, LIVE_HOOKS, motionNote, STATIC_HOOKS, type Hooks } from './motionHooks.ts';

/**
 * Offsets (amendment 2026-11-02; SAFETY §4.5b, H53, H68, C16, C25, C27-C29): the work coordinate system (G54..G59),
 * Set work zero per axis and for all (G10 L20 in the active system, saved on the controller), Go to zero (Z rises in
 * machine coordinates first), the temporary offset (G92, not saved; cleared with G92.1), and the active offsets as the
 * board reported them. Every change is read back by the session.
 */
function zeroBody({ model, ask, goOnly = false }: ZeroProps, hk: Hooks): ComponentChild {
  const { ui, view, ztm, zNow, send, settings } = offsetsMachine({ model });
  const [safeZ, setSafeZ] = hk.state<number | null>(null);
  // OD-23: lift to ztm − 1 only after a homing seen in this connection (safeZ.ts).
  const { safe, handSet } = offsetsSafeZ({ ui, view, ztm, zNow, safeZ });
  type Confirm = { readonly kind: 'set' | 'go' | 'temp'; readonly axes: readonly MotionAxis[] } | { readonly kind: 'clear' } | { readonly kind: 'system'; readonly n: number } | null;
  const [confirm, setConfirm] = hk.state<Confirm>(null);
  const [note, setNote] = hk.state<string | null>(null);
  hk.effect(() => {
    if (ask !== null && ask !== undefined && ui.enabled) setConfirm({ kind: 'go', axes: ask.axes });
  }, [ask?.at]);
  const { enabled, system, machine, off, work } = offsetsReadouts({ view, ui, send });
  const run = (command: MotionCommand): void => {
    setConfirm(null);
    setNote(null);
    void send?.(command).then(setNote);
  };
  // H74 (2026-11-08): at a tool change only the Z re-zero (toolChangeControls.ts); a blocked button says why.
  const snap = view?.message?.snapshot ?? null;
  const tc = atToolChange(snap);
  const button = (label: string, aria: string, onClick: () => void, { control = 'zero', ok = true, blocked = null }: OffsetButtonOptions = {}): ComponentChild =>
    h('button', { type: 'button', class: 'small', 'aria-label': aria, 'data-machine-control': control, ...(blocked === null ? {} : { title: blocked, 'data-blocked': 'tool-change' }), ...(enabled && ok && blocked === null ? { onClick } : { disabled: true }) }, label);
  const confirmCard = offsetConfirmation({ confirm, enabled, setConfirm, system, machine, run, safe, zNow, handSet });
  const offsetLine = (o: Readonly<Partial<Record<MotionAxis, number>>> | null): string =>
    o === null ? UNKNOWN : machineAxes(settings).map((a) => `${a.toUpperCase()} ${coord(o[a])}`).join(', ');
  // Simple: only the Go-to-zero confirmation the jog pad asked for (C25), in place; nothing else of the Offsets tab.
  if (goOnly) return confirm === null ? null : h('div', { class: 'insp sec-zero go-only' }, confirmCard(), motionNote(note));
  return h(
    'section',
    { class: 'insp sec-zero', 'aria-labelledby': 'zero-title' },
    h('header', null, h('h2', { id: 'zero-title' }, 'Offsets'), h('span', { class: 'tag', 'data-offsets': 'system' }, off.system ?? 'G54–G59')),
    coordinateSystems({ off, tc, enabled, setConfirm }),
    // Plain headings (owner, 2026-11-09): the heading word itself opens its help, no round "?".
    h('h3', { class: 'tan-label' }, h(ContextHelp, { id: 'work-zero-help', label: 'Work zero: what Zero and Go do', trigger: 'Work zero', below: true }, `Zero sets the ${system} offset so the axis reads 0 here (G10 L20, saved on the controller). Go moves there, Z rising to Safe Z first.`)),
    offsetsTable({ system, settings, work, off, button, setConfirm, snap, tc }),
    h(
      'label',
      { class: 'jog-feed' },
      h('span', null, 'Safe Z'),
      safeZInput({ safe, enabled, setSafeZ }),
      h('small', null, 'mm'),
    ),
    h('h3', { class: 'tan-label' }, h(ContextHelp, { id: 'g92-help', label: 'Temporary offset: what it does', trigger: 'Temporary offset', below: true }, `G92 shifts work positions so the axes read 0 here without changing the saved ${system} offset. It is not saved: a reset or a program end clears it; Clear sends G92.1.`)),
    // One row per kind, in even columns: each axis, then All and Clear.
    temporaryOffsets({ settings, button, setConfirm, tc, off }),
    off.temporaryInForce ? h('p', { class: 'fine', 'data-offsets': 'temporary' }, `G92 ${offsetLine(off.temporary)} · in force, not saved`) : null,
    confirmCard(),
    offsetsNote({ note, enabled, view }),
  );
}

type ZeroProps = { readonly model?: WorkspaceModel | null; readonly ask?: { readonly axes: readonly MotionAxis[]; readonly at: number } | null; readonly goOnly?: boolean };

function offsetsNote({ note, enabled, view }: { readonly note: string | null; readonly enabled: boolean; readonly view: LiveView | null }): ComponentChild {
  return motionNote(note ?? (enabled ? (view?.message?.snapshot.notices.change?.text ?? null) : null));
}

function offsetsReadouts({ view, ui, send }: { readonly view: LiveView | null; readonly ui: MotionUi; readonly send: ((command: MotionCommand) => Promise<string | null>) | undefined }) {
  const off = offsetsView(view);
  const system = off.system ?? 'G54';
  const dro = view?.message?.dro.axes ?? [];
  const work = (a: MotionAxis): number | null => dro.find((d) => d.axis === a)?.work ?? null;
  const machine = (a: MotionAxis): number | null => dro.find((d) => d.axis === a)?.machine ?? null;
  const enabled = ui.enabled && send !== undefined;
  return { enabled, system, machine, off, work };
}

function offsetsSafeZ({ ui, view, ztm, zNow, safeZ }: { readonly ui: MotionUi; readonly view: LiveView | null; readonly ztm: number | null; readonly zNow: number | null; readonly safeZ: number | null }) {
  const planned = goToZeroSafeZ({ homed: ui.homed, zHomedHere: (view?.message?.snapshot.notices.homedAxes ?? []).includes('z'), ztm, zNow });
  const safe = safeZ ?? planned.safe;
  const handSet = safeZ === null && planned.handSet;
  return { safe, handSet };
}

function offsetsMachine({ model }: { readonly model: WorkspaceModel | null | undefined }) {
  const view = model?.live.value ?? null;
  const ui = motionUi(view);
  const send = model?.actions.value?.motion;
  const settings = settingsOf(view);
  const zNow = machineZ(view);
  const ztm = typeof settings['ztm'] === 'number' ? (settings['ztm'] as number) : null;
  return { ui, view, ztm, zNow, send, settings };
}

function offsetConfirmation({ confirm, enabled, setConfirm, system, machine, run, safe, zNow, handSet }: { readonly confirm: { readonly kind: "set" | "go" | "temp"; readonly axes: readonly MotionAxis[]; } | { readonly kind: "clear"; } | { readonly kind: "system"; readonly n: number; } | null; readonly enabled: boolean; readonly setConfirm: (v: { readonly kind: "set" | "go" | "temp"; readonly axes: readonly MotionAxis[]; } | { readonly kind: "clear"; } | { readonly kind: "system"; readonly n: number; } | null) => void; readonly system: string; readonly machine: (a: MotionAxis) => number | null; readonly run: (command: MotionCommand) => void; readonly safe: number; readonly zNow: number | null; readonly handSet: boolean }) {
  return (): ComponentChild => {
    if (confirm === null || !enabled) return null;
    const cancel = (): void => setConfirm(null);
    switch (confirm.kind) {
      case 'set': {
        return h(WorkZeroConfirm, { axes: confirm.axes, system, machine: (a: MotionAxis) => machine(a) ?? null, advanced: uiLevel.value.value === 'advanced', onCancel: cancel, onConfirm: () => run({ op: 'setZero', axes: confirm.axes }) });
      }
      case 'go':
        return h(ConfirmCard, { text: `${c25({ axes: axesText(confirm.axes), path: goToZeroPath(confirm.axes, safe, zNow) })}${handSet ? ` ${c25HandSet()}` : ''}`, confirm: 'Go to zero', safety: 'C25', onCancel: cancel, onConfirm: () => run({ op: 'goToZero', axes: confirm.axes, safeZ: safe }) });
      case 'temp':
        return h(ConfirmCard, { text: c27({ axes: axesText(confirm.axes), system }), confirm: 'Set temporary offset', safety: 'C27', onCancel: cancel, onConfirm: () => run({ op: 'tempOffset', axes: confirm.axes }) });
      case 'clear':
        return h(ConfirmCard, { text: c28({ system }), confirm: 'Clear temporary offset', safety: 'C28', onCancel: cancel, onConfirm: () => run({ op: 'clearTempOffset' }) });
      default:
        return h(ConfirmCard, { text: c29({ system: `G${53 + confirm.n}` }), confirm: `Use G${53 + confirm.n}`, safety: 'C29', onCancel: cancel, onConfirm: () => run({ op: 'selectCoord', system: confirm.n }) });
    }
  };
}

function safeZInput({ safe, enabled, setSafeZ }: { readonly safe: number; readonly enabled: boolean; readonly setSafeZ: (v: number | null) => void }): ComponentChild {
  return h('input', {
    type: 'number',
    step: 1,
    value: safe,
    ...(enabled ? { onInput: (e: Event) => setSafeZ(Number((e.currentTarget as HTMLInputElement).value)) } : { disabled: true }),
    'aria-label': 'Safe Z height in machine coordinates, mm',
    'data-machine-control': 'zero',
    title: 'Machine Z that Go rises to before X and Y move; never lower than Z is now.',
  });
}

function coordinateSystems({ off, tc, enabled, setConfirm }: { readonly off: OffsetsView; readonly tc: boolean; readonly enabled: boolean; readonly setConfirm: (v: { readonly kind: "set" | "go" | "temp"; readonly axes: readonly MotionAxis[]; } | { readonly kind: "clear"; } | { readonly kind: "system"; readonly n: number; } | null) => void }): ComponentChild {
  return h(
    'div',
    { class: 'seg full wcs-seg', role: 'group', 'aria-label': 'Work coordinate system' },
    [1, 2, 3, 4, 5, 6].map((n) => h(
      'button',
      { type: 'button', key: n, class: off.system === `G${53 + n}` ? 'selected' : undefined, 'aria-pressed': off.system === `G${53 + n}` ? 'true' : 'false', 'data-machine-control': 'offset', ...(tc ? { title: TC_OFFSET_REASON } : {}), ...(enabled && !tc && off.system !== `G${53 + n}` ? { onClick: () => setConfirm({ kind: 'system', n }) } : { disabled: true }) },
      `G${53 + n}`
    )
    )
  );
}

function temporaryOffsets({ settings, button, setConfirm, tc, off }: { readonly settings: Readonly<Record<string, SettingValue>>; readonly button: (label: string, aria: string, onClick: () => void, options?: OffsetButtonOptions) => ComponentChild; readonly setConfirm: (v: { readonly kind: "set" | "go" | "temp"; readonly axes: readonly MotionAxis[]; } | { readonly kind: "clear"; } | { readonly kind: "system"; readonly n: number; } | null) => void; readonly tc: boolean; readonly off: OffsetsView }): ComponentChild {
  return h(
    'div',
    { class: 'temp-offset' },
    h('div', { class: 'temp-axes' }, machineAxes(settings).map((a) => button(`${a.toUpperCase()} = 0`, `Temporary offset: ${a.toUpperCase()} reads 0 here`, () => setConfirm({ kind: 'temp', axes: [a] }), { control: 'offset', ok: true, blocked: tc ? TC_OFFSET_REASON : null }))),
    h(
      'div',
      { class: 'temp-all' },
      button('All = 0', 'Temporary offset: X, Y and Z read 0 here', () => setConfirm({ kind: 'temp', axes: ['x', 'y', 'z'] }), { control: 'offset', ok: true, blocked: tc ? TC_OFFSET_REASON : null }),
      button('Clear', 'Clear the temporary offset (G92.1)', () => setConfirm({ kind: 'clear' }), { control: 'offset', ok: off.temporaryInForce, blocked: tc ? TC_OFFSET_REASON : null })
    )
  );
}

function offsetsTable({ system, settings, work, off, button, setConfirm, snap, tc }: { readonly system: string; readonly settings: Readonly<Record<string, SettingValue>>; readonly work: (a: MotionAxis) => number | null; readonly off: OffsetsView; readonly button: (label: string, aria: string, onClick: () => void, options?: OffsetButtonOptions) => ComponentChild; readonly setConfirm: (v: { readonly kind: "set" | "go" | "temp"; readonly axes: readonly MotionAxis[]; } | { readonly kind: "clear"; } | { readonly kind: "system"; readonly n: number; } | null) => void; readonly snap: SessionSnapshot | null; readonly tc: boolean }): ComponentChild {
  return h(
    'table',
    { class: 'zero-table' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Axis'), h('th', { scope: 'col' }, 'Work'), h('th', { scope: 'col' }, `${system} offset`), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))),
    h(
      'tbody',
      null,
      machineAxes(settings).map((a) => h(
        'tr',
        { key: a, 'data-zero-axis': a },
        h('th', { scope: 'row' }, a.toUpperCase()),
        h('td', { class: 'num' }, coord(work(a))),
        h('td', { class: 'num', 'data-zero-offset': a }, coord(off.saved?.[a])),
        h('td', { class: 'zero-actions' }, button('Zero', `Set work zero for ${a.toUpperCase()} here, saved in ${system}`, () => setConfirm({ kind: 'set', axes: [a] }), { control: 'zero', ok: true, blocked: zeroBlocked(snap, [a]) }), button('Go', `Go to ${a.toUpperCase()} zero`, () => setConfirm({ kind: 'go', axes: [a] }), { control: 'zero', ok: true, blocked: tc ? TC_GO_REASON : null }))
      )
      )
    )
  );
}

function ZeroLive(props: ZeroProps): ComponentChild {
  return zeroBody(props, LIVE_HOOKS);
}

export function ZeroSection(props: ZeroProps = {}): ComponentChild {
  return isLive(props.model) ? h(ZeroLive, props) : zeroBody(props, STATIC_HOOKS);
}

interface OffsetButtonOptions { readonly control?: string; readonly ok?: boolean; readonly blocked?: string | null }

type SessionSnapshot = SnapshotMessage['snapshot'];
