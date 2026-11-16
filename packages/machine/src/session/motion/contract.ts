import type { FaultCause, FaultKind, MotionCtx, PolledValues, SessionConfig, SessionEffect, SessionState, TimerId } from '../types.ts';


/** The reducer's transition, as this module uses it. */
export interface MotionTx {
  s: SessionState;
  readonly config: SessionConfig;
  set(patch: Partial<SessionState>): void;
  emit(effect: SessionEffect): void;
  arm(id: TimerId, ms: number): void;
  cancel(id: TimerId): void;
}

/** What the reducer lends this module (it may not import the reducer: no cycles). */
export interface MotionDeps {
  fault(t: MotionTx, cause: FaultCause, kind: FaultKind, detail: string, at: number): void;
}

export interface PollContext { readonly ctx: MotionCtx; readonly s: SessionState; readonly p: PolledValues; readonly confirm: (ok: boolean) => number; }
