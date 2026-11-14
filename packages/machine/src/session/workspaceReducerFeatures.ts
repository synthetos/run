/** Workspace-only extensions to the connection/read/restore reducer. */
import type { ReducerFeatures } from './reducerCore.ts';
import { onAlarmRestoreAnswered, onAlarmRestoreMissed } from './alarmRestore.ts';
import { onTypedReadsIn, startTypedMove } from './typedMove.ts';
import { POLL_TOKENS, abandonMotion, checkAlarm, idleBase, motionCapable, onFollowUp, onMotionAnswer, onMotionIntent, onMotionReport, onMotionStop, onMotionTimer, onPollDone } from './motion.ts';
import {
  abandonLoad,
  maybeRestoreLineMode,
  onFeedLimit,
  onJobAnswer,
  onJobBreakpoints,
  onJobFault,
  onJobLinkLost,
  onJobMotionAnswer,
  onJobMotionTimeout,
  onJobPause,
  onJobPoll,
  onJobPrepAnswer,
  onJobReset,
  onJobResume,
  onJobRuntimeAnswer,
  onJobStop,
  onJobTimer,
  onLineModeAnswer,
  onLineModeMemory,
  onLoadJob,
  onStartJob,
  pumpJob,
  rxmLine,
} from './job.ts';
import { jobActive, patchJob } from './jobState.ts';
import { completedPoll } from './motion.ts';
import { maybeRereadOffsets } from './jobOffsets.ts';
import { onProbeIntent, probeRefusal } from './probe/intents.ts';
import { onProbeAlarm, onProbeAnswer, onProbePoll, onProbeReport, onProbeTimer } from './probe/run.ts';
import { abandonProbe, onProbeGarbled, onProbeLineDropped, onProbeMissed, onProbeStop } from './probe/stops.ts';
import { probeCarried, probeSeedReads, syncProbe } from './probe/sync.ts';
export const workspaceReducerFeatures: ReducerFeatures = { onAlarmRestoreAnswered, onAlarmRestoreMissed, onTypedReadsIn, startTypedMove, POLL_TOKENS, abandonMotion, checkAlarm, idleBase, motionCapable, onFollowUp, onMotionAnswer, onMotionIntent, onMotionReport, onMotionStop, onMotionTimer, onPollDone, abandonLoad, maybeRestoreLineMode, onFeedLimit, onJobAnswer, onJobBreakpoints, onJobFault, onJobLinkLost, onJobMotionAnswer, onJobMotionTimeout, onJobPause, onJobPoll, onJobPrepAnswer, onJobReset, onJobResume, onJobRuntimeAnswer, onJobStop, onJobTimer, onLineModeAnswer, onLineModeMemory, onLoadJob, onStartJob, pumpJob, rxmLine, jobActive, patchJob, completedPoll, maybeRereadOffsets, onProbeIntent, probeRefusal, onProbeAlarm, onProbeAnswer, onProbePoll, onProbeReport, onProbeTimer, abandonProbe, onProbeGarbled, onProbeLineDropped, onProbeMissed, onProbeStop, probeCarried, probeSeedReads, syncProbe };
