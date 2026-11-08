/**
 * The units and distance mode a motion puts back are read before it changes them (modes.ts; SAFETY §4.2, §4.5b,
 * §4.5c, H50, H74), on the pure reducer with scripted answers: the read wins over whatever the live view says,
 * a refused or damaged read leaves the mode unknown (and then nothing is put back), and a read whose owner has
 * gone changes nothing but the live view.
 */
import type { ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import type { SessionEffect, SessionIntent, SessionState } from '../src/index.ts';
import { MODE_TOKENS, onModesAnswer, queueModeReads } from '../src/session/modes.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

const OK = '{"r":{},"f":[3,0,10]}';
const num = (token: string, v: number): string => `{"r":{"${token}":${v}},"f":[3,0,10]}`;
const BASE: Record<string, string> = { ...EN_ANSWERS, gc: OK, home: num('home', 0), unit: num('unit', 1), dist: num('dist', 0) };

function connected(): Driver {
  const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
  d.open();
  d.answer(BASE);
  return d;
}

/** The live view as a late report left it: millimetres and G91, whatever the board holds now. */
function staleLive(d: Driver, live: Partial<SessionState['live']>): void {
  d.state = { ...d.state, live: { ...d.state.live, ...live } };
}

function motionLines(d: Driver, from: number): string[] {
  return d.effects
    .slice(from)
    .filter((e): e is Extract<SessionEffect, { kind: 'writeLine' }> => e.kind === 'writeLine' && e.motion !== undefined)
    .map((e) => e.line);
}

const STEP: SessionIntent = { intent: 'jog', axes: { x: 1 }, distanceMm: 0.1, feed: 600 };

describe('modes read before a motion', () => {
  it('a jog queues the unit and dist reads ahead of its G21, and ends in G90 with the units it read', () => {
    const d = connected();
    staleLive(d, { unit: 1, dist: 1 });
    const from = d.effects.length;
    expect(d.intent(STEP).allowed).toBe(true);
    const next = [d.state.writing, ...d.state.queue].slice(0, 3);
    expect(next.map((q) => q?.line ?? `${q?.purpose}:${q?.token}`)).toEqual(['modes:unit', 'modes:dist', 'G21']);
    // The board is in inches and G91 (another program left it so): the jog puts back G20, and ends in G90 (§4.5b).
    d.answer({ ...BASE, unit: num('unit', 0), dist: num('dist', 1) });
    expect(motionLines(d, from)).toEqual(['G21', 'G21 G91 G1 X0.1 F600', 'G90 G20']);
    expect(d.state.motion).toBeNull();
    expect(d.state.live.unit).toBe(0); // the read refreshed the live view too
  });

  it('go to zero puts back the distance mode and units it read, not the live view', () => {
    const d = connected();
    staleLive(d, { unit: 1, dist: 0 });
    const from = d.effects.length;
    expect(d.intent({ intent: 'goToZero', axes: ['z'], safeZ: 0 }).allowed).toBe(true);
    d.answer({ ...BASE, unit: num('unit', 0), dist: num('dist', 1) });
    expect(motionLines(d, from)).toEqual(['G90 G21', 'G90 G0 Z0', 'G91 G20']);
  });

  it('a Stop job with no motion of ours reads the units too: M5, M9, then G90 with the G20 the board has', () => {
    const d = connected();
    staleLive(d, { unit: 1 });
    const from = d.effects.length;
    expect(d.intent({ intent: 'stopJob' }).allowed).toBe(true);
    expect([d.state.writing, ...d.state.queue].slice(0, 2).map((q) => `${q?.purpose}:${q?.token}`)).toEqual(['modes:unit', 'modes:dist']);
    d.answer({ ...BASE, unit: num('unit', 0), dist: num('dist', 1) });
    expect(motionLines(d, from)).toEqual(['M5', 'M9', 'G90 G20']);
    expect(d.state.motion).toBeNull();
  });

  it('a refused read leaves the mode unknown: the jog ends with G90 alone and the units are not touched', () => {
    const d = connected();
    staleLive(d, { unit: 0, dist: 1 });
    const from = d.effects.length;
    d.intent(STEP);
    d.answer({ ...BASE, unit: '{"r":{},"f":[3,100,10]}', dist: '{"r":{"dist":7},"f":[3,0,10]}' });
    expect(motionLines(d, from)).toEqual(['G21', 'G21 G91 G1 X0.1 F600', 'G90']);
    expect(d.state.live.unit).toBe(0); // nothing known was read: the live view keeps what it had
  });

  it('a damaged answer to a mode read is no FAULT: the mode is unknown and the jog goes on', () => {
    const d = connected();
    const from = d.effects.length;
    d.intent(STEP);
    d.written();
    d.line('{"r":{"unit":0},"f":[3,0');
    expect(d.state.overlays).not.toContain('FAULT');
    d.answer(BASE);
    expect(motionLines(d, from)).toEqual(['G21', 'G21 G91 G1 X0.1 F600', 'G90']);
  });
});

describe('modes.ts on its own', () => {
  const s0 = connected().state;
  const tx = (s: SessionState) => ({
    s,
    set(patch: Partial<SessionState>) {
      this.s = { ...this.s, ...patch };
    },
  });

  it('reads nothing before the board is classified', () => {
    const t = tx({ ...s0, dialect: null, queue: [] });
    queueModeReads(t, 'motion');
    expect(t.s.queue).toEqual([]);
    expect(MODE_TOKENS).toEqual(['unit', 'dist']);
  });

  it('a read whose owner has gone changes only the live view', () => {
    for (const modesFor of ['motion', 'probe', 'toolChange'] as const) {
      const t = tx({ ...s0, motion: null, job: null, probeZ: { ...s0.probeZ, run: null } });
      onModesAnswer(t, { token: 'dist', purpose: 'modes', modesFor }, 1);
      expect(t.s.live.dist).toBe(1);
      expect(t.s.motion).toBeNull();
      expect(t.s.job).toBeNull();
      expect(t.s.probeZ.run).toBeNull();
    }
  });

  it('a tool change takes the read only while its stop is held', () => {
    const job = { phase: 'outputsOff', toolChange: null } as unknown as NonNullable<SessionState['job']>;
    const t = tx({ ...s0, job });
    onModesAnswer(t, { token: 'unit', purpose: 'modes', modesFor: 'toolChange' }, 0);
    expect(t.s.job?.toolChange).toBeNull();
  });
});
