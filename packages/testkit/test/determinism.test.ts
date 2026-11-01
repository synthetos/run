/**
 * ROADMAP P0-11 acceptance, determinism: the same seed (and fault plan)
 * gives byte-identical transcripts (RUN_PLAN §8.1).
 */
import { describe, expect, it } from 'vitest';
import type { FaultPlan } from '../src/faults.ts';
import { enSim, tgSim } from './helpers.ts';

const PLAN: FaultPlan = {
  faults: [
    { kind: 'corrupt', direction: 'toHost', select: { probability: 0.01 } },
    { kind: 'drop', direction: 'toHost', select: { probability: 0.005 } },
    { kind: 'duplicate', direction: 'toDevice', select: { probability: 0.003 } },
    { kind: 'latency', direction: 'toHost', fromMs: 200, toMs: 400, extraMs: 16 },
    { kind: 'xoffBurst', atMs: 500, holdMs: 30 },
    { kind: 'suppressReports', fromMs: 900, toMs: 1100 },
  ],
};

const JOB = ['{"sr":null}', '{"fb":null,"tid":1}', 'M3 S1000', 'G1 X10 Y5 F600', 'G4 P0.2', 'G2 X20 Y5 I5 J0', 'G1 X0 Y0', 'M5', 'M2'];

function run(model: 'en' | 'tg', seed: number): string {
  const sim = model === 'en' ? enSim({ start: 'boot' }, { faults: PLAN, seed }) : tgSim({ start: 'boot' }, { faults: PLAN, seed });
  sim.clock.advance(1200);
  for (const line of JOB) {
    if (model === 'tg' && line.includes('tid')) continue;
    sim.host.sendLine(line);
    sim.clock.advance(37);
  }
  sim.host.send('!');
  sim.clock.advance(250);
  sim.host.send('~');
  sim.clock.advance(6000);
  return sim.endpoint.transcript.render();
}

describe('determinism', () => {
  it('the same seed and fault plan give byte-identical transcripts (edge-next)', () => {
    const a = run('en', 1234);
    const b = run('en', 1234);
    expect(a).toBe(b);
    expect(a.split('\n').length).toBeGreaterThan(20);
    expect(a).toMatch(/!! corrupt toHost/); // the plan really acted
  });

  it('the same seed and fault plan give byte-identical transcripts (440.21)', () => {
    const a = run('tg', 99);
    expect(a).toBe(run('tg', 99));
    expect(a.split('\n').length).toBeGreaterThan(20);
    expect(a).toMatch(/!! corrupt toHost/); // the plan really acted
  });

  it('a different seed picks different victims, so the transcript differs', () => {
    expect(run('en', 1234)).not.toBe(run('en', 4321));
  });
});
