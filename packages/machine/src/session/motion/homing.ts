import { mapStat } from '@synthetos/protocol';
import { type Decision } from '@synthetos/safety';
import { homingAxes } from '@synthetos/schema';
import { noteHomed } from '../homedAxes.ts';
import {
  homeLine,
  setPositionLine
} from '../motionLines.ts';
import { sessionSettings } from '../settingWrite.ts';
import type { FollowUp, JogAxis, SessionIntent, SessionState } from '../types.ts';
import { type MotionTx, type PollContext } from './contract.ts';
import { changeNotice, clearMotionNotice, newCtx, queueLine, readBack, requestPoll, setMotion, startChange } from './effects.ts';
import { ALLOWED, LETTER, MOTION_LIMITS, SETTLE_BASES } from './limits.ts';
import { atRestPolled, axisNames, deny, dialect, idleBase, machineClass, motionCapable, motionLinesSettled, precondition, validAxisList } from './model.ts';

export function onHome(t: MotionTx, request: Extract<SessionIntent, { readonly intent: 'home' }>, s: SessionState): Decision {
  const pre = precondition(s);
  if (pre !== undefined) return pre;
  // Defence in depth: the matrix allows home only in these bases (HOMING always has a motion, refused above), and a
  // board that is not motion-capable carries READ_ONLY, which the matrix denies.
  /* c8 ignore start */
  if (!motionCapable(s, t.config)) return deny('This board is not approved for motion in this session.', 'Use an approved firmware build.');
  if (s.base !== 'IDLE_UNHOMED' && s.base !== 'IDLE_HOMED' && s.base !== 'CONNECTED_UNKNOWN') return deny('Homing starts only while the machine is idle.', 'Wait until the machine is idle.');
  /* c8 ignore stop */
  if (!validAxisList(request.axes)) return deny('Home names one or more of X, Y, Z and A.', 'Choose an axis.');
  const config = homingAxes(sessionSettings(dialect(s).id, s.values));
  const missing = request.axes.filter((a) => !config[a].configured);
  if (missing.length > 0) {
    const why = missing.map((a) => `${LETTER[a]}: ${config[a].reason as string}`).join('; ');
    return deny(`Homing is not configured for ${axisNames(missing)} (${why}).`, 'Configure the homing switch and search speed in the Board view, or set the machine position here (G28.3) on a machine without switches.');
  }
  t.set({ motion: { ...newCtx(s, 'home'), phase: 'homing', axes: [...request.axes], seen: false }, base: 'HOMING' });
  clearMotionNotice(t);
  queueLine(t, homeLine(request.axes.map((a) => LETTER[a])), 'home');
  requestPoll(t);
  t.arm('motion', MOTION_LIMITS.homingCheckMs);
  return ALLOWED;
}

export function onSetMachinePosition(t: MotionTx, request: Extract<SessionIntent, { readonly intent: 'setMachinePosition' }>, s: SessionState): Decision {
  const pre = precondition(s);
  if (pre !== undefined) return pre;
  /* c8 ignore next -- defence in depth, as for home */
  if (!motionCapable(s, t.config)) return deny('This board is not approved for motion in this session.', 'Use an approved firmware build.');
  if (!validAxisList(request.axes)) return deny('Set machine position names one or more of X, Y, Z and A.', 'Choose an axis.');
  return startChange(t, 'setPosition', setPositionLine(request.axes.map((a) => LETTER[a])), 'setMachinePosition', request.axes);
}

export function onPositionVerify(t: MotionTx, s: SessionState): Decision {
  // positionVerify (the reducer passes nothing else here). The user has checked the machine: UNKNOWN clears.
  // Without motion (a read-only release or board) the base stays CONNECTED_UNKNOWN; nothing moves either way.
  const overlays = s.overlays.filter((o) => o !== 'UNKNOWN');
  t.set({ overlays, base: motionCapable(s, t.config) && overlays.length === 0 ? idleBase(s) : s.base });
  return ALLOWED;
}

/**
 * A follow-up after the last read-back of a homing (`homed`) or a G28.3 (`positionSet`): with all of X, Y and Z
 * homed (`home` 1) the position is trusted, so UNKNOWN clears and the base is IDLE_HOMED.
 */
export function onFollowUp(t: MotionTx, then: Exclude<FollowUp, 'typedCheck'>, at: number): void {
  const s = t.s;
  const homed = s.live.home === 1;
  if (homed && s.overlays.includes('UNKNOWN')) t.set({ overlays: s.overlays.filter((o) => o !== 'UNKNOWN') });
  // Words only (S2): a G28.3 also reads back `home` 1, so say which of the two set the position.
  if (homed) t.set({ notices: { ...t.s.notices, position: { by: then === 'homed' ? 'homing' : 'hand', at } } });
  const ctx = s.motion;
  if (then === 'homed' && ctx !== null && ctx.op === 'home' && ctx.phase === 'readback') {
    noteHomed(t, ctx.axes as readonly JogAxis[]); // S2: known per axis, from the read-back (homedAxes.ts)
    const axes = axisNames(ctx.axes as readonly JogAxis[]);
    t.set({ motion: null });
    changeNotice(t, homed ? 'done' : 'failed', homed ? `Homed ${axes}. Machine position is set from the switches.` : `Homing of ${axes} ended, but the board does not report X, Y and Z all homed.`, at);
  }
  // Nothing else of ours runs and the base is idle-class (an alarm meanwhile has moved it to ALARM): follow the homing state.
  if (t.s.motion !== null || !SETTLE_BASES.has(t.s.base)) return;
  t.set({ base: t.s.overlays.length === 0 ? idleBase(t.s) : 'CONNECTED_UNKNOWN' });
}

/** A pushed status report during homing: a resting or alarmed state asks for confirming polls (pushed stat is never proof). */
export function onMotionReport(t: MotionTx, sr: Readonly<Record<string, unknown>>, _at: number): void {
  const ctx = t.s.motion;
  if (ctx === null || ctx.phase !== 'homing' || !('stat' in sr) || t.s.dialect === null) return;
  const cls = machineClass(t.s);
  if (cls === 'homing') setMotion(t, { seen: true });
  else requestPoll(t);
}

export function pollHoming(t: MotionTx, { ctx, s, p, confirm }: PollContext): void {
  const resting = atRestPolled(s, p) && motionLinesSettled(s);
  const cls = mapStat(dialect(s), p.stat);
  const seen = ctx.seen === true || cls === 'homing' || p.vel !== 0;
  const confirmed = confirm(resting);
  // Done after two polled reads at rest, once the cycle was seen running (or three in a row: it ended unseen).
  if (confirmed < MOTION_LIMITS.confirmations || (!seen && confirmed < MOTION_LIMITS.confirmations + 1)) {
    setMotion(t, { confirmed, seen });
    if (confirmed > 0) requestPoll(t);
    return;
  }
  setMotion(t, { phase: 'readback', confirmed: 0, seen });
  t.cancel('motion');
  readBack(t, ['hom', 'mpo', 'pos', 'ofs', 'home'], 'homed');
  return;
}
