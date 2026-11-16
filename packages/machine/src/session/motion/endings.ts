import { STOP_TEXT } from '@synthetos/safety';
import { noteSetByHand } from '../homedAxes.ts';
import { jobStopped } from '../jobState.ts';
import {
  restoreLine
} from '../motionLines.ts';
import { typedEnded } from '../typedNotice.ts';
import { raiseRestore } from '../typedPieces.ts';
import type { ChangeKind, JogAxis, MotionCtx, SessionState } from '../types.ts';
import { type MotionTx } from './contract.ts';
import { changeNotice, message, queueLine, readBack, setMotion } from './effects.ts';
import { activeSystem, axisNames, returnBase } from './model.ts';

/** Queues the closing lines (SAFETY §4.4 Phase 2 step 5, §4.5b). */
export function finish(t: MotionTx, at: number): void {
  const ctx = t.s.motion as MotionCtx;
  const stop = ctx.reason === 'stopJob';
  const lines = stop ? ['M5', 'M9'] : [];
  // A jog used G21 G91 and go to zero G90 G21 (R1, R2): put back the units read before them (modes.ts). A jog, go to
  // zero and a Stop job end in absolute distance (§4.4, §4.5b; go to zero since OD-19, 2026-11-08); only a jog during
  // a job's tool change puts back the job's own distance mode (Phase 3, H74). A mode that was not read is not put back.
  const dist = ctx.op === 'jog' && ctx.returnTo === 'PROGRAM_PAUSED' && !stop ? ctx.dist : 0;
  if (ctx.op === 'jog' || ctx.op === 'goToZero' || stop) lines.push(restoreLine(ctx.units, dist));
  // OD-31: a typed move's raise that did not finish puts the board's own modes back (a typed G91 or G20 stays).
  else lines.push(...raiseRestore(ctx));
  setMotion(t, { phase: 'finish', confirmed: 0, deadline: null });
  // Phase 3: the hold and the flush are confirmed, so every job line the board still had is gone (`%` dropped its
  // line buffers) and every one it ran has been answered: none is owed any more, and M5's answer is M5's.
  if (stop) t.set({ expected: t.s.expected.filter((e) => e.purpose !== 'job') });
  for (const line of lines) queueLine(t, line, stop ? 'stopJob' : ctx.op === 'goToZero' ? 'goToZero' : 'jog');
  t.cancel('motion');
  if (lines.length === 0) complete(t, at);
}

/** The read-back of each change (amendment 2026-11-02): what it changed, read once. */
const CHANGE_READBACK: Readonly<Record<ChangeKind, (s: SessionState) => readonly string[]>> = {
  setZero: (s) => [`g${53 + (activeSystem(s) as number)}`, 'ofs', 'pos'],
  setPosition: () => ['mpo', 'pos', 'hom', 'ofs', 'home'],
  tempOffset: () => ['g92', 'ofs', 'pos'],
  clearTempOffset: () => ['g92', 'ofs', 'pos'],
  selectCoord: () => ['coor', 'ofs', 'pos', 'g54', 'g55', 'g56', 'g57', 'g58', 'g59'],
};

const CHANGE_DONE: Readonly<Record<ChangeKind, (axes: string) => string>> = {
  setZero: (axes) => `Work zero set for ${axes} (saved on the controller); offsets read back.`,
  setPosition: (axes) => `Machine position set to 0 here for ${axes} (G28.3); position read back.`,
  tempOffset: (axes) => `Temporary offset set: ${axes} read 0 here (G92, not saved).`,
  clearTempOffset: () => 'Temporary offset cleared (G92.1).',
  selectCoord: () => 'Work coordinate system changed; offsets read back.',
};

export function complete(t: MotionTx, at: number): void {
  const ctx = t.s.motion as MotionCtx;
  t.set({ motion: null, base: returnBase(ctx, t.s) });
  t.cancel('motion');
  if (ctx.op === 'change' && ctx.reason === null && ctx.refusal === null) {
    const change = ctx.change as ChangeKind;
    if (change === 'setPosition') noteSetByHand(t, ctx.axes as readonly JogAxis[]);
    readBack(t, CHANGE_READBACK[change](t.s), change === 'setPosition' ? 'positionSet' : undefined);
    changeNotice(t, 'done', CHANGE_DONE[change](axisNames(ctx.axes as readonly JogAxis[])), at);
  }
  if (ctx.op === 'home') {
    // Homing ended by Pause, Stop job or a refusal: the machine is not homed. Read the homing state back.
    readBack(t, ['hom', 'mpo', 'pos', 'home']);
    if (ctx.reason === 'homeAbort') changeNotice(t, 'failed', 'Homing stopped by Pause. The machine is not homed: home again before relying on positions.', at);
  }
  if (ctx.op === 'typed') typedEnded(t, ctx, at);
  if (ctx.reason === 'stopJob') {
    message(t, 'stopped', STOP_TEXT.stopped, at);
    jobStopped(t, at);
  }
  else if (ctx.reason === 'keepalive') message(t, 'failed', 'Jog stopped: the button was let go, or the page lost touch with it.', at);
  else if (ctx.refusal !== null) message(t, 'refused', ctx.refusal, at);
}
