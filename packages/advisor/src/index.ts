/**
 * @synthetos/advisor
 *
 * The feeds and speeds advisor (MACHINING_ASSISTANT §5, §6, §9): the
 * deterministic rules model (spindle speed, chipload with frame-class factor
 * and radial chip thinning, feed, and the envelope checks), the
 * achievable-feed estimate, the live chipload estimator, the §6.4 override
 * envelope, dial-router mapping, and the `AdvisorEngine` seam with
 * `RulesEngine`, `MockAiEngine` and the `GuardedEngine` every engine's
 * output passes through.
 *
 * Pure and deterministic: no clock, no randomness, no network API, no
 * machine, protocol, contracts or cloud client import
 * (.dependency-cruiser.cjs `layer-advisor`). It imports only
 * `@synthetos/library` and the repository's JSON Schema validator.
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

export * from './types.ts';
export * from './analysis/index.ts';
export { DEFAULT_MODEL, THRESHOLDS } from './model.ts';
export type { ModelData } from './model.ts';
export { InputLog } from './provenance.ts';
export type { Provenance } from './provenance.ts';
export { chipThinningFactor, chiploadAt, chiploadRange, feedRate, lerp, spindleSpeed, surfaceSpeed } from './feeds.ts';
export type { SpindleLimit, SpindleSpeed } from './feeds.ts';
export {
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
} from './checks.ts';
export type { Check, CheckKind, CheckReason, CheckStatus } from './checks.ts';
export { ACHIEVABLE_MODEL, predictAchievableFeed } from './achievable.ts';
export type { AchievableFeed, AchievableResult } from './achievable.ts';
export { LEVELS, planOperation } from './plan.ts';
export type { Comparison, Level, LevelLimit, LevelResult, OperationPlan, PlanRefusal, Verdict } from './plan.ts';
export { LIVE_DEFAULTS, LIVE_MAX_SAMPLES, LiveChiploadWindow, MOMO_RAPID, STAT_RUN, estimateLiveChipload } from './live.ts';
export type { LiveCause, LiveChiploadOptions, LiveEstimate, LiveExclusions, StatusSample } from './live.ts';
export { ENVELOPE, PROGRAMMED_STATE, decideOverride, forcedReason, superviseOverride } from './envelope.ts';
export type {
  Clamp,
  EnvelopeDecision,
  EnvelopeInput,
  EnvelopeLimits,
  ForcedReason,
  HoldReason,
  MachineCondition,
  OverrideProposal,
  OverrideState,
  RefusalReason,
} from './envelope.ts';
export { EXAMPLE_DIALS, dialAdvice, dialTableProblem, groupThousands, nearestDialSetting } from './dial.ts';
export type { DialChoice } from './dial.ts';
export { MAX_ENGINE_ITEMS, RECOMMENDATION_SCHEMA, REVIEW_SCHEMA, SUGGESTION_SCHEMA } from './schemas.ts';
export {
  GuardedEngine,
  MOCK_AI_LABEL,
  MockAiEngine,
  RulesEngine,
  boundRecommendation,
  planLimitsProblem,
  rulesCoach,
  rulesReview,
  toRecommendation,
} from './engine.ts';
export type {
  AdvisorEngine,
  BoundLimit,
  BoundRecommendation,
  EngineRefusal,
  GuardedCoach,
  GuardedPlan,
  GuardedReview,
  JobOperationRecord,
  JobRecord,
  Recommendation,
  Review,
  ReviewFinding,
  Suggestion,
  TelemetrySummary,
} from './engine.ts';
