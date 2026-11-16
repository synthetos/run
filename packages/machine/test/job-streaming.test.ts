import { TINYG_EN } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { JOB_LIMITS, jobInFlight, statusMeaning, type SessionState } from '../src/index.ts';
import {
  onJobAnswer,
  pumpJob
} from '../src/session/job.ts';
import { jobHarness, jobLines, runUntil, start, writes, zigzag } from './jobHarness.ts';
import { SMALL, model, ready, tx, withJob } from './jobLayerHarness.ts';

describe('T-S109: streaming by the line buffer free slots (H76)', () => {
  it('streams a job to the end in line mode, setting rxm and putting it back (H77)', async () => {
    const h = await jobHarness({ rxm: 0 });
    const before = await start(h, SMALL);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done' && h.session.snapshot.rxm.busy === false && h.session.snapshot.footerRev === 2);
    const s = h.session.snapshot;
    expect(s.job?.phase).toBe('done');
    const w = writes(h).slice(before);
    // Start reads the board again first, rxm among its prep reads (R3); then the line mode is read, set and read back.
    expect(w.filter((x) => x.startsWith('{"rxm":')).slice(0, 4)).toEqual(['{"rxm":null}', '{"rxm":null}', '{"rxm":1}', '{"rxm":null}']);
    expect(jobLines(h, before)).toHaveLength(8);
    expect(w.indexOf('{"rxm":0}')).toBeGreaterThan(w.indexOf('N8 M30'));
    expect(s.footerRev).toBe(2);
    expect(s.base).toBe('IDLE_UNHOMED');
    expect(s.job?.message).toMatch(/^Job finished: 8 lines/);
    expect(s.rxm.changed).toEqual({ kind: 'restore', from: 1, to: 0 });
  });
});

describe('T-S109: streaming by the line buffer free slots (H76)', () => {
  it('on a board already in line mode nothing is written to rxm, before or after', async () => {
    const h = await jobHarness({ rxm: 1 });
    const before = await start(h, SMALL);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done');
    await h.run(500);
    const w = writes(h).slice(before);
    expect(w.filter((x) => x.startsWith('{"rxm":') && x !== '{"rxm":null}')).toEqual([]);
    expect(h.session.snapshot.rxm.restore).toBe(1);
  });
});

describe('T-S109: streaming by the line buffer free slots (H76)', () => {
  // Under `pnpm check` every package's tests share the cores: this streaming replay needs more than vitest's 5 s.
  it('never has more job lines owed than the free slots less the reserve, and every line is answered', { timeout: 30_000 }, async () => {
    const h = await jobHarness();
    await start(h, zigzag(60));
    let most = 0;
    await runUntil(
      h,
      () => {
        most = Math.max(most, jobInFlight(h.session.state));
        return h.session.snapshot.job?.phase === 'done';
      },
      150_000,
      5,
    );
    expect(h.session.snapshot.job?.phase).toBe('done');
    expect(h.session.snapshot.job?.acked).toBe(h.session.snapshot.job?.total);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(12 - JOB_LIMITS.reserve);
    expect(h.session.snapshot.fault).toBeNull();
  });
});

describe('T-S109: streaming by the line buffer free slots (H76)', () => {
  it('progress maps through the sanitiser: the executing line and the sent band are file lines', async () => {
    const h = await jobHarness();
    const text = ['G21 G90', '(a comment)', '', 'G1 X10 F3000', 'G1 X0', 'G1 X10', 'G1 X0', 'G1 X10', 'M30'].join('\n');
    await start(h, text);
    const seen = new Set<number>();
    await runUntil(h, () => {
      const e = h.session.snapshot.job?.executing;
      if (e !== null && e !== undefined) seen.add(e.line);
      return h.session.snapshot.job?.phase === 'done';
    });
    expect([...seen].every((l) => l !== 2 && l !== 3)).toBe(true);
    expect(seen.has(4) || seen.has(5)).toBe(true);
    expect(h.session.snapshot.job?.sentThrough).toBe(9);
  });
});

describe('T-S109: streaming by the line buffer free slots (H76)', () => {
  it('the final M30 is written only after every earlier line is answered (H35)', async () => {
    const h = await jobHarness();
    await start(h, zigzag(15));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    const events = h.transports.at(-1)?.events ?? [];
    const decoder = new TextDecoder();
    let rx = '';
    let sentBefore = 0;
    let atM30 = -1;
    let linesBeforeM30 = 0;
    for (const e of events) {
      const text = decoder.decode(e.bytes);
      if (e.dir === 'r') rx += text;
      const jobAnswers = (rx.match(/\{"r":\{\},"f":\[3,\d+,\d+\]\}/g) ?? []).length;
      if (e.dir === 'w' && /^N\d+ /.test(text)) {
        if (/^N\d+ M30/.test(text)) {
          atM30 = jobAnswers;
          linesBeforeM30 = sentBefore;
        }
        sentBefore++;
      }
    }
    expect(atM30).toBe(linesBeforeM30);
  });
});

