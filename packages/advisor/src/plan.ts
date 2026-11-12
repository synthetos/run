/**
 * The rules model for one operation (MACHINING_ASSISTANT §5.2).
 *
 * `planOperation` turns an `AdvisorContext` into conservative, balanced and
 * aggressive values, each with its envelope checks; compares the programmed
 * values (at the feed the machine will actually reach, when the path is
 * known) and gives a verdict with plain reasons; and records the provenance
 * of every input, so a result computed from a placeholder carries the flag.
 *
 * The three levels sit at the bottom, middle and top of the material's
 * surface speed and chipload ranges. When the tool has manufacturer (or
 * Synthetos) cutting data for this material, that data beats the generic
 * range (§2): all three levels use it. The frame-class factor scales the
 * chipload. A level whose feed would exceed the axis maximum is held at the
 * maximum with the spindle slowed to keep the chipload, down to the spindle
 * minimum.
 *
 * It refuses, with a reason, a material marked do-not-machine (§3), a tool
 * material the material has no data for, and inputs that are not valid.
 */
import { readMaterial, readTool, type Coolant, type Range, type SafetyNote, type ToolCuttingData } from '@synthetos/library';
import { predictAchievableFeed, type AchievableFeed } from './achievable.ts';
import {
  checkAxisMax,
  checkCoolant,
  checkDeflection,
  checkFrameLimits,
  checkPower,
  checkRubbing,
  checkSpindleRange,
  cuttingForceN,
  cuttingPowerKw,
  toolDeflectionMm,
  type Check,
} from './checks.ts';
import { nearestDialSetting, type DialChoice } from './dial.ts';
import { chipThinningFactor, chiploadAt, chiploadRange, feedRate, lerp, spindleSpeed, surfaceSpeed, type SpindleLimit } from './feeds.ts';
import { DEFAULT_MODEL, THRESHOLDS } from './model.ts';
import { InputLog, type Provenance } from './provenance.ts';
import { OPERATION_KINDS, type AdvisorContext, type OperationKind, type Programmed } from './types.ts';

export const LEVELS = Object.freeze(['conservative', 'balanced', 'aggressive'] as const);
export type Level = (typeof LEVELS)[number];
const LEVEL_T: Readonly<Record<Level, number>> = Object.freeze({ conservative: 0, balanced: 0.5, aggressive: 1 });

export type LevelLimit = SpindleLimit | 'axis-max';

export interface LevelResult {
  readonly level: Level;
  readonly rpm: number;
  readonly feed: number;
  /** Surface speed at `rpm`, m/min. */
  readonly vc: number;
  /** Target chipload (chip thickness), mm/tooth. */
  readonly fz: number;
  /** The chipload to program, after radial chip thinning. */
  readonly fzProgrammed: number;
  readonly limitedBy: readonly LevelLimit[];
  readonly powerKw: number | null;
  readonly deflectionMm: number | null;
  readonly checks: readonly Check[];
  /** Dial routers: the nearest dial position. */
  readonly dial: DialChoice | null;
}

export type Verdict = 'within' | 'check' | 'too-aggressive' | 'rubbing';

export interface Comparison {
  readonly programmed: Programmed;
  /** The chip thickness the programmed values cut (thinning removed), mm/tooth. */
  readonly fz: number;
  /** The same at the predicted achievable feed, when the path is known. */
  readonly fzAtAchievable: number | null;
  readonly checks: readonly Check[];
  readonly verdict: Verdict;
  readonly reasons: readonly string[];
  /** When rubbing: the spindle speed that restores the balanced chipload at the feed reached. */
  readonly suggestedRpm: number | null;
  readonly suggestedDial: DialChoice | null;
}

export type PlanRefusal = 'invalid-input' | 'do-not-machine' | 'no-cutting-data';

export type OperationPlan =
  | {
      readonly ok: true;
      readonly operation: OperationKind;
      readonly levels: Readonly<Record<Level, LevelResult>>;
      readonly comparison: Comparison | null;
      readonly achievable: AchievableFeed | null;
      readonly provenance: Provenance;
      /** Shown wherever the material is chosen, never hidden (§3). */
      readonly safety: readonly SafetyNote[];
      /** Notes that apply to every level ("S does not set this spindle"). */
      readonly notes: readonly string[];
    }
  | { readonly ok: false; readonly refusal: PlanRefusal; readonly message: string; readonly safety: readonly SafetyNote[] };

const VERDICT_FAILS = new Set(['spindle-power', 'axis-max', 'frame-ap', 'frame-ae', 'deflection', 'spindle-range']);

