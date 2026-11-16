import {
  AXES,
  type Axis,
  type SentLine
} from '@synthetos/safety';
import { codeOf, parseLine, type ParsedLine } from '../parser.ts';
import { LINE_FLAG } from '../types.ts';
import { addFinding, addFindingOnce } from './findings.ts';
import { executeStep } from './pipeline.ts';
import { type InterpreterContext } from './state.ts';

export function stepLine(ctx: InterpreterContext, line: SentLine, i: number, last: boolean): void {
  const src = line.sourceLine;
  const n = line.n;
  const parsed = parseLine(line.body, src);
  if (parsed.errors.length > 0 || parsed.cmds.length > 0) {
    addFinding(ctx, src, n, 'block', 'parse-error', `the line cannot be read as G-code: ${parsed.errors.map((e) => e.message).join('; ') || 'controller command'}`);
    ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
    return;
  }
  return parseStep(ctx, { parsed, src, n, i, line, last });
}

export function parseStep(ctx: InterpreterContext, { parsed, src, n, i, line, last }: ParseStepInput): void {

  const codes: string[] = [];
  const params = new Map<string, number>();
  const letters = new Set<string>();
  const axisWords = new Map<Axis, number>();
  for (const w of parsed.words) {
    const c = codeOf(w);
    if (c !== undefined) codes.push(c);
    else {
      letters.add(w.letter);
      if (!params.has(w.letter)) params.set(w.letter, w.value);
      if ((AXES as readonly string[]).includes(w.letter) && !axisWords.has(w.letter as Axis)) axisWords.set(w.letter as Axis, w.value);
    }
  }
  const has = (c: string): boolean => codes.includes(c);

  // Dialect data first: anything this dialect does not run as written is a block, never drawn.
  const unsupported = codes.filter((c) => !ctx.job.codes.includes(c) && !ctx.job.ignoredCodes.includes(c));
  for (const c of unsupported) addFinding(ctx, src, n, 'block', 'unsupported-code', `${c} is not supported in a job on ${ctx.dialect.label}`);
  for (const c of codes) {
    if (ctx.job.ignoredCodes.includes(c)) addFindingOnce(ctx, `ignored ${c}`, src, n, 'info', 'ignored-code', `${c} is accepted and ignored by ${ctx.dialect.label}`);
  }
  if (unsupported.length > 0) {
    ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
    return;
  }
  return executeStep(ctx, { i, has, params, src, n, axisWords, codes, letters, line, last });
}

interface ParseStepInput {
  parsed: ParsedLine;
  src: number;
  n: number;
  i: number;
  line: SentLine;
  last: boolean
}
