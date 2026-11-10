/** The planner model's inputs and outputs (planner/README in the module comments; docs/design/ANALYZE.md slice 2). */

export type PlannerAxisName = 'X' | 'Y' | 'Z';

/** One axis's motion settings as the board holds them, in millimetres: vm and fr mm/min, jm in million mm/min³, jd mm. */
export interface PlannerAxis {
  readonly vm: number;
  readonly fr: number;
  readonly jm: number;
  readonly jd: number;
  /** Steps per mm of the motor driving it (the largest when two motors share it), for the pulse-rate limit. */
  readonly stepsPerUnit?: number;
}

export interface PlannerProfile {
  readonly axes: Readonly<Record<PlannerAxisName, PlannerAxis>>;
  /** Junction acceleration, mm/min². */
  readonly ja: number;
  /** Chordal tolerance, mm. */
  readonly ct: number;
}

/** Why a block exits at the speed it does (TG's planner_timing.py `_exit_limit`). */
export type ExitLimit = 'end' | 'stop' | 'junction' | 'cruise' | 'accel' | 'lookahead';

/** The feed-limit tags of a block (feedlimit.h). */
export type Cause = 'axis_cap' | 'junction' | 'exact_stop' | 'short' | 'min_segment';

export interface PlannedBlock {
  /** File line. */
  readonly n: number;
  readonly kind: 'feed' | 'rapid' | 'arc-seg' | 'dwell';
  readonly lengthMm: number;
  /** mm/min, as planned when the block ran. */
  readonly entry: number;
  readonly cruise: number;
  readonly exit: number;
  /** Seconds, as the exec runs it: head (accelerate), body (cruise), tail (decelerate). */
  readonly seconds: number;
  readonly headS: number;
  readonly bodyS: number;
  readonly tailS: number;
  readonly exitLimit: ExitLimit | null;
  readonly causes: readonly Cause[];
}

export interface PlanResult {
  /** Motion plus dwells, seconds. */
  readonly seconds: number;
  readonly motionS: number;
  readonly dwellS: number;
  readonly blocks: readonly PlannedBlock[];
}
