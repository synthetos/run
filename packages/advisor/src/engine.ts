/**
 * The engine seam (MACHINING_ASSISTANT §5.3; §1 principles 2 and 3).
 *
 * - `AdvisorEngine` is the interface of §5.3: `plan` before the job,
 *   `coach` periodically (never in the real-time loop), `review` after it.
 * - `RulesEngine` is the default: local, offline and deterministic.
 * - `MockAiEngine` returns canned output, clearly labelled
 *   "AI assistant (preview)". No model is called; a `CloudAiEngine` (later)
 *   calls Claude through the Worker, never from this package.
 * - `GuardedEngine` wraps ANY engine. AI proposes, rules decide: whatever an
 *   engine returns is checked against a schema (structured data only, never
 *   free text turned into commands), its numbers are bounded (plan values to
 *   the machine and tool limits; live suggestions through the §6.4 envelope,
 *   `decideOverride`), its preview and placeholder flags are forced on for
 *   AI output, and its engine name is the engine's own. A throwing,
 *   malformed or malicious engine yields refusals, never a value outside the
 *   envelope.
 */
import { validateSchema } from '@synthetos/schema/json-schema';
import { decideOverride, type EnvelopeDecision, type EnvelopeInput, type OverrideState } from './envelope.ts';
import type { LiveEstimate } from './live.ts';
import { LEVELS, planOperation, type Level, type OperationPlan } from './plan.ts';
import { MAX_ENGINE_ITEMS, RECOMMENDATION_SCHEMA, REVIEW_SCHEMA, SUGGESTION_SCHEMA } from './schemas.ts';
import type { AdvisorContext, OperationKind, Programmed } from './types.ts';

export interface Recommendation {
  readonly level: Level;
  readonly rpm: number;
  readonly feed: number;
  readonly reasons: readonly string[];
  /** Preview output (any AI engine): shown as such, never as advice. */
  readonly preview: boolean;
  /** Computed from at least one placeholder value: shown with the flag, never as advice. */
  readonly placeholder: boolean;
  readonly engine: string;
  readonly dialSetting?: string;
}

/** A proposed live change: a scale, a feed or a spindle speed (the envelope makes it one joint scale). */
export interface Suggestion {
  readonly scale?: number;
  readonly feed?: number;
  readonly rpm?: number;
  readonly reason: string;
  readonly preview: boolean;
  readonly engine: string;
}

/** What `coach` sees: the live estimate and the targets, never a raw stream. */
export interface TelemetrySummary {
  readonly estimate: LiveEstimate;
  readonly programmed: Programmed;
  /** Target chipload, mm/tooth. */
  readonly targetChipload: number;
  /** Below this chipload the rules suggest slowing down, mm/tooth. */
  readonly floorChipload: number;
}

export interface JobOperationRecord {
  readonly id: string;
  readonly kind: OperationKind;
  readonly programmed: Programmed;
  /** The mean feed the machine achieved, mm/min. */
  readonly achievedFeed: number;
  readonly seconds: number;
}

export interface JobRecord {
  readonly operations: readonly JobOperationRecord[];
}

export interface ReviewFinding {
  readonly level: 'info' | 'warn';
  readonly text: string;
}

export interface Review {
  readonly summary: string;
  readonly findings: readonly ReviewFinding[];
  readonly preview: boolean;
  readonly engine: string;
}

export interface AdvisorEngine {
  readonly id: string;
  readonly kind: 'rules' | 'ai';
  available(): Promise<boolean>;
  /** Before the job. */
  plan(ctx: AdvisorContext): Promise<Recommendation[]>;
  /** Periodic, not real time. */
  coach(summary: TelemetrySummary): Promise<Suggestion[]>;
  /** After the job. */
  review(job: JobRecord): Promise<Review>;
}

const fp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const pct = (v: number): string => `${Math.round(v * 100)} %`;
const mm3 = (v: number): string => v.toFixed(3);

