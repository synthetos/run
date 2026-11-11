/**
 * What Stop job does is said the same way in the strip's tooltip and on the Safety view (first-time walk
 * 2026-11-08, S4): with motion control it clears the queue and turns the spindle and coolant off; on a
 * read-only connection it is a feedhold that leaves the spindle as it is.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { STOP_JOB_PHASE1, STOP_JOB_PHASE2, stopJobSafetyText } from '../src/workspace/stopJobText.ts';
import { STOP_JOB_PHASE1 as STRIP_PHASE1, STOP_JOB_PHASE2 as STRIP_PHASE2 } from '../src/workspace/MachineStrip.ts';
import { SafetyView } from '../src/workspace/views/OtherViews.ts';
import { createWorkspaceModel, INITIAL_LIVE_VIEW, type LiveView } from '../src/workspace/model.ts';
import { snap } from './jobFixtures.ts';

function modelWith(motion: boolean): ReturnType<typeof createWorkspaceModel> {
  const model = createWorkspaceModel();
  model.live.value = { ...INITIAL_LIVE_VIEW, message: { v: 3, kind: 'snapshot', snapshot: snap(), motion, jobs: motion } as unknown as LiveView['message'] };
  return model;
}

describe('Stop job, said once (S4)', () => {
  it('the strip uses the same sentences', () => {
    expect(STRIP_PHASE1).toBe(STOP_JOB_PHASE1);
    expect(STRIP_PHASE2).toBe(STOP_JOB_PHASE2);
  });
  it('with motion control the Safety view says the queue is cleared and the spindle and coolant turned off', () => {
    const html = renderToString(h(SafetyView, { model: modelWith(true) }));
    expect(html).toContain('clears the queue, and turns the spindle and coolant off');
    expect(html).not.toContain('sends a feedhold');
  });
  it('on a read-only connection it says feedhold, spindle left on', () => {
    const html = renderToString(h(SafetyView, { model: modelWith(false) }));
    expect(html).toContain('sends a feedhold, like Pause');
    expect(html).not.toContain('clears the queue');
  });
  it('with no connection (and prerendered) it says both, and that neither is an emergency stop', () => {
    const text = stopJobSafetyText(false, false);
    expect(text).toContain('clears the queue, and turns the spindle and coolant off');
    expect(text).toContain('sends a feedhold');
    expect(text).toContain('E-stop');
    expect(renderToString(h(SafetyView, { model: null }))).toContain('What Stop job does depends on the connection.');
  });
});

 it('450.04 read-only Stop does not promise unchanged outputs', () => {
  expect(stopJobSafetyText(true, false, true)).toContain('may pause');
  expect(stopJobSafetyText(true, false, true)).not.toContain('keep running');
  expect(stopJobSafetyText(true, true, true)).toContain('clears the queue');
});
