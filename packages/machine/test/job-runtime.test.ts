import { describe, expect, it } from 'vitest';
import { JOB_LIMITS, feedAccountingSafe } from '../src/index.ts';
import { JOBS_RELEASE_NO_FI, jobHarness, runUntil, start, writes, zigzag } from './jobHarness.ts';
import { model } from './jobLayerHarness.ts';

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
});

describe('the job flag and the feed-limit window (capability seams)', () => {
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
});

describe('the job flag and the feed-limit window (capability seams)', () => {
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
});

describe('the job flag and the feed-limit window (capability seams)', () => {
  it('a board with fi gets no fi line unless the release turns feed accounting on (firmware bug N66)', async () => {
    const h = await jobHarness({ device: { start: 'ready', rxm: 0, feedLimit: true }, session: { release: JOBS_RELEASE_NO_FI } });
    const before = await start(h, zigzag(12));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    await h.run(500);
    expect(writes(h).slice(before).filter((w) => w.includes('"fi"'))).toEqual([]);
    expect(h.session.snapshot.job?.feedLimit ?? null).toBeNull();
  });
});

describe('the job flag and the feed-limit window (capability seams)', () => {
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
