import { expect, it } from 'vitest';
import { FeedGaps } from '../src/firmware/feedGaps.ts';
import { enSim, replies } from './helpers.ts';

it('[EN-FEED-LIMIT-STEP3] v2 is ungated, fg is opt-in and paired, new windows keep the opt-in, reset clears it', () => {
  const sim = enSim({ feedLimit: true, feedLimitStep3: true });
  sim.host.sendLine('{"rt":null}');
  sim.clock.advance(30);
  expect(replies(sim.host.take())[0]?.r['rt']).toMatchObject({ job: 0, fg: 0 });
  sim.host.sendLine('{"rt":{"fi":1}}');
  sim.host.sendLine('N1 G1 X5 F600');
  sim.clock.advance(4000);
  const first = sim.host.take();
  expect(first.some(l => l.startsWith('{"fs":{"v":2') && l.includes('"c":[0,0,0,0,0,0,0]'))).toBe(true);
  expect(first.some(l => l.startsWith('{"fg":'))).toBe(false);
  sim.host.sendLine('{"rt":{"fg":1}}');
  sim.host.sendLine('{"rt":{"fi":0}}');
  sim.host.sendLine('{"rt":{"fi":1}}');
  sim.host.sendLine('{"rt":{"job":1}}');
  sim.host.sendLine('N2 G1 X10 F600');
  sim.clock.advance(4000);
  const lines = sim.host.take();
  const gaps = lines.filter(l => l.startsWith('{"fg":'));
  expect(gaps.length).toBeGreaterThan(0);
  for (const line of gaps) {
    const fg = (JSON.parse(line) as { fg: { e: number; q: number } }).fg;
    expect(lines[lines.indexOf(line) - 1]).toContain(`"e":${fg.e},"q":${fg.q}`);
  }
  expect(lines.some(l => l.includes('"n":2,"g":2'))).toBe(true);
  sim.device.resetBoard();
  sim.clock.advance(3000);
  sim.host.take();
  sim.host.sendLine('{"rt":null}');
  sim.clock.advance(30);
  expect(replies(sim.host.take())[0]?.r['rt']).toMatchObject({ job: 0, fg: 0 });
  const legacy = enSim({ feedLimit: true });
  legacy.host.sendLine('{"rt":null}');
  legacy.clock.advance(30);
  expect(replies(legacy.host.take())[0]?.r['rt']).not.toHaveProperty('fg');
});

it('[EN-FEED-LIMIT-STEP3] supply classes accrue separately; holds freeze a gap, job end clears evidence', () => {
  const gaps = new FeedGaps();
  gaps.setJob(1, 0);
  gaps.moved = true;
  gaps.line = 17;
  const drained = { off: false, paused: false, drained: true, pending: true };
  expect(gaps.tick(0, drained)).toContain('"n":17,"g":1');
  gaps.tick(100, { ...drained, pending: false });
  gaps.tick(300, { ...drained, paused: true });
  gaps.tick(1300, { ...drained, pending: false });
  gaps.tick(1400, { ...drained, pending: false });
  expect(JSON.parse(gaps.frame(1, 2))).toMatchObject({ fg: { g: [100, 300, 1] } });
  gaps.setJob(0, 1400);
  gaps.tick(2400, { ...drained, pending: false });
  expect(JSON.parse(gaps.frame(1, 3))).toMatchObject({ fg: { g: [100, 300, 1] } });
});
