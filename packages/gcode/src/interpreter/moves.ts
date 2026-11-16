import {
  type Axis
} from '@synthetos/safety';
import { LINE_FLAG } from '../types.ts';
import { interpretArc } from './arcs.ts';
import { axisMm, offset } from './coordinates.ts';
import { addFinding, addFindingOnce } from './findings.ts';
import { linearMove } from './linear.ts';
import { type InterpreterContext } from './state.ts';

export function interpretMove(ctx: InterpreterContext, ...[axisWords, params, g53, src, n, i]: [axisWords: ReadonlyMap<Axis, number>, params: ReadonlyMap<string, number>, g53: boolean, src: number, n: number, i: number]): void {
  const to = { ...ctx.machine };
  for (const [a, v] of axisWords) {
    const mm = axisMm(ctx, a, v);
    // G53: machine coordinates, absolute for this line only.
    to[a] = g53 ? mm : ctx.distance === 'G91' ? ctx.machine[a] + mm : mm + offset(ctx, a);
  }
  if (ctx.motion === 'G80') return;
  if (ctx.motion !== 'G0' && ctx.feed === undefined) {
    addFinding(ctx, src, n, 'block', 'feed-not-set', `${ctx.motion} before any F word: the board would use whatever feed rate it has (SAFETY §4.5)`);
  }
  spindleWarning(ctx, { to, i, src, n });
  if (ctx.motion === 'G0' || ctx.motion === 'G1') {
    linearMove(ctx, to, ctx.motion, i);
    if (ctx.motion === 'G0' && to.Z - offset(ctx, 'Z') < 0) {
      addFindingOnce(ctx, 'rapid-below-z0', src, n, 'warn', 'rapid-below-z0', 'a rapid move ends below work Z0 (heuristic: check it clears the stock)');
    }
    return;
  }
  interpretArc(ctx, to, axisWords, params, src, n, i);
}

export function spindleWarning(ctx: InterpreterContext, { to, i, src, n }: SpindleWarningInput): void {

  if (ctx.motion !== 'G0' && ctx.spindle === 'off' && (to.X !== ctx.machine.X || to.Y !== ctx.machine.Y || to.Z !== ctx.machine.Z)) {
    ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.SPINDLE_OFF_CUT;
    addFindingOnce(ctx, 'spindle-off', src, n, 'warn', 'spindle-off-cut', 'a cutting move with the spindle off');
  }
}

interface SpindleWarningInput {
  to: { X: number; Y: number; Z: number; A: number; B: number; C: number; };
  i: number;
  src: number;
  n: number
}
