/**
 * The stop paths of a page (P1-06; SAFETY §4.3): TabStop, StopControls,
 * Escape and the cross-tab lock watcher, started as one step before anything
 * that can fail. `renderGuarded` runs the shell render so that a throw there
 * (a component error, a missing Trusted Types policy) cannot unwind the page
 * script past the stop paths: Escape in every tab still requests a stop of
 * every LIVE machine.
 */
import type { BroadcastChannelLike, LockManagerLike } from '../machine-worker/stopChannel.ts';
import { StopControls } from './stopControls.ts';
import { installEscapeStop, LockWatcher, TabStop, type KeyTarget, type Timers } from './tabStop.ts';

export interface StopBootDeps {
  readonly target: KeyTarget;
  readonly channel: BroadcastChannelLike | null;
  readonly locks: LockManagerLike | null;
  readonly timers: Timers;
  readonly newId: () => string;
  /** Feedhold this tab's own machine worker (none until it starts). */
  readonly pauseOwnWorker: () => void;
}

export interface StopPaths {
  readonly tabStop: TabStop;
  readonly stopControls: StopControls;
  readonly watcher: LockWatcher;
}

export function startStopPaths(deps: StopBootDeps): StopPaths {
  const tabStop = new TabStop({ channel: deps.channel, locks: deps.locks, timers: deps.timers, newId: deps.newId });
  const stopControls = new StopControls({ broadcast: (action) => tabStop.request(action), pauseOwnWorker: deps.pauseOwnWorker, timers: deps.timers });
  installEscapeStop(deps.target, () => stopControls.pause());
  const watcher = new LockWatcher(deps.locks, () => stopControls.live, deps.timers, (role) => stopControls.setRole(role));
  watcher.start();
  return { tabStop, stopControls, watcher };
}

/** Runs `render`; a throw is reported, never rethrown. True when it rendered. */
export function renderGuarded(render: () => void, report: (error: unknown) => void): boolean {
  try {
    render();
    return true;
  } catch (error) {
    report(error);
    return false;
  }
}
