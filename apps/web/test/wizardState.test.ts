import { describe, expect, it } from 'vitest';
import { EMPTY_SETUP_RECORD } from '@synthetos/library';
import { currentStep, markDone, NEXT_LABEL, railMarks, skip, STEPS, wizardOpen, type StepId } from '../src/wizard/wizardState.ts';

const base = { record: null, machines: 0, refreshed: true, account: true };

describe('wizardOpen (R1)', () => {
  it('opens only when signed in, after the first read, with zero machines and not dismissed', () => {
    expect(wizardOpen('open', base)).toBe(true);
    expect(wizardOpen('sign-in', base)).toBe(false);
    expect(wizardOpen('checking', base)).toBe(false);
    expect(wizardOpen('open', { ...base, refreshed: false })).toBe(false);
    expect(wizardOpen('open', { ...base, machines: 1 })).toBe(false);
    expect(wizardOpen('open', { ...base, account: false })).toBe(false);
    expect(wizardOpen('open', { ...base, record: { ...EMPTY_SETUP_RECORD, dismissed: true } })).toBe(false);
    expect(wizardOpen('open', { ...base, record: { ...EMPTY_SETUP_RECORD, step: 5 } })).toBe(true);
  });
  it('a wizard that was started stays open after step 2 saved the machine, and resumes on another browser', () => {
    expect(wizardOpen('open', { ...base, machines: 1, record: { ...EMPTY_SETUP_RECORD, step: 3, done: [1, 2] } })).toBe(true);
    expect(wizardOpen('open', { ...base, machines: 1, record: { ...EMPTY_SETUP_RECORD, step: 3, dismissed: true } })).toBe(false);
  });
  it('"Run setup again" (a record back at step 1, not dismissed) opens it for an account that has machines', () => {
    expect(wizardOpen('open', { ...base, machines: 2, record: { ...EMPTY_SETUP_RECORD, step: 1, done: [] } })).toBe(true);
    // A legacy account with machines and no record never sees it uninvited.
    expect(wizardOpen('open', { ...base, machines: 2, record: null })).toBe(false);
  });
});

describe('steps and progress', () => {
  it('seven steps; 1 and 7 are not skippable, the other five are', () => {
    expect(STEPS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(STEPS.map((s) => s.skippable)).toEqual([false, true, true, true, true, true, false]);
    expect(STEPS.map((s) => s.label)).toEqual(['Welcome', 'Machine', 'Firmware', 'Homing', 'Tools', 'Project', 'Done']);
  });
  it('markDone adds the step and advances; the last step stays 7 and done never repeats', () => {
    expect(markDone({ ...EMPTY_SETUP_RECORD, step: 2, done: [1] }, 2)).toEqual({ step: 3, done: [1, 2] });
    expect(markDone({ ...EMPTY_SETUP_RECORD, step: 7, done: [1, 2, 3, 4, 5, 6] }, 7)).toEqual({ step: 7, done: [1, 2, 3, 4, 5, 6, 7] });
    expect(markDone({ ...EMPTY_SETUP_RECORD, step: 3, done: [1, 2, 3] }, 3)).toEqual({ step: 4, done: [1, 2, 3] });
  });
  it('skip advances without marking done', () => {
    expect(skip({ ...EMPTY_SETUP_RECORD, step: 4, done: [1, 2] }, 4)).toEqual({ step: 5 });
    expect(skip({ ...EMPTY_SETUP_RECORD, step: 7, done: [] }, 7)).toEqual({ step: 7 });
  });
  it('railMarks: done steps, the current one, the rest later', () => {
    expect(railMarks({ ...EMPTY_SETUP_RECORD, step: 3, done: [1, 2] })).toEqual(['done', 'done', 'current', 'later', 'later', 'later', 'later']);
    expect(railMarks(null)).toEqual(['current', 'later', 'later', 'later', 'later', 'later', 'later']);
    // A skipped step stays hollow behind the current one.
    expect(railMarks({ ...EMPTY_SETUP_RECORD, step: 4, done: [1, 2] })).toEqual(['done', 'done', 'later', 'current', 'later', 'later', 'later']);
  });
  it('currentStep clamps to 1..7 and reads 1 without a record', () => {
    expect(currentStep(null)).toBe(1);
    expect(currentStep({ ...EMPTY_SETUP_RECORD, step: 5 })).toBe(5);
    expect(currentStep({ ...EMPTY_SETUP_RECORD, step: 12 })).toBe(7);
    expect(currentStep({ ...EMPTY_SETUP_RECORD, step: -2 })).toBe(1);
  });
  it('the primary label per step', () => {
    const labels = ([1, 2, 3, 4, 5, 6, 7] as StepId[]).map((s) => NEXT_LABEL[s]);
    expect(labels).toEqual(['Set up my machine', 'Next: firmware', 'Next: homing', 'Next: tools', 'Next: project', 'Open project', 'Go to the Job page']);
  });
});
