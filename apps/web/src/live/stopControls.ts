/**
 * The workspace page's stop controls (ROADMAP P1-06): the W2 Pause button,
 * Escape, and the observer tab's Pause-request and Stop-job-request
 * buttons, with what the safety bar shows for them.
 *
 * Started by the workspace entry right after hydration and before LIVE
 * entry is mounted, so Escape and the requests work whatever happens to
 * sign-in, the advisory or LIVE entry (DECISIONS D1: stop is never gated).
 *
 * Pause, from the button or Escape:
 * 1. In a LIVE tab, the feedhold intent goes straight to this tab's worker.
 * 2. In every tab, a `pause` stop request is broadcast to every machine
 *    worker of this browser (all LIVE machines, SAFETY §4.3), and each
 *    machine's acknowledgement is reported; a missing one is STOP NOT
 *    DELIVERED.
 * Both happen synchronously in the event handler (T-S18, T-S19); nothing
 * is awaited first.
 */
import { signal, type Signal } from '@preact/signals';
import type { SnapshotMessage } from '../machine-worker/rpc.ts';
import type { StopAction } from '../machine-worker/stopChannel.ts';
import type { StopBarView } from '../shell/SafetyBar.ts';
import { NO_ROLE, type StopOutcome, type TabRole, type Timers } from './tabStop.ts';

/** The worker's snapshot, typed through the worker RPC (T-S39: no page module imports @synthetos/machine). */
type SessionSnapshot = SnapshotMessage['snapshot'];

/** How long a "delivered" line stays in the safety bar. A STOP NOT DELIVERED stays until the next request. */
export const DELIVERED_SHOWN_MS = 5000;
/** How long "Pausing…" waits for a report of the hold before it says the board has not answered (SAFETY §4.4 step 4). */
export const PAUSE_ANSWER_MS = 2000;

export const IDLE_VIEW: StopBarView = Object.freeze({ available: false, prominent: false, band: null, outcome: null });

/** Machine classes during which something may be moving or held (Pause and Stop job are shown prominently). */
const MOVING_CLASSES: ReadonlySet<string> = new Set(['running', 'held', 'probing', 'homing', 'jogging', 'programStop', 'unknown', 'initializing']);

/**
 * True when anything could be moving, held or queued on this tab's machine: a moving or held class, a
 * non-zero velocity, motion this page did not send (ORPHANED_MOTION), or a lost link (it may still be
 * moving). Pause and Stop job are then prominent; otherwise quiet. They are never disabled by this.
 */
export function mayBeMoving(snapshot: SessionSnapshot | null): boolean {
  if (snapshot === null || snapshot.base === 'NOT_CONNECTED') return false;
  if (snapshot.overlays.includes('ORPHANED_MOTION') || snapshot.overlays.includes('LOST') || snapshot.overlays.includes('FAULT')) return true;
  const live = snapshot.live;
  if (typeof live.vel === 'number' && live.vel !== 0) return true;
  if (finishedCycle(snapshot)) return false;
  return live.machineClass !== undefined && MOVING_CLASSES.has(live.machineClass);
}

/** True when the last report says the machine is at rest (idle or ended) with nothing queued from elsewhere. */
export function atRest(snapshot: SessionSnapshot | null): boolean {
  if (snapshot === null || snapshot.base === 'NOT_CONNECTED' || mayBeMoving(snapshot)) return false;
  return snapshot.live.machineClass === 'idle' || snapshot.live.machineClass === 'end' || finishedCycle(snapshot);
}

/**
 * The page's copy of the one stat-3 rule (SAFETY H14 as amended 2026-11-02; machine session resting.ts): on
 * edge-next only, PROGRAM_STOP with hold 0 and no velocity is a finished cycle, not a pause. A program pause
 * (M0, hold 6) and every other dialect keep stat 3 as held or moving.
 */
function finishedCycle(snapshot: SessionSnapshot): boolean {
  const live = snapshot.live;
  return snapshot.classification?.dialectId === 'tinyg-en' && live.machineClass === 'programStop' && live.hold === 0 && live.vel === 0;
}

export interface StopControlsDeps {
  /** Broadcasts a stop request and resolves with each machine's outcome (TabStop.request). */
  readonly broadcast: (action: StopAction) => Promise<StopOutcome>;
  /** Sends the feedhold intent straight to this tab's worker (only called while LIVE). */
  readonly pauseOwnWorker: () => void;
  /** Sends the Stop job intent straight to this tab's worker (only called while LIVE; Phase 1 answers with `!`). */
  readonly stopJobOwnWorker?: () => void;
  readonly timers: Timers;
}

export class StopControls {
  readonly view: Signal<StopBarView> = signal(IDLE_VIEW);
  readonly role: Signal<TabRole> = signal(NO_ROLE);
  /** Whether this tab is LIVE, for the observer panel. */
  readonly liveState: Signal<boolean> = signal(false);
  readonly #deps: StopControlsDeps;
  #live = false;
  #holdWanted = false;
  #snapshot: SessionSnapshot | null = null;
  #outcome: StopBarView['outcome'] = null;
  #clearOutcome: unknown = null;
  #requests = 0;
  /** The machine was at rest when the latest Pause was pressed (the message then says nothing changed). */
  #idleAtPress = false;
  /**
   * What the latest Pause has come to in this LIVE tab (SAFETY §4.4 step 4, amended 2026-11-02): `pausing`
   * until a hold is reported, `no-answer` when none was within PAUSE_ANSWER_MS, `idle` when the machine was
   * or came to rest. A reported hold is shown from the snapshot itself.
   */
  #pausePhase: 'none' | 'pausing' | 'no-answer' | 'idle' = 'none';
  #pauseTimer: unknown = null;