describe('T-S111: a refused line holds the job at that line (H70)', () => {
  it('holds, shows the status in plain words, and Skip line continues behind the confirm', async () => {
    const h = await jobHarness();
    model(h).injectRefusal(/^N6 /, 220, 1);
    const before = await start(h, zigzag(20));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'refused' && h.session.state.job?.confirmed === 2);
    const s = h.session.snapshot;
    expect(s.job?.refused).toMatchObject({ line: 6, status: 220 });
    expect(s.job?.message).toMatch(/^WARNING — The controller refused line 6 \(status 220: outside the soft limits\)/);
    expect(writes(h).slice(before)).toContain('!');
    expect(h.session.request({ intent: 'resume' })).toMatchObject({ allowed: false });
    expect(h.session.request({ intent: 'resume', skip: true })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    expect(h.session.snapshot.job?.phase).toBe('done');
  });
});

describe('T-S111: a refused line holds the job at that line (H70)', () => {
  it('Stop job after a refused line ends the job with the flush sequence', async () => {
    const h = await jobHarness();
    model(h).injectRefusal(/^N5 /, 132, 1);
    await start(h, zigzag(20));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'refused');
    h.session.stopJob();
    await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped');
    expect(h.session.snapshot.job?.phase).toBe('stopped');
  });
});

describe('plain words and lines', () => {
  it('names each refusal class (W38), and says "an error" for an unknown code', () => {
    expect(statusMeaning(TINYG_EN, 221)).toBe('outside the soft limits');
    expect(statusMeaning(TINYG_EN, 132)).toBe('an M code this firmware does not support');
    expect(statusMeaning(TINYG_EN, 106)).toBe('not accepted now');
    expect(statusMeaning(TINYG_EN, 107)).toBe('the line is too long');
    for (const c of [204, 205, 206]) expect(statusMeaning(TINYG_EN, c)).toBe('the controller is in alarm');
    expect(statusMeaning(TINYG_EN, 13)).toBe('the line or its answer was damaged');
    expect(statusMeaning(TINYG_EN, 240)).toBe('homing cycle failed');
    expect(statusMeaning(TINYG_EN, 9999)).toBe('an error');
  });
});

describe('more of the job layer, through its edges', () => {
  it('streaming guards: a line being written or a motion line waiting holds the job lines back', async () => {
    const s = withJob({ ...(await ready()), base: 'RUNNING', footerRev: 3 }, { phase: 'running', free: 12 });
    for (const b of [{ ...s, writing: { token: 'stat', purpose: 'poll' as const, seq: 1 } }, { ...s, queue: [{ token: 'gc', purpose: 'motion' as const, line: 'M5' }] }]) {
      const r = tx(b);
      pumpJob(r.t, true);
      expect(r.fx.filter((e) => e.kind === 'writeLine')).toEqual([]);
    }
    const r = tx(s);
    pumpJob(r.t, true);
    expect(r.fx.filter((e) => e.kind === 'writeLine').length).toBeGreaterThan(0);
  });
});

describe('more of the job layer, through its edges', () => {
  it('a second refused line is recorded only; a refusal while pausing, paused or stopping does not pause again', async () => {
    const s = withJob(await ready(), { phase: 'running', next: 3 });
    const refuse = (st: SessionState, index: number) => {
      const r = tx(st);
      onJobAnswer(r.t, { token: 'job', purpose: 'job', index }, { kind: 'Response', line: '', r: {}, footer: { rev: 3, status: 220, field3: 10, raw: [] } } as never, 0);
      return r;
    };
    const first = refuse(s, 1);
    expect(first.t.s.job?.phase).toBe('refused');
    const second = refuse(first.t.s, 2);
    expect(second.t.s.job?.refused?.index).toBe(1);
    for (const st of [withJob(s, { phase: 'pausing' }), withJob(s, { phase: 'paused' }), withJob(s, { stopping: true })]) {
      const r = refuse(st, 1);
      expect(r.fx.some((e) => e.kind === 'writeRealtime')).toBe(false);
      expect(r.t.s.job?.refused?.index).toBe(1);
    }
    const ended = refuse(withJob(s, { phase: 'stopped' }), 1);
    expect(ended.t.s.job?.refused).toBeNull();
  });
});
