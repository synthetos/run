/**
 * Polled machine position (ROADMAP P1-07; SAFETY §4.2 "Polled reads").
 *
 * EN's default status report has no `mpo*`, and filtered reports do not
 * repeat unchanged values, so the machine DRO and the live marker never
 * trust status reports for machine position: they show only what an
 * explicit `{"mpo":null}` GET answered (`snapshot.values.mpo`, with its
 * receive time).
 *
 * The poller asks the session for that GET every `intervalMs` (500 ms,
 * the §4.2 `mpo` cadence) while a classified board is connected. At most
 * one poll is owed at a time: a tick while the previous poll is still
 * unanswered is skipped (the §4.2 flow-budget rule), until `answerMs`
 * passes and the poll is given up. Every poll goes through
 * `session.read`, so the allow-matrix, the read allowlist and the write
 * gate decide it like any other read; the poller can only ask.
 */
import type { Decision } from '@synthetos/safety';
import type { SessionClock } from './session/machineSession.ts';
import type { SessionSnapshot } from './session/snapshot.ts';
import { READY_BASES } from './session/types.ts';

/** SAFETY §4.2: `mpo` every 500 ms. */
export const MPO_POLL_MS = 500;
/** A poll unanswered after this is given up and the next tick polls again (the session's read timeout). */
export const MPO_POLL_ANSWER_MS = 2000;
/** The group GET the poller sends. */
export const MPO_TOKEN = 'mpo';

export interface PollTarget {
  readonly snapshot: SessionSnapshot;
  read(tokens: readonly string[]): Decision;
}

export interface PositionPollerOptions {
  readonly intervalMs?: number;
  readonly answerMs?: number;
}

/** True when a classified board is connected and the link is neither LOST nor in FAULT. */
export function positionPollable(s: SessionSnapshot): boolean {
  return READY_BASES.has(s.base) && s.classification?.dialectId != null && !s.overlays.includes('LOST') && !s.overlays.includes('FAULT');
}

export class PositionPoller {
  readonly #target: PollTarget;
  readonly #clock: SessionClock;
  readonly #intervalMs: number;
  readonly #answerMs: number;
  #timer: number | null = null;
  /** When the owed poll was asked for, and on which link. */
  #owed: { readonly at: number; readonly epoch: number } | null = null;
  #polls = 0;

  constructor(target: PollTarget, clock: SessionClock, options: PositionPollerOptions = {}) {
    this.#target = target;
    this.#clock = clock;
    this.#intervalMs = options.intervalMs ?? MPO_POLL_MS;
    this.#answerMs = options.answerMs ?? MPO_POLL_ANSWER_MS;
  }

  /** Polls the session asked for (allowed reads only). */
  get polls(): number {
    return this.#polls;
  }

  start(): void {
    if (this.#timer !== null) return;
    this.#arm();
  }

  stop(): void {
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
    this.#owed = null;
  }

  #arm(): void {
    this.#timer = this.#clock.setTimeout(() => {
      this.#tick();
      this.#arm();
    }, this.#intervalMs);
  }

  #tick(): void {
    const s = this.#target.snapshot;
    if (!positionPollable(s)) {
      this.#owed = null;
      return;
    }
    const now = this.#clock.now();
    const owed = this.#owed;
    if (owed !== null && owed.epoch === s.epoch) {
      const answeredAt = s.values[MPO_TOKEN]?.at ?? Number.NEGATIVE_INFINITY;
      if (answeredAt < owed.at && now - owed.at < this.#answerMs) return;
    }
    const decision = this.#target.read([MPO_TOKEN]);
    if (decision.allowed) {
      this.#owed = { at: now, epoch: s.epoch };
      this.#polls++;
    } else {
      this.#owed = null;
    }
  }
}