  constructor(deps: StopControlsDeps) {
    this.#deps = deps;
  }

  get live(): boolean {
    return this.#live;
  }

  /** The W2 button and Escape. */
  pause(): void {
    this.#idleAtPress = this.#live && atRest(this.#snapshot);
    if (this.#live) {
      this.#holdWanted = !this.#idleAtPress;
      this.#setPausePhase(this.#idleAtPress ? 'idle' : this.#held() ? 'none' : 'pausing');
      try {
        this.#deps.pauseOwnWorker();
      } catch {
        // The broadcast below still reaches this tab's worker.
      }
    }
    this.request('pause');
  }

  /**
   * The Stop job button. In a LIVE tab the intent goes straight to this tab's worker, then a `stopJob`
   * request is broadcast to every machine worker of this browser, like Pause (SAFETY §4.3). Phase 1
   * answers Stop job with `!` only (SAFETY §4.4 READ_ONLY row); the outcome line says so.
   */
  stopJob(): void {
    this.#idleAtPress = false;
    if (this.#pausePhase === 'idle') this.#setPausePhase('none');
    if (this.#live) {
      try {
        this.#deps.stopJobOwnWorker?.();
      } catch {
        // The broadcast below still reaches this tab's worker.
      }
    }
    this.request('stopJob');
  }

  /** A stop request to every machine worker (the observer's buttons, and step 2 of Pause). */
  request(action: StopAction): void {
    if (action !== 'pause') this.#idleAtPress = false;
    const n = ++this.#requests;
    const sent = this.#deps.broadcast(action);
    this.#draw();
    void sent.then((outcome) => {
      if (n !== this.#requests) return; // A newer request owns the line.
      this.#show(outcome);
    });
  }

  setLive(live: boolean): void {
    if (live === this.#live) return;
    this.#live = live;
    this.liveState.value = live;
    if (!live) {
      this.#holdWanted = false;
      this.#snapshot = null;
      this.#setPausePhase('none');
    }
    this.#draw();
  }

  setSnapshot(snapshot: SessionSnapshot | null): void {
    this.#snapshot = snapshot;
    if (this.#pausePhase === 'pausing' || this.#pausePhase === 'no-answer') {
      if (this.#held()) this.#setPausePhase('none');
      else if (atRest(snapshot)) {
        // Nothing was moving any more, so the feedhold had nothing to hold (TinyG ignores it at rest).
        this.#holdWanted = false;
        this.#setPausePhase('idle');
      }
    }
    this.#draw();
  }

  #held(): boolean {
    return this.#live && this.#snapshot?.live.machineClass === 'held';
  }

  #setPausePhase(phase: 'none' | 'pausing' | 'no-answer' | 'idle'): void {
    if (this.#pauseTimer !== null) this.#deps.timers.clearTimeout(this.#pauseTimer);
    this.#pauseTimer = null;
    this.#pausePhase = phase;
    if (phase === 'pausing') {
      this.#pauseTimer = this.#deps.timers.setTimeout(() => {
        this.#pauseTimer = null;
        if (this.#pausePhase !== 'pausing') return;
        this.#pausePhase = 'no-answer';
        this.#draw();
      }, PAUSE_ANSWER_MS);
    } else if (phase === 'idle') {
      this.#pauseTimer = this.#deps.timers.setTimeout(() => {
        this.#pauseTimer = null;
        this.#pausePhase = 'none';
        this.#draw();
      }, DELIVERED_SHOWN_MS);
    }
  }

  setRole(role: TabRole): void {
    this.role.value = role;
    this.#draw();
  }

  #show(outcome: StopOutcome): void {
    if (this.#clearOutcome !== null) this.#deps.timers.clearTimeout(this.#clearOutcome);
    this.#clearOutcome = null;
    this.#outcome =
      outcome.kind === 'no-machine'
        ? null
        : { kind: outcome.kind, action: outcome.action, machines: outcome.machines, ...(outcome.kind === 'delivered' && outcome.action === 'pause' && this.#idleAtPress ? { idle: true } : {}) };
    if (outcome.kind === 'delivered') {
      this.#clearOutcome = this.#deps.timers.setTimeout(() => {
        this.#clearOutcome = null;
        this.#outcome = null;
        this.#draw();
      }, DELIVERED_SHOWN_MS);
    }
    this.#draw();
  }

  #draw(): void {
    const role = this.role.value;
    const held = this.#held();
    const phase = this.#live ? this.#pausePhase : 'none';
    this.view.value = Object.freeze({
      available: this.#live || role.observing || role.released.length > 0,
      prominent: (this.#live && (mayBeMoving(this.#snapshot) || this.#holdWanted)) || role.released.length > 0,
      band: held ? 'held' : phase === 'pausing' ? 'pausing' : phase === 'no-answer' ? 'pause-no-answer' : phase === 'idle' ? 'paused-idle' : null,
      outcome: this.#outcome,
    });
  }
}
