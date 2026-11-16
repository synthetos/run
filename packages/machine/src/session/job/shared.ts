import { type Dialect, type JsonValue } from '@synthetos/protocol';
import {
  type Decision,
  type Intent
} from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import { restartDwellWait } from '../dwell.ts';
import { jobEvent, patchJob } from '../jobState.ts';
import { idleBase, motionCapable } from '../motion.ts';
import type { JobState, PendingRead, SessionConfig, SessionState } from '../types.ts';
import { type JobLayerTx } from './contract.ts';
import { JOB_DIALECTS, JOB_PREP_TOKENS } from './limits.ts';

export const ALLOWED: Decision = Object.freeze({ allowed: true });

export function deny(reason: string, remedy: string): Decision {
  return { allowed: false, reason, remedy, citation: 'SAFETY §4.4a' };
}

/** True when this session may run jobs: a jobs release, a motion-capable approved board, a dialect with line mode. */
export function jobsCapable(s: SessionState, config: SessionConfig): boolean {
  return config.release.jobs === true && motionCapable(s, config) && s.dialect !== null && JOB_DIALECTS.has(s.dialect.id);
}

export function dialect(s: SessionState): Dialect {
  return s.dialect as Dialect;
}

export function job(s: SessionState): JobState {
  return s.job as JobState;
}

/** One written line queued as a control or motion read (one at a time, like every other line). */
export function queue(t: JobLayerTx, entry: PendingRead): void {
  t.set({ queue: [...t.s.queue, entry] });
}

/**
 * A realtime byte of the job layer. The job's `~` is checked against `jobLine` (allowed in RUNNING): the base is
 * RUNNING again in the transition that asks for it, and the byte is written right after.
 */
export function writeRealtime(t: JobLayerTx, name: 'feedhold' | 'resume', intent: Intent): void {
  restartDwellWait(t);
  const realtime = dialect(t.s).realtime;
  const byte = name === 'feedhold' ? realtime.feedhold.byte : realtime.resume.byte;
  t.set({ sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name, byte, intent });
}

export function numberOf(v: JsonValue | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** A Start that ends before anything of the job was sent: back to idle, the reason said. */
export function startFailed(t: JobLayerTx, at: number, text: string): void {
  t.cancel('job');
  t.set({ base: idleBase(t.s), queue: t.s.queue.filter((q) => q.purpose !== 'jobPrep') });
  patchJob(t, { phase: 'failed', message: text, endedAt: at });
  jobEvent(t, at, 'error', text);
}

/** The prep reads (JOB_PREP_TOKENS through the read allowlist): taken at load, and again at Start (R3). */
export function prepReads(s: SessionState): PendingRead[] {
  return JOB_PREP_TOKENS.filter((tok) => isReadAllowed(dialect(s).id, tok)).map((token) => ({ token, purpose: 'jobPrep' as const }));
}

export function dataSettled(s: SessionState): boolean {
  return !s.queue.some((q) => q.purpose === 'motion') && s.writing?.purpose !== 'motion' && !s.expected.some((e) => !e.late && e.purpose === 'motion');
}
