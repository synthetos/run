import { expect, it } from 'vitest';
import { jobHarness, EN_APPROVED, start, runUntil, writes, zigzag } from './jobHarness.ts';
it('live overrides are acknowledged during the job and hold; stop preserves factors without restarting outputs', async () => {
  const h = await jobHarness({
    device: { build: { fb: 450.06, fv: 0.97, hv: 8, layout: 10003 } },
    session: { manifest: { ...EN_APPROVED, builds: EN_APPROVED.builds.map(b => ({ ...b, fb: 450.06 })) } },
  });
  await h.run(1500);
  expect(h.session.state.values.mfo?.value).toBe(1);
  await start(h, zigzag(200, ['M5']));
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'running')).toBe(true);
  await h.run(1200); // the next full set of factor/permission reads
  expect(h.session.setOverride({ channel: 'feed', percent: 120 })).toEqual({ allowed: true });
  expect(h.session.setOverride({ channel: 'spindle', percent: 80 }).allowed).toBe(false);
  await h.run(1200);
  expect(h.session.snapshot.overrides?.feed.requested).toBe(120);
  expect(h.session.setOverride({ channel: 'spindle', percent: 80 })).toEqual({ allowed: true });
  await h.run(1200);
  expect(h.session.snapshot.overrides?.spindle.requested).toBe(80);
  expect(h.session.snapshot.overrides?.spindle.effective).toBe(100); // off stays off
  h.session.feedhold();
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'paused')).toBe(true);
  expect(h.session.setOverride({ channel: 'feed', percent: 110 }).allowed).toBe(true);
  await h.run(1200);
  expect(h.session.snapshot.job?.phase).toBe('paused');
  expect(writes(h)).toContain('{"rt":{"mfo":1.2}}');
  expect(writes(h)).toContain('{"rt":{"sso":0.8}}');
  h.session.stopJob();
  await h.run(3000);
  expect(h.session.setOverride({ channel: 'feed', percent: 120 }).allowed).toBe(false);
  expect(h.session.snapshot.overrides?.feed.requested).toBe(110);
});
it('executed M30 and kill restore board factors, and reset never reuses the prior request', async () => {
  const h = await jobHarness({
    device: { build: { fb: 450.06, fv: 0.97, hv: 8, layout: 10003 } },
    session: { manifest: { ...EN_APPROVED, builds: EN_APPROVED.builds.map(b => ({ ...b, fb: 450.06 })) } },
  });
  await h.run(1500);
  await start(h, zigzag(20));
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'running')).toBe(true);
  await h.run(1200); // the next full set of factor/permission reads
  expect(h.session.setOverride({ channel: 'feed', percent: 130 })).toEqual({ allowed: true });
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60000)).toBe(true);
  await h.run(1500);
  expect(h.session.snapshot.overrides?.feed.requested).toBe(100);
  await start(h, zigzag(200));
  expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'running')).toBe(true);
  await h.run(1200); // the next full set of factor/permission reads
  expect(h.session.setOverride({ channel: 'feed', percent: 140 }).allowed).toBe(true);
  await h.run(1200);
  h.device.receive(4, false); // external physical kill, never a UI shortcut
  await h.run(1500);
  expect(h.session.snapshot.overrides?.feed.requested).toBeNull(); // never display the pre-kill factor in FAULT
  h.device.receive(24, false); // external controller reset
  await h.run(4000);
  expect(h.session.snapshot.overrides?.feed.requested).toBeNull();
  expect(h.session.ackFault().allowed).toBe(true);
  expect(await runUntil(h, () => h.session.snapshot.overrides?.feed.requested === 100)).toBe(true);
  expect(h.session.snapshot.overlays).toContain('UNKNOWN');
});
