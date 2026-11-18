import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_SETUP_RECORD } from '@synthetos/library';
import { emptyCache, type CloudCache } from '../src/workspace/cloud/cloudCache.ts';
import { connectSetup } from '../src/workspace/cloud/setupSync.ts';
import { closeSetup, finishStep, restartSetup, skipStep } from '../src/wizard/setupActions.ts';
import { record } from './syncFixtures.ts';

let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; });
const hooks = { persist: () => true, change: () => undefined };
function account(step: number, done: number[]): CloudCache {
  const cache = emptyCache();
  const content = { ...EMPTY_SETUP_RECORD, step, done };
  cache.records = [record('setup', content, 2)];
  stop = connectSetup(cache, hooks).stop;
  return cache;
}

describe('setup actions', () => {
  it('finishStep marks the step done, advances and carries the patch', () => {
    const cache = account(2, [1]);
    finishStep(2, { machineId: 'm-1' });
    expect(cache.pending[0]).toMatchObject({ kind: 'setup', content: { step: 3, done: [1, 2], machineId: 'm-1' } });
  });
  it('skipStep advances and leaves done alone', () => {
    const cache = account(3, [1, 2]);
    skipStep(3);
    expect(cache.pending[0]).toMatchObject({ content: { step: 4, done: [1, 2] } });
  });
  it('closeSetup dismisses and keeps the progress', () => {
    const cache = account(5, [1, 2, 3, 4]);
    closeSetup();
    expect(cache.pending[0]).toMatchObject({ content: { dismissed: true, step: 5, done: [1, 2, 3, 4] } });
  });
  it('restartSetup brings it back at step 1 with nothing done', () => {
    const cache = account(7, [1, 2, 3, 4, 5, 6, 7]);
    restartSetup();
    expect(cache.pending[0]).toMatchObject({ content: { dismissed: false, step: 1, done: [] } });
  });
  it('without an account the actions write nothing', () => {
    const cache = emptyCache();
    finishStep(1);
    expect(cache.pending).toEqual([]);
  });
});
