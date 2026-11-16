import { type Decision } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import {
  MAX_QUEUED_READS
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function onEnq(t: Tx, matrix: Decision, deps: ReducerDeps): void {
  const { deny, enqByte, writeEnq } = deps;
  if (t.s.enqOutstanding) {
    t.decide('enq', deny('A liveness probe is already outstanding.', 'Wait for its answer.', 'SAFETY §4.2 (at most one ENQ outstanding)'));
    return;
  }
  const byte = enqByte(t.s);
  if (byte === undefined) {
    t.decide('enq', deny('ENQ is sent only to classified edge-next after a revision 2 or 3 footer.', 'Nothing to do.', 'SAFETY §4.1 Liveness probe row; T-S24b; PN §2.3'));
    return;
  }
  writeEnq(t, byte);
  t.decide('enq', matrix);
}

export function writeEnq(t: Tx, byte: number, _deps: ReducerDeps): void {
  t.set({ enqOutstanding: true, sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name: 'enq', byte });
}

export function onRead(t: Tx, message: { tokens: readonly string[]; matrix: Decision; }, deps: ReducerDeps): void {
  const { tokens, matrix } = message;
  const { dialectOf, deny } = deps;
  const dialect = dialectOf(t.s);
  if (t.s.base === 'BLOCKED') {
    t.decide('read', deny('This board is not the machine you selected, so nothing is sent to it.', 'Choose the right machine, or disconnect.', 'T-S21; SAFETY §3 BLOCKED'));
    return;
  }
  if (dialect === null || t.s.base === 'IDENTIFYING') {
    t.decide('read', deny('Reads are sent only once the board is classified and its read allowlist is known.', 'Wait for the board to be identified.', 'SAFETY H37; PN §12.3'));
    return;
  }
  if (!Array.isArray(tokens) || tokens.length === 0) {
    t.decide('read', deny('Nothing to read.', 'Name at least one setting.', 'SAFETY H37'));
    return;
  }
  const refused = tokens.filter((tok) => typeof tok !== 'string' || !isReadAllowed(dialect.id, tok, t.s.identity?.fb));
  if (refused.length > 0) {
    const shown = refused.slice(0, 5).map((r) => JSON.stringify(typeof r === 'string' ? r.slice(0, 16) : String(r)));
    t.decide('read', deny(`Not on the ${dialect.id} read allowlist: ${shown.join(', ')}.`, 'Only allowlisted settings can be read.', 'SAFETY H37; PN §12.3; T-S38'));
    return;
  }
  const fresh = [...new Set(tokens)].filter((tok) => !t.s.queue.some((q) => q.token === tok && q.purpose === 'request'));
  if (t.s.queue.length + fresh.length > MAX_QUEUED_READS) {
    t.decide('read', deny('Too many reads are waiting.', 'Wait for the current reads to finish.', 'ROADMAP P1-02'));
    return;
  }
  t.set({ queue: [...t.s.queue, ...fresh.map((token) => ({ token, purpose: 'request' as const }))] });
  t.decide('read', matrix);
}

export function bindReads(deps: ReducerDeps): Pick<ReducerDeps, 'onEnq' | 'writeEnq' | 'onRead'> {
  return {
    onEnq: (t, matrix) => onEnq(t, matrix, deps),
    writeEnq: (t, byte) => writeEnq(t, byte, deps),
    onRead: (t, tokens, matrix) => onRead(t, { tokens: tokens, matrix: matrix }, deps),
  };
}
