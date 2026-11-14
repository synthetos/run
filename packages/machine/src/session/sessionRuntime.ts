/** Build-selected session behavior. The transport executor imports no control implementation. */
import type { Intent, Release } from '@synthetos/safety';
import type { SessionSnapshot } from './snapshot.ts';
import type { RealtimeName, SessionConfig, SessionEvent, SessionState, Transition } from './types.ts';
export type WriteCheck = { readonly kind: 'denied' | 'refused'; readonly reason: string } | undefined;
export interface SessionRuntime {
  initialState(): SessionState;
  snapshotOf(state: SessionState): SessionSnapshot;
  reduce(config: SessionConfig, state: SessionState, event: SessionEvent): Transition;
  checkLine(current: SessionState, emitted: SessionState, release: Release, line: QueuedLine): WriteCheck;
  checkRealtime(current: SessionState, release: Release, bytes: Uint8Array, name: RealtimeName, issuedBy?: Intent): WriteCheck;
}

export interface QueuedLine {
  readonly epoch: number;
  readonly seq: number;
  readonly bytes: Uint8Array;
  /** The state in which the reducer asked for this line: its token rule (probe list or allowlist) applies. */
  readonly emitted: SessionState;
  /** A motion line (Phase 2): the matrix intent that issued it. */
  readonly motion?: Intent;
  /** A settings write line (SAFETY §4.6, amendment 2026-11-02). */
  readonly setting?: true;
  /** A report-configuration line (amendment 2026-11-02, H64). */
  readonly report?: true;
  /** Phase 3: a job line (its index), a line-mode write, or a job `rt` line (SAFETY §4.4a). */
  readonly job?: number;
  readonly lineMode?: true;
  readonly jobRuntime?: true;
  /** The firmware update's `{"boot":1}` (SAFETY §4.8 as amended 2026-11-03). */
  readonly boot?: true;
}
