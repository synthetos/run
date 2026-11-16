import { PHASE_2_RELEASE, w42 } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { JOB_LIMITS, feedAccountingSafe } from '../src/index.ts';
import { JOBS_RELEASE_NO_FI, jobHarness, jobLines, runUntil, start, writes, zigzag } from './jobHarness.ts';
import { SMALL, model } from './jobLayerHarness.ts';
describe('T-S110: Pause, Resume and Stop job (SAFETY §4.4a)', () => {

  it('Pause writes ! and the job holds; Resume writes ~ and streaming goes on to the end', async () => {
    const h = await jobHarness();
    const before = await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 6);
    expect(h.session.feedhold()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'paused');
    expect(h.session.snapshot.base).toBe('HELD');
    const sentAtPause = h.session.snapshot.job?.sent ?? 0;
    await h.run(2000);
    expect(h.session.snapshot.job?.sent).toBe(sentAtPause);
    expect(model(h).snapshot().hold).toBe(6);
    expect(h.session.request({ intent: 'resume' })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 90_000);
    const w = writes(h).slice(before);
    expect(w).toContain('!');
    expect(w.indexOf('~')).toBeGreaterThan(w.indexOf('!'));
    expect(jobLines(h, before)).toHaveLength(h.session.snapshot.job?.total as number);
  });


  it('Stop job: !, % once held, M5, M9; "Stopped at line N"; nothing more is sent; rxm put back', async () => {
    const h = await jobHarness({ rxm: 0 });
    const before = await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 6);
    expect(h.session.stopJob()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped' && h.session.snapshot.footerRev === 2);
    const s = h.session.snapshot;
    const w = writes(h).slice(before);
    const bang = w.indexOf('!');
    const tail = w.slice(bang).filter((x) => !x.startsWith('{"') && x !== '\\x05');
    expect(tail.slice(0, 5)).toEqual(['!', '%', 'M5', 'M9', 'G90']);
    expect(w.slice(bang).some((x) => x.startsWith('N'))).toBe(false);
    expect(s.job?.message).toMatch(/^Stopped at line \d+: queue cleared, spindle and coolant off$/);
    expect(s.base).toBe('IDLE_UNHOMED');
    expect(model(h).snapshot().hold).toBe(0);
    expect(w).toContain('{"rxm":0}');
    expect(w42({ line: 3 })).toBe('Stopped at line 3: queue cleared, spindle and coolant off');
  });


  it('Stop job after a Pause and a Resume still reaches stopped: late job answers do not swallow M5 (H76)', async () => {
    const h = await jobHarness();
    const before = await start(h, zigzag(40));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 5);
    h.session.feedhold();
    await runUntil(h, () => h.session.snapshot.job?.phase === 'paused');
    expect(h.session.request({ intent: 'resume' })).toEqual({ allowed: true });
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 14);
    expect(h.session.stopJob()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped');
    const w = writes(h).slice(before);
    const tail = w.slice(w.lastIndexOf('!')).filter((x) => !x.startsWith('{"') && x !== '\\x05');
    expect(tail.slice(0, 5)).toEqual(['!', '%', 'M5', 'M9', 'G90']);
    expect(h.session.snapshot.motion).toBeNull();
  });


  it('Spindle off during a running job ends it like Stop job', async () => {
    const h = await jobHarness();
    await start(h, zigzag(20));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 4);
    expect(h.session.spindleOffNow()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped');
    expect(h.session.snapshot.job?.phase).toBe('stopped');
  });


  it('Stop job while preparing (before the first line) sends nothing of the job', async () => {
    const h = await jobHarness({ rxm: 1 });
    const before = await start(h, SMALL);
    h.session.stopJob();
    await h.run(2000);
    expect(jobLines(h, before)).toEqual([]);
    expect(h.session.snapshot.job?.phase).toBe('stopped');
  });
});
describe('T-S114: a reset, a lost link or an alarm during a job (H71, H72)', () => {

  it('a reset mid-job is a FAULT with W40; nothing more is written to the board', async () => {
    const h = await jobHarness();
    await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 5);
    model(h).resetBoard();
    await runUntil(h, () => h.session.snapshot.overlays.includes('FAULT'));
    const at = writes(h).length;
    await h.run(5000);
    const s = h.session.snapshot;
    expect(s.fault?.cause).toBe('bannerAfterReady');
    expect(s.overlays).toContain('UNKNOWN');
    expect(s.job?.phase).toBe('failed');
    expect(s.job?.message).toMatch(/^DANGER — The controller reset during the job at line \d+\. Everything queued is gone/);
    expect(writes(h).slice(at).some((w) => w.startsWith('N'))).toBe(false);
  });


  it('a lost link ends the job (LOST)', async () => {
    const h = await jobHarness();
    await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 5);
    h.endpoint.disconnect();
    await h.run(100);
    expect(h.session.snapshot.overlays).toContain('LOST');
    expect(h.session.snapshot.job?.phase).toBe('failed');
    expect(h.session.snapshot.job?.message).toMatch(/^The connection was lost at line/);
  });


  it('an alarm (a limit switch) ends the job and the session is in ALARM', async () => {
    const h = await jobHarness();
    await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 5);
    model(h).injectLimitSwitch(1);
    await runUntil(h, () => h.session.snapshot.base === 'ALARM');
    await h.run(2000);
    // The alarm's `er` latches a FAULT; the controller has already flushed and turned its outputs off, so no
    // flush sequence is sent into the alarm.
    expect(h.session.snapshot.job?.phase).toBe('failed');
    expect(h.session.snapshot.job?.message).toMatch(/^The job ended at line \d+: the board reported an exception \(status 203\)/);
    expect(h.session.snapshot.job?.stopping).toBe(false);
  });
});
describe('the job flag and the feed-limit window (capability seams)', () => {

  it('no job flag is ever sent without the capability (edge-next a7489b79 has none)', async () => {
    const h = await jobHarness();
    const before = await start(h, zigzag(8), [5]);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'breakpoint');
    h.session.request({ intent: 'resume' });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done');
    expect(writes(h).slice(before).some((w) => w.includes('"job"'))).toBe(false);
    expect(h.session.snapshot.job?.jobFlag).toBeNull();
  });


  it('with the capability: job 1 at start, 0 before a breakpoint, 1 on resume, 0 after the last line', async () => {
    const h = await jobHarness({ device: { start: 'ready', rxm: 0, jobFlag: true } });
    expect(h.session.snapshot.rtLeaves).toContain('job');
    const before = await start(h, zigzag(8), [5]);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'breakpoint');
    h.session.request({ intent: 'resume' });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done');
    const flags = writes(h)
      .slice(before)
      .filter((w) => w.includes('"job"'));
    expect(flags).toEqual(['{"rt":{"job":1}}', '{"rt":{"job":0}}', '{"rt":{"job":1}}', '{"rt":{"job":0}}']);
    expect(model(h).jobFlag).toBe(0);
  });


  it('with fi: the window opens at the start, summaries reach the job, and it closes at the end', async () => {
    const h = await jobHarness({ device: { start: 'ready', rxm: 0, feedLimit: true } });
    const before = await start(h, zigzag(12));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    await h.run(500);
    const w = writes(h).slice(before);
    expect(w).toContain(`{"rt":{"fi":${JOB_LIMITS.feedLimitS}}}`);
    expect(w).toContain('{"rt":{"fi":0}}');
    expect(h.session.snapshot.job?.feedLimit?.last).toMatchObject({ e: expect.any(Number), q: expect.any(Number) });
  });


  it('a board with fi gets no fi line unless the release turns feed accounting on (firmware bug N66)', async () => {
    const h = await jobHarness({ device: { start: 'ready', rxm: 0, feedLimit: true }, session: { release: JOBS_RELEASE_NO_FI } });
    const before = await start(h, zigzag(12));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    await h.run(500);
    expect(writes(h).slice(before).filter((w) => w.includes('"fi"'))).toEqual([]);
    expect(h.session.snapshot.job?.feedLimit ?? null).toBeNull();
  });


  it('fb 450.02 and later have the N66 fix: fi is sent without the release flag', async () => {
    const approved = { environment: 'staging' as const, builds: [{ channel: 'bench' as const, dialect: 'tinyg-en' as const, fb: 450.02, fbs: null, commit: 'f'.repeat(40), note: 'test' }] };
    const h = await jobHarness({ device: { start: 'ready', rxm: 0, feedLimit: true, build: { fb: 450.02, fv: 0.97, hv: 8, layout: 10002 } }, session: { release: JOBS_RELEASE_NO_FI, manifest: approved } });
    expect(feedAccountingSafe(h.session.state)).toBe(true);
    const before = await start(h, zigzag(12));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    await h.run(500);
    expect(writes(h).slice(before)).toContain(`{"rt":{"fi":${JOB_LIMITS.feedLimitS}}}`);
  });
});
describe('the line mode at connect (H77)', () => {

  it('a board left in line mode is put back only where this browser has a pending record; with none it is left as found', async () => {
    for (const [remembered, expected] of [
      [0, '{"rxm":0}'],
      [null, undefined],
    ] as const) {
      const h = await jobHarness({ rxm: 1 });
      const before = writes(h).length;
      h.session.rememberLineMode(h.session.snapshot.epoch, remembered);
      await h.run(1000);
      const w = writes(h).slice(before);
      expect(w.find((x) => x.startsWith('{"rxm":') && x !== '{"rxm":null}'), String(remembered)).toBe(expected);
      if (expected !== undefined) {
        expect(h.session.snapshot.footerRev).toBe(2);
        expect(h.session.snapshot.rxm).toMatchObject({ changed: { kind: 'restore', from: 1, to: 0 }, pending: false });
      } else {
        expect(h.session.snapshot.footerRev).toBe(3);
        expect(h.session.snapshot.rxm).toMatchObject({ leftAsFound: true, pending: false });
        expect(h.session.log().some((l) => l.text.includes('left as found'))).toBe(true);
      }
    }
  });


  it('a pending record on a board already in character mode is cleared without a write', async () => {
    const h = await jobHarness({ rxm: 0 });
    const before = writes(h).length;
    h.session.rememberLineMode(h.session.snapshot.epoch, 0);
    await h.run(1000);
    expect(writes(h).slice(before).some((w) => w.startsWith('{"rxm":'))).toBe(false);
    expect(h.session.snapshot.rxm).toMatchObject({ pending: false, restore: 0 });
  });


  it('the job marks the change pending from its write until the end-of-job restore reads back', async () => {
    const h = await jobHarness({ rxm: 0 });
    h.session.rememberLineMode(h.session.snapshot.epoch, null);
    await start(h, zigzag(4));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'running');
    expect(h.session.snapshot.rxm).toMatchObject({ pending: true, restore: 0 });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done' && h.session.snapshot.footerRev === 2 && !h.session.snapshot.rxm.busy);
    expect(h.session.snapshot.rxm).toMatchObject({ pending: false, restore: 0 });
  });


  it('without the page memory, or without the jobs release, nothing is written', async () => {
    const h = await jobHarness({ rxm: 1 });
    const before = writes(h).length;
    await h.run(2000);
    expect(writes(h).slice(before).some((w) => w.startsWith('{"rxm":'))).toBe(false);
    const p2 = await jobHarness({ rxm: 1, session: { release: PHASE_2_RELEASE } });
    const b2 = writes(p2).length;
    p2.session.rememberLineMode(p2.session.snapshot.epoch, 0);
    await p2.run(2000);
    expect(writes(p2).slice(b2).some((w) => w.startsWith('{"rxm":'))).toBe(false);
  });
});


it('step 3 probes fg, opts in with fi, pairs summaries, and clears the opt-in at completion', async () => {
  const h = await jobHarness({ device: { start: 'ready', rxm: 0, feedLimit: true, feedLimitStep3: true } });
  expect(h.session.snapshot.rtLeaves).toEqual(expect.arrayContaining(['fg', 'job', 'fi']));
  const before = await start(h, zigzag(12));
  await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
  await h.run(1000);
  const w = writes(h).slice(before);
  expect(w.filter(s => s.includes('"fg"'))).toEqual(['{"rt":{"fg":1}}', '{"rt":{"fg":0}}']);
  expect(w.filter(s => s.includes('"job"'))).toEqual(['{"rt":{"job":1}}', '{"rt":{"job":0}}']);
  const fl = h.session.snapshot.job?.feedLimit;
  expect(fl?.last?.c).toHaveLength(7);
  expect(fl?.gaps).toMatchObject({ e: fl?.last?.e, q: fl?.last?.q });
});
