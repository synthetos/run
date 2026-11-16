import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import {
  rxmTarget,
  type SessionState
} from '../src/index.ts';
import {
  maybeRestoreLineMode,
  onLineModeAnswer,
  onLineModeMemory
} from '../src/session/job.ts';
import { JOBS_RELEASE, jobHarness, runUntil, start, writes, zigzag } from './jobHarness.ts';
import { ready, tx, withJob } from './jobLayerHarness.ts';

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
});

describe('the line mode at connect (H77)', () => {
  it('a pending record on a board already in character mode is cleared without a write', async () => {
    const h = await jobHarness({ rxm: 0 });
    const before = writes(h).length;
    h.session.rememberLineMode(h.session.snapshot.epoch, 0);
    await h.run(1000);
    expect(writes(h).slice(before).some((w) => w.startsWith('{"rxm":'))).toBe(false);
    expect(h.session.snapshot.rxm).toMatchObject({ pending: false, restore: 0 });
  });
});

describe('the line mode at connect (H77)', () => {
  it('the job marks the change pending from its write until the end-of-job restore reads back', async () => {
    const h = await jobHarness({ rxm: 0 });
    h.session.rememberLineMode(h.session.snapshot.epoch, null);
    await start(h, zigzag(4));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'running');
    expect(h.session.snapshot.rxm).toMatchObject({ pending: true, restore: 0 });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done' && h.session.snapshot.footerRev === 2 && !h.session.snapshot.rxm.busy);
    expect(h.session.snapshot.rxm).toMatchObject({ pending: false, restore: 0 });
  });
});