/** The rules engine's recommendation for one level of a plan. */
export function toRecommendation(plan: Extract<OperationPlan, { ok: true }>, level: Level, engine = 'rules'): Recommendation {
  const l = plan.levels[level];
  const reasons = l.checks.filter((c) => c.status !== 'ok').map((c) => c.reason.message);
  if (l.limitedBy.length > 0) reasons.push(`Limited by: ${l.limitedBy.join(', ')}.`);
  reasons.push(...plan.notes);
  if (plan.provenance.placeholder) reasons.push(`Placeholder data (${plan.provenance.placeholderInputs.join(', ')}): not advice until sourced.`);
  return Object.freeze({
    level,
    rpm: l.rpm,
    feed: l.feed,
    reasons: Object.freeze(reasons),
    preview: false,
    placeholder: plan.provenance.placeholder,
    engine,
    ...(l.dial === null ? {} : { dialSetting: l.dial.setting }),
  });
}

/**
 * The rules coach (§6.2, §6.3 Advise): when the live chipload is under the
 * floor, slow the spindle so the chip is the target again at the speed the
 * machine actually reaches. The feed scales with it (the envelope's ratio
 * rule) but never below the velocity already reached, where it changes
 * nothing.
 */
export function rulesCoach(summary: TelemetrySummary, engine = 'rules'): Suggestion[] {
  const { estimate: e, programmed, targetChipload, floorChipload } = summary;
  if (e.status !== 'ok' || !(fp(targetChipload) && fp(floorChipload) && fp(programmed.feed) && fp(programmed.rpm))) return [];
  const fzLive = e.fzLive as number;
  const meanVel = e.meanVel as number;
  if (fzLive >= floorChipload) return [];
  const scale = Math.max((e.rpm * fzLive) / (targetChipload * programmed.rpm), meanVel / programmed.feed);
  const cause =
    e.cause === 'planner-starving'
      ? ' The planner is starving: segments are short or the stream is slow.'
      : e.cause === 'machine-limited'
        ? ' Acceleration and jerk cap the speed at corners and short moves.'
        : '';
  const reason =
    `Slow down: averaging ${pct(e.feedRatio as number)} of programmed feed. Chipload ${mm3(fzLive)} mm is below the ${mm3(floorChipload)} mm floor. ` +
    `Spindle ${Math.round(programmed.rpm * scale)} rpm (${pct(scale - 1)}) keeps the chips thick.${cause}`;
  return [Object.freeze({ scale, reason, preview: false, engine })];
}

/** The rules review (§6.6): programmed against achieved feed per operation, and the time lost. */
export function rulesReview(job: JobRecord, engine = 'rules'): Review {
  const findings: ReviewFinding[] = [];
  let lost = 0;
  let counted = 0;
  for (const op of job.operations) {
    if (!(fp(op.programmed.feed) && fp(op.achievedFeed) && fp(op.seconds))) {
      findings.push({ level: 'info', text: `${op.id}: not enough data to review.` });
      continue;
    }
    counted++;
    const ratio = Math.min(1, op.achievedFeed / op.programmed.feed);
    const opLost = op.seconds * (1 - ratio);
    lost += opLost;
    findings.push({
      level: ratio < 0.9 ? 'warn' : 'info',
      text: `${op.id} (${op.kind}): ${pct(ratio)} of programmed feed${opLost >= 1 ? `, about ${Math.round(opLost)} s lost` : ''}.`,
    });
  }
  const summary = counted === 0 ? 'No operations to review.' : `${counted} operation(s) reviewed; about ${Math.round(lost)} s lost to feeds the machine did not reach.`;
  return Object.freeze({ summary, findings: Object.freeze(findings.map((f) => Object.freeze(f))), preview: false, engine });
}

export class RulesEngine implements AdvisorEngine {
  readonly id = 'rules';
  readonly kind = 'rules';

  async available(): Promise<boolean> {
    return true;
  }

  /** Three recommendations, or none when the plan is refused (call `planOperation` for the reason). */
  async plan(ctx: AdvisorContext): Promise<Recommendation[]> {
    const plan = planOperation(ctx);
    return plan.ok ? LEVELS.map((level) => toRecommendation(plan, level, this.id)) : [];
  }

  async coach(summary: TelemetrySummary): Promise<Suggestion[]> {
    return rulesCoach(summary, this.id);
  }

  async review(job: JobRecord): Promise<Review> {
    return rulesReview(job, this.id);
  }
}

export const MOCK_AI_LABEL = 'AI assistant (preview)';

/** Canned output, labelled as a preview. It calls no model and reads nothing from its inputs. */
export class MockAiEngine implements AdvisorEngine {
  readonly id = 'mock-ai';
  readonly kind = 'ai';
  readonly label = MOCK_AI_LABEL;

  async available(): Promise<boolean> {
    return true;
  }

