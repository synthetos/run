/**
 * "Ready to start?" (owner, 2026-11-09): the Run step as one list, one line per item with a mark (✓ done, ! needs
 * you, ✕ blocked, … still checking), the one tick that confirms what applies, and what Start must ask first (the
 * travel question, C40 or C41). Pure: RunPanel.ts gathers the inputs and draws it.
 *
 * Nothing here decides for the machine. The session checks every start again (SAFETY §4.4a); this only keeps the page
 * honest about what Start will need, and never names a reason that is not the real one.
 */
import type { BlockActionId, ControlBlock } from '../controlBlock.ts';
import { MARK_TEXT, type Mark, type TickPart } from './runCopy.ts';

export type ReadyItemId = 'machine' | 'file' | 'zero' | 'position' | 'travel' | 'modes' | 'feeds' | 'tool' | 'spindle';

/** What an item's button does. Block actions reuse the Position panel's (ControlBlockCard.ts). */
export type ReadyActionId = BlockActionId | 'connect' | 'verify' | 'home' | 'analyze' | 'save-zero' | 'edit-tool' | 'use-file-tool';

export interface ReadyItem {
  readonly id: ReadyItemId;
  readonly label: string;
  readonly mark: Mark;
  /** A few words. */
  readonly summary: string;
  readonly actions: readonly { readonly id: ReadyActionId; readonly label: string }[];
  /** The note in the Notes tab that says more, if any. */
  readonly note?: string;
}

