import {
  type Dialect,
  type Response
} from '@synthetos/protocol';
import { allowed, type Decision } from '@synthetos/safety';
import type { PortSelector } from '../../transport.ts';
import { restingUsesHold } from '../resting.ts';
import { gateTokens, judgeGate } from '../settingWrite.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function refuseBoot(t: Tx, why: string, _deps: ReducerDeps): void {
  t.set({ bootEntry: null, queue: t.s.queue.filter((q) => q.purpose !== 'bootGate' && q.purpose !== 'boot'), notices: { ...t.s.notices, bootRefused: why } });
  t.emit({ kind: 'log', text: `bootloader entry refused: ${why}` });
}

/**
 * `flash`: the idle gate (polled `stat`, `hold` where trusted, `vel`, `qr`), then `{"boot":1}`. The firmware
 * answers, then resets into xboot (a 60 s window); the session closes the link as soon as the line is written
 * and returns to NOT_CONNECTED, so the flasher can open the same port in bootloader role. Allowed by the matrix
 * row of kind `flash` (the flasher phase switch); the session also needs a classified TinyG dialect, no job, no
 * move and no settings write in progress.
 */
export function onFlash(t: Tx, matrix: Decision, deps: ReducerDeps): void {
  const { dialectOf, BOOT_DIALECTS, deny, settingWriteActive } = deps;
  const dialect = dialectOf(t.s);
  if (dialect === null || !BOOT_DIALECTS.includes(dialect.id)) {
    t.decide('flash', deny('This board was not identified as a TinyG, so run does not ask it to enter its bootloader.', 'Use recovery: unplug the USB cable and plug it back in while run waits for the bootloader.', 'SAFETY §4.8 (amended 2026-11-03); OLD-S §4.8 step 1'));
    return;
  }
  if (t.s.bootEntry !== null) {
    t.decide('flash', deny('The board is already being asked to enter its bootloader.', 'Wait for it.', 'SAFETY §4.8'));
    return;
  }
  if (settingWriteActive(t.s) || t.s.motion !== null || t.s.job !== null) {
    t.decide('flash', deny('Something else is in progress: a move, a job or a settings write.', 'Wait for it to finish, and unload the job.', 'SAFETY §4.1 Flash row; §4.8'));
    return;
  }
  const tokens = gateTokens(dialect, restingUsesHold(dialect)).filter((tok) => tok !== 'unit');
  const { bootRefused: _old, ...notices } = t.s.notices;
  t.set({ bootEntry: { phase: 'gate', gate: {} }, notices, queue: [...tokens.map((token) => ({ token, purpose: 'bootGate' as const })), ...t.s.queue] });
  t.emit({ kind: 'log', text: `bootloader entry: idle gate (${tokens.join(' ')})` });
  t.decide('flash', matrix);
}

export function onBootGateAnswer(t: Tx, message: { token: string; r: Response; }, deps: ReducerDeps): void {
  const { token, r } = message;
  const { refuseBoot, withNumber, dialectOf, matrixSnapshot } = deps;
  const b = t.s.bootEntry;
  /* c8 ignore next -- gate reads are queued only by an entry in its gate phase, and dropped when it ends */
  if (b === null || b.phase !== 'gate') return;
  const value = r.r[token];
  if (r.footer.status !== 0 || typeof value !== 'number' || !Number.isFinite(value)) {
    refuseBoot(t, `the board did not answer the ${token} read (status ${r.footer.status})`);
    return;
  }
  const gate = { ...b.gate, [token]: value };
  t.set({ bootEntry: { ...b, gate }, live: withNumber(t, t.s.live, token, value) });
  if (t.s.queue.some((q) => q.purpose === 'bootGate')) return;
  const dialect = dialectOf(t.s) as Dialect;
  // The settings gate's rule without the units (the bootloader does not care whether the board works in inches).
  if (t.s.dwellWait != null) {
    refuseBoot(t, 'the dwell has not been confirmed finished');
    return;
  }
  const verdict = judgeGate(dialect, { ...gate, unit: 1 }, restingUsesHold(dialect));
  if (!verdict.ok) {
    refuseBoot(t, verdict.detail.replace('Not written: ', '').replace(', with nothing queued and in millimetres', ', with nothing queued'));
    return;
  }
  const again = allowed(matrixSnapshot(t.s), 'flash', t.config.release);
  /* c8 ignore next 4 -- an overlay that denies the entry (FAULT, LOST) also ends it before the gate completes; the re-check stays */
  if (!again.allowed) {
    refuseBoot(t, again.reason);
    return;
  }
  t.set({ bootEntry: { phase: 'writing', gate }, queue: [{ token: 'boot', purpose: 'boot' }, ...t.s.queue] });
}

/** `{"boot":1}` was written: the board resets now. Close the link and leave the port to the flasher. */
export function onBootWritten(t: Tx, at: number, deps: ReducerDeps): void {
  const { resetToNotConnected } = deps;
  const port = t.s.port as PortSelector;
  const boardId = typeof t.s.identity?.id === 'string' ? t.s.identity.id : null;
  t.emit({ kind: 'log', text: 'bootloader entry: {"boot":1} written; the board resets into its bootloader; the link closes' });
  t.emit({ kind: 'close', epoch: t.s.epoch });
  // The board resets: position, homing and every RAM setting are gone. The next connect starts in UNKNOWN.
  resetToNotConnected(t, true);
  t.set({ notices: { ...t.s.notices, bootloaderEntered: { at, port, boardId } } });
}

/** An entry in progress is cut off (FAULT, LOST, reset). */
export function interruptBootEntry(t: Tx, why: string, deps: ReducerDeps): void {
  const { refuseBoot } = deps;
  if (t.s.bootEntry === null) return;
  refuseBoot(t, why);
}

export function bindBoot(deps: ReducerDeps): Pick<ReducerDeps, 'refuseBoot' | 'onFlash' | 'onBootGateAnswer' | 'onBootWritten' | 'interruptBootEntry'> {
  return {
    refuseBoot: (t, why) => refuseBoot(t, why, deps),
    onFlash: (t, matrix) => onFlash(t, matrix, deps),
    onBootGateAnswer: (t, token, r) => onBootGateAnswer(t, { token: token, r: r }, deps),
    onBootWritten: (t, at) => onBootWritten(t, at, deps),
    interruptBootEntry: (t, why) => interruptBootEntry(t, why, deps),
  };
}
