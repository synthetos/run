import {
  AXES
} from '@synthetos/safety';
import { KIND } from '../types.ts';
import { type Pos } from './contract.ts';
import { type InterpreterContext } from './state.ts';
import { estimateTime } from './timing.ts';

export function linearMove(ctx: InterpreterContext, to: Pos, motion: 'G0' | 'G1', i: number): void {
  let sq = 0;
  for (const a of AXES) sq += (to[a] - ctx.machine[a]) ** 2;
  const len = Math.sqrt(sq);
  if (motion === 'G0') ctx.rapidMm += len;
  else ctx.feedMm += len;
  ctx.events.line(ctx.machine, to, motion === 'G0', ctx.uncertain, ctx.feed);
  estimateTime(ctx, len, to, motion === 'G0');
  ctx.pieces.push({ kind: 'line', line: i, to, k: kindBits(ctx, motion === 'G0' ? KIND.RAPID : KIND.FEED) });
  ctx.machine = to;
  ctx.movedYet = true;
}

export function jump(ctx: InterpreterContext, to: Pos, i: number): void {
  ctx.events.unmodelled(ctx.machine, to);
  ctx.pieces.push({ kind: 'jump', line: i, to, k: kindBits(ctx, KIND.BREAK) });
  ctx.machine = to;
  ctx.movedYet = true;
}

export function kindBits(ctx: InterpreterContext, k: number): number {
  return ctx.uncertain ? k | KIND.UNCERTAIN : k;
}