  async plan(_ctx: AdvisorContext): Promise<Recommendation[]> {
    return [
      {
        level: 'balanced',
        rpm: 18_000,
        feed: 1200,
        reasons: [`${MOCK_AI_LABEL}: canned example output, not advice.`],
        preview: true,
        placeholder: true,
        engine: this.id,
      },
    ];
  }

  async coach(_summary: TelemetrySummary): Promise<Suggestion[]> {
    return [{ scale: 0.9, reason: `${MOCK_AI_LABEL}: canned example suggestion.`, preview: true, engine: this.id }];
  }

  async review(_job: JobRecord): Promise<Review> {
    return {
      summary: `${MOCK_AI_LABEL}: canned example review. No model was called.`,
      findings: [{ level: 'info', text: 'Canned preview output.' }],
      preview: true,
      engine: this.id,
    };
  }
}

// --- The guard -------------------------------------------------------------

export type BoundLimit = 'spindle-max' | 'tool-max' | 'spindle-min' | 'axis-max';

export interface BoundRecommendation extends Recommendation {
  readonly clampedBy: readonly BoundLimit[];
}

export interface EngineRefusal {
  /** The item's index, or -1 for the whole call. */
  readonly index: number;
  readonly reason: string;
}

export interface GuardedPlan {
  readonly engine: string;
  readonly recommendations: readonly BoundRecommendation[];
  readonly refused: readonly EngineRefusal[];
}

export interface GuardedCoach {
  readonly engine: string;
  readonly decisions: readonly { readonly suggestion: Suggestion; readonly decision: EnvelopeDecision }[];
  readonly refused: readonly EngineRefusal[];
  /** The override state after the decisions (unchanged unless one applied or reset). */
  readonly state: OverrideState;
}

export interface GuardedReview {
  readonly engine: string;
  readonly review: Review | null;
  readonly refused: readonly EngineRefusal[];
}

/**
 * Why plan values cannot be bounded for this context (its limits are not
 * valid numbers, or the tool's maximum is below the spindle's minimum), or
 * null. The guard refuses the whole call rather than pass a value it cannot
 * bound.
 */
export function planLimitsProblem(ctx: AdvisorContext): string | null {
  const { spindle, maxFeed } = ctx.machine;
  const spindleOk = Number.isFinite(spindle.minRpm) && spindle.minRpm >= 0 && fp(spindle.maxRpm) && spindle.minRpm <= spindle.maxRpm;
  if (!spindleOk || !fp(maxFeed.xy) || !fp(maxFeed.z)) return 'The machine limits are not valid numbers, so no engine value can be bounded.';
  if (ctx.toolMaxRpm !== undefined && !(fp(ctx.toolMaxRpm) && ctx.toolMaxRpm >= spindle.minRpm)) {
    return "The tool's maximum speed is not a number at or above the spindle minimum, so no engine value can be bounded.";
  }
  return null;
}

/** Bounds a plan value to the spindle's range, the tool's maximum and the axis maximum (limits checked by `planLimitsProblem`). */
export function boundRecommendation(rec: Recommendation, ctx: AdvisorContext): BoundRecommendation {
  const { spindle, maxFeed } = ctx.machine;
  const clampedBy: BoundLimit[] = [];
  let rpm = rec.rpm;
  if (ctx.toolMaxRpm !== undefined && ctx.toolMaxRpm < spindle.maxRpm && rpm > ctx.toolMaxRpm) {
    rpm = ctx.toolMaxRpm;
    clampedBy.push('tool-max');
  } else if (rpm > spindle.maxRpm) {
    rpm = spindle.maxRpm;
    clampedBy.push('spindle-max');
  }
  if (rpm < spindle.minRpm) {
    rpm = spindle.minRpm;
    clampedBy.push('spindle-min');
  }
  const feedMax = ctx.operation.kind === 'drill' ? maxFeed.z : maxFeed.xy;
  let feed = rec.feed;
  if (feed > feedMax) {
    feed = feedMax;
    clampedBy.push('axis-max');
  }
  return Object.freeze({ ...rec, rpm, feed, clampedBy: Object.freeze(clampedBy) });
}

type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

async function settle<T>(call: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `The engine failed: ${detail.slice(0, 200)}` };
  }
}

function schemaReason(errors: readonly { path: string; message: string }[]): string {
  return `Not a valid engine result: ${errors
    .slice(0, 3)
    .map((e) => `${e.path || '/'} ${e.message}`)
    .join('; ')}`;
}

