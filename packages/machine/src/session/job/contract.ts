import { type JobTx } from '../jobState.ts';
import type { SessionConfig } from '../types.ts';

/** The transition, as this module uses it (the reducer's `Tx`). */
export interface JobLayerTx extends JobTx {
  readonly config: SessionConfig;
}

/** What the reducer lends this module (it may not import the reducer: no cycles). */
export interface JobDeps {
  /** Latch a FAULT (the reducer's enterFault). */
  fault(t: JobLayerTx, cause: 'staleWhileRunning', kind: 'liveness', detail: string, at: number): void;
}
