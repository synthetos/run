import {
  type Axis,
  type SentLine
} from '@synthetos/safety';
import { LINE_FLAG } from '../types.ts';
import { applyActions } from './actions.ts';
import { addFinding } from './findings.ts';
import { feedAndWords, offsetsAndModes, unitsAndPlane } from './modal.ts';
import { outputsAndDwell, recordEnd, recordPause } from './outputs.ts';
import { ruleBlocks } from './rules.ts';
import { type InterpreterContext } from './state.ts';

export function executeStep(ctx: InterpreterContext, { i, has, params, src, n, axisWords, codes, letters, line, last }: ExecuteStepInput): void {


  if (ctx.uncertain) ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.UNCERTAIN;
  outputsAndDwell(ctx, { has, params });
  unitsAndPlane(ctx, { has, src, n });
  offsetsAndModes(ctx, { has, axisWords });
  feedAndWords(ctx, { params, codes });

  // The dialect's block rules, with this line's modes (TG: G28/G30 under G20 or G91).
  const rules = ruleBlocks(ctx, codes, letters);
  for (const r of rules) addFinding(ctx, src, n, 'block', r.id, r.reason);
  if (rules.length > 0) {
    ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
    return;
  }
  applyActions(ctx, { has, params, axisWords, src, n, i, letters });
  recordPause(ctx, { codes, line, src, n, i });
  recordEnd(ctx, { codes, last, src, n });
  if (ctx.uncertain) ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.UNCERTAIN;
}

interface ExecuteStepInput {
  i: number;
  has: (c: string) => boolean;
  params: Map<string, number>;
  src: number;
  n: number;
  axisWords: Map<Axis, number>;
  codes: string[];
  letters: Set<string>;
  line: SentLine;
  last: boolean
}
