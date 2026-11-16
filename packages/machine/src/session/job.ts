/**
 * The Phase 3 job layer of the session reducer: streaming a whole G-code file (owner 2026-11-02; SAFETY §4.4a,
 * H70-H78; T-S108-T-S115).
 *
 * Pure functions over the reducer's transition, like motion.ts: they read the state, queue lines and realtime
 * bytes as effects and arm the `job` timer. The reducer calls them only when the session's release has jobs;
 * every intent has passed the allow-matrix first, and every line and byte is checked again by the write gate
 * when it is written (writePolicy.ts).
 *
 * What runs here:
 * - **Load** (H73): the file text is sanitised HERE, in the worker, with the live board's limits, offsets and
 *   modes read for it (`jobPrep` reads), never the preview's offline model (SAFETY §4.7). The lines never leave
 *   the worker; the page sees a summary.
 * - **Start**: the page's confirmations are checked again (homed or C36, the work zero C31, the spindle C32),
 *   then PREAMBLE: the prep reads are taken again and the file is sanitised again with the board's current
 *   position, offsets, modes and limits (`checking`; a jog, an offset, a settings write or a mode change since the
 *   load would otherwise leave the checked lines stale: independent review 2026-11-03, R3), then the line mode is
 *   read and set to 1 if it is not (`{"rxm":1}`, its own reviewed intent, read back), the footer must then be
 *   revision 3 (line mode, `f[2]` the free line slots), the feed-limit window and the job flag are sent where the
 *   board has them, and the job runs.
 * - **Streaming** (H76): a line is written only while the last footer's free slots, less every job line still
 *   owed an answer, leave more than `reserve` slots for control lines (`!`, `~`, `%` and `{...}` lines are served
 *   first by the board). The answers to data lines come in order; a refused line (non-zero status) holds the job
 *   at that line (H70), whether it was running or already pausing or paused: only Stop job or "Skip line" (C33)
 *   resumes it (independent review 2026-11-03, R4). Feeding stops before a tool change (H74) and a breakpoint
 *   (H75), after a program stop line (H36), and the final M2/M30 is held back until every earlier line is
 *   answered (H35).
 * - **Tool change** (H74): drained, then `M5` and `M9` are written and must each be answered with status 0
 *   (`outputsOff`) before the card says the outputs are off (W37) and the change-ready state is offered; a refusal
 *   or a missing answer ends the job with "use your E-stop" (independent review 2026-11-03, R6). The return after
 *   the change runs in explicit absolute millimetres (`G90 G21` on its own answered line) and puts the job's
 *   distance mode and units back before the job goes on (R1).
 * - **Pause** is `!`, **Resume** is `~` and streaming goes on from where it was; **Stop job** is the motion
 *   layer's flush sequence (`!`, `%` once held, `M5`, `M9`), then "Stopped at line N" (W42).
 *
 * Every decision about the machine uses polled `stat`, `hold`, `vel`, `qr` (SAFETY §4.2) of the poll cycle that
 * just completed, and only when all four were answered with status 0 (independent review 2026-11-03, R5), never
 * the last status report; the reported `line` drives progress and the planner view only.
 */
export { feedLimitWindow, foldFeedLimit, parseFeedMove, parseFeedSummary } from './feedLimit.ts';
export { type JobDeps, type JobLayerTx } from './job/contract.ts';
export { onJobFault, onJobLinkLost, onJobReset, onJobStop } from './job/endings.ts';
export { JOB_DIALECTS, JOB_LIMITS, JOB_PREP_TOKENS } from './job/limits.ts';
export { maybeRestoreLineMode, onLineModeAnswer, onLineModeMemory, rxmLine, rxmTarget } from './job/lineMode.ts';
export { abandonLoad, onJobPrepAnswer, onLoadJob, textHash } from './job/load.ts';
export { liveMotion, liveStart, sanitizeLive } from './job/model.ts';
export { onJobMotionAnswer, onJobMotionTimeout } from './job/outputs.ts';
export { onJobPoll, onJobTimer } from './job/polls.ts';
export { onJobPause, onJobResume } from './job/resume.ts';
export { FEED_ACCOUNTING_MIN_FB, feedAccountingSafe, feedLimitLine, feedLimitSupported, jobFlagLine, jobFlagSupported, onFeedLimit, onJobRuntimeAnswer } from './job/runtime.ts';
export { jobsCapable } from './job/shared.ts';
export { onJobBreakpoints, onStartJob, queuedLine } from './job/start.ts';
export { jobInFlight, onJobAnswer, pumpJob, slotRoom, statusMeaning } from './job/streaming.ts';
