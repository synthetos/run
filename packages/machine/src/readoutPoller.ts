/**
 * Polled spindle and coolant readouts (DISPLAY ONLY).
 *
 * A stock board's status list (its answer to `{sr:null}`) does not carry the
 * edge-next readouts `spe`, `spc`, `sps`, `cof` and `com`. While a classified
 * board is connected, this poller asks for the ones the status list lacks,
 * about once a second, as plain GETs through `session.read`: the
 * allow-matrix, the read allowlist and the write gate decide each poll like
 * any other read, and the poller can only ask. It never configures the
 * status list.
 *
 * The answers land in `snapshot.values[token]` and are shown by the page.
 * They report the outputs as last driven, each sampled on its own, so they
 * are never a safety input: nothing that decides a write, a stop or an
 * overlay reads them (SAFETY §4.4; session-reducer tests).
 *
 * At most one poll is owed at a time: a tick while the previous poll is still
 * unanswered is skipped until `answerMs` passes and the poll is given up
 * (the same flow-budget rule as the `mpo` poller).
 */
import type { SessionClock } from './session/machineSession.ts';
import type { SessionSnapshot } from './session/snapshot.ts';
import { positionPollable, type PollTarget } from './positionPoller.ts';

/** About once a second. */
export const READOUT_POLL_MS = 1000;
/** A poll unanswered after this is given up (the session's read timeout). */
export const READOUT_POLL_ANSWER_MS = 2000;
/** The readouts polled when the status list lacks them. */
export const READOUT_TOKENS: readonly string[] = Object.freeze(['spe', 'spc', 'sps', 'cof', 'com']);

export interface ReadoutPollerOptions {
  readonly intervalMs?: number;
  readonly answerMs?: number;
}

/**
 * The readouts to poll for this snapshot: those the board's status list does not carry. Empty until the
 * status list is known (`live.srList`), and empty when the link is not pollable.
 */
export function readoutsToPoll(s: SessionSnapshot): readonly string[] {
  if (!positionPollable(s)) return [];
  const list = s.live.srList;
  if (list === undefined) return [];
  return READOUT_TOKENS.filter((t) => !list.includes(t));
}

export class ReadoutPoller {
  readonly #target: PollTarget;
  readonly #clock: SessionClock;
  readonly #intervalMs: number;
  readonly #answerMs: number;
  #timer: number | null = null;
  #owed: { readonly at: number; readonly epoch: number; readonly tokens: readonly string[] } | null = null;
  #polls = 0;

  constructor(target: PollTarget, clock: SessionClock, options: ReadoutPollerOptions = {}) {
    this.#target = target;
    this.#clock = clock;
    this.#intervalMs = options.intervalMs ?? READOUT_POLL_MS;
    this.#answerMs = options.answerMs ?? READOUT_POLL_ANSWER_MS;
  }

  /** Polls the session allowed. */
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
    const tokens = readoutsToPoll(s);
    if (tokens.length === 0) {
      this.#owed = null;
      return;
    }
    const now = this.#clock.now();
    const owed = this.#owed;
    if (owed !== null && owed.epoch === s.epoch) {
      const answered = owed.tokens.every((t) => (s.values[t]?.at ?? Number.NEGATIVE_INFINITY) >= owed.at);
      if (!answered && now - owed.at < this.#answerMs) return;
    }
    const decision = this.#target.read(tokens);
    if (decision.allowed) {
      this.#owed = { at: now, epoch: s.epoch, tokens };
      this.#polls++;
    } else {
      this.#owed = null;
    }
  }
}
