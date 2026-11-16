/**
 * The read-only session statechart as a pure reducer (ROADMAP P1-02; SAFETY
 * §3, §4.1, §4.4; PN §2.3; OLD-TP §4.2).
 *
 * `reduce(config, state, event)` returns the next state and the effects the
 * executor (machineSession.ts) must carry out. It reads no clock, timer,
 * port or global: time arrives in events, and timers are effects.
 *
 * The path: NOT_CONNECTED → PORT_REQUEST (the worker asks the build's
 * transport source for the chosen port) → OPENING → IDENTIFYING (the
 * capability probe, PN §2.3, `{sr:null}` first) → READING (`stat`,
 * `hold`, `vel`, `qr`, `ex`) → CONNECTED_UNKNOWN. The probe result and the
 * classification are recorded in the session log (a `log` effect). BLOCKED when the board's id is
 * not the selected machine's (T-S21): nothing more is written.
 *
 * Overlays (SAFETY §3), in precedence order FAULT > LOST > ORPHANED_MOTION >
 * UNKNOWN > STALE > READ_ONLY > NEEDS_REVIEW:
 * - FAULT: a banner after the board was ready (T-S10), a write failure or a
 *   refused write, an unexpected response, a footer revision change, an
 *   `er` report, a board that keeps resetting during the probe. Latched;
 *   `ackFault` completes only when two polled reads 250 ms apart show
 *   `hold` = 0 and `qr` = the dialect's `plannerBlocks`, then the board is
 *   probed again from `{sr:null}`.
 * - LOST: the link dropped. The port is closed; acknowledging it returns to
 *   NOT_CONNECTED and the next connect starts with UNKNOWN.
 * - ORPHANED_MOTION: no answer to a probe GET (3 s for the first line), an
 *   unsolicited report showing motion while connecting, or READING finds
 *   the board not idle (`stat` not idle/end, `hold` ≠ 0, `vel` ≠ 0, `qr`
 *   not `plannerBlocks`). A boot banner while unclassified ends it (the
 *   reset ended the motion) and the probe restarts.
 * - UNKNOWN: after LOST, after a reset banner.
 * - STALE: the receive watchdog (SAFETY §4.2, P1-04). On a classified,
 *   connected link, after `livenessIdleMs` of received silence the session
 *   asks for proof of life: ENQ on edge-next after a rev-2/3 footer (at
 *   most one outstanding), otherwise a `stat` GET. No byte within
 *   `staleAfterMs` of asking is unexpected silence: STALE. A read after
 *   classification that goes unanswered is STALE as well. Cleared by the
 *   next line received. With the heartbeat on, the window is
 *   `reportSilenceMs` and ends in STALE with nothing sent, except while the
 *   machine is held, dwelling or queued without stepping (the heartbeat is
 *   silent then): one ask per window, STALE only if it goes unanswered.
 * - READ_ONLY: the classifier returned READ_ONLY, or READING found `ex`
 *   other than 0, 1 or 2 (2 is RTS/CTS, accepted since OD-33 with RTS held
 *   on after every open, rts.ts; an unread `ex` counts as unknown, fail
 *   closed).
 * - NEEDS_REVIEW: a settings drift (the drift check that raises it arrives
 *   with the settings read; the overlay and its matrix rules exist now).
 *
 * Phase 1 writes (the only ones this file can produce): single-token GETs
 * from the probe list before classification and from the dialect's read
 * allowlist after it, ENQ (classified `tinyg-en`, after a rev-2/3 footer,
 * at most one outstanding), and the feedhold `!` for Pause, Stop job and
 * Spindle off (the last two with "Use your E-stop", SAFETY §4.4 READ_ONLY
 * row). Every intent goes through `safety.allowed` with the configured
 * release first, and every line through the matrix again when it is sent.
 */
import type { JobDeps } from './job.ts';
import type { MotionDeps } from './motion.ts';
import { bindAnswers } from './reducers/answers.ts';
import { bindBoot } from './reducers/boot.ts';
import { bindConnect } from './reducers/connect.ts';
import type { ReducerDeps } from './reducers/deps.ts';
import { bindEvents } from './reducers/events.ts';
import { bindFaults } from './reducers/faults.ts';
import { bindGarbled } from './reducers/garbled.ts';
import { bindIdentify } from './reducers/identify.ts';
import { bindInbound } from './reducers/inbound.ts';
import { bindIntents } from './reducers/intents.ts';
import { bindLive } from './reducers/live.ts';
import { bindReads } from './reducers/reads.ts';
import { bindReports } from './reducers/reports.ts';
import { bindSettings } from './reducers/settings.ts';
import { bindShared } from './reducers/shared.ts';
import { bindTimers } from './reducers/timers.ts';
import { Tx } from './reducers/transaction.ts';
import { createReducerValues } from './reducers/values.ts';
import { bindWatchdog } from './reducers/watchdog.ts';
import { bindWriting } from './reducers/writing.ts';

import type { ReducerFeatures } from './reducers/features.ts';
export type { ReducerFeatures, WorkspaceReducerFeatures } from './reducers/features.ts';

/** Compose per-instance dependencies; the event dispatcher preserves the original effect order. */
export function createSessionReducer(features: ReducerFeatures) {
  const deps = { features, ...createReducerValues() } as ReducerDeps;
  const MOTION_DEPS: MotionDeps = { fault: (...[t, cause, kind, detail, at]) => deps.enterFault(t as Tx, cause, kind, detail, at) };
  const JOB_DEPS: JobDeps = { fault: (...[t, cause, kind, detail, at]) => deps.enterFault(t as Tx, cause, kind, detail, at) };
  Object.assign(deps,
    bindShared(deps),
    bindReads(deps),
    bindSettings(deps),
    bindBoot(deps),
    bindFaults(deps),
    bindConnect(deps),
    bindIdentify(deps),
    bindLive(deps),
    bindReports(deps),
    bindWatchdog(deps),
    bindWriting(deps),
    bindTimers(deps),
    bindInbound(deps),
    bindAnswers(deps),
    bindGarbled(deps),
    bindIntents(deps),
    bindEvents(deps),
    { MOTION_DEPS, JOB_DEPS },
  );
  return {
    READING_TOKENS: deps.READING_TOKENS,
    FULL_SESSION_FLOW_CONTROL: deps.FULL_SESSION_FLOW_CONTROL,
    MOTION_READING_TOKENS: deps.MOTION_READING_TOKENS,
    VERIFY_TOKENS: deps.VERIFY_TOKENS,
    PROBE_TOKENS: deps.PROBE_TOKENS,
    initialState: deps.initialState,
    dialectOf: deps.dialectOf,
    matrixSnapshot: deps.matrixSnapshot,
    readableNow: deps.readableNow,
    enqAllowedNow: deps.enqAllowedNow,
    reduce: deps.reduce,
    settingWriteActive: deps.settingWriteActive,
    BOOT_LINE: deps.BOOT_LINE,
    probeRecord: deps.probeRecord,
    LIVENESS_TOKEN: deps.LIVENESS_TOKEN,
  };
}