const fp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const mm3 = (v: number): string => v.toFixed(3);

function refusal(refusal: PlanRefusal, message: string, safety: readonly SafetyNote[] = []): OperationPlan {
  return Object.freeze({ ok: false, refusal, message, safety });
}

/** Why the context cannot be planned, or null. Records are checked with the library's own validators. */
function inputProblem(ctx: AdvisorContext): string | null {
  const tool = readTool(ctx.tool);
  if (!tool.ok) return `The tool is not valid: ${tool.issues.map((i) => `${i.path || '/'} ${i.message}`).join('; ')}`;
  const material = readMaterial(ctx.material);
  if (!material.ok) return `The material is not valid: ${material.issues.map((i) => `${i.path || '/'} ${i.message}`).join('; ')}`;
  const { machine, operation } = ctx;
  const s = machine.spindle;
  if (!(Number.isFinite(s.minRpm) && s.minRpm >= 0 && fp(s.maxRpm) && s.minRpm <= s.maxRpm && fp(s.powerKw))) {
    return 'The spindle needs a speed range (minimum at or below maximum) and a rated power.';
  }
  if (!(fp(machine.maxFeed.xy) && fp(machine.maxFeed.z))) return 'The axis maximum feeds must be positive numbers.';
  if (!['hobby', 'medium', 'rigid'].includes(machine.frameClass)) return 'The frame class is hobby, medium or rigid.';
  if (ctx.toolMaxRpm !== undefined && !(fp(ctx.toolMaxRpm) && ctx.toolMaxRpm >= s.minRpm)) return "The tool's maximum speed must be a positive number at or above the spindle minimum.";
  if (ctx.stickout !== undefined && !fp(ctx.stickout)) return 'The stickout must be a positive number.';
  if (!['none', 'air', 'mist', 'flood'].includes(ctx.coolant)) return 'Coolant is none, air, mist or flood.';
  if (!(OPERATION_KINDS as readonly string[]).includes(operation.kind)) return `"${operation.kind}" is not an operation kind.`;
  if (!fp(operation.ap) || !fp(operation.ae)) return 'The depth of cut and the stepover must be positive numbers.';
  if (operation.ae > ctx.tool.geometry.diameter) return 'The stepover is larger than the tool diameter.';
  if (operation.programmed !== undefined && !(fp(operation.programmed.feed) && fp(operation.programmed.rpm))) {
    return 'The programmed feed and spindle speed must be positive numbers.';
  }
  return null;
}

/** Manufacturer data beats Synthetos data; user and AI entries are not used as targets. */
function trustedCuttingData(ctx: AdvisorContext): ToolCuttingData | undefined {
  const forMaterial = ctx.tool.cuttingData.filter((c) => c.materialRef.id === ctx.material.id);
  return forMaterial.find((c) => c.source === 'manufacturer') ?? forMaterial.find((c) => c.source === 'synthetos');
}

interface Inputs {
  readonly diameter: number;
  readonly flutes: number;
  readonly ap: number;
  readonly ae: number;
  readonly thinning: number;
  readonly kc: number | undefined;
  readonly stickout: number | undefined;
  /** Undefined when the model has no spec for the tool type: deflection is then unknown. */
  readonly effectiveDiameter: number | undefined;
  readonly youngsModulusGPa: number;
  readonly finishing: boolean;
  readonly maxFeed: number;
  readonly coolant: { readonly need: 'required' | 'recommended' | 'none' | 'avoid'; readonly reason: string; readonly available: Coolant };
  readonly limit: { readonly ap: number; readonly ae: number };
}

function checksAt(i: Inputs, ctx: AdvisorContext, rpm: number, feed: number): { checks: Check[]; powerKw: number | null; deflectionMm: number | null } {
  const checks: Check[] = [];
  checks.push(checkPower({ ap: i.ap, ae: i.ae, vf: feed, kc: i.kc, powerKw: ctx.machine.spindle.powerKw }));
  checks.push(checkAxisMax(feed, i.maxFeed));
  checks.push(...checkFrameLimits(i.ap, i.ae, i.diameter, i.limit));
  const powerKw = i.kc === undefined ? null : cuttingPowerKw(i.ap, i.ae, feed, i.kc);
  let deflectionMm: number | null = null;
  if (ctx.operation.kind !== 'drill') {
    if (i.kc !== undefined && i.stickout !== undefined && i.effectiveDiameter !== undefined) {
      const force = cuttingForceN(i.ap, i.ae, feed, i.kc, i.diameter, rpm);
      deflectionMm = toolDeflectionMm(force, i.stickout, i.effectiveDiameter, i.youngsModulusGPa);
    }
    checks.push(checkDeflection(deflectionMm, i.finishing));
  }
  checks.push(checkCoolant(i.coolant.need, i.coolant.reason, i.coolant.available));
  return { checks, powerKw, deflectionMm };
}

