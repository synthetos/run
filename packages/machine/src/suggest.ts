/**
 * Machine suggestion after the probe (ROADMAP P1-03; SAFETY H-ID row,
 * T-S50; RUN_PLAN §7.2).
 *
 * The probed board is matched to saved machines by `(family, board id)`:
 * the controller family of the classified dialect and the `id` string the
 * probe read. Local machines always count; cloud machines only when the
 * user is signed in. Nothing is ever selected here: one match is offered
 * for the user to confirm, several are offered for the user to pick from
 * (two machines can carry the same board id, for example a profile copied
 * between computers). An unclassified board, or one that reported no id,
 * matches nothing.
 *
 * `checkSelection` is the hard block: a machine whose bound device is a
 * different board cannot be used with this one. The session enforces the
 * same rule on the wire (T-S21, BLOCKED); this check lets the UI refuse
 * before it asks.
 */
import type { DialectId } from '@synthetos/protocol';
import { familyOfDialect, type BoundDevice } from '@synthetos/schema';

/** A saved machine the user could pick. Only its binding is read here. */
export interface MachineCandidate {
  readonly source: 'local' | 'cloud';
  /** The store's key for this machine (local id or cloud id). */
  readonly key: string;
  readonly boundDevice: BoundDevice | null;
}

/** What the probe said about the connected board. */
export interface ProbedBoard {
  /** The classified dialect, or null when the board is unclassified. */
  readonly dialectId: DialectId | null;
  /** The board's `id`, when it reported one. */
  readonly id: string | undefined;
}

export interface MachineSuggestion {
  /** Every matching machine: local ones first, then cloud ones, each in the order given. */
  readonly matches: readonly MachineCandidate[];
  /** Never set: the user always chooses (T-S50). */
  readonly selected: null;
  /** `none`: offer a new machine; `confirm`: one match, the user confirms it; `pick`: several, the user picks one. */
  readonly choice: 'none' | 'confirm' | 'pick';
}

function matchesBoard(board: ProbedBoard, m: MachineCandidate): boolean {
  if (board.dialectId === null || board.id === undefined || m.boundDevice === null) return false;
  return m.boundDevice.family === familyOfDialect(board.dialectId) && m.boundDevice.id === board.id;
}

/** Saved machines bound to this board. Cloud machines are considered only when signed in. */
export function suggestMachines(
  board: ProbedBoard,
  local: readonly MachineCandidate[],
  cloud: readonly MachineCandidate[],
  signedIn: boolean,
): MachineSuggestion {
  const pool = signedIn ? [...local, ...cloud] : [...local];
  const matches = Object.freeze(pool.filter((m) => matchesBoard(board, m)));
  const choice = matches.length === 0 ? 'none' : matches.length === 1 ? 'confirm' : 'pick';
  return Object.freeze({ matches, selected: null, choice });
}

export type SelectionCheck =
  | { readonly ok: true; readonly binds: boolean }
  | { readonly ok: false; readonly code: 'unclassified' | 'no-board-id' | 'bound-device-differs'; readonly reason: string };

/**
 * May the user use `machine` with the connected board? An unbound machine
 * may (the connect binds it); a machine bound to another board, or to
 * another family, is a hard block.
 */
export function checkSelection(board: ProbedBoard, machine: MachineCandidate): SelectionCheck {
  if (board.dialectId === null) return Object.freeze({ ok: false, code: 'unclassified', reason: 'The board is not identified, so no machine can be chosen for it.' });
  if (board.id === undefined) return Object.freeze({ ok: false, code: 'no-board-id', reason: 'The board reported no id, so it cannot be bound to a machine.' });
  if (machine.boundDevice === null) return Object.freeze({ ok: true, binds: true });
  if (matchesBoard(board, machine)) return Object.freeze({ ok: true, binds: false });
  return Object.freeze({
    ok: false,
    code: 'bound-device-differs',
    reason: `This machine is bound to board ${machine.boundDevice.id} (${machine.boundDevice.family}); the connected board is ${board.id} (${familyOfDialect(board.dialectId)}).`,
  });
}
