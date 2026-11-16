import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { JOB_LIMITS, liveStart } from '../src/index.ts';
import {
  onJobPrepAnswer
} from '../src/session/job.ts';
import { confirmFor, jobHarness, load, writes } from './jobHarness.ts';
import { SMALL, ready, tx, value, withJob } from './jobLayerHarness.ts';

describe('T-S108: loading a job sanitises it in the worker with the live board', () => {
  it('reads the board, sanitises, and summarises without sending a single job line', async () => {
    const h = await jobHarness();
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    const before = writes(h).length;
    await load(h, SMALL);
    const job = h.session.snapshot.job;
    expect(job?.report?.blocks).toEqual([]);
    expect(job?.phase).toBe('ready');
    expect(job?.total).toBe(8);
    expect(job?.hash).toMatch(/^[0-9a-f]{8}$/);
    const sent = writes(h).slice(before);
    expect(sent.every((w) => w.startsWith('{"'))).toBe(true);
    expect(sent).toContain('{"x":null}');
    expect(sent).toContain('{"ofs":null}');
  });
});

describe('T-S108: loading a job sanitises it in the worker with the live board', () => {
  it('a file that does not pass is blocked with its findings, and cannot start', async () => {
    const h = await jobHarness();
    await load(h, 'G21\nG38.2 Z-5 F100\nM30');
    const job = h.session.snapshot.job;
    expect(job?.phase).toBe('blocked');
    expect(job?.report?.blocks[0]?.line).toBe(2);
    expect(h.session.startJob([], confirmFor(h))).toMatchObject({ allowed: false, reason: 'The check found something that stops this file.' });
  });
});

describe('T-S108: loading a job sanitises it in the worker with the live board', () => {
  it('M6 is a manual tool-change stop on edge-next (INFO), not a block', async () => {
    const h = await jobHarness();
    await load(h, 'G21 G90\nM3 S10000\nG1 X1 F600\nT2 M6\nG1 X2\nM5\nM30');
    const job = h.session.snapshot.job;
    expect(job?.phase).toBe('ready');
    expect(job?.report?.toolChanges).toEqual([4]);
    expect(job?.report?.counts.info).toBe(1);
    expect(job?.report?.startsSpindle).toBe(true);
    expect(job?.report?.speeds).toEqual([10000]);
  });
});

describe('T-S108: loading a job sanitises it in the worker with the live board', () => {
  it('jobs need the jobs release, an approved board and an idle machine; unloading clears it', async () => {
    const p2 = await jobHarness({ session: { release: PHASE_2_RELEASE } });
    expect(p2.session.loadJob({ name: 'a.nc', text: SMALL })).toMatchObject({ allowed: false, reason: 'Jobs are not available with this release or this board.' });
    const ro = await jobHarness({ session: { manifest: { environment: 'staging', builds: [] } } });
    expect(ro.session.loadJob({ name: 'a.nc', text: SMALL }).allowed).toBe(false);
    const h = await jobHarness();
    expect(h.session.loadJob({ name: '', text: SMALL }).allowed).toBe(false);
    expect(h.session.loadJob({ name: 'a.nc', text: '' }).allowed).toBe(false);
    expect(h.session.loadJob({ name: 'a.nc', text: 'x'.repeat(JOB_LIMITS.maxBytes + 1) }).allowed).toBe(false);
    expect(h.session.loadJob({ name: 'a.nc', text: SMALL })).toEqual({ allowed: true });
    expect(h.session.loadJob({ name: 'b.nc', text: SMALL })).toMatchObject({ allowed: false, reason: 'The machine is busy.' });
    await h.run(500);
    expect(h.session.loadJob(null)).toEqual({ allowed: true });
    expect(h.session.snapshot.job).toBeNull();
  });
});

describe('more of the job layer, through its edges', () => {
  it('prep answers that are damaged or empty, scalars read as null, a spindle line without S', async () => {
    const s = await ready();
    const loading = withJob({ ...s, queue: [{ token: 'unit', purpose: 'jobPrep' }] }, { phase: 'loading', source: { text: 'G21\nM3\nG1 X1 F600\nM5\nM30', c22: false } });
    const r = tx(loading);
    onJobPrepAnswer(r.t, { token: 'x', purpose: 'jobPrep' }, null, 0);
    expect(r.t.s.values['x']).toMatchObject({ value: null, status: -1 });
    r.t.s = { ...r.t.s, queue: [] };
    onJobPrepAnswer(r.t, { token: 'coor', purpose: 'jobPrep' }, { kind: 'Response', line: '', r: {}, footer: { rev: 3, status: 0, field3: 10, raw: [] } } as never, 0);
    expect(r.t.s.job?.report?.startsSpindle).toBe(true);
    expect(r.t.s.job?.report?.speeds).toEqual([]);
    expect(liveStart({ ...s, values: { unit: value(null) } }).units).toBeUndefined();
  });
});

describe('more of the job layer, through its edges', () => {
  it('the check summary counts blocks and tool changes in plain words', async () => {
    const blocked = await ready('G21\nG38.2 Z-1 F10\nG38.3 Z-1 F10\nM30');
    expect(blocked.job?.events.at(-1)?.text).toMatch(/^Checked with this board.s values: \d+ findings stop this file\.$/);
    const two = await ready('G21 G90\nG1 X1 F600\nT1 M6\nG1 X2\nT2 M6\nG1 X3\nM30');
    expect(two.job?.events.at(-1)?.text).toMatch(/, 2 tool changes\.$/);
    expect((await ready('G21\n$H\nM30')).job?.events.at(-1)?.text).toBe("Checked with this board's values: 1 finding stops this file.");
  });
});
