/**
 * Why the machine controls are blocked, in short sentences, and the one action that clears it (owner, 2026-11-09:
 * "if it's read only you cannot move ... this is dumb antipattern"). Pure: the Position panel draws the card
 * (ControlBlockCard.ts) and hides jog, home, zero and go-to-zero while a block holds.
 *
 * This decides nothing for the machine. It reads the same snapshot the session decides on (motion.ts `motionUi`
 * gives the gate and its precedence) and only picks the words and the way forward. A block is a state that needs
 * the user to act; a passing state (identifying the board, no status for a moment, a job or a move running) is not
 * a block, and its controls stay in place, disabled, with the reason in their titles.
 */
import type { LiveView } from './model.ts';
import type { SnapshotMessage } from '../machine-worker/rpc.ts';
import { coolantText, displayReadouts, spindleText } from './status.ts';

type Snapshot = SnapshotMessage['snapshot'];

export type BlockKind =
  | 'observer'
  | 'flag-off'
  | 'lost'
  | 'fault'
  | 'orphaned'
  | 'unidentified'
  | 'not-approved'
  | 'unknown'
  | 'needs-review'
  | 'wrong-board'
  | 'alarm';

/** What a block's button does. The card wires each to an existing flow; none is new machine logic. */
export type BlockActionId = 'trust' | 'update' | 'review' | 'machines' | 'clear-alarm' | 'disconnect';

export interface BlockAction {
  readonly id: BlockActionId;
  readonly label: string;
  readonly primary?: boolean;
}

export interface ControlBlock {
  readonly kind: BlockKind;
  /** The first sentence, shown in bold. */
  readonly title: string;
  /** The rest, one short sentence each. */
  readonly lines: readonly string[];
  readonly actions: readonly BlockAction[];
}

/** What the card needs beyond the snapshot. */
export interface BlockContext {
  /** Another tab of this browser controls a machine (this tab is not LIVE). */
  readonly observing: boolean;
  /** The existing trusted-build flow would offer to trust this board's build (Board → Firmware, C38, H87). */
  readonly trustOffered: boolean;
}

/** The board's build in plain words: "450.02, no build id", or "450.02, build 1a2b3c4d". */
export function buildText(s: Snapshot): string {
  const fb = s.identity?.fb;
  const fbs = s.identity?.fbs;
  const build = typeof fb === 'number' ? fb.toFixed(2) : 'unknown build';
  return `${build}, ${typeof fbs === 'string' && fbs.length > 0 ? `build ${fbs.slice(0, 8)}` : 'no build id'}`;
}

function notApproved(s: Snapshot, flasher: boolean, ctx: BlockContext): ControlBlock {
  const c = s.classification;
  const update: BlockAction[] = flasher ? [{ id: 'update', label: 'Update firmware', primary: !ctx.trustOffered }] : [];
  const trust: BlockAction[] = ctx.trustOffered ? [{ id: 'trust', label: 'Trust this firmware on this board', primary: true }] : [];
  const noUpdate = flasher ? [] : ['Firmware updates are not available on this site.'];
  if (c?.reason === 'flowControl') {
    return { kind: 'not-approved', title: 'Run can’t control this board yet.', lines: ['It uses hardware flow control (RTS/CTS), which Run doesn’t support.', 'Set flow control to XON/XOFF ($ex=1) with another program, then connect again.'], actions: [{ id: 'disconnect', label: 'Disconnect' }] };
  }
  if (c?.reason === 'stock-449') {
    return { kind: 'not-approved', title: 'Run can’t control this board yet.', lines: [`It runs stock TinyG firmware (${buildText(s)}), which Run only reads.`, ...noUpdate], actions: update };
  }
  if (c?.dialectId?.startsWith('g2core') === true) {
    return { kind: 'not-approved', title: 'Run can’t control this board yet.', lines: ['Run reads g2core boards but does not control them yet.'], actions: [] };
  }
  return {
    kind: 'not-approved',
    title: 'Run can’t control this board yet.',
    lines: [`Its firmware build isn’t on Run’s approved list (${buildText(s)}).`, ...noUpdate],
    actions: [...trust, ...update],
  };
}

/**
 * The block that holds now, or null. Same order as the session's gate (motion.ts `why`); the passing states
 * return null so their controls stay where they are.
 */
export function controlBlock(view: LiveView | null, ctx: BlockContext): ControlBlock | null {
  const s = view?.message?.snapshot ?? null;
  if (s === null || s.base === 'NOT_CONNECTED') {
    return ctx.observing ? { kind: 'observer', title: 'Another tab controls the machine.', lines: ['Use that tab, or close it and connect here.'], actions: [] } : null;
  }
  if (view?.message?.motion !== true) {
    return { kind: 'flag-off', title: 'Run doesn’t move machines on this site yet.', lines: ['Positions and settings are read only.'], actions: [] };
  }
  const o = s.overlays;
  if (o.includes('LOST')) return { kind: 'lost', title: 'The connection to the board is lost.', lines: ['Check the cable and the power, then connect again.'], actions: [{ id: 'disconnect', label: 'Disconnect', primary: true }] };
  if (o.includes('FAULT')) return { kind: 'fault', title: 'Run stopped on a fault.', lines: ['Check the machine, then disconnect and connect again.'], actions: [{ id: 'disconnect', label: 'Disconnect', primary: true }] };
  if (o.includes('ORPHANED_MOTION')) return { kind: 'orphaned', title: 'The machine is moving and this page didn’t start it.', lines: ['Use Stop job at the top first.'], actions: [] };
  if (s.classification === null || s.base === 'IDENTIFYING' || s.base === 'READING' || s.base === 'OPENING' || s.base === 'PORT_REQUEST') return null;
  if (s.classification.dialectId === null) {
    return { kind: 'unidentified', title: 'Run couldn’t identify this board.', lines: ['Its replies carried no values.', 'On TinyG, set $jv to 4, then connect again.'], actions: [{ id: 'disconnect', label: 'Disconnect', primary: true }] };
  }
  if (o.includes('READ_ONLY') || s.classification.mode !== 'full') return notApproved(s, view?.message?.flasher === true, ctx);
  if (o.includes('STALE')) return null;
  // UNKNOWN's card is the Position panel's existing exits (homing.ts UnknownExits): verify, home, or set machine zero.
  if (o.includes('UNKNOWN')) return { kind: 'unknown', title: 'Position not verified.', lines: [], actions: [] };
  if (o.includes('NEEDS_REVIEW')) return { kind: 'needs-review', title: 'The board’s settings differ from this machine’s.', lines: ['Keep the board’s settings or review them before moving.'], actions: [{ id: 'review', label: 'Review settings', primary: true }] };
  if (s.base === 'BLOCKED') return { kind: 'wrong-board', title: 'This isn’t the board saved for this machine.', lines: ['Choose the machine that uses this board, or connect the right board.'], actions: [{ id: 'machines', label: 'Choose the machine', primary: true }] };
  if (s.base === 'ALARM') return { kind: 'alarm', title: 'The controller is in alarm, so it stopped.', lines: ['Clear the alarm before moving.'], actions: [{ id: 'clear-alarm', label: 'Clear alarm…', primary: true }] };
  return null;
}

/**
 * The board reports the spindle and the coolant off. While a block holds, the Spindle section is drawn only when this
 * is false (on, or not known), so its Off (stop-class, never gated) is there when it could matter.
 */
export function outputsOff(view: LiveView | null): boolean {
  const r = displayReadouts(view?.message?.snapshot ?? null);
  return spindleText(r) === 'Off' && ['Off', 'Flood off', 'Mist off'].includes(coolantText(r));
}
