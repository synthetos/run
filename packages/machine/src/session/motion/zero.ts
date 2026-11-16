import { type Decision } from '@synthetos/safety';
import { queueModeReads } from '../modes.ts';
import {
  ABSOLUTE_MM_LINE,
  CLEAR_TEMP_OFFSET_LINE,
  motionLineKind,
  safeZLine,
  selectCoordLine,
  setZeroLine,
  tempOffsetLine,
  toZeroLine
} from '../motionLines.ts';
import type { SessionIntent, SessionState } from '../types.ts';
import { type MotionTx } from './contract.ts';
import { clearMotionNotice, newCtx, queueLine, requestPoll, startChange, tick } from './effects.ts';
import { ALLOWED, LETTER, TOOL_CHANGE_ZERO } from './limits.ts';
import { activeSystem, deny, machineZ, precondition, validAxisList } from './model.ts';

export function onGoToZero(t: MotionTx, request: Extract<SessionIntent, { readonly intent: 'goToZero' }>, s: SessionState): Decision {
  const pre = precondition(s);
  if (pre !== undefined) return pre;
  const { axes, safeZ } = request;
  if (!validAxisList(axes)) return deny('Go to zero names one or more of X, Y, Z and A.', 'Choose an axis.');
  const letters = axes.map((a) => LETTER[a]);
  const planar = letters.filter((l) => l !== 'Z');
  // Explicit absolute millimetres first, on a line of its own, answered before any move (R1): `G53 G0 Z`
  // under G91 would go DOWN by the safe height, under G20 25.4 times too far. The modes are put back at the end.
  const steps: string[] = [ABSOLUTE_MM_LINE];
  if (planar.length > 0) {
    const z = machineZ(s);
    if (z === undefined || typeof safeZ !== 'number' || !Number.isFinite(safeZ)) return deny('The machine Z position is not known yet.', 'Wait for the position to be read.');
    // Never lower Z first: the safe height is at least where Z already is (H53).
    steps.push(safeZLine(Math.max(z, safeZ)), toZeroLine(planar));
  }
  if (letters.includes('Z')) steps.push(toZeroLine(['Z']));
  if (steps.some((l) => motionLineKind(l) === undefined)) return deny('The safe height is out of range.', 'Choose another safe height.');
  t.set({ motion: { ...newCtx(s, 'goToZero'), phase: 'drain', steps: steps.slice(1) }, base: 'JOGGING' });
  clearMotionNotice(t);
  queueModeReads(t, 'motion');
  queueLine(t, steps[0] as string, 'goToZero');
  requestPoll(t);
  tick(t);
  return ALLOWED;
}

export function onSetWorkZero(t: MotionTx, request: Extract<SessionIntent, { readonly intent: 'setWorkZero' }>, s: SessionState): Decision {
  const pre = precondition(s);
  if (pre !== undefined) return pre;
  if (!validAxisList(request.axes)) return deny('Set zero names one or more of X, Y, Z and A.', 'Choose an axis.');
  // H74 (2026-11-08): at a manual tool change only Z is re-zeroed, for the new tool's length. An X, Y or A zero
  // there would shift the rest of the job, which was checked at Start against the old offsets.
  if (s.job?.phase === 'toolChange' && !(request.axes.length === 1 && request.axes[0] === 'z')) return deny(TOOL_CHANGE_ZERO, 'Re-zero Z only, or stop the job.');
  const system = activeSystem(s);
  if (system === null) return deny('The active work coordinate system is not known (or is G53).', 'Select G54 to G59 first.');
  // G10 L20 in the ACTIVE system, saved on the controller (C16); then its offsets are read back.
  return startChange(t, 'setZero', setZeroLine(request.axes.map((a) => LETTER[a]), system), 'setWorkZero', request.axes);
}

export function onTempOffset(t: MotionTx, request: Extract<SessionIntent, { readonly intent: 'tempOffset' }>, s: SessionState): Decision {
  const pre = precondition(s);
  if (pre !== undefined) return pre;
  if ('clear' in request) return startChange(t, 'clearTempOffset', CLEAR_TEMP_OFFSET_LINE, 'tempOffset');
  if (!validAxisList(request.axes)) return deny('A temporary offset names one or more of X, Y, Z and A.', 'Choose an axis.');
  return startChange(t, 'tempOffset', tempOffsetLine(request.axes.map((a) => LETTER[a])), 'tempOffset', request.axes);
}

export function onSelectCoordSystem(t: MotionTx, request: Extract<SessionIntent, { readonly intent: 'selectCoordSystem' }>, s: SessionState): Decision {
  const pre = precondition(s);
  if (pre !== undefined) return pre;
  const system = request.system;
  if (typeof system !== 'number' || !Number.isInteger(system) || system < 1 || system > 6) return deny('Choose G54 to G59.', 'Choose G54 to G59.');
  return startChange(t, 'selectCoord', selectCoordLine(system), 'selectCoordSystem');
}
