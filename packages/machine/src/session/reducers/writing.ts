import {
  PROBE_STEPS
} from '@synthetos/protocol';
import { allowed, type Intent } from '@synthetos/safety';
import { getLineFor } from '@synthetos/schema';
import { JV_LINE, reportLineShape } from '../reports.ts';
import { settingLine, settingRefusal } from '../settingWrite.ts';
import {
  type PendingRead,
  type ReadPurpose,
  type SessionState
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function onLineWritten(t: Tx, at: number, deps: ReducerDeps): void {
  const { onBootWritten, answerTimeout } = deps;
  const { seq: _seq, ...line } = t.s.writing as PendingRead & { readonly seq: number; };
  t.set({ writing: null });
  if (line.purpose === 'boot') {
    onBootWritten(t, at);
    return;
  }
  // A line written while the board was resetting is lost with its RX ring: expect nothing for it.
  if (t.s.probe !== null && t.s.probe.settling !== 'none') return;
  t.set({ expected: [...t.s.expected, { ...line, late: false }] });
  t.arm('answer', answerTimeout(t, line.purpose));
}

export function answerTimeout(t: Tx, purpose: ReadPurpose, _deps: ReducerDeps): number {
  const timings = t.config.timings;
  if (purpose === 'splice') return timings.firstAnswerMs;
  if (purpose === 'probe') return timings.probeAnswerMs;
  return timings.readAnswerMs;
}

// --- Writing ----------------------------------------------------------------

/** Writes the next queued read when nothing is in flight and the matrix allows a read now. */
export function pump(t: Tx, deps: ReducerDeps): void {
  const { linkUp, matrixSnapshot, lineFor, enterFault } = deps;
  const s = t.s;
  if (s.writing !== null || s.queue.length === 0 || !linkUp(s)) return;
  // One line at a time, except job lines in line mode (H76): those are paced by the free slots (job.ts).
  if (s.expected.some((e) => !e.late && e.purpose !== 'job')) return;
  if (s.footerRev !== 3 && s.expected.some((e) => !e.late)) return;
  const next = s.queue[0] as PendingRead;
  const reportWrite = next.purpose === 'report' && s.reports.step?.line !== undefined;
  const lineModeWrite = next.purpose === 'lineMode' && next.value !== undefined;
  const ownLine = next.purpose === 'motion' || (next.purpose === 'probeZ' && next.line !== undefined);
  const intent = queuedIntent(next, { ownLine, reportWrite, lineModeWrite });
  if (!allowed(matrixSnapshot(s), intent, t.config.release).allowed) {
    dropRefused(t, { s, next, ownLine, reportWrite }, deps);
    return;
  }
  const line = lineFor(s, next);
  if (line === undefined) {
    t.set({ queue: s.queue.slice(1) });
    enterFault(t, 'writeRefused', 'integrity', `no allowlisted GET for ${JSON.stringify(next.token)} in this state`, s.live.lastRxAt ?? 0);
    return;
  }
  const seq = s.sent.lines + 1;
  t.set({ queue: s.queue.slice(1), writing: { ...next, seq }, sent: { ...s.sent, lines: seq } });
  t.emit({
    kind: 'writeLine',
    epoch: s.epoch,
    seq,
    token: next.token,
    line,
    ...writeMetadata(next, { ownLine, reportWrite, lineModeWrite, intent }),
  });
}

export function lineFor(s: SessionState, read: PendingRead, deps: ReducerDeps): string | undefined {
  const { features } = deps;
  if (read.purpose === 'motion' || (read.purpose === 'probeZ' && read.line !== undefined)) return read.line;
  /* c8 ignore start -- the queued setting line always matches the write in progress; any mismatch is a bug and becomes a writeRefused FAULT */
  if (read.purpose === 'setting') {
    return settingWriteLine(s, read, deps);
  }
  /* c8 ignore stop */
  if (read.purpose === 'lineMode' && read.value !== undefined) return features.rxmLine?.(read.value === 1 ? 1 : 0);
  if (read.purpose === 'jobRuntime') return read.line;
  return configuredLine(s, read, deps);
}

export function bindWriting(deps: ReducerDeps): Pick<ReducerDeps, 'onLineWritten' | 'answerTimeout' | 'pump' | 'lineFor'> {
  return {
    onLineWritten: (t, at) => onLineWritten(t, at, deps),
    answerTimeout: (t, purpose) => answerTimeout(t, purpose, deps),
    pump: (t) => pump(t, deps),
    lineFor: (s, read) => lineFor(s, read, deps),
  };
}

interface LineShape { ownLine: boolean; reportWrite: boolean; lineModeWrite: boolean; }
function queuedIntent(next: PendingRead, shape: LineShape): Intent {
  const { ownLine, reportWrite, lineModeWrite } = shape;
  return ownLine
    ? (next.intent as Intent)
    : next.purpose === 'setting'
      ? 'settingsWrite'
      : reportWrite
        ? 'configureReports'
        : lineModeWrite
          ? 'lineMode'
          : next.purpose === 'jobRuntime'
            ? 'jobRuntime'
            : next.purpose === 'boot'
              ? 'flash'
              : 'read';
}

function dropRefused(t: Tx, message: { s: SessionState; next: PendingRead; ownLine: boolean; reportWrite: boolean; }, deps: ReducerDeps): void {
  const { s, next, ownLine, reportWrite } = message;
  const { finishSettingWrite, failReports, features } = deps;
  // A motion line or a settings write the matrix no longer allows (the state changed since it was queued) is dropped, never held.
  /* c8 ignore next -- a safety net: every state change that ends motion (STALE, FAULT, LOST, ALARM) empties the motion queue first */
  if (next.purpose === 'motion') t.set({ queue: s.queue.slice(1) });
  /* c8 ignore next -- a setting line is queued in the same transition the matrix allowed it */
  if (next.purpose === 'setting') finishSettingWrite(t, 'refused', 'Not written: the machine is no longer in a state that allows settings writes.');
  /* c8 ignore next -- a report step is queued in the transition maybeConfigure checked the matrix, and an overlay that denies it also fails the configuration first */
  if (reportWrite) failReports(t, 'the machine is no longer in a state that allows report configuration');
  // Probe Z: its line is dropped, never held; the probe says what that means (an alarm, STALE).
  if (next.purpose === 'probeZ' && ownLine) features.onProbeLineDropped?.(t, next.line as string, s.live.lastRxAt as number);
  return;
}

function writeMetadata(next: PendingRead, shape: LineShape & { intent: Intent; }) {
  const { ownLine, reportWrite, lineModeWrite, intent } = shape;
  return (ownLine
    ? { motion: { intent } }
    : next.purpose === 'setting'
      ? { intent: 'settingsWrite' as const }
      : reportWrite || next.purpose === 'normalize'
        ? { intent: 'configureReports' as const }
        : lineModeWrite
          ? { intent: 'lineMode' as const }
          : next.purpose === 'jobRuntime'
            ? { intent: 'jobRuntime' as const }
            : next.purpose === 'boot'
              ? { intent: 'flash' as const }
              : {});
}

function settingWriteLine(s: SessionState, read: PendingRead, deps: ReducerDeps): string | undefined {
  const { dialectOf } = deps;
  /* c8 ignore start -- moved with the defensive setting-line checks from lineFor above */
  const w = s.settingWrite;
  const dialect = dialectOf(s);
  if (w === null || w.phase !== 'writing' || w.key !== read.token || w.value !== read.value || dialect === null) return undefined;
  if (settingRefusal(dialect.id, w.key, w.value, s.values, s.identity?.fb) !== null) return undefined;
  return settingLine(w.key, w.value) ?? undefined;
  /* c8 ignore stop */
}

function configuredLine(s: SessionState, read: PendingRead, deps: ReducerDeps): string | undefined {
  const { dialectOf, BOOT_LINE, readableNow } = deps;
  // OD-14: identification needs it, so it goes out under the probe's own gate; the write policy admits exactly this line, only while it is in flight.
  /* c8 ignore next -- the jv line is queued in the same transition that sets normalizing */
  if (read.purpose === 'normalize') return s.probe?.normalizing === true ? JV_LINE : undefined;
  /* c8 ignore next -- the boot line is queued only when the entry passes its gate, in the same transition */
  if (read.purpose === 'boot') return s.bootEntry?.phase === 'writing' ? BOOT_LINE : undefined;
  if (read.purpose === 'report' && s.reports.step?.line !== undefined) {
    const line = s.reports.step.line;
    /* c8 ignore next -- the steps are built from the shapes the gate admits; a mismatch is a bug and becomes a writeRefused FAULT */
    return reportLineShape(line) ? line : undefined;
  }
  if (!readableNow(s, read.token)) return undefined;
  const dialect = dialectOf(s);
  if (dialect === null) return PROBE_STEPS.find((step) => step.key === read.token)?.line;
  return getLineFor(dialect.id, read.token, s.identity?.fb);
}
