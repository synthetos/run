/**
 * The write gate's check for the two mode lines the session issues on its own (OD-19, 2026-11-08): a job's start
 * modes (`jobModes`, PREAMBLE only) and the `G90` after a Clear alarm (`alarmRestore`). Each is admitted only as the
 * exact line the session planned in the state the write happens in; anything else from those intents is a bug and
 * refused (writePolicy.ts makes that a FAULT).
 */
import type { Intent } from '@synthetos/safety';
import { alarmRestoreWritableIn } from './alarmRestore.ts';
import { jobModesWritableIn } from './jobModes.ts';
import type { SessionState } from './types.ts';

/** Why `bytes` from `intent` may not be written in `state`, or undefined (any other intent: no opinion). */
export function ownModeLineRefusal(state: SessionState, intent: Intent, bytes: Uint8Array): string | undefined {
  if (intent !== 'jobModes' && intent !== 'alarmRestore') return undefined;
  const line = String.fromCharCode(...bytes).replace(/\n$/, '');
  if (intent === 'jobModes') return jobModesWritableIn(state, line) ? undefined : `${JSON.stringify(line)} is not the start-modes line of the job starting now`;
  return alarmRestoreWritableIn(state, line) ? undefined : `${JSON.stringify(line)} is not the restore a cleared alarm asks for`;
}
