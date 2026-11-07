/** A hand-fed reducer for the Probe Z tests, starting from a real session's state on the edge-next model. */
import { classifyLine } from '@synthetos/protocol';
import { expect } from 'vitest';
import { DEFAULT_TIMINGS, reduce, type SessionConfig, type SessionEffect, type SessionEvent, type SessionIntent, type SessionState, type TimerId } from '../src/index.ts';
import { JOBS_RELEASE_NO_FI } from './jobHarness.ts';
import { EN_450_02_APPROVED, START, passTouch, probeHarness } from './probeHarness.ts';

export const CONFIG: SessionConfig = { release: JOBS_RELEASE_NO_FI, manifest: EN_450_02_APPROVED, timings: DEFAULT_TIMINGS };

/** Feeds the reducer by hand. `at` moves only when told. */
export class R {
  s: SessionState;
  fx: readonly SessionEffect[] = [];
  at = 1_000_000;
  constructor(s: SessionState) {
    this.s = s;
  }
  ev(e: SessionEvent): this {
    const t = reduce(CONFIG, this.s, e);
    this.s = t.state;
    this.fx = t.effects;
    return this;
  }
  intent(request: SessionIntent): this {
    return this.ev({ type: 'intent', at: this.at, request });
  }
  line(text: string): this {
    return this.ev({ type: 'inbound', epoch: this.s.epoch, at: this.at, event: classifyLine(text) });
  }
  timer(id: TimerId): this {
    return this.ev({ type: 'timer', id, seq: this.s.timers[id] as number, at: this.at });
  }
  /** Completes the write in progress and answers it: a value for a GET, a status for a G-code line. */
  answer(value: unknown = 0, status = 0): this {
    const w = this.s.writing;
    if (w === null) throw new Error('nothing is being written');
    this.ev({ type: 'lineWritten', epoch: this.s.epoch, seq: w.seq, at: this.at });
    const rev = this.s.footerRev ?? 2;
    return this.line(w.line !== undefined ? `{"r":{},"f":[${rev},${status},8]}` : `{"r":{"${w.token}":${JSON.stringify(value)}},"f":[${rev},${status},8]}`);
  }
  /** Answers the poll cycle in progress (stat, hold, vel, qr) as at rest, or with `stat`. */
  poll(stat = 3): this {
    const values: Record<string, number> = { stat, hold: 0, vel: 0, qr: 32 };
    for (const token of ['stat', 'hold', 'vel', 'qr']) {
      if (this.s.writing?.token !== token) throw new Error(`expected ${token}, writing ${JSON.stringify(this.s.writing)}`);
      this.answer(values[token]);
    }
    return this;
  }
  /** Answers every probe input read in the way. */
  inputs(value = 0): this {
    while (this.s.writing?.token === 'in5') this.answer(value);
    return this;
  }
  get writing(): string | undefined {
    return this.s.writing?.line ?? this.s.writing?.token;
  }
}

/** A session with the touch test passed and nothing in flight. */
export async function ready(): Promise<R> {
  const h = await probeHarness();
  await passTouch(h);
  const s = h.session.state;
  return new R({ ...s, queue: [], expected: [], writing: null, timers: {}, probeZ: { ...s.probeZ, readingAt: 1_000_000 } });
}

/** From ready to the probe running (the G38.2 answered). */
export async function probing(): Promise<R> {
  const r = (await ready()).intent(START);
  r.poll(1);
  expect(r.writing).toBe('G21');
  r.answer();
  expect(r.writing).toBe('G91 G38.2 Z-5 F25');
  r.answer();
  expect(r.s.probeZ.step).toBe('probing');
  return r;
}

/** From probing to the zero's line being written. */
export async function zeroLine(): Promise<R> {
  const r = await probing();
  r.line('{"prb":{"e":1,"x":0,"y":0,"z":-3.02,"a":0,"b":0,"c":0}}');
  expect(r.s.probeZ.step).toBe('zeroing');
  r.poll().timer('probe').poll();
  expect(r.writing).toBe('G10 L20 P1 Z12.6782');
  return r;
}
