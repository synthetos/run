/**
 * The edge-next model as a streaming target (Phase 3, SAFETY §4.4a; T-S115): line mode with free-slot footers
 * (`f[2]`), an answer per line with its status, a refused line, a reset banner while lines are queued, the switch
 * between character and line mode (`rxm`, with the footer revision following it), and the feed-limit push.
 */
import { describe, expect, it } from 'vitest';
import { enSim, replies, statuses } from './helpers.ts';

describe('line mode as run streams it', () => {
  it('[EN-RX-LINEMODE] free slots fall while lines wait and rise as the planner takes them; every line is answered in order', () => {
    const sim = enSim();
    const job = Array.from({ length: 30 }, (_, i) => `N${i + 1} G1 X${(i % 2) * 5 + 1} F3000`);
    let next = 0;
    let free = 12;
    let inFlight = 0;
    let maxInFlight = 0;
    const answered: number[][] = [];
    for (let step = 0; step < 4000 && answered.length < job.length; step++) {
      // run's rule: write only while free - inFlight leaves more than 2 slots.
      while (next < job.length && free - inFlight > 2) {
        sim.host.sendLine(job[next] as string);
        next++;
        inFlight++;
      }
      maxInFlight = Math.max(maxInFlight, inFlight);
      sim.clock.advance(20);
      for (const r of replies(sim.host.take())) {
        answered.push(r.f);
        free = r.f[2] as number;
        inFlight--;
      }
    }
    expect(answered).toHaveLength(job.length);
    expect(answered.every((f) => f[0] === 3 && f[1] === 0)).toBe(true);
    expect(Math.min(...answered.map((f) => f[2] as number))).toBeLessThan(12);
    // Never more lines in the board than its 12 headers less the 2 kept for control lines.
    expect(maxInFlight).toBeLessThanOrEqual(10);
  });

  it('[EN-FOOTER] a refused line gets its status in its own answer, and the next line still runs', () => {
    const sim = enSim();
    sim.host.sendLine('N1 G1 X1 F600');
    sim.host.sendLine('N2 M100'); // not a TinyG code
    sim.host.sendLine('N3 G1 X2');
    sim.clock.advance(10_000);
    const s = statuses(sim.host.take());
    expect(s[0]).toBe(0);
    expect(s[1]).not.toBe(0);
    expect(s[2]).toBe(0);
    expect(sim.device.snapshot().position[0]).toBeCloseTo(2, 3);
  });

  it('[EN-BANNER] a reset while lines are queued prints the banner and nothing queued is answered or run', () => {
    const sim = enSim();
    for (let i = 0; i < 8; i++) sim.host.sendLine(`N${i + 1} G1 X${i + 10} F600`);
    sim.clock.advance(200);
    sim.host.take();
    sim.device.resetBoard();
    sim.clock.advance(3000);
    const lines = sim.host.take();
    expect(lines.some((l) => l.includes('SYSTEM READY'))).toBe(true);
    expect(replies(lines)).toHaveLength(0);
    expect(sim.device.snapshot().position[0]).toBe(0);
  });

  it('[EN-FOOTER] rxm 0 → 1 changes the footer of the answer to that write; it survives a reset (persisted)', () => {
    const sim = enSim({ rxm: 0 });
    sim.host.sendLine('{"stat":null}');
    sim.clock.advance(20);
    expect(replies(sim.host.take())[0]?.f[0]).toBe(2);
    sim.host.sendLine('{"rxm":1}');
    sim.clock.advance(20);
    expect(replies(sim.host.take())[0]?.f[0]).toBe(3);
    sim.device.resetBoard();
    sim.clock.advance(3000);
    sim.host.take();
    sim.host.sendLine('{"stat":null}');
    sim.clock.advance(20);
    expect(replies(sim.host.take())[0]?.f[0]).toBe(3);
  });
});

describe('the feed-limit push (option feedLimit)', () => {
  it('[EN-FEED-LIMIT-PUSH] fi opens a window at quiescence, fs lines come while a cycle runs and once after it', () => {
    const sim = enSim({ feedLimit: true });
    sim.host.sendLine('{"rt":null}');
    sim.clock.advance(20);
    expect(replies(sim.host.take())[0]?.r['rt']).toMatchObject({ fi: 0, fs: null });
    sim.host.sendLine('{"rt":{"fi":90}}');
    sim.clock.advance(20);
    expect(replies(sim.host.take())[0]?.r['rt']).toEqual({ fi: 60 });
    sim.host.sendLine('{"rt":{"fi":1}}');
    sim.host.sendLine('G1 X60 F600');
    sim.clock.advance(4000);
    const lines = sim.host.take();
    const fs = lines.filter((l) => l.startsWith('{"fs":'));
    expect(fs.length).toBeGreaterThanOrEqual(2);
    expect(fs[0]).toMatch(/^\{"fs":\{"v":1,"e":1,"q":1,"c":\[0,0,0,0,0,0\],"ct":\d+,"cd":0\.000\}\}$/);
    sim.clock.advance(8000);
    const after = sim.host.take().filter((l) => l.startsWith('{"fs":'));
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(sim.device.snapshot().position[0]).toBeCloseTo(60, 3);
    sim.clock.advance(5000);
    expect(sim.host.take().filter((l) => l.startsWith('{"fs":'))).toEqual([]);
    sim.host.sendLine('{"rt":{"fi":0}}');
    sim.clock.advance(20);
    expect(statuses(sim.host.take())).toEqual([0]);
  });

  it('[EN-FEED-LIMIT-PUSH] off to on is refused while moving (106); a build without it answers 100', () => {
    const sim = enSim({ feedLimit: true });
    sim.host.sendLine('G1 X20 F600');
    sim.clock.advance(300);
    sim.host.take();
    sim.host.sendLine('{"rt":{"fi":2}}');
    sim.clock.advance(20);
    expect(statuses(sim.host.take())).toEqual([106]);
    const plain = enSim();
    plain.host.sendLine('{"rt":{"fi":2}}');
    plain.clock.advance(20);
    expect(statuses(plain.host.take())).toEqual([100]);
  });

  it('the job flag exists with option jobFlag, and a reset clears it', () => {
    const sim = enSim({ jobFlag: true });
    sim.host.sendLine('{"rt":{"job":1}}');
    sim.clock.advance(20);
    expect(statuses(sim.host.take())).toEqual([0]);
    expect(sim.device.jobFlag).toBe(1);
    sim.host.sendLine('{"rt":{"job":2}}');
    sim.clock.advance(20);
    expect(statuses(sim.host.take())).toEqual([110]);
    sim.host.sendLine('{"rt":null}');
    sim.clock.advance(20);
    expect(replies(sim.host.take())[0]?.r['rt']).toMatchObject({ job: 1 });
    sim.device.resetBoard();
    sim.clock.advance(3000);
    expect(sim.device.jobFlag).toBe(0);
  });
});
