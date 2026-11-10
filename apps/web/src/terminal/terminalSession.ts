/**
 * What the terminal reads from the session (H91): the translator's context, the modes in effect, a typed move's
 * outcome from the session's notice, and a read's answer as a transcript entry. Pure; the snapshot is the worker's.
 */
import type { SnapshotMessage } from '../machine-worker/rpc.ts';
import type { ConsoleAnswer } from '../live/consoleRead.ts';
import { jobStreaming } from '../live/consoleRead.ts';
import { allowedRead, readableTokens, replyRows, statusText } from '../console/words.ts';
import type { TerminalContext } from './translate.ts';
import type { BoardModes } from './preview.ts';
import type { TypedMoveNotice } from './format.ts';
import type { Entry } from './transcript.ts';

export type Snapshot = SnapshotMessage['snapshot'];

function scalar(s: Snapshot, token: string): number | undefined {
  const v = s.values[token];
  return v !== undefined && v.status === 0 && typeof v.value === 'number' ? v.value : undefined;
}

/** The translator's context for this snapshot (null: no board connected or classified). */
export function terminalContext(s: Snapshot | null): TerminalContext {
  const connected = s !== null && s.base !== 'NOT_CONNECTED';
  const dialect = connected ? (s.classification?.dialectId ?? null) : null;
  const coor = s?.live.coor;
  const feed = s === null ? undefined : scalar(s, 'feed');
  return {
    readDecision: dialect === null ? null : allowedRead(dialect),
    jobStreaming: jobStreaming(s),
    dialect,
    readable: readableTokens(dialect).map((t) => t.token),
    activeSystem: coor !== undefined && Number.isInteger(coor) && coor >= 1 && coor <= 6 ? coor : null,
    // The session decides again with a fresh read; here only to give the plain refusal before anything is sent.
    feedInEffect: feed !== undefined && feed > 0 && s !== null && scalar(s, 'unit') === 1,
  };
}

/** The board's modes as run knows them, for the line above the input. */
export function boardModes(s: Snapshot | null): BoardModes {
  return { units: s?.boardModes.units, dist: s?.boardModes.dist, coor: s?.live.coor };
}

/** A machine id for the history (per machine): the board's id, or one shared key before it is read. */
export function machineKey(s: Snapshot | null): string {
  const id = s?.identity?.id;
  return typeof id === 'string' && id !== '' ? id : 'default';
}

/** True while a typed move of this session runs (one line in flight). */
export function typedRunning(s: Snapshot | null): boolean {
  return s?.motion?.op === 'typed';
}

/**
 * The typed move's outcome, once the session has one for the line sent: the notice is new when it is not the one
 * that was there when the line was sent (the session clears it while a move runs). Null while waiting.
 */
export function typedOutcome(s: Snapshot | null, line: string, before: TypedMoveNotice | null): TypedMoveNotice | null {
  const n = s?.notices.typed ?? null;
  if (n === null || n.line !== line || (before !== null && n.at === before.at)) return null;
  return n;
}

/** A read's answer as one transcript entry: the words, and the raw JSON for the raw filter. */
export function readEntry(token: string, answer: ConsoleAnswer, dialect: string | null, at: number): Omit<Entry, 'id'> {
  if (!answer.ok) return { at, kind: 'error', text: answer.message };
  const rows = replyRows(token, answer.value, dialect);
  const words = rows.map((r) => `${r.label === '' ? r.key : `${r.label} (${r.key})`}: ${r.value}`).join(' · ');
  const text = answer.status === 0 ? words : `The board answered with ${statusText(answer.status)}. ${words}`;
  return { at, kind: 'reply', text, raw: answer.raw ?? JSON.stringify({ r: { [token]: answer.value } }) };
}
