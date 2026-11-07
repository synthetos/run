/**
 * Probe Z, step 2: the touch test, every time (SAFETY §4.5c, H90). Each mark fills in from the board's reading only:
 * not touching, then touching while the owner holds the plate to the tool, then not touching again. It proves the
 * lead at that moment only. Reads only; the session refuses jog from here until the result.
 */
import { h, type ComponentChild } from 'preact';
import type { ProbeSnapshot } from '@synthetos/machine';
import { Icon } from '../icons.ts';
import { focusOnMount } from '../ui.ts';
import { InputReading } from './InputReading.ts';
import { ProbeCard } from './ProbeCard.ts';

export interface ProbeTouchProps {
  readonly input: ProbeSnapshot['input'];
  readonly touch: ProbeSnapshot['touch'];
  readonly advanced: boolean;
  readonly onContinue: () => void;
  readonly onRetest: () => void;
  readonly onCancel: () => void;
}

const PROBLEM: Readonly<Record<NonNullable<ProbeSnapshot['touch']['problem']>, string>> = {
  startedTouching: 'The input reads touching with nothing touching it. Check that the plate isn’t against the tool, and check the lead and clip.',
  noChange: 'The input didn’t change. Check the lead and its clip, and that the plate is the one connected to the board.',
  timedOut: 'The touch test timed out. Test again.',
};

/** The test passed: all three readings, in order, and no problem. */
export function touchPassed(touch: ProbeSnapshot['touch']): boolean {
  return touch.sawClear && touch.sawTouching && touch.sawReleased && touch.problem === null;
}

function mark(done: boolean, label: string, attr: string): ComponentChild {
  return h('li', { class: done ? 'done' : undefined, 'data-touch': attr, 'data-done': done ? 'true' : 'false' }, h('span', { class: 'probe-mark', 'aria-hidden': 'true' }, done ? Icon('check', 14) : null), h('span', null, label), done ? h('span', { class: 'sr-only' }, ' (done)') : null);
}

export function ProbeTouch(props: ProbeTouchProps): ComponentChild {
  const { touch, input } = props;
  const unreadable = input === null || input.reading === null || input.reading === 'disabled';
  const passed = touchPassed(touch) && !unreadable;
  const problem = touch.problem === null ? null : PROBLEM[touch.problem];
  return h(
    ProbeCard,
    { title: 'Touch test', stage: 'touch', step: 'touch' },
    h(InputReading, { input, advanced: props.advanced }),
    h('ol', { class: 'probe-marks' }, mark(touch.sawClear, 'Reads not touching', 'clear'), mark(touch.sawTouching, 'Touch the plate to the tool', 'touching'), mark(touch.sawReleased, 'Let go', 'released')),
    unreadable ? h('p', { class: 'probe-error', role: 'alert' }, 'Run can’t read the probe input.') : null,
    problem === null ? null : h('p', { class: 'probe-error', role: 'alert', 'data-touch-problem': touch.problem }, problem),
    passed ? h('p', { class: 'probe-ok', role: 'status' }, 'Touch test passed. The lead worked just now. Set the plate on the work under the tool.') : null,
    h(
      'div',
      { class: 'probe-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'probe-cancel', ref: focusOnMount, onClick: props.onCancel }, 'Cancel'),
      problem === null ? null : h('button', { type: 'button', class: 'small', 'data-action': 'probe-retest', onClick: props.onRetest }, 'Test again'),
      passed ? h('button', { type: 'button', class: 'small primary', 'data-action': 'probe-continue', onClick: props.onContinue }, 'Continue') : null,
    ),
  );
}
