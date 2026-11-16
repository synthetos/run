import { type Decision } from '@synthetos/safety';
import {
  CLEAR_LINE,
  spindleLine
} from '../motionLines.ts';
import type { SessionIntent } from '../types.ts';
import { type MotionTx } from './contract.ts';
import { queueLine, requestPoll } from './effects.ts';
import { ALLOWED, MOTION_LIMITS } from './limits.ts';
import { deny } from './model.ts';

export function onSpindleOn(t: MotionTx, request: Extract<SessionIntent, { readonly intent: 'spindleOn' }>): Decision {
  // As setWorkZero: idle only, so nothing else is moving.
  if (request.output === 'spindle') {
    const { direction, rpm } = request;
    if ((direction !== 'cw' && direction !== 'ccw') || typeof rpm !== 'number' || !Number.isFinite(rpm) || rpm < 1 || rpm > MOTION_LIMITS.maxRpm) {
      return deny(`Spindle speed must be 1 to ${MOTION_LIMITS.maxRpm}.`, 'Choose another speed.');
    }
    queueLine(t, spindleLine(direction, rpm), 'spindleOn');
    return ALLOWED;
  }
  if (request.output !== 'mist' && request.output !== 'flood') return deny('Unknown output.', 'Choose spindle, mist or flood.');
  queueLine(t, request.output === 'mist' ? 'M7' : 'M8', 'spindleOn');
  return ALLOWED;
}

export function onClearAlarm(t: MotionTx): Decision {
  // ALARM (the only state the matrix allows this in) is reached only in a motion-capable session.
  queueLine(t, CLEAR_LINE, 'clearAlarm');
  requestPoll(t);
  t.set({ queue: [...t.s.queue, { token: 'home', purpose: 'poll' }] });
  return ALLOWED;
}
