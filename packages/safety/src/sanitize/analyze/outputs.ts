import { type Word } from '../lex.ts';
import { type ModelContext } from './context.ts';
import { selectWcs, setG92 } from './offsets.ts';
import { exactUnc, zeroPos } from './positions.ts';

/** Commanded outputs at this point (SAFETY H48). */
export function outputsOn(ctx: ModelContext): boolean {
  return ctx.spindle !== 'off' || ctx.mist || ctx.flood;
}

/**
   * Program end resets the modal state (@cite EN canonical_machine.c:2191-2214; TG canonical_machine.c:1362-1374):
   * G92 cancelled, the default coordinate system and plane, G94, motion cancelled. EN also restores the
   * default units and sets G90; TG keeps the units and restores the default distance mode. Where the two
   * differ, the value is kept only if both firmwares agree on it, otherwise it becomes unknown.
   */
export function resetProgram(ctx: ModelContext): void {
  const d = ctx._defaults;
  ctx.units = ctx.units !== null && ctx.units === d.units ? ctx.units : null;
  ctx.distance = d.distance === 'G90' ? 'G90' : null;
  ctx.plane = d.plane ?? null;
  ctx.motionMode = 'G80';
  setG92(ctx, false, zeroPos(), exactUnc());
  selectWcs(ctx, d.wcs ?? null);
  if (ctx._job.programEndStopsOutputs) {
    ctx.spindle = 'off';
    ctx.mist = false;
    ctx.flood = false;
  }
}

export function updateOutputs(ctx: ModelContext, { S, T, has, programEnd }: UpdateOutputsInput): void {


  // --- Outputs and program flow (after motion in the block). ---
  if (S !== undefined) ctx.speed = S.value;
  if (T !== undefined) ctx.tool = T.value;
  if (has('M3')) ctx.spindle = 'cw';
  if (has('M4')) ctx.spindle = 'ccw';
  if (has('M5')) ctx.spindle = 'off';
  if (has('M7')) ctx.mist = true;
  if (has('M8')) ctx.flood = true;
  if (has('M9')) {
    ctx.mist = false;
    ctx.flood = false;
  }
  if (programEnd) resetProgram(ctx);
}

interface UpdateOutputsInput {
  S: Word | undefined;
  T: Word | undefined;
  has: (code: string) => boolean;
  programEnd: boolean
}
