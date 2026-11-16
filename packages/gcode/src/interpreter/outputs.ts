import {
  type SentLine
} from '@synthetos/safety';
import { LINE_FLAG } from '../types.ts';
import { zero } from './coordinates.ts';
import { addFinding } from './findings.ts';
import { type InterpreterContext } from './state.ts';

export function outputsAndDwell(ctx: InterpreterContext, { has, params }: OutputsAndDwellInput): void {


  // Outputs and dwell (NIST order of execution).
  if (has('M3')) ctx.spindle = 'cw';
  if (has('M4')) ctx.spindle = 'ccw';
  if (has('M5')) ctx.spindle = 'off';
  if (has('M7')) ctx.mist = true;
  if (has('M8')) ctx.flood = true;
  if (has('M9')) {
    ctx.mist = false;
    ctx.flood = false;
  }
  if (has('G4')) {
    const p = params.get('P');
    if (p !== undefined && ctx.seconds !== null) ctx.seconds += p;
    if (p !== undefined) ctx.events.dwell(p);
  }
}

export function recordPause(ctx: InterpreterContext, { codes, line, src, n, i }: RecordPauseInput): void {


  // Pauses: the dialect's barrier codes (M1 only with optional stop on), or the C14 M0.
  const barrierCodes = ctx.dialect.gcode.barrierCodes.filter((c) => c !== 'M1' || ctx.options.optionalStop === true);
  const pause = codes.some((c) => barrierCodes.includes(c));
  if (pause !== line.barrier) {
    addFinding(ctx, src, n, 'block', 'barrier-mismatch', pause
      ? 'this line pauses the job on this dialect, but the stream does not stop feeding after it'
      : 'the stream stops feeding after this line, but nothing on it pauses this dialect');
  }
  if (pause) {
    ctx.events.barrier();
    ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.PAUSE;
    ctx.pausePoints.push(n);
    if (ctx.spindle !== 'off' || ctx.mist || ctx.flood) {
      addFinding(ctx, src, n, 'info', 'pause-outputs-on', 'the spindle and coolant stay on at this pause');
    }
  }
}

export function recordEnd(ctx: InterpreterContext, { codes, last, src, n }: RecordEndInput): void {


  // Program end.
  const end = ctx.dialect.gcode.holdbackEndCodes.some((c) => codes.includes(c));
  if (end) {
    if (!last) {
      const severity = ctx.job.midFileProgramEnd;
      addFinding(ctx, src, n, severity, 'mid-file-program-end', severity === 'block'
        ? '' /* Shared H35 text is supplied by add. */
        : 'M2/M30 before the end of the file: the lines after it still run');
    }
    programEnd(ctx);
  }
}

/** M2/M30 (@cite EN canonical_machine.c:2174-2214): G92.1, default system, plane, units, G90, G80; outputs per dialect. */
export function programEnd(ctx: InterpreterContext): void {
  ctx.g92 = { offsets: zero(), active: false };
  ctx.wcs = ctx.defaults.wcs;
  ctx.plane = ctx.defaults.plane;
  ctx.units = ctx.defaults.units;
  ctx.distance = 'G90';
  ctx.motion = 'G80';
  if (ctx.job.programEndStopsOutputs) {
    ctx.spindle = 'off';
    ctx.mist = false;
    ctx.flood = false;
  }
}

interface OutputsAndDwellInput {
  has: (c: string) => boolean;
  params: Map<string, number>
}

interface RecordPauseInput {
  codes: string[];
  line: SentLine;
  src: number;
  n: number;
  i: number
}

interface RecordEndInput {
  codes: string[];
  last: boolean;
  src: number;
  n: number
}
