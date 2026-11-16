import {
  AXES
} from '@synthetos/safety';
import { type TimingModel } from '../types.ts';
import { type Pos } from './contract.ts';
import { type InterpreterContext } from './state.ts';

/** Adds a move's estimated duration (trapezoid, starting and ending at rest; an estimate only). */
export function estimateTime(ctx: InterpreterContext, len: number, to: Pos, rapid: boolean): void {
  if (len === 0 || ctx.seconds === null) return;
  const timing: TimingModel | undefined = ctx.options.timing;
  if (timing === undefined) {
    ctx.seconds = null;
    return;
  }
  const limits = rapid ? timing.maxVelocity : timing.feedrateMax;
  let v = rapid ? Infinity : ctx.feed ?? NaN;
  let j = Infinity;
  for (const a of AXES) {
    const d = Math.abs(to[a] - ctx.machine[a]);
    if (d === 0) continue;
    const lim = limits[a];
    if (lim === undefined) {
      ctx.seconds = null;
      return;
    }
    v = Math.min(v, (lim * len) / d);
    const jm = timing.jerk?.[a];
    if (jm !== undefined) j = Math.min(j, (jm * len) / d);
  }
  if (!(v > 0)) {
    ctx.seconds = null;
    return;
  }
  let minutes: number;
  if (j === Infinity) minutes = len / v;
  else {
    // Constant-jerk ramp from rest to v takes 2√(v/j) and covers v·√(v/j); two ramps per move.
    const ramp = v * Math.sqrt(v / j);
    if (2 * ramp <= len) minutes = 4 * Math.sqrt(v / j) + (len - 2 * ramp) / v;
    else {
      const peak = Math.cbrt(((len * Math.sqrt(j)) / 2) ** 2);
      minutes = 4 * Math.sqrt(peak / j);
    }
  }
  ctx.seconds += minutes * 60;
}
