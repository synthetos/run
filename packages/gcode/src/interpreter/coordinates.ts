import {
  AXES,
  type Axis
} from '@synthetos/safety';
import { MM_PER_INCH, ROTARY } from './constants.ts';
import { type Pos } from './contract.ts';
import { type InterpreterContext } from './state.ts';

export const zero = (): Pos => ({ X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 });

export const fill = (v: Partial<Record<Axis, number>> | undefined): { pos: Pos; complete: boolean } => {
  const pos = zero();
  let complete = v !== undefined;
  for (const a of AXES) {
    const x = v?.[a];
    if (x === undefined || !Number.isFinite(x)) complete = false;
    else pos[a] = x;
  }
  return { pos, complete };
};

/** Program units to mm. */
export function unitScale(ctx: InterpreterContext): number {
  return ctx.units === 'G20' ? MM_PER_INCH : 1;
}

/** The work offset on an axis. EN and TG apply the tool offset to X, Y and Z only (@cite EN canonical_machine.c:536-563). */
export function offset(ctx: InterpreterContext, a: Axis): number {
  return ctx.wcsOffsets[ctx.wcs][a] + (ctx.g92.active ? ctx.g92.offsets[a] : 0) + (ROTARY.has(a) ? 0 : ctx.tool[a]);
}

export function work(ctx: InterpreterContext, a: Axis): number {
  return ctx.machine[a] - offset(ctx, a);
}

/** Axis word → mm (rotary: degrees, as written). */
export function axisMm(ctx: InterpreterContext, a: Axis, v: number): number {
  return ROTARY.has(a) ? v : v * unitScale(ctx);
}

/** An offset word → mm. Rotary offsets follow the dialect (`rotaryOffsetsUseUnits`). */
export function offsetMm(ctx: InterpreterContext, a: Axis, v: number): number {
  return ROTARY.has(a) && !ctx.job.rotaryOffsetsUseUnits ? v : v * unitScale(ctx);
}
