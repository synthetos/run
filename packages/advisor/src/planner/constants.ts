/**
 * The TinyG planner's constants, pinned to the firmware build this model reproduces (OD-27: "we need to make sure
 * the tg motion profiles doesn't change or this preview will too"). @cite TinyG 450.02 (a7489b79) planner.h,
 * planner sources_sha256 cc87325c91799513035e665cf697552783794abb61cbd6dbd0112c22f5a6abdf. A firmware build with
 * other planner sources is a new model to validate against TG's host replay, not a silent change here.
 */

/** The firmware build whose planner this model reproduces. */
export const PLANNER_BUILD = Object.freeze({ fb: 450.02, commit: 'a7489b79', sourcesSha256: 'cc87325c91799513035e665cf697552783794abb61cbd6dbd0112c22f5a6abdf' });

export const MICROSECONDS_PER_MINUTE = 60_000_000;
export const PLANNER_BUFFER_POOL_SIZE = 32;
/** Buffers kept free before an arc segment is queued (cm_arc_callback). */
export const PLANNER_BUFFER_HEADROOM = 12;
/** Blocks queued before the oldest runs, as the host replay streams them (planner_timing.py: replay batch 28). */
export const QUEUE_BATCH = 28;
export const JERK_MULTIPLIER = 1_000_000;
export const JERK_MATCH_PRECISION = 1000;
export const NOM_SEGMENT_TIME = 5000 / MICROSECONDS_PER_MINUTE;
export const MIN_SEGMENT_TIME = 2500 / MICROSECONDS_PER_MINUTE;
export const MIN_BLOCK_TIME = MIN_SEGMENT_TIME;
export const MIN_SEGMENT_TIME_PLUS_MARGIN = 2501 / MICROSECONDS_PER_MINUTE;
export const MIN_ARC_SEGMENT_USEC = 10_000;
export const TRAPEZOID_ITERATION_ERROR_PERCENT = 0.1;
/** fp_EQ, fp_ZERO (util.h). */
export const EPSILON = 0.00001;
/** The DDA frequency the motor pulse-rate limit uses (st_refresh_move_time: 90% of it). */
export const FREQUENCY_DDA = 50_000;
/** Junction cases (_get_junction_vmax). */
export const STRAIGHT_JUNCTION = 10_000_000;
export const EXACT_STOP_OFF = 8675309;
