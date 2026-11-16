/** Ordered M-code fields; execution remains in the planner command queue. */
import '../marker.ts';
import { ModelGapError } from './common.ts';
import type { Word } from './gcode.ts';
import type { GcodeInput } from './gcodeInput.ts';
import { EN_TABLE, statusCode } from './table.ts';
const ST = (name: string): number => statusCode(EN_TABLE, name);
interface Context { readonly g: GcodeInput; readonly block: string; readonly fb: number; readonly setModal: (name: string) => boolean }
function flow(code: number, c: Context): number {
  if (!c.setModal('M4')) return ST('GCODE_MODAL_GROUP_VIOLATION');
  c.g.programFlow = code === 1 ? 'optionalStop' : code === 2 || code === 30 ? 'end' : 'stop';
  return 0;
}
function outputs(code: number, c: Context): number {
  if ([3, 4, 5].includes(code)) {
    if (!c.setModal('M7')) return ST('GCODE_MODAL_GROUP_VIOLATION');
    c.g.spindle = code === 3 ? 'cw' : code === 4 ? 'ccw' : 'off'; return 0;
  }
  if (code === 7 || code === 8) {
    const key = code === 7 ? 'mist' : 'flood';
    if (c.g[key] === true || c.g.flood === false) return ST('GCODE_MODAL_GROUP_VIOLATION');
    c.g[key] = true; return 0;
  }
  if (!c.setModal('M8') || c.g.mist === true || c.g.flood === true) return ST('GCODE_MODAL_GROUP_VIOLATION');
  c.g.flood = false; return 0;
}
function other(code: number, c: Context): number {
  if (code >= 48 && code <= 51) {
    if (c.fb < 450.06) return ST('MCODE_COMMAND_UNSUPPORTED');
    c.g.override = code; return 0;
  }
  if (code === 400) {
    if (!/^(N\d+)?M400$/.test(c.block)) return ST('COMMAND_NOT_ACCEPTED');
    if (c.g.nextAction !== undefined) return ST('GCODE_MODAL_GROUP_VIOLATION');
    c.g.nextAction = 'motionSync'; return 0;
  }
  if ([105, 114, 115, 201].includes(code)) throw new ModelGapError(`edge-next M${code}`);
  return ST('MCODE_COMMAND_UNSUPPORTED');
}
export function parseM(w: Word, c: Context): number {
  const v = w.value, code = Math.trunc(v);
  if (!(v >= 0 && v <= 999) || w.decimals > 1 || (w.decimals === 1 && code !== 201)) return ST('MCODE_COMMAND_UNSUPPORTED');
  if ([0, 60, 1, 2, 30].includes(code)) return flow(code, c);
  if ([3, 4, 5, 7, 8, 9].includes(code)) return outputs(code, c);
  if (code === 6) { c.g.toolChange = true; return 0; }
  return other(code, c);
}
