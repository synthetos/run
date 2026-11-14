import { expect, it, vi } from 'vitest';
import * as contract from '../src/session/workspaceFeatureContract.ts';
import { workspaceReducerFeatures } from '../src/session/workspaceReducerFeatures.ts';
import { MachineSession } from '../src/session/machineSession.ts';
import type { ReducerFeatures } from '../src/session/reducerCore.ts';

const EXPECTED = [
  'onAlarmRestoreAnswered',
  'onAlarmRestoreMissed',
  'onTypedReadsIn',
  'startTypedMove',
  'POLL_TOKENS',
  'abandonMotion',
  'checkAlarm',
  'idleBase',
  'motionCapable',
  'onFollowUp',
  'onMotionAnswer',
  'onMotionIntent',
  'onMotionReport',
  'onMotionStop',
  'onMotionTimer',
  'onPollDone',
  'abandonLoad',
  'maybeRestoreLineMode',
  'onFeedLimit',
  'onJobAnswer',
  'onJobBreakpoints',
  'onJobFault',
  'onJobLinkLost',
  'onJobMotionAnswer',
  'onJobMotionTimeout',
  'onJobPause',
  'onJobPoll',
  'onJobPrepAnswer',
  'onJobReset',
  'onJobResume',
  'onJobRuntimeAnswer',
  'onJobStop',
  'onJobTimer',
  'onLineModeAnswer',
  'onLineModeMemory',
  'onLoadJob',
  'onStartJob',
  'pumpJob',
  'rxmLine',
  'jobActive',
  'patchJob',
  'completedPoll',
  'maybeRereadOffsets',
  'onProbeIntent',
  'probeRefusal',
  'onProbeAlarm',
  'onProbeAnswer',
  'onProbePoll',
  'onProbeReport',
  'onProbeTimer',
  'abandonProbe',
  'onProbeGarbled',
  'onProbeLineDropped',
  'onProbeMissed',
  'onProbeStop',
  'probeCarried',
  'probeSeedReads',
  'syncProbe',
] as const;
it('pins every workspace feature and accepts the complete frozen implementation', () => {
  expect(contract.WORKSPACE_FEATURE_KEYS).toEqual(EXPECTED);
  expect(Object.keys(workspaceReducerFeatures).sort()).toEqual([...EXPECTED].sort());
  expect(Object.isFrozen(workspaceReducerFeatures)).toBe(true);
  expect(() => contract.assertWorkspaceFeatures(workspaceReducerFeatures)).not.toThrow();
});
it.each(EXPECTED)('rejects a missing %s before a workspace can start', key => {
  const partial: ReducerFeatures = { ...workspaceReducerFeatures };
  Reflect.deleteProperty(partial, key);
  expect(() => contract.assertWorkspaceFeatures(partial)).toThrow(key);
});
it('rejects malformed hook values and an empty poll inventory', () => {
  for (const value of [undefined, null, 1, []]) {
    const partial = { ...workspaceReducerFeatures, POLL_TOKENS: value } as unknown as ReducerFeatures;
    expect(() => contract.assertWorkspaceFeatures(partial)).toThrow('POLL_TOKENS');
  }
  expect(() => contract.assertWorkspaceFeatures({ ...workspaceReducerFeatures, onJobStop: 1 } as unknown as ReducerFeatures)).toThrow('onJobStop');
});
it('checks at construction before the executor can initialize or access a transport', () => {
  const check = vi.spyOn(contract, 'assertWorkspaceFeatures').mockImplementation(() => { throw new Error('startup completeness'); });
  try {
    // Invalid options deliberately prove the assertion precedes executor initialization.
    expect(() => new MachineSession(null as unknown as ConstructorParameters<typeof MachineSession>[0])).toThrow('startup completeness');
    expect(check).toHaveBeenCalledWith(workspaceReducerFeatures);
  } finally { check.mockRestore(); }
});
