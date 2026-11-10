/**
 * How the terminal shows things (H91): a colour class per entry kind, status codes in plain words, a typed move's
 * result as one line, and the travel question (Home / Move anyway / Cancel). The symbols ✓ ⚠ ✕ ⏸ ▶ are for the
 * screen only: nothing here is ever written to the board (typed lines are printable ASCII, typedLine.ts).
 *
 * Pure.
 */
import { DEN } from '@synthetos/schema';
import type { WorkerStatus } from '../machine-worker/rpc.ts';
import type { EntryKind } from './transcript.ts';

/** A typed move's result, as the session snapshot carries it (H91). */
export type TypedMoveNotice = NonNullable<WorkerStatus['session']['notices']['typed']>;
/** The travel finding a typed move could not check (the job start's C40/C41 data). */
export type TravelFinding = NonNullable<TypedMoveNotice['travel']>;

export const SYMBOL = Object.freeze({ done: '✓', warn: '⚠', error: '✕', paused: '⏸', running: '▶' });

/** The CSS class of each entry kind (the view styles them from theme tokens, both themes). */
export const KIND_CLASS: Readonly<Record<EntryKind, string>> = Object.freeze({
  sent: 'term-sent',
  reply: 'term-reply',
  error: 'term-error',
  status: 'term-status',
  note: 'term-note',
});

/** Shown once per session, the first time a move is typed (design doc, "Notice"). */
export const FIRST_MOVE_NOTICE = 'Typed moves run straight on the machine. Stop is the red button or Esc.';

/** A status code in plain words: "OK", or "Status 22: floating point error." Never the firmware's constant name. */
export function statusWords(status: number): string {
  if (status === 0) return 'OK';
  const names = DEN.status.find(([code]) => code === status)?.[1];
  const words = names?.[0]?.replace(/^STAT_/, '').toLowerCase().replace(/_/g, ' ');
  return words === undefined ? `Status ${status}.` : `Status ${status}: ${words}.`;
}

export interface Shown {
  readonly symbol: string;
  readonly cls: string;
  readonly text: string;
}

/** A typed move's result as one transcript line: the symbol, its class and the words. */
export function typedResult(notice: TypedMoveNotice): Shown {
  switch (notice.kind) {
    case 'done':
      return { symbol: SYMBOL.done, cls: KIND_CLASS.note, text: `${notice.line}: ${notice.text}` };
    case 'confirm':
      return { symbol: SYMBOL.warn, cls: KIND_CLASS.note, text: notice.text };
    case 'stopped':
      return { symbol: SYMBOL.paused, cls: KIND_CLASS.error, text: `${notice.line}: ${notice.text}` };
    default:
      return { symbol: SYMBOL.error, cls: KIND_CLASS.error, text: `${notice.line}: ${notice.text}` };
  }
}

/** A line the user sent, as the transcript shows it while it runs. */
export function sentLine(line: string): Shown {
  return { symbol: SYMBOL.running, cls: KIND_CLASS.sent, text: line };
}

export type TravelChoice = 'home' | 'moveAnyway' | 'cancel';

/** The travel question for a typed move the session could not check (the same finding a job start asks C40/C41 for). */
export interface TravelQuestion {
  readonly text: string;
  readonly choices: readonly { readonly choice: TravelChoice; readonly label: string }[];
  /** Sent back with "Move anyway": the session matches it exactly. */
  readonly finding: string;
}

/** The question in short sentences. "Home" is offered first; "Move anyway" sends the line again with the finding. */
export function travelQuestion(finding: TravelFinding): TravelQuestion {
  const p = finding.past;
  const text =
    p !== undefined
      ? `${p.axis} isn't homed, so Run can't check its travel. ${p.axis} would reach ${p.reach} ${p.unit}, past its ${p.limit} ${p.unit} limit. Move only if you have checked where it is.`
      : `Run can't check this move against the travel: ${finding.text.replace(/^line \d+: /, '')}. Move only if you have checked that it fits.`;
  return {
    text,
    choices: [
      { choice: 'home', label: 'Home' },
      { choice: 'moveAnyway', label: 'Move anyway' },
      { choice: 'cancel', label: 'Cancel' },
    ],
    finding: finding.text,
  };
}
