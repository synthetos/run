import {
  WCS_CODES,
  type Axis,
  type Wcs
} from '@synthetos/safety';
import { LINE_FLAG } from '../types.ts';
import { ROTARY } from './constants.ts';
import { axisMm, offset, offsetMm, zero } from './coordinates.ts';
import { addFinding } from './findings.ts';
import { linearMove } from './linear.ts';
import { interpretMove } from './moves.ts';
import { type InterpreterContext } from './state.ts';

export function applyActions(ctx: InterpreterContext, { has, params, axisWords, src, n, i, letters }: ApplyActionsInput): void {


  // Non-modal actions that consume the axis words.
  if (has('G10')) {
    g10(ctx, params, axisWords, src, n, i);
  } else if (has('G28.1')) {
    ctx.g28 = { ...ctx.machine };
  } else if (has('G30.1')) {
    ctx.g30 = { ...ctx.machine };
  } else if (has('G92')) {
    for (const [a, v] of axisWords) {
      ctx.g92.offsets[a] = ctx.machine[a] - ctx.wcsOffsets[ctx.wcs][a] - (ROTARY.has(a) ? 0 : ctx.tool[a]) - offsetMm(ctx, a, v);
    }
    ctx.g92.active = true;
    if (axisWords.size > 0) ctx.frameTable.g92(src);
  } else if (has('G92.1')) {
    ctx.g92 = { offsets: zero(), active: false };
  } else if (has('G92.2')) {
    ctx.g92.active = false;
  } else if (has('G92.3')) {
    ctx.g92.active = true;
  } else if (has('G28') || has('G30')) {
    storedMove(ctx, has('G28') ? 'G28' : 'G30', axisWords, src, n, i);
  } else if (!has('G43.1')) {
    applyModalMove(ctx, { has, axisWords, letters, params, src, n, i });
  }
}

export function g10(ctx: InterpreterContext, ...[params, axisWords, src, n, i]: [params: ReadonlyMap<string, number>, axisWords: ReadonlyMap<Axis, number>, src: number, n: number, i: number]): void {
  const l = params.get('L');
  const p = params.get('P');
  if (l === undefined || !ctx.dialect.gcode.lWords.includes(l)) {
    const allowed = ctx.dialect.gcode.lWords.map((v) => `L${String(v)}`).join(', ');
    addFinding(ctx, src, n, 'block', 'l-word', l === 20
      ? `${ctx.dialect.label} has no G10 L20 (only ${allowed}): it would run as L2 and set the offset to the written value, not to the current position`
      : `G10 ${l === undefined ? 'without L' : `L${String(l)}`} is not supported on ${ctx.dialect.label} (only ${allowed})`);
    ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
    return;
  }
  const target = p !== undefined && Number.isInteger(p) && p >= 1 && p <= 6 ? (WCS_CODES[p - 1] as Wcs) : undefined;
  if (target === undefined) {
    addFinding(ctx, src, n, 'block', 'bad-parameter', 'G10 needs P1 to P6');
    return;
  }
  for (const [a, v] of axisWords) {
    const mm = offsetMm(ctx, a, v);
    if (l === 2) ctx.wcsOffsets[target][a] = mm;
    else {
      // L20: the offset that makes the current position read `v` in that system (@cite EN canonical_machine.c:1055-1062).
      ctx.wcsOffsets[target][a] = ctx.machine[a] - mm - (ctx.g92.active ? ctx.g92.offsets[a] : 0) - (ROTARY.has(a) ? 0 : ctx.tool[a]);
    }
  }
}

/** G28/G30: an optional intermediate point, then the stored position on every axis (@cite EN canonical_machine.c:1390-1405). */
export function storedMove(ctx: InterpreterContext, ...[code, axisWords, src, n, i]: [code: 'G28' | 'G30', axisWords: ReadonlyMap<Axis, number>, src: number, n: number, i: number]): void {
  if (axisWords.size > 0) {
    const to = { ...ctx.machine };
    for (const [a, v] of axisWords) {
      const mm = axisMm(ctx, a, v);
      if (ctx.job.storedMoveIntermediate === 'machine') to[a] = mm;
      else to[a] = ctx.distance === 'G91' ? ctx.machine[a] + mm : mm + offset(ctx, a);
    }
    linearMove(ctx, to, 'G0', i);
  }
  const stored = code === 'G28' ? ctx.g28 : ctx.g30;
  if (stored === null) {
    ctx.uncertain = true;
    ctx.events.unmodelled(ctx.machine, ctx.machine);
    addFinding(ctx, src, n, 'warn', 'stored-position-unknown', `the stored ${code} position was not read from the board: the preview cannot draw this move and every later position is uncertain`);
    return;
  }
  linearMove(ctx, { ...stored }, 'G0', i);
}

export function applyModalMove(ctx: InterpreterContext, { has, axisWords, letters, params, src, n, i }: ApplyModalMoveInput): void {

  for (const m of ['G0', 'G1', 'G2', 'G3', 'G80'] as const) if (has(m)) ctx.motion = m;
  if (axisWords.size > 0 || (ctx.motion === 'G2' || ctx.motion === 'G3') && (letters.has('I') || letters.has('J') || letters.has('K') || letters.has('R'))) {
    interpretMove(ctx, axisWords, params, has('G53'), src, n, i);
  }
}

interface ApplyActionsInput {
  has: (c: string) => boolean;
  params: Map<string, number>;
  axisWords: Map<Axis, number>;
  src: number;
  n: number;
  i: number;
  letters: Set<string>
}

interface ApplyModalMoveInput {
  has: (c: string) => boolean;
  axisWords: Map<Axis, number>;
  letters: Set<string>;
  params: Map<string, number>;
  src: number;
  n: number;
  i: number
}
