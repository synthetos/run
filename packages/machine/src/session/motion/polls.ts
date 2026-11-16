import { checkAlarm } from './alarms.ts';
import { type MotionTx } from './contract.ts';
import { requestPoll, setMotion } from './effects.ts';
import { pollHoming } from './homing.ts';
import { completedPoll } from './model.ts';
import { pollDrain, pollFeed } from './pollFeed.ts';
import { pollFlush, pollHold } from './pollStops.ts';

/** One poll cycle was answered (after `qr`). */
export function onPollDone(t: MotionTx, at: number): void {
  const ctx = t.s.motion;
  if (ctx === null || !checkAlarm(t, at)) return;
  const s = t.s;
  const p = completedPoll(s);
  if (p === null) {
    // A read of this cycle was rejected, damaged or missing: it confirms nothing, whatever the live view says (R5;
    // H56, H69). Count from zero again; the hold and flush deadlines still run (W12 and FAULT on a silent board).
    setMotion(t, { confirmed: 0 });
    if (ctx.phase !== 'homing') requestPoll(t); // homing polls again from its own check timer
    return;
  }
  const confirm = (ok: boolean): number => (ok ? ctx.confirmed + 1 : 0);
  switch (ctx.phase) {
    case 'feed': {
      return pollFeed(t, { ctx, s, p, confirm });
    }
    case 'drain': {
      return pollDrain(t, at, { ctx, s, p, confirm });
    }
    case 'hold': {
      return pollHold(t, at, { ctx, s, p, confirm });
    }
    case 'homing': {
      return pollHoming(t, { ctx, s, p, confirm });
    }
    case 'flush': {
      return pollFlush(t, at, { ctx, s, p, confirm });
    }
    /* c8 ignore next 2 -- held and finish stop the poll timer, so no poll cycle completes in them */
    default:
      return;
  }
}