/** A move past the travel of an axis that is not homed (C41), or a travel that could not be checked (C40). */
export type TravelAsk =
  | { readonly kind: 'past'; readonly axis: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C'; readonly line: number; readonly reach: number; readonly limit: number; readonly unit: 'mm' | '°'; readonly more: number; readonly text: string; readonly homeable: boolean; readonly zeroFirst?: boolean }
  | { readonly kind: 'unchecked'; readonly why: string; readonly text: string };

export interface ReadyInput {
  readonly connected: boolean;
  /** The worker's jobs switch (bench and staging). */
  readonly jobsOn: boolean;
  /** The block the Position panel shows (read only, UNKNOWN, alarm, ...), with its real reason. */
  readonly block: ControlBlock | null;
  /** A passing reason Start must wait for (the connection being set up, a move running), or null. */
  readonly wait: string | null;
  readonly fileName: string | null;
  readonly check:
    | { readonly state: 'none' | 'checking' }
    | { readonly state: 'blocked'; readonly line: number | null; readonly message: string; readonly more: number }
    | { readonly state: 'done'; readonly lines: number; readonly toolChanges: number; readonly seconds: number | null };
  /** Plan versus board work zero: `match`, `differs` (C31), `unknown` (not read), or null before connecting. */
  readonly zero: { readonly state: 'match' | 'differs' | 'unknown'; readonly comparable: boolean } | null;
  /** All of X, Y and Z homed (or set), false when not, null when not known. */
  readonly homed: boolean | null;
  readonly homedBy: 'homing' | 'hand' | undefined;
  /** Homing is configured for some axis and the machine can move: Home is offered. */
  readonly canHome: boolean;
  /** The travel check: null until the file is checked; `fits` when nothing is asked. */
  readonly travel: null | { readonly kind: 'fits' } | TravelAsk;
  readonly modes: string | null;
  /** The Analyze summary ("Feeds: within range", "Feeds: needs review in Analyze"). */
  readonly feeds: string;
  readonly spindle: { readonly starts: boolean; readonly speeds: string } | null;
  /**
   * The file's tools against the tool table (workspace/toolMismatch.ts): the first mismatched T number and the row's
   * words ("T1 doesn't match the file."), or null. Never blocking: the board runs what the file says.
   */
  readonly toolMismatch?: { readonly number: number; readonly summary: string } | null;
}

export interface ReadyModel {
  readonly items: readonly ReadyItem[];
  /** What the one tick confirms (always the attestation; the others when they apply). Empty before a file is ready. */
  readonly tick: readonly TickPart[];
  /** A blocked or still-checking item: Start stays off. */
  readonly blocked: boolean;
  /** What Start asks before the start confirmation, or null. */
  readonly travelAsk: TravelAsk | null;
}

const fmtSeconds = (s: number): string => (s >= 3600 ? `about ${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min` : `about ${Math.max(1, Math.round(s / 60))} min`);

function machineItem(input: ReadyInput): ReadyItem | null {
  if (!input.connected) {
    if (input.block?.kind === 'observer') return { id: 'machine', label: 'Machine', mark: 'blocked', summary: `${input.block.title} ${input.block.lines.join(' ')}`, actions: [] };
    return { id: 'machine', label: 'Machine', mark: 'blocked', summary: 'Not connected.', actions: [{ id: 'connect', label: 'Connect' }] };
  }
  if (!input.jobsOn) return { id: 'machine', label: 'Machine', mark: 'blocked', summary: 'Running jobs isn’t on in this build.', actions: [] };
  const b = input.block;
  if (b !== null) {
    if (b.kind === 'unknown') return { id: 'machine', label: 'Machine', mark: 'blocked', summary: 'Position not verified.', actions: [{ id: 'verify', label: 'Check…' }] };
    // The title alone: the full reason is the Position panel's card, right beside the list.
    return { id: 'machine', label: 'Machine', mark: 'blocked', summary: b.title, actions: b.actions.map((a) => ({ id: a.id, label: a.label })) };
  }
  if (input.wait !== null) return { id: 'machine', label: 'Machine', mark: 'waiting', summary: input.wait, actions: [] };
  return null;
}

function fileItem(input: ReadyInput): ReadyItem {
  const c = input.check;
  if (input.fileName === null) return { id: 'file', label: 'File', mark: 'blocked', summary: 'Open a G-code file.', actions: [] };
  if (c.state === 'none' || c.state === 'checking') {
    // Behind a machine block nothing is checked yet: say when it will be, not "checking" forever.
    if (!input.connected) return { id: 'file', label: 'File', mark: 'needs', summary: 'Checked when you connect.', actions: [] };
    if (!input.jobsOn || input.block !== null) return { id: 'file', label: 'File', mark: 'needs', summary: 'Checked once the board can run jobs.', actions: [] };
    return { id: 'file', label: 'File', mark: 'waiting', summary: 'Checking with this board…', actions: [] };
  }
  if (c.state === 'blocked') return { id: 'file', label: 'File', mark: 'blocked', summary: `${c.line === null ? '' : `Line ${c.line.toLocaleString('en-US')}: `}${c.message}${c.more > 0 ? ` (+${c.more} more)` : ''}`, actions: [], note: 'file-check' };
  if (c.state !== 'done') return { id: 'file', label: 'File', mark: 'waiting', summary: 'Checking with this board…', actions: [] };
  return { id: 'file', label: 'File', mark: 'done', summary: `Checked. ${c.lines.toLocaleString('en-US')} lines${c.seconds === null ? '' : `, ${fmtSeconds(c.seconds)}`}.`, actions: [], note: 'file-check' };
}

function zeroItem(input: ReadyInput): ReadyItem {
  const z = input.zero;
  if (z === null) return { id: 'zero', label: 'Work zero', mark: 'needs', summary: 'Compared when you connect.', actions: [] };
  if (z.state === 'match') return { id: 'zero', label: 'Work zero', mark: 'done', summary: 'Matches your plan.', actions: [], note: 'zero' };
  if (z.state === 'unknown') return { id: 'zero', label: 'Work zero', mark: 'blocked', summary: 'Not read from the board yet.', actions: [], note: 'zero' };
  return { id: 'zero', label: 'Work zero', mark: 'needs', summary: z.comparable ? 'Not your plan’s.' : 'Can’t compare.', actions: [{ id: 'save-zero', label: 'Save' }], note: 'zero' };
}

function positionItem(input: ReadyInput): ReadyItem {
  if (input.homed === null) return { id: 'position', label: 'Position', mark: input.connected ? 'waiting' : 'needs', summary: input.connected ? 'Reading…' : 'Read when you connect.', actions: [] };
  if (input.homed) return { id: 'position', label: 'Position', mark: 'done', summary: input.homedBy === 'hand' ? 'Set by hand.' : 'Homed.', actions: [] };
  return { id: 'position', label: 'Position', mark: 'needs', summary: 'Not homed.', actions: input.canHome ? [{ id: 'home', label: 'Home' }] : [] };
}

function travelItem(input: ReadyInput): ReadyItem {
  const t = input.travel;
  if (t === null) return { id: 'travel', label: 'Travel', mark: input.connected && input.jobsOn && input.block === null && input.fileName !== null ? 'waiting' : 'needs', summary: 'Checked with the file.', actions: [] };
  if (t.kind === 'fits') return { id: 'travel', label: 'Travel', mark: 'done', summary: 'Every move fits.', actions: [] };
  if (t.kind === 'past') return { id: 'travel', label: 'Travel', mark: 'needs', summary: `Line ${t.line.toLocaleString('en-US')} goes past ${t.axis}.`, actions: t.homeable ? [{ id: 'home', label: `Home ${t.axis}` }] : [], note: 'travel' };
  return { id: 'travel', label: 'Travel', mark: 'needs', summary: 'Can’t be checked.', actions: [], note: 'travel' };
}

/** The Tools row when the file's tools differ from the table's: the note's two buttons, never blocking. */
function toolMismatchItem(m: { readonly number: number; readonly summary: string }): ReadyItem {
  return { id: 'tool', label: 'Tools', mark: 'needs', summary: m.summary, actions: [{ id: 'edit-tool', label: `Edit T${m.number}` }, { id: 'use-file-tool', label: 'Use the file’s tool' }], note: `tool-mismatch/${m.number}` };
}

/** The list and what Start needs, from what the page knows now. */
export function readyModel(input: ReadyInput): ReadyModel {
  const machine = machineItem(input);
  const fileReady = input.check.state === 'done';
  const homedNo = input.homed === false;
  // C41: a move past the travel of an axis that is not homed is asked at Start, and that one answer covers C36.
  const pastUnhomed = input.travel !== null && input.travel.kind === 'past' && homedNo;
  const spindle = input.spindle;
  const items: ReadyItem[] = [
    ...(machine === null ? [] : [machine]),
    fileItem(input),
    zeroItem(input),
    positionItem(input),
    travelItem(input),
    ...(input.modes === null ? [] : [{ id: 'modes' as const, label: 'Board modes', mark: 'done' as const, summary: `${input.modes}.`, actions: [], note: 'modes' }]),
    { id: 'feeds', label: 'Feeds', mark: /within range/.test(input.feeds) ? 'done' : 'needs', summary: /needs review/.test(input.feeds) ? 'Review.' : input.feeds.replace(/^Feeds: /, '').replace(/^./, (c) => c.toUpperCase()), actions: /within range/.test(input.feeds) ? [] : [{ id: 'analyze', label: 'Analyze' }] },
    ...(input.toolMismatch != null ? [toolMismatchItem(input.toolMismatch)] : input.check.state === 'done' && input.check.toolChanges > 0 ? [{ id: 'tool' as const, label: 'Tools', mark: 'done' as const, summary: `${input.check.toolChanges} tool ${input.check.toolChanges === 1 ? 'change' : 'changes'}. Run stops for each.`, actions: [] }] : []),
    ...(spindle?.starts === true ? [{ id: 'spindle' as const, label: 'Spindle', mark: 'needs' as const, summary: `${spindle.speeds}, on by itself.`, actions: [] }] : []),
  ];
  const tick: TickPart[] = !fileReady || machine !== null
    ? []
    : [
        ...(input.zero?.state === 'differs' ? (['workZero'] as const) : []),
        ...(homedNo && !pastUnhomed ? (['unhomed'] as const) : []),
        ...(spindle?.starts === true ? (['spindle'] as const) : []),
        'attended',
      ];
  const blocked = items.some((i) => i.mark === 'blocked' || i.mark === 'waiting');
  const travelAsk = input.travel !== null && input.travel.kind !== 'fits' ? input.travel : null;
  return { items, tick, blocked, travelAsk };
}

/** The mark as text, for the list and its tests. */
export function markText(mark: Mark): string {
  return MARK_TEXT[mark];
}
