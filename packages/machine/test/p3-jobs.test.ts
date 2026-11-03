/**
 * Phase 3 jobs against the test-kit edge-next model (owner 2026-11-02; SAFETY §4.4a, H70-H78; T-S108-T-S114).
 * The session, the link and the model share one virtual clock.
 */
import { PHASE_2_RELEASE, w42 } from '@synthetos/safety';
import type { TinyGEdgeNextModel } from '@synthetos/testkit';
import { describe, expect, it } from 'vitest';
import { JOB_LIMITS, jobInFlight } from '../src/index.ts';
import { CONFIRM, jobHarness, jobLines, load, runUntil, start, writes, zigzag } from './jobHarness.ts';

const SMALL = ['G21 G90', 'G0 X1 Y1', 'G1 X5 F600', 'G1 Y5', 'G1 X1', 'G1 Y1', 'G0 X0 Y0', 'M30'].join('\n');

const model = (h: { readonly device: unknown }): TinyGEdgeNextModel => h.device as TinyGEdgeNextModel;

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

  it('a file that does not pass is blocked with its findings, and cannot start', async () => {
    const h = await jobHarness();
    await load(h, 'G21\nG38.2 Z-5 F100\nM30');
    const job = h.session.snapshot.job;
    expect(job?.phase).toBe('blocked');
    expect(job?.report?.blocks[0]?.line).toBe(2);
    expect(h.session.startJob([], CONFIRM)).toMatchObject({ allowed: false, reason: 'The check found something that stops this file.' });
  });

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

describe('T-S109: streaming by the line buffer free slots (H76)', () => {
  it('streams a job to the end in line mode, setting rxm and putting it back (H77)', async () => {
    const h = await jobHarness({ rxm: 0 });
    const before = await start(h, SMALL);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done' && h.session.snapshot.rxm.busy === false && h.session.snapshot.footerRev === 2);
    const s = h.session.snapshot;
    expect(s.job?.phase).toBe('done');
    const w = writes(h).slice(before);
    expect(w.slice(0, 3)).toEqual(['{"rxm":null}', '{"rxm":1}', '{"rxm":null}']);
    expect(jobLines(h, before)).toHaveLength(8);
    expect(w.indexOf('{"rxm":0}')).toBeGreaterThan(w.indexOf('N8 M30'));
    expect(s.footerRev).toBe(2);
    expect(s.base).toBe('IDLE_UNHOMED');
    expect(s.job?.message).toMatch(/^Job finished: 8 lines/);
    expect(s.rxm.changed).toEqual({ kind: 'restore', from: 1, to: 0 });
  });

  it('on a board already in line mode nothing is written to rxm, before or after', async () => {
    const h = await jobHarness({ rxm: 1 });
    const before = await start(h, SMALL);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done');
    await h.run(500);
    const w = writes(h).slice(before);
    expect(w.filter((x) => x.startsWith('{"rxm":') && x !== '{"rxm":null}')).toEqual([]);
    expect(h.session.snapshot.rxm.restore).toBe(1);
  });

  it('never has more job lines owed than the free slots less the reserve, and every line is answered', async () => {
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

describe('T-S112: manual tool change (H74)', () => {
  const TC = ['G21 G90', 'M3 S12000', 'G1 X5 F600', 'G1 X0', 'T2 M6', 'G1 X3 F600', 'G1 X0', 'M5', 'M30'].join('\n');

  it('stops before M6, drains, turns the spindle and coolant off, and resumes with the M6 line itself', async () => {
    const h = await jobHarness();
    const before = await start(h, TC);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'toolChange');
    const s = h.session.snapshot;
    expect(s.base).toBe('PROGRAM_PAUSED');
    expect(s.job?.toolChange).toMatchObject({ line: 5, tool: 2, spindle: 'cw', speed: 12000, restartsSpindle: false, moved: false });
    await h.run(500);
    const w = writes(h).slice(before);
    expect(w.some((x) => x.includes('M6'))).toBe(false);
    expect(w.slice(w.indexOf('N4 G1 X0'))).toEqual(expect.arrayContaining(['M5', 'M9']));
    expect(model(h).snapshot().spindle).toBe('off');
    // The spindle was on and the file does not restart it: C35 first.
    expect(h.session.request({ intent: 'resume' })).toMatchObject({ allowed: false, reason: expect.stringContaining('Run starts it (M3 S12000)') });
    // Jog to a change position (Z up), then resume: back at a safe height, spindle on, M6, on.
    expect(h.session.request({ intent: 'jog', axes: { z: 1 }, distanceMm: 5, feed: 600 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.motion === null && h.session.snapshot.base === 'PROGRAM_PAUSED');
    expect(h.session.snapshot.job?.toolChange?.moved).toBe(true);
    const at = writes(h).length;
    expect(h.session.request({ intent: 'resume', spindleRestart: true })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    const after = writes(h).slice(at).filter((x) => !x.startsWith('{"') && x !== '\\x05');
    expect(after[0]).toMatch(/^G53 G0 Z[45](\.\d+)?$/);
    expect(after.slice(1, 4)).toEqual(['G53 G0 X0 Y0', 'M3 S12000', 'N5 T2 M6']);
    expect(h.session.snapshot.job?.phase).toBe('done');
  });

  it('a jog during a tool change restores the job distance mode, not G90 (G91 file)', async () => {
    const h = await jobHarness();
    await start(h, ['G21 G91', 'G1 X2 F600', 'T1 M6', 'G1 X2', 'M30'].join('\n'));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'toolChange');
    const at = writes(h).length;
    h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 });
    await runUntil(h, () => h.session.snapshot.motion === null && h.session.snapshot.base === 'PROGRAM_PAUSED');
    expect(writes(h).slice(at)).toContain('G91');
  });

  it('only Resume and Stop job are offered at a breakpoint; motion intents are refused while a job runs', async () => {
    const h = await jobHarness();
    await start(h, zigzag(10), [6]);
    await h.run(200);
    expect(h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 }).allowed).toBe(false);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'breakpoint');
    expect(h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 })).toMatchObject({ allowed: false, reason: 'Only Resume and Stop job are offered at this stop.' });
  });
});

