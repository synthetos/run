import { OVERLAYS, type Decision, type Intent, type Overlay } from '@synthetos/safety';
import {
  type SessionConfig,
  type SessionEffect,
  type SessionState,
  type TimerId,
  type Transition
} from '../types.ts';

export class Tx {
  s: SessionState;
  readonly fx: SessionEffect[] = [];
  readonly config: SessionConfig;

  constructor(config: SessionConfig, state: SessionState) {
    this.config = config;
    this.s = state;
  }

  set(patch: Partial<SessionState>): void {
    this.s = { ...this.s, ...patch };
  }

  emit(effect: SessionEffect): void {
    this.fx.push(Object.freeze(effect));
  }

  decide(intent: Intent, decision: Decision): void {
    this.emit({ kind: 'decision', intent, decision: Object.freeze(decision) });
  }

  arm(id: TimerId, ms: number): void {
    const seq = this.s.timerSeq + 1;
    this.set({ timerSeq: seq, timers: { ...this.s.timers, [id]: seq } });
    this.emit({ kind: 'armTimer', id, seq, ms });
  }

  cancel(id: TimerId): void {
    if (this.s.timers[id] === undefined) return;
    const timers = { ...this.s.timers };
    delete timers[id];
    this.set({ timers });
    this.emit({ kind: 'cancelTimer', id });
  }

  cancelAll(): void {
    for (const id of Object.keys(this.s.timers) as TimerId[]) this.cancel(id);
  }

  addOverlay(o: Overlay): void {
    if (this.s.overlays.includes(o)) return;
    this.set({ overlays: OVERLAYS.filter((x) => x === o || this.s.overlays.includes(x)) });
  }

  removeOverlay(o: Overlay): void {
    if (!this.s.overlays.includes(o)) return;
    this.set({ overlays: this.s.overlays.filter((x) => x !== o) });
  }

  done(): Transition {
    return { state: deepFreezeState(this.s), effects: Object.freeze(this.fx) };
  }
}

export function deepFreezeState(s: SessionState): SessionState {
  return deepFreeze(s);
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}
