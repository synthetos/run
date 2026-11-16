import { reduceOverrides } from './overrides/reducer.ts';
import type { OverrideState } from './overrides/model.ts';
import { overrideWrite } from './overrides/policy.ts';
/** Workspace-only control behavior; never imported by the open firmware entry. */
import { initialState } from './reducer.ts';
import { snapshotOf } from './snapshot.ts';
import { checkWrite } from './writePolicy.ts';
import type { SessionRuntime } from './sessionRuntime.ts';
import type { QueuedLine } from './sessionRuntime.ts';
export const workspaceRuntime: SessionRuntime = {
  initialState, reduce: reduceOverrides, snapshotOf,
  checkLine: (current, emitted, release, item) => item.jobRuntime === true && (emitted as OverrideState).overrides?.pending === new TextDecoder().decode(item.bytes).trim()
    ? overrideWrite(current, emitted, release, item)
    : item.motion !== undefined
    ? checkWrite(current, emitted, release, item.bytes, 'motion', item.motion)
    : item.job !== undefined
      ? checkWrite(current, emitted, release, item.bytes, 'jobLine', undefined, item.job)
      : checkWrite(current, emitted, release, item.bytes, writeIntentOf(item)),
  checkRealtime: (current, release, bytes, name, issuedBy) => checkWrite(current, current, release, bytes, name, issuedBy),
};

function writeIntentOf(item: QueuedLine): 'settingsWrite' | 'configureReports' | 'lineMode' | 'jobRuntime' | 'flash' | 'read' {
  if (item.boot === true) return 'flash';
  if (item.setting === true) return 'settingsWrite';
  if (item.report === true) return 'configureReports';
  if (item.lineMode === true) return 'lineMode';
  if (item.jobRuntime === true) return 'jobRuntime';
  return 'read';
}