export function planOperation(ctx: AdvisorContext): OperationPlan {
  const problem = inputProblem(ctx);
  if (problem !== null) return refusal('invalid-input', problem);
  const { tool, material, machine, operation } = ctx;
  const safety = material.safety;
  const doNotMachine = safety.find((s) => s.severity === 'do-not-machine');
  if (doNotMachine !== undefined) return refusal('do-not-machine', doNotMachine.text, safety);
  const cutting = material.cutting.find((c) => c.toolMaterial === tool.toolMaterial);
  if (cutting === undefined) return refusal('no-cutting-data', `${material.name} has no cutting data for ${tool.toolMaterial} tools.`, safety);

  const model = ctx.model ?? DEFAULT_MODEL;
  const log = new InputLog();
  const diameter = tool.geometry.diameter;
  const flutes = tool.geometry.flutes;
  const drilling = operation.kind === 'drill';
  const ae = drilling ? diameter : operation.ae;
  const frameFactor = log.use(`model.frameClassFactor.${machine.frameClass}`, model.frameClassFactor[machine.frameClass]);
  const engagement = log.use('material.cutting.engagement', cutting.engagement);
  const typeSpec = model.toolTypes.find((t) => t.type === tool.type);
  const ratio = typeSpec === undefined ? undefined : log.use(`model.toolTypes.${tool.type}.effectiveDiameterRatio`, typeSpec.effectiveDiameterRatio);
  const youngs = log.use(`model.toolMaterials.${tool.toolMaterial}.youngsModulusGPa`, model.toolMaterials[tool.toolMaterial].youngsModulusGPa);
  const kc = material.physical.kc === undefined ? undefined : log.use('material.physical.kc', material.physical.kc);

  let vcRange: Range;
  let fzRange: Range;
  const trusted = trustedCuttingData(ctx);
  if (trusted !== undefined && trusted.vc !== undefined) {
    log.cite({ kind: trusted.source === 'manufacturer' ? 'manufacturer' : 'synthetos', title: `${tool.name} cutting data for ${material.name}`, ...(trusted.note === '' ? {} : { locator: trusted.note }) });
    vcRange = { min: trusted.vc, max: trusted.vc };
    fzRange = { min: trusted.fz, max: trusted.fz };
  } else {
    vcRange = log.use('material.cutting.vc', cutting.vc);
    fzRange = chiploadRange(log.use('material.cutting.chipload', cutting.chipload), diameter);
  }

  const inputs: Inputs = {
    diameter,
    flutes,
    ap: operation.ap,
    ae,
    thinning: drilling ? 1 : chipThinningFactor(diameter, ae),
    kc,
    stickout: ctx.stickout ?? tool.geometry.stickout,
    effectiveDiameter: ratio === undefined ? undefined : ratio * diameter,
    youngsModulusGPa: youngs,
    finishing: operation.kind === 'finish',
    maxFeed: drilling ? machine.maxFeed.z : machine.maxFeed.xy,
    coolant: { need: material.coolant.need, reason: material.coolant.reason, available: ctx.coolant },
    limit: engagement[machine.frameClass],
  };
  const dialTable = machine.spindle.kind === 'dial-router' ? machine.spindle.dial : undefined;

  const levels = {} as Record<Level, LevelResult>;
  for (const level of LEVELS) {
    const t = LEVEL_T[level];
    const speed = spindleSpeed(lerp(vcRange, t), diameter, machine.spindle, ctx.toolMaxRpm);
    const fz = lerp(fzRange, t) * frameFactor;
    const fzProgrammed = fz * inputs.thinning;
    let rpm = speed.rpm;
    let feed = feedRate(rpm, flutes, fzProgrammed);
    const limitedBy: LevelLimit[] = speed.limitedBy === null ? [] : [speed.limitedBy];
    if (feed > inputs.maxFeed) {
      feed = inputs.maxFeed;
      rpm = feed / (flutes * fzProgrammed);
      limitedBy.push('axis-max');
      if (rpm < machine.spindle.minRpm) {
        rpm = machine.spindle.minRpm;
        if (!limitedBy.includes('spindle-min')) limitedBy.push('spindle-min');
      }
    }
    const at = checksAt(inputs, ctx, rpm, feed);
    levels[level] = Object.freeze({
      level,
      rpm,
      feed,
      vc: surfaceSpeed(rpm, diameter),
      fz,
      fzProgrammed,
      limitedBy: Object.freeze(limitedBy),
      powerKw: at.powerKw,
      deflectionMm: at.deflectionMm,
      checks: Object.freeze(at.checks),
      dial: dialTable === undefined ? null : nearestDialSetting(rpm, dialTable),
    });
  }

  const achieved =
    operation.path !== undefined && machine.motion !== undefined && operation.programmed !== undefined
      ? predictAchievableFeed(operation.path, operation.programmed.feed, machine.motion)
      : null;
  const achievable = achieved !== null && achieved.ok ? achieved.value : null;
  const comparison = operation.programmed === undefined ? null : compare(ctx, inputs, levels, operation.programmed, achievable, dialTable);

  const notes: string[] = [];
  if (!machine.spindle.sControlled) notes.push('S does not set this spindle: set the speed by hand.');
  if (achieved !== null && !achieved.ok) notes.push(`No achievable-feed estimate: ${achieved.reason}`);
  return Object.freeze({
    ok: true,
    operation: operation.kind,
    levels: Object.freeze(levels),
    comparison,
    achievable,
    provenance: log.result(),
    safety,
    notes: Object.freeze(notes),
  });
}

