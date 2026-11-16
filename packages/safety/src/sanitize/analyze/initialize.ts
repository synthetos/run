import type { Dialect, DialectJobGcode } from '@synthetos/protocol';
import {
  ROTARY,
  reportedErrorMm
} from '../geometry.ts';
import type { Axis, SanitizeOptions, StartState } from '../types.ts';
import { AXES, AXIS_MODE_INHIBITED, WCS_CODES } from '../types.ts';
import { modeOf } from './axisModes.ts';
import { type ModelContext } from './context.ts';
import { offsetUnc } from './offsets.ts';
import { emptyPos, exactUnc, posFrom, uncOf, zeroPos, type Pos, type Unc } from './positions.ts';
import { INCH_MM } from './tables.ts';

export function initialize(ctx: ModelContext, dialect: Dialect, job: DialectJobGcode, options: SanitizeOptions): void {
  ctx._job = job;
  ctx._manualToolChange = dialect.id === 'tinyg-en';
  ctx._rules = dialect.gcode.blocked;
  ctx._lWords = dialect.gcode.lWords;
  ctx._options = options;
  ctx._motion = options.motion;
  ctx._hasToolOffset = job.codes.includes('G43.1');
  ctx._hasArcDistance = job.codes.includes('G90.1');
  const s: StartState = options.start ?? {};
  ctx._defaults = s.defaults ?? {};
  initializeModal(ctx, { s });
  initializeUncertainty(ctx, { job, s });
  initializeJointRisk(ctx);
}

export function initializeModal(ctx: ModelContext, { s }: InitializeModalInput): void {

  ctx.units = s.units ?? null;
  ctx.distance = s.distance ?? null;
  ctx.arcDistance = ctx._hasArcDistance ? (s.arcDistance ?? null) : 'G91.1';
  ctx.plane = s.plane ?? null;
  ctx.motionMode = s.motion ?? null;
  ctx.feed = s.feedMmPerMin !== undefined && s.feedMmPerMin > 0 && Number.isFinite(s.feedMmPerMin) ? s.feedMmPerMin : null;
  initializePositions(ctx, { s });
}

export function initializeUncertainty(ctx: ModelContext, { job, s }: InitializeUncertaintyInput): void {

  // Reported values: `mpo` is always mm (@cite EN canonical_machine.c:363-371); offsets and stored
  // positions are printed in the units in force where the board converts them (F_CONVERT, @cite EN
  // config_app.c:858-871 `prep_float`), so an inch board's three decimals are 0.0127 mm apart, and
  // unknown units are taken as inches.
  const offsetUnit = (axis: Axis): number =>
    (ROTARY.has(axis) && !job.rotaryOffsetsUseUnits) || s.units === 'G21' ? 1 : INCH_MM;
  const reported = (p: Pos): Unc => uncOf(p, (a, v) => reportedErrorMm(v, offsetUnit(a)));
  ctx.uMachine = uncOf(ctx.machine, (_a, v) => reportedErrorMm(v, 1));
  ctx.uWcs = { G54: exactUnc(), G55: exactUnc(), G56: exactUnc(), G57: exactUnc(), G58: exactUnc(), G59: exactUnc() };
  for (const w of WCS_CODES) ctx.uWcs[w] = reported(ctx.wcsOffsets[w]);
  ctx.uG92 = reported(ctx.g92);
  ctx.uTool = ctx._hasToolOffset ? reported(ctx.toolOffset) : exactUnc();
  ctx.uG28 = reported(ctx.g28);
  ctx.uG30 = reported(ctx.g30);
  ctx.work = emptyPos();
  ctx.uWork = exactUnc(); // every axis is set just below
  for (const a of AXES) {
    const m = ctx.machine[a];
    const t = ctx.totalOffset(a);
    ctx.work[a] = m !== null && t !== null ? m - t : null;
    ctx.uWork[a] = ctx.uMachine[a] + offsetUnc(ctx, a);
  }
}

export function initializeJointRisk(ctx: ModelContext): void {

  // Finding: inhibited axis. For an inhibited axis the step target is 0 once any segment has run since it
  // was inhibited (or since a step resync); before that it is still the joint the axis had when it was
  // inhibited, and with no segment since, the position has not moved either. So the motor is at step 0 or
  // at the position the board reports. An axis of unknown mode may be inhibited. (An axis un-inhibited
  // while away from 0 has the mirror problem and is not visible in any read: STATUS of this finding.)
  const risk: Axis[] = [];
  let residual: number | null = 0;
  for (const a of AXES) {
    const mode = modeOf(ctx, a);
    if (mode !== undefined && mode !== AXIS_MODE_INHIBITED) continue;
    const m = ctx.machine[a];
    if (m !== 0) {
      risk.push(a);
      continue;
    }
    if (residual === null) continue;
    residual = ROTARY.has(a) ? null : residual + ctx.uMachine[a];
  }
  ctx._jointRisk = risk;
  ctx._jointResidualMm = residual;
}

export function initializePositions(ctx: ModelContext, { s }: InitializePositionsInput): void {

  ctx.wcs = s.wcs ?? null;
  ctx.machine = posFrom(s.machine);
  ctx.wcsOffsets = { G54: emptyPos(), G55: emptyPos(), G56: emptyPos(), G57: emptyPos(), G58: emptyPos(), G59: emptyPos() };
  for (const w of WCS_CODES) ctx.wcsOffsets[w] = posFrom(s.wcsOffsets?.[w]);
  ctx.g92 = posFrom(s.g92?.offsets);
  ctx.g92Active = s.g92 === undefined ? null : s.g92.active;
  ctx.toolOffset = ctx._hasToolOffset ? posFrom(s.toolOffset) : zeroPos();
  ctx.g28 = posFrom(s.g28);
  ctx.g30 = posFrom(s.g30);
  ctx.spindle = s.spindle ?? 'off';
  ctx.mist = s.mist ?? false;
  ctx.flood = s.flood ?? false;
}

interface InitializeModalInput {
  s: StartState
}

interface InitializeUncertaintyInput {
  job: DialectJobGcode;
  s: StartState
}

interface InitializePositionsInput {
  s: StartState
}
