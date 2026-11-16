import type { Dialect, DialectJobGcode } from '@synthetos/protocol';
import {
  WCS_CODES,
  type SentLine,
  type StartState,
  type Wcs
} from '@synthetos/safety';
import { EventRecorder } from '../events.ts';
import { FrameRecorder } from '../frames.ts';
import { type InterpretOptions } from '../types.ts';
import { type Pos } from './contract.ts';
import { fill, offset } from './coordinates.ts';
import { addFinding } from './findings.ts';
import { InterpreterState, type InterpreterContext } from './state.ts';

export function createInterpreter(dialect: Dialect, job: DialectJobGcode, lines: readonly SentLine[], options: InterpretOptions): InterpreterContext { const ctx = new InterpreterState(); initializeInterpreter(ctx, dialect, job, lines, options); return ctx; }

export function initializeInterpreter(ctx: InterpreterContext, ...[dialect, job, lines, options]: [dialect: Dialect, job: DialectJobGcode, lines: readonly SentLine[], options: InterpretOptions]): void {
  ctx.dialect = dialect;
  ctx.job = job;
  ctx.lines = lines;
  ctx.options = options;
  ctx.flags = new Uint8Array(lines.length);
  ctx.events = new EventRecorder(lines);
  const s = options.start ?? {};
  const m = fill(s.machine);
  initializeModes(ctx, { m, s });
  const { offsetsKnown, g, t } = initializeOffsets(ctx, { s });
  initializeOutputs(ctx, { s });
  initializeAssumptions(ctx, { m, offsetsKnown, s, g, t });
}

export function initializeModes(ctx: InterpreterContext, { m, s }: InitializeModesInput): void {

  ctx.machine = m.pos;
  ctx.units = s.units ?? 'G21';
  ctx.distance = s.distance ?? 'G90';
  ctx.arcDistance = s.arcDistance ?? 'G91.1';
  ctx.plane = s.plane ?? 'G17';
  ctx.motion = s.motion ?? 'G80';
  ctx.feed = s.feedMmPerMin;
  ctx.wcs = s.wcs ?? 'G54';
}

export function initializeOffsets(ctx: InterpreterContext, { s }: InitializeOffsetsInput): { offsetsKnown: boolean; g: { pos: Pos; complete: boolean; }; t: { pos: Pos; complete: boolean; } } {

  const offsets = {} as Record<Wcs, Pos>;
  let offsetsKnown = true;
  for (const w of WCS_CODES) {
    const f = fill(s.wcsOffsets?.[w]);
    offsets[w] = f.pos;
    if (!f.complete) offsetsKnown = false;
  }
  ctx.wcsOffsets = offsets;
  const g = fill(s.g92?.offsets);
  ctx.g92 = { offsets: g.pos, active: s.g92?.active ?? false };
  const t = fill(s.toolOffset);
  ctx.tool = t.pos;
  ctx.frameTable = new FrameRecorder([offset(ctx, 'X'), offset(ctx, 'Y'), offset(ctx, 'Z')]);
  return { offsetsKnown, g, t };
}

export function initializeOutputs(ctx: InterpreterContext, { s }: InitializeOutputsInput): void {

  ctx.g28 = s.g28 === undefined ? null : fill(s.g28).pos;
  ctx.g30 = s.g30 === undefined ? null : fill(s.g30).pos;
  ctx.spindle = s.spindle ?? 'off';
  ctx.mist = s.mist ?? false;
  ctx.flood = s.flood ?? false;
  ctx.defaults = {
    units: s.defaults?.units ?? ctx.units,
    distance: s.defaults?.distance ?? 'G90',
    plane: s.defaults?.plane ?? 'G17',
    wcs: s.defaults?.wcs ?? 'G54',
  };
}

export function initializeAssumptions(ctx: InterpreterContext, { m, offsetsKnown, s, g, t }: InitializeAssumptionsInput): void {

  const assumed: string[] = [];
  if (!m.complete) assumed.push('machine position');
  if (!offsetsKnown) assumed.push('work offsets');
  if (s.g92 === undefined || !g.complete) assumed.push('G92 offsets');
  if (!t.complete) assumed.push('tool offset');
  if (assumed.length > 0) {
    ctx.uncertain = !m.complete || !offsetsKnown || !g.complete;
    addFinding(ctx, 0, null, 'warn', 'start-assumed', `not read from the board, assumed zero: ${assumed.join(', ')}; positions are flagged uncertain`);
  }
}

interface InitializeModesInput {
  m: { pos: Pos; complete: boolean; };
  s: StartState
}

interface InitializeOffsetsInput {
  s: StartState
}

interface InitializeOutputsInput {
  s: StartState
}

interface InitializeAssumptionsInput {
  m: { pos: Pos; complete: boolean; };
  offsetsKnown: boolean;
  s: StartState;
  g: { pos: Pos; complete: boolean; };
  t: { pos: Pos; complete: boolean; }
}