function compare(
  ctx: AdvisorContext,
  inputs: Inputs,
  levels: Readonly<Record<Level, LevelResult>>,
  programmed: Programmed,
  achievable: AchievableFeed | null,
  dialTable: AdvisorContext['machine']['spindle']['dial'],
): Comparison {
  const { flutes, thinning } = inputs;
  const spindle = ctx.machine.spindle;
  const fz = chiploadAt(programmed.feed, programmed.rpm, flutes) / thinning;
  const reachedFeed = achievable === null ? programmed.feed : Math.min(programmed.feed, achievable.averageFeed);
  const fzAtAchievable = achievable === null ? null : chiploadAt(reachedFeed, programmed.rpm, flutes) / thinning;
  const target = levels.balanced.fz;
  const at = checksAt(inputs, ctx, programmed.rpm, programmed.feed);
  const checks = [...at.checks, checkSpindleRange(programmed.rpm, spindle.minRpm, spindle.maxRpm, ctx.toolMaxRpm), checkRubbing(fzAtAchievable ?? fz, target)];
  const reasons = checks.filter((c) => c.status !== 'ok').map((c) => c.reason.message);
  const aggressive = levels.aggressive.fz;
  const overChip = fz > aggressive * (1 + THRESHOLDS.chiploadTolerance);
  if (overChip) reasons.push(`The programmed chipload ${mm3(fz)} mm is above the aggressive level (${mm3(aggressive)} mm).`);
  else reasons.push(`The programmed chipload is ${mm3(fz)} mm (levels ${mm3(levels.conservative.fz)}-${mm3(aggressive)} mm).`);
  if (achievable !== null) {
    reasons.push(`Estimate: this operation averages about ${Math.round(achievable.averageFeed)} of ${Math.round(programmed.feed)} mm/min (${Math.round(achievable.fraction * 100)} %).`);
  }

  let verdict: Verdict;
  if (overChip || checks.some((c) => c.status === 'fail' && VERDICT_FAILS.has(c.kind))) verdict = 'too-aggressive';
  else if (checks.some((c) => c.kind === 'rubbing' && c.status === 'fail')) verdict = 'rubbing';
  else if (checks.some((c) => c.status !== 'ok')) verdict = 'check';
  else verdict = 'within';

  let suggestedRpm: number | null = null;
  if (verdict === 'rubbing') {
    const wanted = reachedFeed / (flutes * levels.balanced.fzProgrammed);
    const ceiling = ctx.toolMaxRpm === undefined ? spindle.maxRpm : Math.min(spindle.maxRpm, ctx.toolMaxRpm);
    suggestedRpm = Math.min(ceiling, Math.max(spindle.minRpm, wanted));
    reasons.push(`Slow the spindle to about ${Math.round(suggestedRpm)} rpm to keep the chips thick.`);
  }
  return Object.freeze({
    programmed: Object.freeze({ ...programmed }),
    fz,
    fzAtAchievable,
    checks: Object.freeze(checks),
    verdict,
    reasons: Object.freeze(reasons),
    suggestedRpm,
    suggestedDial: suggestedRpm === null || dialTable === undefined ? null : nearestDialSetting(suggestedRpm, dialTable),
  });
}
