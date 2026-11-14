/** Workspace hooks are mandatory at startup; the firmware reducer remains optional. */
import type { ReducerFeatures, WorkspaceReducerFeatures } from './reducerCore.ts';
export type { WorkspaceReducerFeatures } from './reducerCore.ts';

// Record forces this inventory to grow whenever ReducerFeatures gains a key.
const REQUIRED: Record<keyof WorkspaceReducerFeatures, true> = Object.freeze({
  onAlarmRestoreAnswered: true,
  onAlarmRestoreMissed: true,
  onTypedReadsIn: true,
  startTypedMove: true,
  POLL_TOKENS: true,
  abandonMotion: true,
  checkAlarm: true,
  idleBase: true,
  motionCapable: true,
  onFollowUp: true,
  onMotionAnswer: true,
  onMotionIntent: true,
  onMotionReport: true,
  onMotionStop: true,
  onMotionTimer: true,
  onPollDone: true,
  abandonLoad: true,
  maybeRestoreLineMode: true,
  onFeedLimit: true,
  onJobAnswer: true,
  onJobBreakpoints: true,
  onJobFault: true,
  onJobLinkLost: true,
  onJobMotionAnswer: true,
  onJobMotionTimeout: true,
  onJobPause: true,
  onJobPoll: true,
  onJobPrepAnswer: true,
  onJobReset: true,
  onJobResume: true,
  onJobRuntimeAnswer: true,
  onJobStop: true,
  onJobTimer: true,
  onLineModeAnswer: true,
  onLineModeMemory: true,
  onLoadJob: true,
  onStartJob: true,
  pumpJob: true,
  rxmLine: true,
  jobActive: true,
  patchJob: true,
  completedPoll: true,
  maybeRereadOffsets: true,
  onProbeIntent: true,
  probeRefusal: true,
  onProbeAlarm: true,
  onProbeAnswer: true,
  onProbePoll: true,
  onProbeReport: true,
  onProbeTimer: true,
  abandonProbe: true,
  onProbeGarbled: true,
  onProbeLineDropped: true,
  onProbeMissed: true,
  onProbeStop: true,
  probeCarried: true,
  probeSeedReads: true,
  syncProbe: true,
});
export const WORKSPACE_FEATURE_KEYS = Object.freeze(Object.keys(REQUIRED) as (keyof WorkspaceReducerFeatures)[]);

export function assertWorkspaceFeatures(features: ReducerFeatures): asserts features is WorkspaceReducerFeatures {
  for (const key of WORKSPACE_FEATURE_KEYS) {
    const value = features[key];
    const valid = key === 'POLL_TOKENS' ? Array.isArray(value) && value.length > 0 : typeof value === 'function';
    if (!valid) throw new Error(`Workspace session requires reducer feature ${key}`);
  }
}
