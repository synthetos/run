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
import type { SessionSnapshot } from '@synthetos/machine';
import type { StopAction } from '../machine-worker/stopChannel.ts';
import type { StopBarView } from '../shell/SafetyBar.ts';
import { NO_ROLE, type StopOutcome, type TabRole, type Timers } from './tabStop.ts';

/** How long a "delivered" line stays in the safety bar. A STOP NOT DELIVERED stays until the next request. */
export const DELIVERED_SHOWN_MS = 5000;

export const IDLE_VIEW: StopBarView = Object.freeze({ available: false, band: null, outcome: null });

export interface StopControlsDeps {
  /** Broadcasts a stop request and resolves with each machine's outcome (TabStop.request). */
  readonly broadcast: (action: StopAction) => Promise<StopOutcome>;
  /** Sends the feedhold intent straight to this tab's worker (only called while LIVE). */
  readonly pauseOwnWorker: () => void;
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

  constructor(deps: StopControlsDeps) {
    this.#deps = deps;
  }

  get live(): boolean {
    return this.#live;
  }

  /** The W2 button and Escape. */
  pause(): void {
    if (this.#live) {
      this.#holdWanted = true;
      try {
        this.#deps.pauseOwnWorker();
      } catch {
        // The broadcast below still reaches this tab's worker.
      }
    }
    this.request('pause');
  }

  /** A stop request to every machine worker (the observer's buttons, and step 2 of Pause). */
  request(action: StopAction): void {
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
    }
    this.#draw();
  }

  setSnapshot(snapshot: SessionSnapshot | null): void {
    this.#snapshot = snapshot;
    this.#draw();
  }

  setRole(role: TabRole): void {
    this.role.value = role;
    this.#draw();
  }

  #show(outcome: StopOutcome): void {
    if (this.#clearOutcome !== null) this.#deps.timers.clearTimeout(this.#clearOutcome);
    this.#clearOutcome = null;
    this.#outcome = outcome.kind === 'no-machine' ? null : { kind: outcome.kind, action: outcome.action, machines: outcome.machines };
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
    const held = this.#live && this.#snapshot?.live.machineClass === 'held';
    this.view.value = Object.freeze({
      available: this.#live || role.observing || role.released.length > 0,
      band: held ? 'held' : this.#live && this.#holdWanted ? 'pause-requested' : null,
      outcome: this.#outcome,
    });
  }
}