describe('the line mode at connect (H77)', () => {
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

describe('line mode (H77)', () => {
  it('the target outside a job: only a value Run changed and has not put back (pending), else nothing', async () => {
    const s = await ready();
    const rxm = (restore: number | null, pending: boolean): SessionState => ({ ...s, rxm: { ...s.rxm, restore, pending, memoryKnown: true } });
    expect(rxmTarget(rxm(0, true))).toBe(0);
    expect(rxmTarget(rxm(1, true))).toBe(1);
    expect(rxmTarget(rxm(0, false))).toBeNull();
    expect(rxmTarget(rxm(null, true))).toBeNull();
    const r = tx(s);
    expect(onLineModeMemory(r.t, 3).allowed).toBe(false);
    expect(onLineModeMemory(r.t, null).allowed).toBe(true);
    expect(r.t.s.rxm).toMatchObject({ restore: null, pending: false, memoryKnown: true });
    expect(onLineModeMemory(r.t, 0).allowed).toBe(true);
    expect(r.t.s.rxm).toMatchObject({ restore: 0, pending: true, memoryKnown: true });
    // A value this session already found wins over the record.
    const known = tx({ ...s, rxm: { ...s.rxm, restore: 1 } });
    onLineModeMemory(known.t, 0);
    expect(known.t.s.rxm).toMatchObject({ restore: 1, pending: false, memoryKnown: true });
  });
});

describe('line mode (H77)', () => {
  it('nothing is put back unless the board is quiet, idle, in line mode and the target is 0', async () => {
    const s0 = await ready();
    const s: SessionState = { ...s0, footerRev: 3, rxm: { ...s0.rxm, restore: 0, memoryKnown: true, pending: true } };
    const blocked: SessionState[] = [
      { ...s, footerRev: 2 },
      { ...s, footerRev: undefined },
      { ...s, rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } },
      withJob(s, { phase: 'running' }),
      { ...s, motion: {} as never },
      { ...s, reports: { ...s.reports, phase: 'seeding' } },
      { ...s, queue: [{ token: 'stat', purpose: 'poll' }] },
      { ...s, writing: { token: 'stat', purpose: 'poll', seq: 1 } },
      { ...s, expected: [{ token: 'stat', purpose: 'poll', late: false }] },
      { ...s, settingWrite: { phase: 'writing' } as never },
      withJob(s, { phase: 'loading' }),
      { ...s, rxm: { ...s.rxm, restore: 1 } },
      { ...s, rxm: { ...s.rxm, restore: null, memoryKnown: false } },
      { ...s, rxm: { ...s.rxm, pending: false } },
    ];
    for (const b of blocked) {
      const r = tx(b);
      maybeRestoreLineMode(r.t, true);
      expect(r.t.s.queue).toEqual(b.queue);
    }
    const no = tx(s);
    maybeRestoreLineMode(no.t, false);
    expect(no.t.s.queue).toEqual([]);
    const notCapable = tx(s, { ...JOBS_RELEASE, jobs: false });
    maybeRestoreLineMode(notCapable.t, true);
    expect(notCapable.t.s.queue).toEqual([]);
    const yes = tx(s);
    maybeRestoreLineMode(yes.t, true);
    expect(yes.t.s.queue).toEqual([{ token: 'rxm', purpose: 'lineMode', value: 0 }]);
    expect(yes.t.s.rxm.footerExpect).toBe(2);
  });
});

describe('line mode (H77)', () => {
  it('with no pending record a board in line mode is logged once and left as found; a record on a board in character mode is cleared', async () => {
    const s0 = await ready();
    const found = tx({ ...s0, footerRev: 3, rxm: { ...s0.rxm, memoryKnown: true } });
    maybeRestoreLineMode(found.t, true);
    maybeRestoreLineMode(found.t, true);
    expect(found.t.s.queue).toEqual([]);
    expect(found.t.s.rxm.leftAsFound).toBe(true);
    expect(found.fx.filter((e) => e.kind === 'log' && e.text.includes('left as found'))).toHaveLength(1);
    const early = tx({ ...s0, footerRev: 3, rxm: { ...s0.rxm, memoryKnown: false } });
    maybeRestoreLineMode(early.t, true);
    expect(early.t.s.rxm.leftAsFound).toBe(false);
    const settled = tx({ ...s0, footerRev: 2, rxm: { ...s0.rxm, memoryKnown: true, restore: 0, pending: true } });
    maybeRestoreLineMode(settled.t, true);
    expect(settled.t.s.queue).toEqual([]);
    expect(settled.t.s.rxm.pending).toBe(false);
    expect(settled.fx.some((e) => e.kind === 'log' && e.text.includes('record that Run changed it is cleared'))).toBe(true);
    const nothing = tx({ ...s0, footerRev: 2 });
    maybeRestoreLineMode(nothing.t, true);
    expect(nothing.t.s.rxm).toEqual(s0.rxm);
  });
});

describe('line mode (H77)', () => {
  it('a refused write, a failed read and a read-back that differs end the step; a job that was preparing fails', async () => {
    const s = withJob({ ...(await ready()), base: 'PREAMBLE' }, { phase: 'preparing' });
    const answer = (r: Record<string, unknown>, status = 0) => ({ kind: 'Response', line: '', r, footer: { rev: 3, status, field3: 10, raw: [] }, tid: undefined }) as never;
    for (const [step, reply] of [
      [{ kind: 'write', purpose: 'job', value: 1 }, answer({ rxm: 1 }, 100)],
      [{ kind: 'read', purpose: 'job', value: 1 }, null],
      [{ kind: 'readback', purpose: 'job', value: 1 }, answer({ rxm: 0 })],
    ] as const) {
      const r = tx({ ...s, rxm: { ...s.rxm, step: step as never } });
      onLineModeAnswer(r.t, reply, 1);
      expect(r.t.s.rxm.step).toBeNull();
      expect(r.t.s.job?.phase).toBe('failed');
      expect(r.t.s.base).toBe('IDLE_UNHOMED');
    }
    const restore = tx({ ...s, job: null, rxm: { ...s.rxm, step: { kind: 'write', purpose: 'restore', value: 0 } } });
    onLineModeAnswer(restore.t, answer({}, 100), 1);
    expect(restore.t.s.rxm.detail).toMatch(/refused rxm 0/);
    const quietRestore = tx({ ...s, job: null, rxm: { ...s.rxm, step: { kind: 'readback', purpose: 'restore', value: 0 } } });
    onLineModeAnswer(quietRestore.t, answer({ rxm: 0 }), 1);
    expect(quietRestore.t.s.rxm.changed).toEqual({ kind: 'restore', from: 1, to: 0 });
    // Line mode read as 1, but the footer is revision 2: never streamed.
    const rev2 = tx({ ...s, footerRev: 2, rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } });
    onLineModeAnswer(rev2.t, answer({ rxm: 1 }), 1);
    expect(rev2.t.s.job?.message).toMatch(/footer is revision 2, not 3/);
    // A pending record (Run changed this board earlier and never put it back) keeps its value over the job's read.
    const pending = tx({ ...s, rxm: { ...s.rxm, restore: 0, pending: true, step: { kind: 'read', purpose: 'job', value: 1 } } });
    onLineModeAnswer(pending.t, answer({ rxm: 1 }), 1);
    expect(pending.t.s.rxm).toMatchObject({ restore: 0, pending: true, current: 1 });
  });
});

describe('more of the job layer, through its edges', () => {
  it('line mode: a read of 0 after the job was stopped writes nothing; a read-back with no value; an unknown footer', async () => {
    const s = withJob({ ...(await ready()), base: 'PREAMBLE' }, { phase: 'preparing', stopping: true });
    const answer = (r: Record<string, unknown>) => ({ kind: 'Response', line: '', r, footer: { rev: 2, status: 0, field3: 10, raw: [] } }) as never;
    const read0 = tx({ ...s, rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } });
    onLineModeAnswer(read0.t, answer({ rxm: 0 }), 0);
    expect(read0.t.s.queue).toEqual([]);
    const noValue = tx({ ...s, rxm: { ...s.rxm, step: { kind: 'readback', purpose: 'job', value: 1 } } });
    onLineModeAnswer(noValue.t, answer({}), 0);
    expect(noValue.t.s.rxm.detail).toBe('rxm reads back nothing (status 0), not 1');
    const fresh = withJob(s, { stopping: false });
    const unknown = tx({ ...fresh, footerRev: undefined, rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } });
    onLineModeAnswer(unknown.t, answer({ rxm: 1 }), 0);
    expect(unknown.t.s.job?.message).toMatch(/revision unknown, not 3/);
  });
});