/** Valid items of a list result, and refusals for the rest. */
function readList<T>(value: unknown, schema: Parameters<typeof validateSchema>[0]): { items: { index: number; item: T }[]; refused: EngineRefusal[] } {
  if (!Array.isArray(value)) return { items: [], refused: [{ index: -1, reason: 'The engine did not return a list.' }] };
  const items: { index: number; item: T }[] = [];
  const refused: EngineRefusal[] = [];
  value.forEach((item: unknown, index) => {
    if (index >= MAX_ENGINE_ITEMS) {
      refused.push({ index, reason: `More than ${MAX_ENGINE_ITEMS} items: ignored.` });
      return;
    }
    const errors = validateSchema(schema, item);
    if (errors.length > 0) refused.push({ index, reason: schemaReason(errors) });
    else items.push({ index, item: item as T });
  });
  return { items, refused };
}

export class GuardedEngine {
  readonly engine: AdvisorEngine;

  constructor(engine: AdvisorEngine) {
    this.engine = engine;
  }

  get id(): string {
    return this.engine.id;
  }

  /** AI output is always a preview and never counts as sourced. */
  get isAi(): boolean {
    return this.engine.kind !== 'rules';
  }

  async available(): Promise<boolean> {
    const r = await settle(() => this.engine.available());
    return r.ok && r.value === true;
  }

  async plan(ctx: AdvisorContext): Promise<GuardedPlan> {
    const limits = planLimitsProblem(ctx);
    if (limits !== null) return Object.freeze({ engine: this.id, recommendations: [], refused: [{ index: -1, reason: limits }] });
    const r = await settle(() => this.engine.plan(ctx));
    if (!r.ok) return Object.freeze({ engine: this.id, recommendations: [], refused: [{ index: -1, reason: r.reason }] });
    const { items, refused } = readList<Recommendation>(r.value, RECOMMENDATION_SCHEMA);
    const recommendations = items.map(({ item }) =>
      boundRecommendation({ ...item, engine: this.id, preview: item.preview || this.isAi, placeholder: item.placeholder || this.isAi }, ctx),
    );
    return Object.freeze({ engine: this.id, recommendations: Object.freeze(recommendations), refused: Object.freeze(refused) });
  }

  /**
   * Passes each valid suggestion through the envelope, in order, threading
   * the override state so that several suggestions in one call still obey
   * the rate limit. Forced returns to 100 % do not depend on an engine: the
   * caller runs `superviseOverride` on every status report.
   */
  async coach(summary: TelemetrySummary, envelope: EnvelopeInput): Promise<GuardedCoach> {
    const r = await settle(() => this.engine.coach(summary));
    if (!r.ok) return Object.freeze({ engine: this.id, decisions: [], refused: [{ index: -1, reason: r.reason }], state: envelope.state });
    const { items, refused } = readList<Suggestion>(r.value, SUGGESTION_SCHEMA);
    let state = envelope.state;
    const decisions = items.map(({ item }) => {
      const suggestion: Suggestion = Object.freeze({ ...item, engine: this.id, preview: item.preview || this.isAi });
      const proposal = { ...(item.scale === undefined ? {} : { scale: item.scale }), ...(item.feed === undefined ? {} : { feed: item.feed }), ...(item.rpm === undefined ? {} : { rpm: item.rpm }) };
      const decision = decideOverride({ ...envelope, state }, proposal);
      if (decision.kind === 'apply' || decision.kind === 'reset') state = decision.state;
      return Object.freeze({ suggestion, decision });
    });
    return Object.freeze({ engine: this.id, decisions: Object.freeze(decisions), refused: Object.freeze(refused), state });
  }

  async review(job: JobRecord): Promise<GuardedReview> {
    const r = await settle(() => this.engine.review(job));
    if (!r.ok) return Object.freeze({ engine: this.id, review: null, refused: [{ index: -1, reason: r.reason }] });
    const errors = validateSchema(REVIEW_SCHEMA, r.value);
    if (errors.length > 0) return Object.freeze({ engine: this.id, review: null, refused: [{ index: -1, reason: schemaReason(errors) }] });
    const review = r.value;
    return Object.freeze({ engine: this.id, review: Object.freeze({ ...review, engine: this.id, preview: review.preview || this.isAi }), refused: [] });
  }
}