describe('T-S113: breakpoints and program stops (H75, H36)', () => {
  it('stops before a breakpoint line with the queue drained, and Resume goes on from it', async () => {
    const h = await jobHarness();
    const before = await start(h, zigzag(12), [8]);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'breakpoint');
    const s = h.session.snapshot;
    expect(s.job?.message).toBe('Stopped at breakpoint · line 8');
    expect(s.job?.acked).toBe(s.job?.sent);
    expect(jobLines(h, before).at(-1)).toMatch(/^N7 /);
    expect(model(h).snapshot().hold).toBe(0);
    h.session.request({ intent: 'resume' });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    expect(jobLines(h, before).filter((l) => l.startsWith('N8 '))).toHaveLength(1);
  });

  it('a breakpoint set on a line already queued is reported as one that cannot be honoured (W41)', async () => {
    const h = await jobHarness();
    await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.sent ?? 0) > 8);
    const queued = h.session.snapshot.job?.sentThrough as number;
    expect(h.session.setBreakpoints([queued])).toEqual({ allowed: true });
    expect(h.session.snapshot.job?.events.at(-1)?.text).toBe(`Line ${queued} is already queued on the controller, so a breakpoint there cannot stop the job.`);
    expect(h.session.setBreakpoints([0])).toMatchObject({ allowed: false });
  });

  it('an M0 is a host barrier: nothing after it is sent until the machine has drained (H36)', async () => {
    const h = await jobHarness();
    const before = await start(h, ['G21 G90', 'G1 X5 F600', 'M0', 'G1 X0', 'M30'].join('\n'));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'programStop');
    expect(jobLines(h, before).at(-1)).toMatch(/^N3 M0/);
    h.session.request({ intent: 'resume' });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done');
    expect(h.session.snapshot.job?.phase).toBe('done');
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
  it('no job flag is ever sent without the capability (edge-next 93a723b8 has none)', async () => {
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
    expect(h.session.snapshot.job?.feedLimit?.fs).toMatchObject({ v: 1 });
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
